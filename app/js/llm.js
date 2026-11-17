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

const SYSTEM_PROMPT = `你是一个严谨的题库结构化和出题助手。用户会给你一段复习资料（可能是知识点整理、题目、讲义摘录），你需要把它整理成结构化的刷题题库。

【核心任务】
1. 提取资料中已有的题目，逐题结构化。
2. 对开放性题目（计算题、简答题、证明题、论述题），额外改写成选择题，方便自动判分和刷题。
3. 为每道题标注涉及的知识点标签（tags）。

【题型要求】
- 原文中已有 A/B/C/D 选项的选择题 → type 设为 "choice"，保留原选项。
- 原文中的填空题 → type 设为 "blank"，answer 为填空答案。
- 计算题/简答题/证明题/开放论述题 → 产出两条：
  a) 一条 type="calculation" 保留原开放题和完整答案/解析；
  b) 一条 type="choice" 由你改写：题干不变或等价改写，设计 4 个选项（1 个正确 + 3 个有代表性的干扰项，干扰项要体现典型错误），answer 为正确选项字母 A/B/C/D，explanation 说明为什么对、干扰项错在哪。
- 纯知识点陈述（没有题目）→ 若信息足够，围绕它出 1-3 道选择题巩固；否则跳过。

【输出格式】
严格输出一个 JSON 对象，不要任何 Markdown 代码块标记，不要解释文字。格式如下：
{
  "title": "题库名称（根据资料内容拟定，简洁）",
  "summary": "一句话说明这份资料覆盖了哪些知识点",
  "questions": [
    {
      "type": "choice | blank | calculation",
      "stem": "题干文字（数学公式用 LaTeX，如 $x^2$）",
      "options": ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
      "answer": "正确选项字母或填空/简答答案",
      "explanation": "解析：为什么正确，其他选项错在哪（简洁）",
      "tags": ["知识点1", "知识点2"],
      "origin": "original | rewritten"
    }
  ]
}

【严格要求】
- options 仅在 type="choice" 时提供，其余题型不要 options 字段。
- 干扰项必须合理，不能是明显错误的凑数选项。
- 数学公式用 LaTeX 表示（如 $x^2$），保证可读。
- 若资料内容过少或无法出题，返回 {"title":"...","summary":"...","questions":[]}。
- 只输出纯 JSON 对象，不要用代码块包裹。`;

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

  /** 结构化资料 → 题库对象。带一次 JSON 修复重试。 */
  async structure(text, onProgress) {
    const cfg = await this.getConfig();
    const err = this.validate(cfg);
    if (err) throw new Error(err);

    if (onProgress) onProgress('正在让模型阅读资料并出题…');
    let raw = await this.chat(cfg, text, SYSTEM_PROMPT);

    let parsed;
    try {
      parsed = this.parseJSON(raw);
    } catch (e) {
      if (onProgress) onProgress('整理结果格式有偏差，正在自动修正…');
      const fixPrompt = '把下面的内容修正为严格合法的 JSON 对象，只输出 JSON，不要任何解释或代码块标记：\n\n' + raw;
      raw = await this.chat(cfg, fixPrompt, '你是 JSON 格式修正助手，只输出合法 JSON。');
      parsed = this.parseJSON(raw);
    }

    return this.normalize(parsed);
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
