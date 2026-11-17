/* 大模型层：BYOK（用户自带 API Key），兼容 OpenAI Chat Completions 协议。
   Key 只存本地浏览器，不上传任何服务器。

   重要（CORS）：浏览器直连受服务商跨域策略限制。经查证，OpenRouter 明确开放
   浏览器直连（Access-Control-Allow-Origin: *），且一个 Key 覆盖所有主流模型、有免费额度，
   因此设为默认首选。国内多数厂商（DeepSeek/智谱/通义/Kimi）对网页来源跨域会拦截，
   仅作备用，可能在网页版里报"无法连接"。 */

const PRESETS = {
  openrouter: {
    name: 'OpenRouter（推荐 · 有免费模型）',
    base: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'deepseek/deepseek-chat-v3-0324:free',
    keyUrl: 'https://openrouter.ai/keys',
    browserOK: true
  },
  glm: {
    name: '智谱 GLM（可能受跨域限制）',
    base: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    browserOK: false
  },
  deepseek: {
    name: 'DeepSeek（可能受跨域限制）',
    base: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    browserOK: false
  },
  qwen: {
    name: '通义千问（可能受跨域限制）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    keyUrl: 'https://help.aliyun.com/zh/dashscope/developer-reference/api-key-settings',
    browserOK: false
  },
  kimi: {
    name: 'Kimi（可能受跨域限制）',
    base: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    browserOK: false
  },
  custom: {
    name: '自定义（OpenAI 兼容）',
    base: '',
    model: '',
    keyUrl: '',
    browserOK: null
  }
};

const SYSTEM_PROMPT = `你是一个严谨的题库生成助手。用户会给你一份复习资料（知识点整理、讲义、章节笔记，或现成的题目），你要把它变成可以直接刷的选择题库。

【第一原则：知识点整理也要出题，而且是主力场景】
原文里没有现成题目，不代表你没有题可出——把陈述句变成考题才是你的本职。
- 每个独立知识点（一个术语、一条规则、一个构成要件、一组例外情形、一个程序步骤），至少出 1 道题。
- 题量要跟知识点密度走：一份知识点整理，通常每 200–300 字就该有 1 道题。
- 绝不因为"原文只有陈述"就只象征性地出几道。用户要的是能练一天的题，不是 8 道。
- 遇到确实无法出题的内容（目录、编委会名单、纯致谢），跳过即可，不必勉强。

【第二原则：按章节组织】
- 资料里有"第X章 / 第X节 / 一、二、三、 / ## 标题"这类结构时，按章节分组出题。
- 每一章的题量见用户指令（默认每章 5 道）。章节内知识点多，可以适量多出，但不要把所有题压在第一章。
- 每道题的 tags 第一个元素写所属章节名（如 "第三章 公司的设立"），后面再写具体知识点。

【题型判定】
- 原文已有 A/B/C/D 选项的选择题 → type="choice"，保留原选项，origin="original"。
- 填空题 → type="blank"，answer 为填空答案。
- 简答 / 论述 / 案例分析 / 计算题 → 产出两条：
  a) type="calculation"，保留原题与完整答案，origin="original"；
  b) type="choice"，改写成四选一，origin="rewritten"，answer 为字母 A/B/C/D。
- 纯知识点陈述 → 直接出 type="choice"，不需要额外的开放题版本。

【出题质量】
- 考"是否真懂"，不是考"是否背过原句"：用小案例、条件判断、易混概念辨析、给错误表述让你挑错。
- 干扰项要像真的：把典型误区做成选项——张冠李戴（把 A 制度的条件套到 B）、条件记错（把"可以"记成"应当"）、例外当原则。
- 四个选项长度接近、表述同样正式，不要靠"明显很离谱"来凑数。
- 解析写两句：为什么对，其他选项错在哪。不要复述题干。

【输出格式】
严格输出一个 JSON 对象，不要 Markdown 代码块标记，不要任何解释文字：
{
  "title": "题库名称（简洁）",
  "summary": "一句话说明覆盖了哪些知识点",
  "questions": [
    {
      "type": "choice | blank | calculation",
      "stem": "题干",
      "options": ["A. …", "B. …", "C. …", "D. …"],
      "answer": "B",
      "explanation": "解析…",
      "tags": ["章节名", "知识点"],
      "origin": "original | rewritten"
    }
  ]
}

【严格要求】
- options 只在 type="choice" 时给，必须 4 个，以 "A. " "B. " 开头。
- 章节标题只用来组织，不要把它本身当成一道题。
- 数学公式用 LaTeX，如 $x^2$。
- 只输出纯 JSON 对象。`;

const LLM = {
  PRESETS,
  SYSTEM_PROMPT,

  /** 读取当前模型配置 */
  async getConfig() {
    const preset = await DB.getSetting('llmPreset', 'openrouter');
    const apiKey = await DB.getSetting('llmApiKey', '');
    const base = await DB.getSetting('llmBase', '');
    const model = await DB.getSetting('llmModel', '');
    return { preset, apiKey, base, model };
  },

  /** 保存模型配置 */
  async setConfig(cfg) {
    await DB.setSetting('llmPreset', cfg.preset);
    await DB.setSetting('llmApiKey', (cfg.apiKey || '').trim());
    await DB.setSetting('llmBase', (cfg.base || '').trim());
    await DB.setSetting('llmModel', (cfg.model || '').trim());
  },

  /** 校验配置是否完整 */
  validate(cfg) {
    if (!cfg.apiKey) return '请先填写 API Key（在「设置」里，各平台免费注册即可获取）';
    const p = PRESETS[cfg.preset] || PRESETS.custom;
    const endpoint = cfg.preset === 'custom' ? cfg.base : p.base;
    const model = cfg.preset === 'custom' ? cfg.model : p.model;
    if (!endpoint) return '自定义模式需要填写接口地址';
    if (!model) return '自定义模式需要填写模型名称';
    return null;
  },

  /** 调用大模型，返回纯文本 */
  async chat(cfg, userText, systemPrompt) {
    const p = PRESETS[cfg.preset] || PRESETS.custom;
    const endpoint = cfg.preset === 'custom' ? cfg.base : p.base;
    const model = cfg.preset === 'custom' ? cfg.model : p.model;

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
            { role: 'user', content: userText }
          ],
          temperature: 0.2,
          max_tokens: 8192
        })
      });
    } catch (e) {
      // fetch 抛错通常是网络不通或浏览器跨域（CORS）被拒
      throw new Error('无法连接到该服务商：可能是网络问题或浏览器跨域限制。建议到「设置」换一家服务商试试（如 DeepSeek），或检查网络后重试。');
    }

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json()).error?.message || ''; } catch (e) {}
      const hint = resp.status === 401 ? 'API Key 无效或已过期' :
                   resp.status === 429 ? '调用太频繁或额度用尽，稍后再试' :
                   resp.status === 404 ? '接口地址或模型名不对' : '';
      throw new Error(`模型调用失败（${resp.status}）${hint ? '：' + hint : ''}${detail ? ' — ' + detail : ''}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型返回内容为空，请重试');
    return content;
  },

  /* ---------- 按章节切分 ---------- */

  /** 识别章节标题行：Markdown 标题、第X章/节/讲、一、二、、（一） */
  isHeading(line) {
    const t = (line || '').trim();
    if (!t || t.length > 48) return false;
    return /^#{1,4}\s*\S/.test(t) ||
           /^第\s*[一二三四五六七八九十百千零〇\d]+\s*[章节讲篇部]/.test(t) ||
           /^[一二三四五六七八九十]+\s*[、．.]\s*\S/.test(t) ||
           /^[（(]\s*[一二三四五六七八九十]+\s*[）)]\s*\S/.test(t);
  },

  /** 太长的段按空行切开，保证每次请求不超限 */
  splitLong(seg, maxChars) {
    if (seg.text.length <= maxChars) return [seg];
    const paras = seg.text.split(/\n\s*\n/);
    const out = [];
    let buf = '';
    let n = 1;
    paras.forEach(p => {
      if (buf && (buf.length + p.length + 2) > maxChars) {
        out.push({ title: seg.title + (n > 1 ? '（续 ' + n + '）' : ''), text: buf.trim() });
        n++;
        buf = p;
      } else {
        buf = buf ? buf + '\n\n' + p : p;
      }
    });
    if (buf.trim()) out.push({ title: seg.title + (n > 1 ? '（续 ' + n + '）' : ''), text: buf.trim() });
    return out;
  },

  /** 按章节把资料切成若干段；没有章节结构时按长度切 */
  splitByChapter(text, maxChars) {
    maxChars = maxChars || 7000;
    const lines = text.split(/\r?\n/);
    const marks = [];
    lines.forEach((ln, i) => { if (this.isHeading(ln)) marks.push(i); });

    let segs;
    if (marks.length >= 2) {
      const bounds = marks[0] === 0 ? marks.slice() : [0].concat(marks);
      segs = bounds.map((start, i) => {
        const end = i + 1 < bounds.length ? bounds[i + 1] : lines.length;
        const head = lines[start].trim().replace(/^#{1,4}\s*/, '').slice(0, 40);
        const isPre = i === 0 && marks[0] !== 0;
        return { title: isPre ? '开头部分' : head, text: lines.slice(start, end).join('\n').trim() };
      });
    } else {
      segs = [{ title: '', text: text.trim() }];
    }

    const out = [];
    segs.forEach(s => out.push.apply(out, this.splitLong(s, maxChars)));
    return out.filter(s => s.text.trim().length > 0);
  },

  /** 把章节打包成若干次请求：一批最多 3 章、6000 字，保证每批都能出满题且不超输出上限 */
  planBatches(segs, maxBatches) {
    maxBatches = maxBatches || 12;
    const MAX_CHAPTERS = 3;
    const MAX_CHARS = 6000;
    const batches = [];
    let cur = null;
    segs.forEach(s => {
      const overflow = cur && (cur.count >= MAX_CHAPTERS || (cur.text.length + s.text.length + 2) > MAX_CHARS);
      if (!cur || overflow) {
        cur = { titles: [], text: '', count: 0 };
        batches.push(cur);
      }
      cur.titles.push(s.title);
      cur.text += (cur.text ? '\n\n' : '') + s.text;
      cur.count++;
    });
    batches.forEach(b => {
      b.title = b.titles.filter(Boolean)[0] || '';
      b.label = b.count > 1 ? (b.title ? b.title + ' 等 ' + b.count + ' 节' : b.count + ' 个小节') : (b.title || '整段');
    });
    const skippedChapters = batches.length > maxBatches
      ? batches.slice(maxBatches).reduce((n, b) => n + b.count, 0) : 0;
    return { batches: batches.slice(0, maxBatches), skippedChapters };
  },

  /** 拼每次请求的指令 + 正文 */
  buildUserText(batch, perChapter, idx, total) {
    const batchInfo = total > 1 ? `（第 ${idx + 1} / ${total} 批）` : '';
    const where = batch.label ? `当前处理：${batch.label}` : '当前处理：整份资料';
    const target = batch.count > 1
      ? `本批共 ${batch.count} 个章节，每个章节各出 ${perChapter} 道选择题（合计约 ${batch.count * perChapter} 道）。`
      : (batch.title
          ? `本段是「${batch.title}」，出 ${perChapter} 道选择题（知识点多可到 ${perChapter + 3} 道）。`
          : `本段没有明确章节，按知识点密度出题：每 200–300 字 1 道，总数不少于 ${perChapter} 道。`);

    return `${batchInfo}${where}
${target}
每个章节都必须有题，不要集中在开头几节；宁可多出，不要少出。

资料正文：
"""
${batch.text}
"""

按系统提示的要求输出 JSON。`;
  },

  /** 结构化资料 → 题库对象。按章节分批请求，合并去重。 */
  async structure(text, opts, onProgress) {
    if (typeof opts === 'function') { onProgress = opts; opts = {}; }
    opts = opts || {};
    const perChapter = Math.max(1, Math.min(20, parseInt(opts.perChapter, 10) || 5));

    const cfg = await this.getConfig();
    const err = this.validate(cfg);
    if (err) throw new Error(err);

    let segs = this.splitByChapter(text, 7000);
    if (!segs.length) segs = [{ title: '', text: text.trim() }];
    const plan = this.planBatches(segs, 12);
    const batches = plan.batches;

    const results = [];
    for (let i = 0; i < batches.length; i++) {
      const label = batches[i].label || ('第 ' + (i + 1) + ' 批');
      if (onProgress) {
        onProgress(batches.length > 1
          ? `正在出题：${label}（${i + 1}/${batches.length}）…`
          : '正在让模型阅读资料并出题…');
      }
      const userText = this.buildUserText(batches[i], perChapter, i, batches.length);
      let raw = await this.chat(cfg, userText, SYSTEM_PROMPT);
      let parsed;
      try {
        parsed = this.parseJSON(raw);
      } catch (e) {
        if (onProgress) onProgress(`「${label}」的格式有偏差，正在自动修正…`);
        raw = await this.chat(cfg,
          '把下面的内容修正为严格合法的 JSON 对象，只输出 JSON，不要任何解释或代码块标记：\n\n' + raw,
          '你是 JSON 格式修正助手，只输出合法 JSON。');
        parsed = this.parseJSON(raw);
      }
      results.push(this.normalize(parsed));
    }

    // 合并 + 按题干去重
    const seen = new Set();
    const questions = [];
    results.forEach(r => r.questions.forEach(q => {
      const key = q.stem.replace(/\s+/g, '').replace(/[，。；、？?！!：:（）()【】"“”'']/g, '').slice(0, 42);
      if (seen.has(key)) return;
      seen.add(key);
      questions.push(q);
    }));

    const titles = results.map(r => r.title).filter(Boolean);
    const title = titles.length ? titles[0] : '未命名题库';
    const summaries = results.map(r => r.summary).filter(Boolean);
    const head = summaries.length ? summaries[0] : '';
    const summary = (head ? head + '　' : '') +
      `共 ${segs.length} 节、${batches.length} 批处理，整理出 ${questions.length} 道题` +
      (plan.skippedChapters ? `（资料过长，末尾约 ${plan.skippedChapters} 节未处理，建议分批导入）` : '');

    return {
      title, summary, questions,
      segments: segs.length, batches: batches.length, skipped: plan.skippedChapters
    };
  },

  /** 从可能带代码块标记的文本中提取 JSON */
  parseJSON(raw) {
    let s = (raw || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    return JSON.parse(s);
  },

  /** 规范化模型输出，补齐字段、去重、生成 id */
  normalize(parsed) {
    const questions = (parsed.questions || []).filter(q => q && q.stem).map((q, i) => {
      const type = ['choice', 'blank', 'calculation'].includes(q.type) ? q.type : 'choice';
      let options = Array.isArray(q.options) ? q.options.map(String) : [];
      if (type === 'choice' && options.length < 2) {
        options = ['A. ' + (q.answer || ''), 'B. 其他', 'C. 其他', 'D. 其他'];
      }
      return {
        id: 'q_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 7),
        type: type,
        stem: String(q.stem),
        options: type === 'choice' ? options : [],
        answer: String(q.answer || ''),
        explanation: String(q.explanation || ''),
        tags: Array.isArray(q.tags) ? q.tags.map(String).slice(0, 5) : [],
        origin: q.origin === 'rewritten' ? 'rewritten' : 'original'
      };
    });
    return {
      title: String(parsed.title || '未命名题库').slice(0, 60),
      summary: String(parsed.summary || ''),
      questions: questions
    };
  }
};

window.LLM = LLM;
