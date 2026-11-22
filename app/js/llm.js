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
    name: '智谱 GLM（免费 · 桌面版可用）',
    base: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    browserOK: false
  },
  deepseek: {
    name: 'DeepSeek（便宜 · 桌面版可用）',
    base: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    browserOK: false
  },
  qwen: {
    name: '通义千问（桌面版可用）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    keyUrl: 'https://help.aliyun.com/zh/dashscope/developer-reference/api-key-settings',
    browserOK: false
  },
  kimi: {
    name: 'Kimi（桌面版可用）',
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

【反向题（"哪项错误"）必须自洽 —— 最容易出错，务必逐题自查】
- 题干问"以下哪项是错误的 / 不正确 / 不属于 / 表述有误"时，正确答案必须是那个**确实错**的选项，其余三个必须都是正确表述。
- 如果你凑不出一个确定是错的选项（四条法条都成立），**就不要出反向题**，把题干改成"以下哪项是正确的"，答案改为那唯一正确的一项。
- 解析必须与答案同向：答案项要说明"这句话错在哪"（错把什么记成了什么）。**绝不允许**出现"这是……义务之一""不是错误选项""该说法正确"这类与答案自相矛盾的话。
- 交卷前逐题复查：把 answer 指向的选项原文读一遍，确认它真的回答了题干所问；不一致就改答案或改题干，不要两个都留着。

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

/* 资料来源本身已经是一套题（试卷、练习册、ima 生成的题库）时用的提示词。
   与 SYSTEM_PROMPT 的根本区别：这里**禁止出题**，只做整理和补答案。 */
const EXTRACT_PROMPT = `你是题库整理助手。用户给你的资料**已经是一套现成的题目**（可能是试卷、课后练习、或别人生成的题库），你的任务是把它原样整理成结构化 JSON，而不是出题。

【最高原则：只整理，不出题】
- 原文有几道就整理几道，一道不多、一道不少。绝不自己补题，绝不把一道题拆成两道，也绝不合并。
- 题干原样保留：只清掉 Markdown 标记（**、#、>、多余空行），不要意译、不要精简、不要改写措辞、不要补全条件。
- **但原文题干本身就不完整时必须补全**（这条优先于上一条）：判断标准是题干读完后能否明确回答选出某个选项。
  - 只有标题/短语、没有问句（如"四个基本概念（数据/DB/DBMS/DBS）——选择题常考辨析""层次模型（IMS）vs 网状模型（DBTG）"）→ 不算完整题干，必须根据选项和原文补上明确的问题，例如"数据库、DB、DBMS、DBS 四个概念中，负责管理数据库的是哪一个？""IMS 和 DBTG 分别代表哪种数据模型？"。补全时只能在原文已有信息里组织措辞，不得引入原文没有的知识点；补好后 origin 仍填 "original"，answerSource 填 "inferred"。
  - 题干里有"____""（ ）""："等符号却没说明要填什么 → 补成完整问句。
  - 一个标题下面只列了几个名词、没有提问 → 这是知识点罗列，不是题目，跳过它，不要硬凑成题。
- 选项原样保留：保留原来的顺序和内容，统一写成 "A. …" "B. …" 的格式。
- 保持原文顺序和题号顺序，不要重新排列。
- 原文的章节标题、题型分组（"一、单项选择题"、"二、判断题"）不要单独当成题目，把分组名写进该题 tags 的第一个元素。

【答案与解析】
- 原文给了答案（如"答案：B"、括号里的字母、题末答案表）→ 照抄，answerSource 填 "source"。
- 原文**没给答案** → 你自己判断最可能的正确答案，answer 填字母，answerSource 填 "inferred"，explanation 写一两句依据（引原文条款或原理），方便用户核对。
- 原文有解析 → 保留原意，不要重写成长篇。
- 判断题原文写成"（ ）""对/错""√/×"的 → 转成两个选项："A. 正确" "B. 错误"，答案是 A 或 B。
- 多选题原文标注"多选"或答案有多个字母 → answer 写成字母组合，如 "ABD"，不要拆成单选。
- 没有选项的简答/名词解释 → type="calculation"，answer 写参考答案要点，不要改写成选择题。

【题型判定】
- 有 A/B/C/D 选项 → type="choice"。
- 填空（"____"或"（ ）"里填内容而非字母）→ type="blank"，answer 为填空内容。
- 简答 / 论述 / 案例分析 / 计算 → type="calculation"，保留原题与完整答案。
- 所有题目的 origin 一律填 "original"，不要填 "rewritten"。

【输出格式】
严格输出一个 JSON 对象，不要 Markdown 代码块标记，不要任何解释文字：
{
  "title": "题库名称（用原文标题，没有就按内容拟定）",
  "summary": "一句话说明这份题库的范围",
  "questions": [
    {
      "type": "choice | blank | calculation",
      "stem": "题干（原样）",
      "options": ["A. …", "B. …", "C. …", "D. …"],
      "answer": "B",
      "answerSource": "source | inferred",
      "explanation": "解析或答案依据",
      "tags": ["题型或章节名", "知识点"],
      "origin": "original"
    }
  ]
}

【严格要求】
- options 只在 type="choice" 时给。
- 数学公式用 LaTeX，如 $x^2$。
- 只输出纯 JSON 对象。`;

const LLM = {
  PRESETS,
  SYSTEM_PROMPT,
  EXTRACT_PROMPT,
  _proxyAvailable: null,

  /** 探测是否运行在桌面版（launcher.pyw 提供 /__proxy 与 /api/llm） */
  async hasProxy() {
    if (this._proxyAvailable !== null) return this._proxyAvailable;
    try {
      const r = await fetch('/__proxy', { cache: 'no-store' });
      this._proxyAvailable = r.ok && (await r.text()).includes('proxy-ok');
    } catch (e) {
      this._proxyAvailable = false;
    }
    return this._proxyAvailable;
  },

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

    const payload = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
        { role: 'user', content: userText }
      ],
      temperature: 0.2,
      max_tokens: 8192
    };

    // 桌面版：交给本地服务转发，绕开浏览器跨域限制，国产模型也能用
    const useProxy = await this.hasProxy();
    const targetUrl = useProxy ? '/api/llm' : endpoint;
    const fetchOpts = useProxy ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, apiKey: cfg.apiKey, payload })
    } : {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(payload)
    };

    let resp;
    try {
      resp = await fetch(targetUrl, fetchOpts);
    } catch (e) {
      // fetch 抛错通常是网络不通或浏览器跨域（CORS）被拒
      throw new Error(useProxy
        ? '本地转发失败：可能是网络中断，或大模型服务商拒绝了这个 Key。请检查网络后重试，或到「设置」确认 Key 有效。'
        : '无法连接到该服务商：浏览器跨域限制（网页版直连会被拦）。桌面版不受此限制；网页版请到「设置」改用 OpenRouter。');
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

  /** 判断这份资料是不是「已经是一套现成的题」——是的话就不用再让模型出题 */
  detect(text) {
    const t = String(text || '');
    const empty = { mode: 'generate', questions: 0, options: 0, answers: 0, hasAnswers: false };
    if (t.trim().length < 20) return empty;

    // 题号行：1. / 1、/ 第1题 / （1）
    // 光有题号+选项还不够：知识点罗列（"1. 四个基本概念——选择题常考辨析"）也会被误判成题目，
    // 所以题干本身必须像一道能回答的题（带问号或提问词），否则不算现成题。
    const looksLikeQuestion = (s) => /[？?]/.test(s)
      || /(以下|下列|哪个|哪些|哪项|哪一种|下列说法|是否正确|属于|不属于|正确的是|错误的是|是指|指的是|称为|等于|多少|如何|为什么|请|指出|判断|选出|表示|代表)/.test(s);
    let questions = 0;
    t.split(/\r?\n/).forEach(raw => {
      const ln = raw.trim().replace(/^[#>*\s]+/, '').replace(/\*+$/, '').trim();
      if (!ln || ln.length < 6) return;
      const numbered = /^(?:\d{1,3}|第\s*\d{1,3}\s*[题问])\s*[.、．)）:：]\s*(.+)$/.exec(ln)
        || /^[（(]\s*\d{1,3}\s*[）)]\s*(\S.{9,})$/.exec(ln);
      if (numbered && looksLikeQuestion(numbered[1] || '')) questions++;
    });
    if (!questions) return Object.assign({}, empty, { options: 0 });

    // 选项：行首 A. 或行内 A. xxx
    const headOpts = (t.match(/(?:^|\n)\s*[*#>\s]*[A-DＡ-Ｄ]\s*[.、．)）]/g) || []).length;
    const inlineOpts = (t.match(/(?:^|[^A-Za-z])[A-D]\s*[.、．)）]\s*\S/g) || []).length;
    const options = Math.max(headOpts, inlineOpts);

    // 答案痕迹："答案：B" / "正确答案" / 行尾（B）
    const answers = (t.match(/(?:参考)?答案\s*[:：]|正确答案|[（(]\s*[A-D]{1,4}\s*[）)]/g) || []).length;

    const isSet = questions >= 2 && options >= 4 && options >= questions * 1.6;
    return {
      mode: isSet ? 'extract' : 'generate',
      questions,
      options,
      answers,
      hasAnswers: answers >= Math.max(1, Math.ceil(questions / 3))
    };
  },

  /** 按题号把现成题目切成若干批（不按章节，因为试卷的题目才是最小单位） */
  splitByQuestion(text, maxQuestions, maxChars) {
    maxQuestions = maxQuestions || 10;
    maxChars = maxChars || 6000;
    const lines = String(text || '').split(/\r?\n/);
    const isStem = (ln) => {
      const t = ln.trim().replace(/^[#>*\s]+/, '').replace(/\*+$/, '').trim();
      if (!t || t.length < 6) return false;
      if (/^[A-DＡ-Ｄ]\s*[.、．)）]/.test(t)) return false;   // 选项行
      return /^(?:\d{1,3}|第\s*\d{1,3}\s*[题问])\s*[.、．)）:：]/.test(t) ||
             (/^[（(]\s*\d{1,3}\s*[）)]\s*\S/.test(t) && t.length > 10);
    };

    const marks = [];
    lines.forEach((ln, i) => { if (isStem(ln)) marks.push(i); });
    if (marks.length < 2) return [{ title: '', text: String(text || '').trim(), count: 0 }];

    // 第一个题号之前的内容（标题、说明）丢掉，只整理题目本身
    const blocks = marks.map((start, k) => {
      const end = k + 1 < marks.length ? marks[k + 1] : lines.length;
      return { no: k + 1, text: lines.slice(start, end).join('\n').trim() };
    });

    const batches = [];
    let cur = null;
    blocks.forEach(b => {
      const over = cur && (cur.count >= maxQuestions || (cur.text.length + b.text.length + 2) > maxChars);
      if (!cur || over) { cur = { text: '', count: 0, nos: [] }; batches.push(cur); }
      cur.nos.push(b.no);
      cur.text += (cur.text ? '\n\n' : '') + b.text;
      cur.count++;
    });

    return batches.map(b => ({
      title: b.nos.length > 1
        ? `第 ${b.nos[0]}–${b.nos[b.nos.length - 1]} 题`
        : `第 ${b.nos[0]} 题`,
      text: b.text,
      count: b.count
    }));
  },

  /** 整理模式每次请求的指令 + 原文 */
  buildExtractText(batch, idx, total) {
    const batchInfo = total > 1 ? `（第 ${idx + 1} / ${total} 批）` : '';
    const range = batch.title ? `本次范围：${batch.title}，` : '';
    return `${batchInfo}下面是资料里现成的题目。
${range}共 ${batch.count} 道，全部整理进来，一道都不能漏；不要新增题目、不要改写题干与选项、不要合并或拆分。

资料原文：
"""
${batch.text}
"""

按系统提示的要求输出 JSON。`;
  },

  /** 合并多批结果并按题干去重（保住原顺序） */
  mergeQuestions(results) {
    const seen = new Set();
    const questions = [];
    results.forEach(r => r.questions.forEach(q => {
      const key = q.stem.replace(/\s+/g, '').replace(/[，。；、？?！!：:（）()【】"“”'']/g, '').slice(0, 42);
      if (seen.has(key)) return;
      seen.add(key);
      questions.push(q);
    }));
    return questions;
  },

  /** 现成题目：只整理，不出新题 */
  async extractSet(text, cfg, onProgress) {
    const MAX_BATCHES = 8;
    let batches = this.splitByQuestion(text, 10, 6000);
    const totalQ = batches.reduce((n, b) => n + (b.count || 0), 0);
    const skipped = Math.max(0, batches.length - MAX_BATCHES);
    batches = batches.slice(0, MAX_BATCHES);

    const results = [];
    for (let i = 0; i < batches.length; i++) {
      const label = batches[i].title || ('第 ' + (i + 1) + ' 段');
      if (onProgress) {
        onProgress(batches.length > 1
          ? `正在整理原题：${label}（${i + 1}/${batches.length}）…`
          : '正在整理资料里的原题…');
      }
      const userText = this.buildExtractText(batches[i], i, batches.length);
      let raw = await this.chat(cfg, userText, EXTRACT_PROMPT);
      let parsed;
      try {
        parsed = this.parseJSON(raw);
      } catch (e) {
        if (onProgress) onProgress(`「${label}」格式有偏差，正在自动修正…`);
        raw = await this.chat(cfg,
          '把下面的内容修正为严格合法的 JSON 对象，只输出 JSON，不要任何解释或代码块标记：\n\n' + raw,
          '你是 JSON 格式修正助手，只输出合法 JSON。');
        parsed = this.parseJSON(raw);
      }
      results.push(this.normalize(parsed));
    }

    const questions = this.mergeQuestions(results);
    const inferred = questions.filter(q => q.answerSource === 'inferred').length;
    const guessed = totalQ && questions.length !== totalQ;

    const title = (results.map(r => r.title).filter(Boolean)[0]) || '未命名题库';
    const summary = `资料本身是现成题目：整理出 ${questions.length} 道` +
      (inferred ? `，其中 ${inferred} 道原文没给答案、由模型补答` : '') +
      (guessed ? `（原文约 ${totalQ} 道，${questions.length > totalQ ? '多出' : '少了'} ${Math.abs(questions.length - totalQ)} 道，建议核对）` : '') +
      (skipped ? `（资料过长，末尾 ${skipped} 批未处理，建议分批导入）` : '');

    return {
      title, summary, questions,
      mode: 'extract', inferred, totalQ,
      segments: batches.length, batches: batches.length, skipped
    };
  },

  /** 结构化资料 → 题库对象。已有现成题目时只整理；否则按章节分批出题。 */
  async structure(text, opts, onProgress) {
    if (typeof opts === 'function') { onProgress = opts; opts = {}; }
    opts = opts || {};
    const perChapter = Math.max(1, Math.min(20, parseInt(opts.perChapter, 10) || 5));

    const cfg = await this.getConfig();
    const err = this.validate(cfg);
    if (err) throw new Error(err);

    // 已有现成题目 → 整理；否则 → 出题
    const mode = opts.mode === 'extract' || opts.mode === 'generate'
      ? opts.mode
      : this.detect(text).mode;
    if (mode === 'extract') return this.extractSet(text, cfg, onProgress);

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
    const questions = this.mergeQuestions(results);

    const titles = results.map(r => r.title).filter(Boolean);
    const title = titles.length ? titles[0] : '未命名题库';
    const summaries = results.map(r => r.summary).filter(Boolean);
    const head = summaries.length ? summaries[0] : '';
    const summary = (head ? head + '　' : '') +
      `共 ${segs.length} 节、${batches.length} 批处理，整理出 ${questions.length} 道题` +
      (plan.skippedChapters ? `（资料过长，末尾约 ${plan.skippedChapters} 节未处理，建议分批导入）` : '');

    return {
      title, summary, questions, mode: 'generate',
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
  /** 生成后质检：抓明显的答案/解析自相矛盾（模型偶尔把"正确表述"标成错误答案） */
  audit(q) {
    const warns = [];
    const stem = String(q.stem || '').trim();
    // 题干不完整：只是标题/短语，读完后不知道要选什么
    const hasQuestion = /[？?]/.test(stem)
      || /(以下|下列|哪个|哪些|哪项|哪一种|下列说法|属于|不属于|正确|错误|是否有|能否|应该|应当|多少|如何|什么|为什么|请|指出|判断|选出|表示|代表|称为|指的是)/.test(stem);
    if (q.type === 'choice' && stem && !hasQuestion) {
      warns.push('题干疑似不完整：读起来像标题或短语，不像一道能回答的题');
    }
    if (q.type !== 'choice') return warns;
    const ans = String(q.answer || '').trim();
    const letters = (ans.toUpperCase().match(/[A-D]/g) || []);
    if (!letters.length) {
      warns.push('答案不是 A/B/C/D，没法自动判分');
    } else if (q.options.length && letters.some(l => l.charCodeAt(0) - 65 >= q.options.length)) {
      warns.push('答案字母超出了选项数量');
    }
    // 反向题：题干问"哪项错误"，解析却在说这一项是对的
    const reversed = /(哪|那)[一几]?[项个些]?[^。？?]{0,12}(错误|不正确|不属于|有误|不对)/.test(q.stem)
      || /(以下|下列)[^。？?]{0,10}(错误|不正确|不属于)/.test(q.stem);
    if (reversed) {
      const ex = String(q.explanation || '');
      if (/不是错误选项|不是错项|属于正确的|说法正确|表述正确|是正确的陈述|是正确的表述/.test(ex)) {
        warns.push('解析与答案疑似矛盾：题目问「哪项错误」，解析却说这个选项是对的');
      }
    }
    return warns;
  },

  normalize(parsed) {
    const questions = (parsed.questions || []).filter(q => q && q.stem).map((q, i) => {
      const type = ['choice', 'blank', 'calculation'].includes(q.type) ? q.type : 'choice';
      let options = Array.isArray(q.options) ? q.options.map(String) : [];
      if (type === 'choice' && options.length < 2) {
        options = ['A. ' + (q.answer || ''), 'B. 其他', 'C. 其他', 'D. 其他'];
      }
      const out = {
        id: 'q_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 7),
        type: type,
        stem: String(q.stem),
        options: type === 'choice' ? options : [],
        answer: String(q.answer || ''),
        explanation: String(q.explanation || ''),
        tags: Array.isArray(q.tags) ? q.tags.map(String).slice(0, 5) : [],
        origin: q.origin === 'rewritten' ? 'rewritten' : 'original'
      };
      // 答案来自原文还是模型自己补的（整理模式下用来提示用户核对）
      if (q.answerSource === 'inferred' || q.answerSource === 'source') {
        out.answerSource = q.answerSource;
      }
      const warns = this.audit(out);
      if (warns.length) out._warn = warns.join('；');
      return out;
    });
    return {
      title: String(parsed.title || '未命名题库').slice(0, 60),
      summary: String(parsed.summary || ''),
      questions: questions
    };
  }
};

window.LLM = LLM;
