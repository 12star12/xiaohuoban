/* 主应用：视图路由、导入生成、刷题流程、统计渲染。 */

const App = {
  currentBank: null,
  quizQueue: [],
  quizIndex: 0,
  quizAnswers: [],
  quizStartTs: 0,
  historyDays: 7,

  async init() {
    Achievements.startTracker();
    this.bindNav();
    this.bindImport();
    this.bindHistory();
    await this.renderSettings();
    await this.renderHome();
    // 桌面模式：显示「退出应用」按钮
    if (new URLSearchParams(location.search).get('desktop') === '1') {
      const btn = document.getElementById('btnExitApp');
      if (btn) btn.style.display = 'inline-flex';
    }
    // 定时刷新今日统计（每 20 秒，仅在首页）
    setInterval(() => {
      if (this.currentView === 'home') this.renderHome();
    }, 20000);
  },

  currentView: 'home',

  bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.view));
    });
  },

  /** 只切换视图 DOM，不触发渲染（供需要先切换再自行渲染的场景，避免异步竞态） */
  switchView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  go(view) {
    this.switchView(view);
    const renders = {
      home: () => this.renderHome(),
      library: () => this.renderLibrary(),
      import: () => this.renderModelStatus(),
      practice: () => this.renderPracticeSelect(),
      history: () => this.renderHistory(),
      wrong: () => this.renderWrong(),
      achievements: () => this.renderAchievements(),
      settings: () => this.renderSettings()
    };
    if (renders[view]) renders[view]();
  },

  /* ---------- 首页 ---------- */
  async renderHome() {
    const s = await Achievements.todayStats();
    const life = await Achievements.lifetimeStats();
    const hour = new Date().getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    document.getElementById('greeting').textContent = greet + '！';

    // 今日学习时长与对比
    document.getElementById('studyMin').textContent = this.fmtMin(s.studySeconds);
    const hist = await Achievements.history(2);
    const yesterday = hist.length >= 2 ? hist[hist.length - 2].studySeconds : 0;
    const todayMin = Math.floor(s.studySeconds / 60);
    const yestMin = Math.floor(yesterday / 60);
    let cmp = '今天也在慢慢积累呀 🌿';
    if (todayMin > yestMin && yestMin > 0) cmp = `比昨天多 ${todayMin - yestMin} 分钟 ↑`;
    else if (todayMin < yestMin) cmp = `比昨天少 ${yestMin - todayMin} 分钟，没关系~`;
    else if (todayMin === yestMin && todayMin > 0) cmp = '和昨天一样，稳稳的 🌿';
    document.getElementById('studyCompare').textContent = cmp;

    // 四项指标
    document.getElementById('statsGrid').innerHTML = `
      <div class="metric"><div class="metric-ico g">✅</div><div><div class="metric-val">${s.completed}</div><div class="metric-lbl">完成题目</div></div></div>
      <div class="metric"><div class="metric-ico o">⭐</div><div><div class="metric-val">${s.correct}</div><div class="metric-lbl">答对题目</div></div></div>
      <div class="metric"><div class="metric-ico o">🎯</div><div><div class="metric-val">${s.accuracy}<span style="font-size:12px">%</span></div><div class="metric-lbl">正确率</div></div></div>
      <div class="metric"><div class="metric-ico g">🌱</div><div><div class="metric-val">${s.mastered}</div><div class="metric-lbl">掌握知识点</div></div></div>
    `;

    // 目标进度
    document.getElementById('goalPanel').innerHTML = `
      <div class="goal-label">⭐ 今日学习目标：完成 <b>${s.goal}</b> 道题（${s.completed} / ${s.goal}）</div>
      <div class="goal-track"><div class="goal-fill" style="width:${s.goalPct}%"></div></div>
    `;

    // 成长足迹折线图（近 7 天完成题数）
    const week = await Achievements.history(7);
    this.renderGrowthChart(week);
    const streak = this.calcStreak(week);
    document.getElementById('streakBubble').textContent = `连续学习 ${streak} 天 🎉`;

    // 成就勋章
    document.getElementById('badgeDays').textContent = life.days;
    const { name: rankName, icon: rankIcon } = this.rankFor(life.days);
    document.getElementById('badgeRibbon').textContent = rankName;
    document.getElementById('badgeMedal').textContent = rankIcon;

    await this.renderDailyQuote();
  },

  fmtMin(sec) {
    const m = Math.floor((sec || 0) / 60);
    return String(m).padStart(2, '0');
  },

  /** 从近 N 天记录末尾往前数连续有学习行为的天数 */
  calcStreak(rows) {
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].attempts > 0 || rows[i].studySeconds > 0) streak++;
      else break;
    }
    return streak;
  },

  rankFor(days) {
    if (days >= 100) return { name: '学习宗师', icon: '👑' };
    if (days >= 30) return { name: '学习达人', icon: '🏆' };
    if (days >= 14) return { name: '学习小达人', icon: '🏅' };
    if (days >= 7) return { name: '学习小新星', icon: '🌟' };
    if (days >= 3) return { name: '学习新苗', icon: '🌱' };
    return { name: '启程小白', icon: '🌰' };
  },

  renderGrowthChart(rows) {
    const vals = rows.map(r => r.completed);
    const max = Math.max(1, ...vals);
    const labels = rows.map(r => {
      const d = new Date(r.date);
      return ['日','一','二','三','四','五','六'][d.getDay()];
    });
    const W = 320, H = 118, padX = 14, padTop = 12, padBottom = 22;
    const innerW = W - padX * 2, innerH = H - padTop - padBottom;
    const pts = vals.map((v, i) => ({
      x: padX + (innerW * i / Math.max(1, vals.length - 1)),
      y: padTop + innerH - (v / max) * innerH
    }));
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const area = line + ` L ${pts[pts.length-1].x.toFixed(1)},${padTop+innerH} L ${pts[0].x.toFixed(1)},${padTop+innerH} Z`;
    const dots = pts.map((p, i) => `<circle class="gc-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"><title>周${labels[i]}：${vals[i]} 题</title></circle>`).join('');
    const xlabels = pts.map((p, i) => `<text class="gc-label" x="${p.x.toFixed(1)}" y="${H-5}">周${labels[i]}</text>`).join('');
    document.getElementById('growthChart').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="gcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f4a259" stop-opacity=".28"/><stop offset="100%" stop-color="#f4a259" stop-opacity="0"/></linearGradient></defs>
        <path class="gc-area" d="${area}"/>
        <path class="gc-line" d="${line}"/>
        ${dots}${xlabels}
      </svg>`;
  },

  async renderDailyQuote() {
    const q = await Achievements.dailyQuote();
    document.getElementById('quoteCard').innerHTML = `
      <span class="tq-leaf">🍂</span>
      <button class="tq-refresh" onclick="App.refreshQuote()" title="换一句">换一句 ↻</button>
      <div class="tq-label">今日寄语</div>
      <div class="tq-zh">${this.esc(q.zh)}</div>
      ${q.en ? `<div class="tq-en">${this.esc(q.en)}</div>` : ''}
      <div class="tq-src">—— ${this.esc(q.author)}${q.work ? '　' + this.esc(q.work) : ''}${q.note ? '　(' + this.esc(q.note) + ')' : ''}</div>
    `;
  },

  async refreshQuote() {
    await Achievements.nextQuote();
    await this.renderDailyQuote();
  },

  /* ---------- 题库 ---------- */
  async renderLibrary() {
    const banks = await DB.getBanks();
    const el = document.getElementById('bankList');
    if (!banks.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty-mark">▤</div>
          <div class="empty-title">还没有题库</div>
          <div>导入你的复习资料，大模型会帮你整理成可刷的题库。<br>开放性题目会自动改写成选择题。</div>
          <div style="margin-top:18px"><button class="btn primary" onclick="App.showImport()">+ 导入第一份资料</button></div>
        </div>`;
      return;
    }
    banks.sort((a, b) => b.createdAt - a.createdAt);

    // 按学科文件夹分组（没设 folder 的旧题库归入「未分类」）
    const groups = {};
    banks.forEach(b => {
      const folder = b.folder || '未分类';
      (groups[folder] = groups[folder] || []).push(b);
    });
    const folderNames = Object.keys(groups).sort((a, b) => {
      if (a === '未分类') return 1;
      if (b === '未分类') return -1;
      return a.localeCompare(b, 'zh-CN');
    });

    el.innerHTML = folderNames.map(folder => {
      const items = groups[folder];
      const open = !(this._closedFolders && this._closedFolders.has(folder));
      const qCount = items.reduce((n, b) => n + (b.count || 0), 0);
      const cards = items.map(b => {
        const tags = (b.tags || []).slice(0, 6).map(t => `<span class="tag">${this.esc(t)}</span>`).join('');
        return `
        <div class="bank-item">
          <div>
            <div class="bank-title">${this.esc(b.name)}</div>
            <div class="bank-meta">${b.count} 道题 · ${new Date(b.createdAt).toLocaleDateString('zh-CN')}${b.summary ? ' · ' + this.esc(b.summary) : ''}</div>
            <div class="bank-tags">${tags}</div>
          </div>
          <div class="bank-actions">
            <button class="btn primary" onclick="App.startQuizById('${b.id}')">开始刷题</button>
            <button class="btn" onclick="App.renameBankFolder('${b.id}')">移动</button>
            <button class="btn" onclick="App.deleteBank('${b.id}')">删除</button>
          </div>
        </div>`;
      }).join('');
      return `
      <div class="folder-group">
        <div class="folder-head" onclick="App.toggleFolder('${this.esc(folder)}')">
          <span class="folder-caret ${open ? '' : 'collapsed'}">▾</span>
          <span class="folder-name">📁 ${this.esc(folder)}</span>
          <span class="folder-count">${items.length} 套题库 · ${qCount} 题</span>
          ${folder !== '未分类' ? `<button class="folder-rename" title="重命名文件夹" onclick="event.stopPropagation();App.renameFolder('${this.esc(folder)}')">✎</button>` : ''}
        </div>
        <div class="folder-body" style="display:${open ? 'block' : 'none'}">${cards}</div>
      </div>`;
    }).join('');
  },

  toggleFolder(name) {
    if (!this._closedFolders) this._closedFolders = new Set();
    if (this._closedFolders.has(name)) this._closedFolders.delete(name);
    else this._closedFolders.add(name);
    this.renderLibrary();
  },

  async renameFolder(oldName) {
    const name = prompt('把文件夹「' + oldName + '」重命名为：', oldName);
    if (!name || !name.trim() || name.trim() === oldName) return;
    const banks = await DB.getBanks();
    for (const b of banks) {
      if ((b.folder || '未分类') === oldName) {
        b.folder = name.trim();
        await DB.putBank(b);
      }
    }
    this.renderLibrary();
  },

  async renameBankFolder(bankId) {
    const banks = await DB.getBanks();
    const bank = banks.find(b => b.id === bankId);
    if (!bank) return;
    const folders = Array.from(new Set(banks.map(b => b.folder || '未分类')))
      .filter(f => f !== (bank.folder || '未分类'));
    const choice = prompt('移动题库「' + bank.name + '」到哪个学科？\n可直接输入新学科名' +
      (folders.length ? '，或选已有：' + folders.join('、') : ''), '');
    if (!choice || !choice.trim()) return;
    bank.folder = choice.trim();
    await DB.putBank(bank);
    await this.renderLibrary();
  },

  async deleteBank(id) {
    if (!confirm('确定删除这套题库及其所有答题记录吗？此操作不可恢复。')) return;
    await DB.deleteBank(id);
    await this.renderLibrary();
  },

  /* ---------- 导入与生成 ---------- */
  showImport() { this.go('import'); },

  /** 学科快捷标签：已有题库的学科 + 常用预设 */
  async renderFolderQuick() {
    const el = document.getElementById('folderQuick');
    if (!el) return;
    const banks = await DB.getBanks();
    const used = Array.from(new Set(banks.map(b => b.folder).filter(Boolean)));
    const presets = ['高等数学', '线性代数', '概率论', '计算机网络', '操作系统', '英语', '专业课'];
    const list = Array.from(new Set([...used, ...presets])).slice(0, 12);
    el.innerHTML = list.map(name =>
      `<button type="button" class="folder-chip" onclick="App.pickFolder('${this.esc(name)}')">${this.esc(name)}</button>`
    ).join('');
  },

  pickFolder(name) {
    const el = document.getElementById('importFolder');
    if (el) el.value = name;
  },

  bindImport() {
    this.renderFolderQuick();
    const ta = document.getElementById('importText');
    ta.addEventListener('input', () => {
      document.getElementById('charCount').textContent = ta.value.length + ' 字';
    });
    document.getElementById('importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      this.showLoading('正在读取 ' + f.name + ' …');
      try {
        let text = '';
        if (ext === 'pdf') {
          text = await this.readPdf(f);
        } else if (ext === 'docx' || ext === 'doc') {
          text = await this.readDocx(f);
        } else {
          text = await f.text();
        }
        ta.value = text;
        ta.dispatchEvent(new Event('input'));
        if (!text.trim()) {
          alert('这份文件里没有读到文字。如果是扫描版图片 PDF/Word，请先做 OCR 转成文字再上传。');
        }
      } catch (err) {
        alert('读取文件失败：' + err.message);
      } finally {
        this.hideLoading();
        e.target.value = '';
      }
    });
  },

  /** 用 pdf.js 提取 PDF 文字（逐页） */
  async readPdf(file) {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.js';
    }
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // 按行拼接：pdf.js 返回的 items 带坐标，简单按 Y 分组以保持换行
      const items = content.items || [];
      let line = '', lastY = null;
      const lines = [];
      items.forEach(it => {
        const y = it.transform ? Math.round(it.transform[5]) : 0;
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          lines.push(line);
          line = '';
        }
        line += (it.str || '');
        lastY = y;
      });
      if (line) lines.push(line);
      parts.push('【第 ' + i + ' 页】\n' + lines.join('\n'));
    }
    return parts.join('\n\n');
  },

  /** 用 mammoth 提取 Word（.docx）文字 */
  async readDocx(file) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || '';
  },

  async renderModelStatus() {
    const cfg = await LLM.getConfig();
    const err = LLM.validate(cfg);
    const p = LLM.PRESETS[cfg.preset] || LLM.PRESETS.custom;
    const el = document.getElementById('modelStatus');
    const isDesktop = await LLM.hasProxy();
    if (err) {
      const tip = isDesktop
        ? '先到 <a href="#" onclick="App.go(\'settings\')">设置</a> 填好 API Key。桌面版经本地转发，国产模型（智谱 GLM、DeepSeek 等）都能用。'
        : '先到 <a href="#" onclick="App.go(\'settings\')">设置</a> 填好 API Key。网页版建议用 OpenRouter（支持浏览器直连）。';
      el.innerHTML = `<div class="model-bad">⚠ ${this.esc(err)}</div>
        <p class="hint-text">${tip}</p>`;
      document.getElementById('genBtn').disabled = false;
    } else {
      el.innerHTML = `<div class="model-ok">✓ 已就绪：${this.esc(p.name)}</div>
        <p class="hint-text">Key 仅保存在本机${isDesktop ? '，经本地转发调用' : '浏览器'}。</p>`;
    }
  },

  async generate() {
    const text = document.getElementById('importText').value.trim();
    if (!text) { alert('请先粘贴或上传资料内容'); return; }
    if (text.length < 20) { alert('内容太少了，至少粘贴 20 个字以上'); return; }

    const btn = document.getElementById('genBtn');
    const sel = document.getElementById('perChapter');
    const perChapter = sel ? (parseInt(sel.value, 10) || 5) : 5;
    btn.disabled = true;
    this.showLoading('正在阅读资料并出题…');
    try {
      const result = await LLM.structure(text, { perChapter }, (msg) => this.setLoadingText(msg));
      if (!result.questions.length) {
        alert('模型没有从资料中提取到题目。试试粘贴更完整的题目或知识点内容。');
        return;
      }
      this._preview = result;
      this.renderPreview(result);
      if (result.skipped) {
        alert(`资料较长，只处理了前 ${result.segments} 段（末尾 ${result.skipped} 段未处理）。\n建议按章节拆成几份分别导入，题量会更完整。`);
      }
    } catch (e) {
      alert('生成失败：' + e.message);
    } finally {
      btn.disabled = false;
      this.hideLoading();
    }
  },

  renderPreview(result) {
    const area = document.getElementById('previewArea');
    const typeLabel = { choice: '选择题', blank: '填空题', calculation: '计算/简答题' };
    const suspect = result.questions.filter(q => q._warn).length;
    const items = result.questions.map((q, i) => {
      const ansKey = String(q.answer || '').trim().charAt(0).toUpperCase();
      const opts = (q.options || []).length ? `<div class="pv-opts">${q.options.map(o => {
        const hit = q.type === 'choice' && String(o).trim().charAt(0).toUpperCase() === ansKey;
        return `<div class="pv-opt ${hit ? 'hit' : ''}">${this.esc(o)}</div>`;
      }).join('')}</div>` : '';
      return `<div class="preview-q">
        <div class="preview-q-type">${i+1}. ${typeLabel[q.type] || q.type}${q.origin === 'rewritten' ? ' · 由开放题改写' : ''}　${(q.tags||[]).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}</div>
        <div class="preview-q-stem">${this.esc(q.stem)}</div>
        ${opts}
        <div class="pv-answer">答案 <b>${this.esc(q.answer)}</b>${q.explanation ? `<span class="pv-exp">${this.esc(q.explanation)}</span>` : ''}</div>
        ${q._warn ? `<div class="pv-warn">⚠ ${this.esc(q._warn)}</div>` : ''}
        <div class="pv-actions">
          <button class="btn" onclick="App.editAnswer(${i})">改答案</button>
          <button class="btn" onclick="App.dropQuestion(${i})">删掉这题</button>
        </div>
      </div>`;
    }).join('');
    area.innerHTML = `
      <div class="preview-box">
        <div class="preview-head">
          <div>
            <div class="panel-title" style="margin-bottom:2px">预览：${this.esc(result.title)}（共 ${result.questions.length} 题）</div>
            <div class="hint-text" style="margin-top:0">${this.esc(result.summary)}</div>
            ${suspect ? `<div class="pv-warn" style="margin-top:8px">有 ${suspect} 道题被系统标为「可能有问题」（答案与解析对不上），保存前建议逐题看一眼，或直接改答案 / 删掉。</div>` : ''}
          </div>
          <button class="btn primary" onclick="App.savePreview()">保存到题库</button>
        </div>
        ${items}
      </div>`;
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  editAnswer(i) {
    const q = this._preview && this._preview.questions[i];
    if (!q) return;
    const v = prompt('把这题的正确答案改成（选择题填字母）：', String(q.answer || ''));
    if (v === null || !v.trim()) return;
    q.answer = v.trim();
    delete q._warn;
    const w = LLM.audit(q);
    if (w.length) q._warn = w.join('；');
    this.renderPreview(this._preview);
  },

  dropQuestion(i) {
    const p = this._preview;
    if (!p) return;
    if (!confirm('确定删掉第 ' + (i + 1) + ' 题吗？')) return;
    p.questions.splice(i, 1);
    if (!p.questions.length) {
      this._preview = null;
      document.getElementById('previewArea').innerHTML = '';
      return;
    }
    this.renderPreview(p);
  },

  async savePreview() {
    const r = this._preview;
    if (!r) return;
    this.showLoading('正在保存…');
    try {
      const bankId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const folderEl = document.getElementById('importFolder');
      const folder = (folderEl && folderEl.value.trim()) || '未分类';
      await DB.putBank({
        id: bankId,
        name: r.title,
        folder: folder,
        summary: r.summary,
        count: r.questions.length,
        tags: Array.from(new Set(r.questions.flatMap(q => q.tags || []))),
        createdAt: Date.now()
      });
      await DB.putQuestions(r.questions.map(q => {
        const copy = Object.assign({}, q, { bankId });
        delete copy._warn;   // 质检标记不入库
        return copy;
      }));
      this._preview = null;
      document.getElementById('importText').value = '';
      document.getElementById('previewArea').innerHTML = '';
      this.hideLoading();
      alert('已保存到题库，可以去刷题了。');
      this.go('library');
    } catch (e) {
      this.hideLoading();
      alert('保存失败：' + e.message);
    }
  },

  /* ---------- 刷题 ---------- */
  async renderPracticeSelect() {
    const banks = await DB.getBanks();
    const el = document.getElementById('practiceBody');
    document.getElementById('practiceSub').textContent = '选择一套题库，开始今天的练习。';
    if (!banks.length) {
      el.innerHTML = `<div class="empty"><div class="empty-mark">✎</div>
        <div class="empty-title">还没有可以刷的题</div>
        <div>先去题库导入一份复习资料。</div>
        <div style="margin-top:18px"><button class="btn primary" onclick="App.showImport()">去导入资料</button></div></div>`;
      return;
    }
    el.innerHTML = `<div class="quiz-select">${banks.map(b => `
      <button class="quiz-card" onclick="App.startQuizById('${b.id}')">
        <div class="quiz-card-title">${this.esc(b.name)}</div>
        <div class="hint-text" style="margin-top:4px">${b.count} 道题 · 点击开始</div>
      </button>`).join('')}</div>`;
  },

  async startQuizById(bankId) {
    const bank = (await DB.getBanks()).find(b => b.id === bankId);
    if (!bank) return;
    let questions = await DB.getQuestions(bankId);
    if (!questions.length) { alert('这套题库没有题目'); return; }
    // 打乱顺序
    questions = questions.slice().sort(() => Math.random() - 0.5);
    this.currentBank = bank;
    this.quizQueue = questions;
    this.quizIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    // 用 switchView 而非 go：避免 go 触发的异步 renderPracticeSelect 覆盖题目
    this.switchView('practice');
    this.renderQuestion();
  },

  renderQuestion() {
    const el = document.getElementById('practiceBody');
    document.getElementById('practiceSub').textContent = this.currentBank.name;
    if (this.quizIndex >= this.quizQueue.length) {
      this.renderQuizDone();
      return;
    }
    const q = this.quizQueue[this.quizIndex];
    const typeLabel = { choice: '选择题', blank: '填空题', calculation: '计算 / 简答题' };
    let answerUI = '';
    if (q.type === 'choice') {
      answerUI = `<div class="quiz-options">${q.options.map((o, i) => {
        const key = String.fromCharCode(65 + i);
        return `<button class="quiz-option" data-key="${key}" onclick="App.selectChoice('${key}', this)"><span class="opt-key">${key}.</span>${this.esc(o.replace(/^[A-D][\.、]\s*/, ''))}</button>`;
      }).join('')}</div>
      <div class="quiz-footer"><span></span><button class="btn primary" id="submitBtn" disabled onclick="App.submitChoice()">提交答案</button></div>`;
    } else if (q.type === 'blank') {
      answerUI = `<input type="text" class="blank-input" id="blankInput" placeholder="输入你的答案">
      <div class="quiz-footer"><span></span><button class="btn primary" onclick="App.submitBlank()">提交答案</button></div>`;
    } else {
      answerUI = `<div class="answer-box ok" style="background:var(--paper-2);border-color:var(--line)">
        <div class="answer-label">参考答案</div>${this.esc(q.answer)}
        ${q.explanation ? '<div style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">' + this.esc(q.explanation) + '</div>' : ''}
      </div>
      <div style="margin-top:16px;font-size:13px;color:var(--ink-2)">刚才这道题，你掌握得怎么样？</div>
      <div class="self-assess">
        <button onclick="App.submitSelf('① 空白')">① 完全没思路</button>
        <button onclick="App.submitSelf('② 算错')">② 有思路算错</button>
        <button onclick="App.submitSelf('③ 慢但对')">③ 慢但对</button>
        <button onclick="App.submitSelf('④ 快而准')">④ 快而准</button>
      </div>`;
    }

    el.innerHTML = `
      <div class="quiz-stage">
        <div class="quiz-top">
          <div class="quiz-progress-txt">第 ${this.quizIndex+1} / ${this.quizQueue.length} 题</div>
          <div class="quiz-top-actions">
            <button class="btn" onclick="App.fixQuestion()" title="答案或解析对不上？点这里改">这题有误</button>
            <button class="btn" onclick="App.go('practice')">退出练习</button>
          </div>
        </div>
        <div class="quiz-q-card">
          <div class="quiz-q-num">${typeLabel[q.type] || '题目'}　${(q.tags||[]).slice(0,3).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}</div>
          <div class="quiz-q-stem">${this.esc(q.stem)}</div>
          <div id="answerZone">${answerUI}</div>
          <div id="feedbackZone"></div>
        </div>
      </div>`;
    this._selected = null;
    this._qStart = Date.now();
  },

  selectChoice(key, btn) {
    this._selected = key;
    document.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const sub = document.getElementById('submitBtn');
    if (sub) sub.disabled = false;
  },

  async submitChoice() {
    const q = this.quizQueue[this.quizIndex];
    const correct = this._selected === q.answer.trim().charAt(0).toUpperCase();
    document.querySelectorAll('.quiz-option').forEach(b => {
      const k = b.dataset.key;
      if (k === q.answer.trim().charAt(0).toUpperCase()) b.classList.add('correct');
      else if (k === this._selected) b.classList.add('wrong');
      b.onclick = null;
    });
    const sub = document.getElementById('submitBtn'); if (sub) sub.remove();
    await this.afterAnswer(correct, this._selected, q);
  },

  async submitBlank() {
    const q = this.quizQueue[this.quizIndex];
    const val = document.getElementById('blankInput').value.trim();
    if (!val) { alert('请输入答案'); return; }
    const correct = val.replace(/\s/g,'').toLowerCase() === q.answer.replace(/\s/g,'').toLowerCase();
    await this.afterAnswer(correct, val, q);
  },

  async submitSelf(assessment) {
    const q = this.quizQueue[this.quizIndex];
    const correct = assessment.indexOf('④') >= 0 || assessment.indexOf('③') >= 0;
    document.querySelectorAll('.self-assess button').forEach(b => b.onclick = null);
    await this.afterAnswer(correct, assessment, q);
  },

  async afterAnswer(correct, userAnswer, q) {
    const duration = Math.round((Date.now() - this._qStart) / 1000);
    await Achievements.recordAttempt({
      questionId: q.id, bankId: q.bankId || this.currentBank.id,
      userAnswer, correct, durationSec: duration
    });
    this.quizAnswers.push({ q, correct, userAnswer });

    const isRight = correct;
    document.getElementById('feedbackZone').innerHTML = `
      <div class="answer-box ${isRight ? 'ok' : 'no'}">
        <div class="answer-label">${isRight ? '答对了' : '再看看'}</div>
        ${q.explanation ? this.esc(q.explanation) : (isRight ? '继续保持。' : '正确答案：' + this.esc(q.answer))}
      </div>
      <div class="quiz-footer">
        <span></span>
        <button class="btn primary" onclick="App.nextQuestion()">${this.quizIndex+1 >= this.quizQueue.length ? '完成练习' : '下一题 →'}</button>
      </div>`;

    // 阶段性鼓励（每 10 题，非模态，不打断）
    const enc = await Achievements.maybeEncourage();
    if (enc) this.showEncourage(enc);
  },

  /** 题目答案/解析对不上时，就地改掉（写回题库，之后按新答案判分） */
  async fixQuestion() {
    const q = this.quizQueue[this.quizIndex];
    if (!q) return;
    const v = prompt('这题的正确答案应该是（选择题填字母 A/B/C/D）：', String(q.answer || ''));
    if (v === null || !v.trim()) return;
    q.answer = v.trim();
    const copy = Object.assign({}, q);
    delete copy._warn;
    try {
      await DB.putQuestions([copy]);
      alert('已修正。之后的判分按新答案来；之前答错的记录还在错题本里，重练一次就会更新。');
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  },

  nextQuestion() {
    this.quizIndex++;
    this.renderQuestion();
  },

  renderQuizDone() {
    const total = this.quizAnswers.length;
    const right = this.quizAnswers.filter(a => a.correct).length;
    const pct = total ? Math.round(right / total * 100) : 0;
    document.getElementById('practiceBody').innerHTML = `
      <div class="quiz-stage quiz-done">
        <div class="quiz-done-mark">✦</div>
        <div class="quiz-done-title">这一轮结束了</div>
        <p class="page-sub" style="margin-bottom:24px">完成 ${total} 题 · 答对 ${right} 题 · 正确率 ${pct}%</p>
        <p class="hint-text" style="margin-bottom:24px">${pct >= 80 ? '这批题你已经很熟了，可以休息一下。' : pct >= 50 ? '大体掌握了，错题可以回头再看。' : '别急，错题已经记进错题本，过两天再来。'}</p>
        <div class="quick-actions" style="justify-content:center">
          <button class="btn primary" onclick="App.retryLastQuiz()">再来一轮</button>
          <button class="btn" onclick="App.go('home')">回到今日</button>
          <button class="btn" onclick="App.go('wrong')">看错题本</button>
        </div>
      </div>`;
  },

  /* ---------- 学习历史 ---------- */
  bindHistory() {
    document.querySelectorAll('#historyRange .seg').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#historyRange .seg').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.historyDays = parseInt(b.dataset.days, 10);
        this.renderHistory();
      });
    });
  },

  async renderHistory() {
    const rows = await Achievements.history(this.historyDays);
    const active = rows.filter(r => r.attempts > 0 || r.studySeconds > 0);
    const maxMin = Math.max(1, ...rows.map(r => Math.floor(r.studySeconds / 60)));
    const el = document.getElementById('historyBody');
    if (!active.length) {
      el.innerHTML = `<div class="empty"><div class="empty-mark">◷</div><div class="empty-title">还没有学习记录</div><div>开始刷题后，这里会慢慢记下你走过的路。</div></div>`;
      return;
    }
    const body = rows.slice().reverse().map(r => {
      const min = Math.floor(r.studySeconds / 60);
      const barW = Math.round(min / maxMin * 70);
      const acc = r.accuracy === null ? '—' : r.accuracy + '%';
      const d = new Date(r.date);
      const wd = ['日','一','二','三','四','五','六'][d.getDay()];
      return `<tr>
        <td>${d.getMonth()+1}/${d.getDate()} <span style="color:var(--ink-3)">周${wd}</span></td>
        <td><span class="hist-bar" style="width:${barW}px"></span>${min} 分</td>
        <td>${r.completed}</td>
        <td>${acc}</td>
        <td>${r.tags.slice(0,4).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}${r.wrongTags.length ? ' <span style="color:var(--clay);font-size:11px">错题:'+r.wrongTags.slice(0,2).map(this.esc).join('/')+'</span>' : ''}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="hist-table">
        <thead><tr><th>日期</th><th>学习时长</th><th>完成题数</th><th>正确率</th><th>知识点 / 错题</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="hint-text">最近 ${this.historyDays} 天 · 共学习 ${active.length} 天 · 累计 ${Achievements.formatDuration(rows.reduce((s,r)=>s+r.studySeconds,0))}</p>`;
  },

  /* ---------- 错题本 ---------- */
  async renderWrong() {
    const list = await Achievements.wrongBook();
    const el = document.getElementById('wrongBody');
    if (!list.length) {
      el.innerHTML = `<div class="empty"><div class="empty-mark">◇</div><div class="empty-title">错题本是空的</div><div>很好，或者说明你还没开始刷——两种情况都值得高兴。</div></div>`;
      return;
    }

    const banks = await DB.getBanks();
    const bankMap = {};
    banks.forEach(b => bankMap[b.id] = b);
    const isLeft = x => !(x.lastAttempt && x.lastAttempt.correct);

    // 按学科文件夹归类（原题库被删的落到「未分类」）
    const groups = {};
    list.forEach(item => {
      const b = bankMap[item.question.bankId];
      const folder = (b && b.folder) || '未分类';
      (groups[folder] = groups[folder] || []).push(item);
    });
    const folderNames = Object.keys(groups).sort((a, b) => {
      if (a === '未分类') return 1;
      if (b === '未分类') return -1;
      return a.localeCompare(b, 'zh-CN');
    });

    const totalLeft = list.filter(isLeft).length;
    const head = `
      <div class="wrong-top">
        <div>
          <div class="wrong-sum">共 ${list.length} 道错题 · 分布在 ${folderNames.length} 个学科</div>
          <div class="hint-text">其中 ${totalLeft} 道最近一次仍做错。已经做对的会标「已攻克」，不再进入重练。</div>
        </div>
        <button class="btn primary" onclick="App.startWrongQuiz('')" ${totalLeft ? '' : 'disabled'}>全部再来一遍</button>
      </div>`;

    const body = folderNames.map(folder => {
      const items = groups[folder];
      const open = !(this._closedWrongFolders && this._closedWrongFolders.has(folder));
      const left = items.filter(isLeft).length;
      const cards = items.map(item => {
        const q = item.question;
        const solved = !isLeft(item);
        const bankName = (bankMap[q.bankId] || {}).name || '未知题库';
        return `<div class="preview-q">
          <div class="preview-q-type">${q.type === 'choice' ? '选择题' : '题目'} · ${this.esc(bankName)}${solved
            ? ' · <span style="color:var(--green)">已攻克</span>'
            : ' · <span style="color:var(--clay)">仍待攻克</span>'}</div>
          <div class="preview-q-stem">${this.esc(q.stem)}</div>
          <div class="answer-box ok" style="margin-top:10px;padding:10px 14px;font-size:12.5px">正确答案：${this.esc(q.answer)}</div>
        </div>`;
      }).join('');
      return `
      <div class="folder-group">
        <div class="folder-head" onclick="App.toggleWrongFolder('${this.esc(folder)}')">
          <span class="folder-caret ${open ? '' : 'collapsed'}">▾</span>
          <span class="folder-name">📁 ${this.esc(folder)}</span>
          <span class="folder-count">${items.length} 道错题 · ${left} 道待攻克</span>
          <button class="folder-action" ${left ? '' : 'disabled'} title="${left ? '只刷这个学科的错题' : '这个学科的错题都做对了'}"
            onclick="event.stopPropagation();App.startWrongQuiz('${this.esc(folder)}')">${left ? '刷这些 ↻' : '都攻克了'}</button>
        </div>
        <div class="folder-body" style="display:${open ? 'block' : 'none'}">${cards}</div>
      </div>`;
    }).join('');

    el.innerHTML = head + body;
  },

  toggleWrongFolder(name) {
    if (!this._closedWrongFolders) this._closedWrongFolders = new Set();
    if (this._closedWrongFolders.has(name)) this._closedWrongFolders.delete(name);
    else this._closedWrongFolders.add(name);
    this.renderWrong();
  },

  /** 错题重练：只把「最近一次仍做错」的题放进队列，可限定某个学科 */
  async startWrongQuiz(folderName) {
    const list = await Achievements.wrongBook();
    const banks = await DB.getBanks();
    const bankMap = {};
    banks.forEach(b => bankMap[b.id] = b);

    const pool = list.filter(item => {
      if (item.lastAttempt && item.lastAttempt.correct) return false;
      if (!folderName) return true;
      const b = bankMap[item.question.bankId];
      return ((b && b.folder) || '未分类') === folderName;
    });

    if (!pool.length) {
      alert(folderName
        ? `「${folderName}」里的错题都已经做对了，没有待攻克的题。`
        : '当前没有待攻克的错题，去刷点新题吧。');
      return;
    }

    const questions = pool.map(x => x.question).sort(() => Math.random() - 0.5);
    this.currentBank = {
      id: '__wrong__',
      name: folderName ? `错题重练 · ${folderName}` : '错题重练 · 全部',
      folder: folderName || ''
    };
    this.quizQueue = questions;
    this.quizIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this.switchView('practice');
    this.renderQuestion();
  },

  /** 练习结束页的「再来一轮」：错题轮次再练错题，普通轮次重刷本题库 */
  retryLastQuiz() {
    if (this.currentBank && this.currentBank.id === '__wrong__') {
      return this.startWrongQuiz(this.currentBank.folder || '');
    }
    return this.startQuizById(this.currentBank.id);
  },

  /* ---------- 成就勋章 ---------- */
  async renderAchievements() {
    const life = await Achievements.lifetimeStats();
    const rec = await Achievements.dailyRecords();
    const today = await Achievements.todayStats();
    const all = await DB.getAttempts();
    const totalQ = all.length;
    const right = all.filter(a => a.correct).length;
    const accuracy = totalQ ? Math.round(right / totalQ * 100) : 0;

    const groups = this.buildBadges(life.days, totalQ, accuracy, rec, today);
    const card = b => `
        <div class="ach-card ${b.got ? '' : 'locked'}">
          <div class="ach-medal">${b.got ? b.icon : '🔒'}</div>
          <div class="ach-name">${b.name}</div>
          <div class="ach-desc">${b.got ? b.desc : b.how}</div>
          ${!b.got && b.now ? `<div class="ach-now">${b.now}</div>` : ''}
        </div>`;

    document.getElementById('achievementBody').innerHTML = `
      <div class="ach-overview">
        <div class="ach-stat"><div class="ach-stat-val">${life.days}</div><div class="ach-stat-lbl">累计学习天数</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${Achievements.formatDuration(life.totalSeconds)}</div><div class="ach-stat-lbl">累计学习时长</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${rec.maxQ}<span style="font-size:13px"> 题</span></div><div class="ach-stat-lbl">最佳单日${rec.maxQDate ? ' · ' + rec.maxQDate.slice(5) : ''}</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${accuracy}%</div><div class="ach-stat-lbl">总正确率</div></div>
      </div>

      <div class="ach-sec">
        <div class="ach-sec-title">🔥 每日纪录<span class="ach-sec-sub">一天的高光也算数，今天二十道就值得夸</span></div>
        <div class="ach-grid">${groups.daily.map(card).join('')}</div>
      </div>

      <div class="ach-sec">
        <div class="ach-sec-title">🌿 长期成就<span class="ach-sec-sub">靠日积月累慢慢长出来</span></div>
        <div class="ach-grid">${groups.lifetime.map(card).join('')}</div>
      </div>

      <p class="hint-text">勋章按你真实的学习记录自动点亮，不需要打卡、也没有排名。慢慢来，比较快。</p>
    `;
  },

  buildBadges(days, totalQ, accuracy, rec, today) {
    rec = rec || { maxQ: 0, maxMinutes: 0, maxAccuracy: 0 };
    const todayQ = today ? today.completed : 0;
    const todayMin = today ? Math.floor(today.studySeconds / 60) : 0;

    const lifetime = [
      { name: '启程之芽', icon: '🌱', desc: '开始了，就是最好的一步', how: '学习满 1 天解锁', got: days >= 1 },
      { name: '三日新苗', icon: '🌿', desc: '连续的心血，正在发芽', how: '学习满 3 天解锁', got: days >= 3 },
      { name: '学习小新星', icon: '🌟', desc: '一周的坚持，很了不起', how: '学习满 7 天解锁', got: days >= 7 },
      { name: '学习小达人', icon: '🏅', desc: '两周如一日，稳稳向前', how: '学习满 14 天解锁', got: days >= 14 },
      { name: '百题斩', icon: '⚔️', desc: '一百次落笔，都是积累', how: '累计作答 100 题解锁', got: totalQ >= 100 },
      { name: '神射手', icon: '🎯', desc: '正确率超过八成，漂亮', how: '总正确率 ≥ 80% 且作答 ≥ 20 题解锁', got: accuracy >= 80 && totalQ >= 20 },
      { name: '学习达人', icon: '🏆', desc: '一个月的陪伴，已成习惯', how: '学习满 30 天解锁', got: days >= 30 },
      { name: '学习宗师', icon: '👑', desc: '百日筑基，厚积薄发', how: '学习满 100 天解锁', got: days >= 100 }
    ];

    const daily = [
      { name: '今日二十题', icon: '🥾', desc: '一天二十道，值得夸一句', how: '单日完成 20 题解锁', got: rec.maxQ >= 20, now: `今天 ${todayQ} / 20 题` },
      { name: '半百', icon: '🔥', desc: '一天五十道，很扎实', how: '单日完成 50 题解锁', got: rec.maxQ >= 50, now: `今天 ${todayQ} / 50 题` },
      { name: '百题日', icon: '💯', desc: '一天一百道，这一天值得记住', how: '单日完成 100 题解锁', got: rec.maxQ >= 100, now: `今天 ${todayQ} / 100 题` },
      { name: '两百题', icon: '🚀', desc: '一天两百道，状态在线', how: '单日完成 200 题解锁', got: rec.maxQ >= 200, now: `今天 ${todayQ} / 200 题` },
      { name: '一小时专注', icon: '⏳', desc: '单日学习满一小时', how: '单日学习 60 分钟解锁', got: rec.maxMinutes >= 60, now: `今天 ${todayMin} / 60 分钟` },
      { name: '两小时深耕', icon: '🕰️', desc: '单日学习满两小时', how: '单日学习 120 分钟解锁', got: rec.maxMinutes >= 120, now: `今天 ${todayMin} / 120 分钟` },
      { name: '神准日', icon: '🎯', desc: '单日正确率 90% 以上', how: '单日正确率 ≥ 90%（当天 ≥ 20 题）解锁', got: rec.maxAccuracy >= 90, now: `今天 ${today ? today.accuracy : 0}%` }
    ];

    return { lifetime, daily };
  },

  /* ---------- 设置 ---------- */
  async renderSettings() {
    const cfg = await LLM.getConfig();
    const presetSel = document.getElementById('setPreset');
    presetSel.innerHTML = Object.entries(LLM.PRESETS).map(([k, p]) =>
      `<option value="${k}" ${k === cfg.preset ? 'selected' : ''}>${p.name}</option>`).join('');
    document.getElementById('setApiKey').value = cfg.apiKey;
    document.getElementById('setBase').value = cfg.base;
    document.getElementById('setModel').value = cfg.model;
    document.getElementById('setGoal').value = await DB.getSetting('dailyGoal', 20);
    document.getElementById('setStep').value = await DB.getSetting('encourageStep', 10);
    this.onPresetChange();
  },

  onPresetChange() {
    const preset = document.getElementById('setPreset').value;
    const p = LLM.PRESETS[preset];
    document.getElementById('customFields').style.display = preset === 'custom' ? 'block' : 'none';
    const help = document.getElementById('presetHelp');
    let html = '';
    if (p.keyUrl) {
      html = `在 <a href="${p.keyUrl}" target="_blank" rel="noopener">这里免费注册并获取 API Key</a> ↗`;
    } else {
      html = '填写你的接口地址与模型名称，需兼容 OpenAI Chat Completions 协议。';
    }
    if (p.browserOK === false) {
      html += `<br><span style="color:#a56b4f">⚠ 该服务商对网页直连有跨域限制，在网页版里可能报「无法连接」。推荐用 OpenRouter。</span>`;
    } else if (p.browserOK === true) {
      html += `<br><span style="color:#4f6b5c">✓ 支持网页直连，最适合分享给朋友使用。</span>`;
    }
    help.innerHTML = html;
  },

  async saveSettings() {
    await LLM.setConfig({
      preset: document.getElementById('setPreset').value,
      apiKey: document.getElementById('setApiKey').value,
      base: document.getElementById('setBase').value,
      model: document.getElementById('setModel').value
    });
    alert('模型配置已保存到本机。');
    await this.renderModelStatus();
  },

  async savePrefs() {
    await DB.setSetting('dailyGoal', Math.max(1, parseInt(document.getElementById('setGoal').value, 10) || 20));
    await DB.setSetting('encourageStep', Math.max(1, parseInt(document.getElementById('setStep').value, 10) || 10));
    alert('学习偏好已保存。');
    this.renderHome();
  },

  async clearData() {
    if (!confirm('确定清除所有题库、答题记录和学习时长吗？此操作不可恢复。')) return;
    if (!confirm('请再次确认：真的要清空全部数据？')) return;
    await DB.clearAll();
    alert('已清空全部数据。');
    this.go('home');
  },

  async exitDesktop() {
    if (!confirm('确定退出应用吗？学习数据已自动保存，下次打开可继续。')) return;
    try { await fetch('/__quit'); } catch (e) { /* 已退出则忽略 */ }
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#8a6d52;background:#fdf7ee"><div style="text-align:center"><div style="font-size:44px">🌙</div><h2>已退出，可以关闭窗口了</h2><p style="opacity:.7">下次双击桌面图标即可继续学习</p></div></div>';
  },

  /* ---------- 鼓励弹窗 ---------- */
  showEncourage(enc) {
    document.getElementById('encourageText').textContent = enc.text;
    document.getElementById('encourageHeadline').textContent = `你已完成 ${enc.milestone} 道题！`;
    const t = document.getElementById('encourageToast');
    t.classList.add('show');
    clearTimeout(this._encTimer);
    this._encTimer = setTimeout(() => this.closeEncourage(), 8000);
  },
  closeEncourage() { document.getElementById('encourageToast').classList.remove('show'); },

  /* ---------- 工具 ---------- */
  showLoading(text) {
    this.setLoadingText(text);
    document.getElementById('loading').classList.add('show');
  },
  setLoadingText(text) { document.getElementById('loadingText').textContent = text; },
  hideLoading() { document.getElementById('loading').classList.remove('show'); },

  showOverlay(html) {
    document.getElementById('modal').innerHTML = html;
    document.getElementById('overlay').classList.add('show');
  },
  closeOverlay(e) {
    if (e && e.target !== document.getElementById('overlay')) return;
    document.getElementById('overlay').classList.remove('show');
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
