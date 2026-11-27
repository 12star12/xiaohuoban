/* 主应用：视图路由、导入生成、刷题流程、统计渲染。 */

const QUIZ_SESSION_KEY = 'hb_quiz_session_v1';

const App = {
  currentBank: null,
  quizQueue: [],
  quizIndex: 0,
  quizProgressIndex: 0,   // 下一题的位置：答完但还没点「下一题」时也指向已答完之后
  quizAnswers: [],
  quizStartTs: 0,
  historyDays: 7,

  async init() {
    Achievements.startTracker();
    this.bindNav();
    this.bindImport();
    this.bindHistory();
    try { this._favIds = new Set((await DB.getFavorites()).map(f => f.questionId)); }
    catch (e) { this._favIds = new Set(); }
    await this.refreshAttemptCounts();
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
    // 有没做完的一轮，打开应用就直接接回上次那一题
    const session = this.loadQuizSession();
    if (session) await this.applySession(session);
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
      import: () => { this.renderModelStatus(); this.detectImport(); },
      practice: () => this.goPractice(),
      history: () => this.renderHistory(),
      wrong: () => this.renderWrong(),
      favorites: () => this.renderFavorites(),
      achievements: () => this.renderAchievements(),
      settings: () => this.renderSettings()
    };
    if (renders[view]) renders[view]();
  },

  /** 每道题做过几次 + 每套题刷了几遍。
   *  遍数口径：一套题完整做完一轮算 1 遍。取这套题里「做得最少的那道题」的作答次数，
   *  个别题答错反复重做不会把整套题的遍数虚高。 */
  async refreshAttemptCounts() {
    try {
      const all = await DB.getAttempts();
      const m = {}, bankQuestions = {};
      all.forEach(a => {
        if (!a.questionId) return;
        m[a.questionId] = (m[a.questionId] || 0) + 1;
        if (a.bankId) {
          const qm = bankQuestions[a.bankId] || (bankQuestions[a.bankId] = {});
          qm[a.questionId] = (qm[a.questionId] || 0) + 1;
        }
      });
      this._attemptCounts = m;
      this._bankQuestions = bankQuestions;
    } catch (e) { this._attemptCounts = {}; this._bankQuestions = {}; }
  },

  attemptCount(qid) {
    return (this._attemptCounts && this._attemptCounts[qid]) || 0;
  },

  /** 这套题刷了几遍 = 做过的题里作答次数的最小值 */
  bankRounds(bankId) {
    const qm = this._bankQuestions && this._bankQuestions[bankId];
    if (!qm) return 0;
    const counts = Object.keys(qm).map(qid => qm[qid]);
    if (!counts.length) return 0;
    return Math.min.apply(null, counts);
  },

  doneBadge(qid) {
    const n = this.attemptCount(qid);
    return n ? `<span class="done-count">做过 ${n} 遍</span>` : '';
  },

  bankDoneBadge(bankId) {
    const n = this.bankRounds(bankId);
    return n ? `<span class="done-count">刷了 ${n} 遍</span>` : '';
  },

  /* ---------- 首页 ---------- */
  async renderHome() {
    const s = await Achievements.todayStats();
    const life = await Achievements.lifetimeStats();
    const hour = new Date().getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    document.getElementById('greeting').textContent = greet + '！';

    // 今日学习时长：按今天的表现给表扬，不和昨天/前天比——每天自己有进展就值得夸
    document.getElementById('studyMin').textContent = this.fmtMin(s.studySeconds);
    const todayMin = Math.floor(s.studySeconds / 60);
    let praise;
    if (todayMin === 0) praise = '今天还没开始，做一道题就出发 🌱';
    else if (todayMin < 20) praise = `今天已经学了 ${todayMin} 分钟，起步就很棒 👏`;
    else if (todayMin < 60) praise = `${todayMin} 分钟的专注，值得夸一句 ✨`;
    else if (todayMin < 120) praise = `今天学了 ${todayMin} 分钟，状态真不错 🔥`;
    else praise = `${todayMin} 分钟，今天这份认真太亮眼了 🌟`;
    document.getElementById('studyCompare').textContent = praise;

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

    // 小积分与今日待复习（都做成可点的入口）
    const pts = await Achievements.getPoints();
    document.getElementById('pointsStrip').innerHTML =
      `🏅 我的积分 <b>${pts.total}</b> <span class="today-only">今天 +${pts.today}</span> <span class="strip-arrow">去看看 ›</span>`;
    const rv = await Achievements.reviewStats();
    document.getElementById('reviewStrip').innerHTML = rv.due > 0
      ? `🧠 今天有什么知识可以复习 <span class="today-only">${rv.due} 道在等你</span> <span class="strip-arrow">去看看 →</span>`
      : `🧠 今天有什么知识可以复习 <span class="strip-goal">${rv.active ? `暂时都跟上了，下次还有 ${rv.active} 道排队` : '错题答错后会自动安排复习'}</span>`;
    document.getElementById('reviewStrip').style.cursor = rv.due > 0 ? 'pointer' : 'default';

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
    await this.refreshAttemptCounts();
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
      const folderRounds = Math.max.apply(null, [0].concat(items.map(b => this.bankRounds(b.id))));
      const cards = items.map(b => {
        const tags = (b.tags || []).slice(0, 6).map(t => `<span class="tag">${this.esc(t)}</span>`).join('');
        return `
        <div class="bank-item" id="bankItem_${b.id}">
          <div>
            <div class="bank-title"><span class="bank-title-link" onclick="App.toggleBankQuestions('${b.id}')" title="点击看这套题的题目">${this.esc(b.name)}</span> ${this.bankDoneBadge(b.id)}</div>
            <div class="bank-meta">${b.count} 道题 · ${new Date(b.createdAt).toLocaleDateString('zh-CN')}${b.summary ? ' · ' + this.esc(b.summary) : ''}</div>
            <div class="bank-tags">${tags}</div>
          </div>
          <div class="bank-actions">
            <button class="btn" onclick="App.toggleBankQuestions('${b.id}')">看题目</button>
            <button class="btn primary" onclick="App.startQuizById('${b.id}')">开始刷题</button>
            <button class="btn" onclick="App.renameBank('${b.id}')" title="给这套题（这一节）改名">改名</button>
            <button class="btn" onclick="App.renameBankFolder('${b.id}')">移动</button>
            <button class="btn" onclick="App.deleteBank('${b.id}')">删除</button>
          </div>
          <div class="bank-q-list" id="bankQ_${b.id}" style="display:none"></div>
        </div>`;
      }).join('');
      return `
      <div class="folder-group">
        <div class="folder-head" onclick="App.toggleFolder('${this.esc(folder)}')">
          <span class="folder-caret ${open ? '' : 'collapsed'}">▾</span>
          <span class="folder-name">📁 ${this.esc(folder)}</span>
          <span class="folder-count">${items.length} 套题库 · ${qCount} 题${folderRounds ? ' · 最多刷了 ' + folderRounds + ' 遍' : ''}</span>
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

  /** 展开/收起某套题库的题目列表（含答案与解析） */
  async toggleBankQuestions(bankId) {
    const box = document.getElementById('bankQ_' + bankId);
    if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = '<div class="bank-q-loading">正在读取题目…</div>';
    try {
      const qs = await DB.getQuestions(bankId);
      if (!qs.length) { box.innerHTML = '<div class="bank-q-loading">这套题库暂时没有题目。</div>'; return; }
      const letters = q => (String(q.answer || '').toUpperCase().match(/[A-D]/g) || []);
      box.innerHTML = qs.map((q, i) => {
        const type = q.type === 'choice' ? (letters(q).length > 1 ? '多选' : '单选')
          : q.type === 'blank' ? '填空' : '简答';
        const opts = (q.options || []).length ? `<div class="pv-opts">${q.options.map(o => {
          const k = String(o).trim().charAt(0).toUpperCase();
          return `<div class="pv-opt ${letters(q).indexOf(k) >= 0 ? 'hit' : ''}">${this.esc(o)}</div>`;
        }).join('')}</div>` : '';
        return `<div class="preview-q">
          <div class="preview-q-type">${i + 1}. ${type}${(q.tags || []).slice(0, 3).map(t => '<span class="tag">' + this.esc(t) + '</span>').join(' ')}</div>
          <div class="preview-q-stem">${this.formatStem(q.stem)}</div>
          ${opts}
          <div class="pv-answer">答案 <b>${this.esc(q.answer)}</b>${q.explanation ? `<span class="pv-exp">${this.esc(q.explanation)}</span>` : ''}</div>
        </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = '<div class="bank-q-loading">读取失败：' + this.esc(e.message) + '</div>';
    }
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

  /** 给一套题（一节）改名 */
  async renameBank(bankId) {
    const banks = await DB.getBanks();
    const bank = banks.find(b => b.id === bankId);
    if (!bank) return;
    const name = prompt('给这套题起个名字：', bank.name);
    if (!name || !name.trim() || name.trim() === bank.name) return;
    bank.name = name.trim();
    await DB.putBank(bank);
    await this.renderLibrary();
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
      this.detectImport();
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
    const batchInput = document.getElementById('batchFiles');
    if (batchInput) batchInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await this.batchImport(files);
    });
    this.updateBatchModeTip();
  },

  /** 批量模式说明文案 */
  updateBatchModeTip() {
    const el = document.getElementById('batchModeTip');
    if (!el) return;
    const m = (document.getElementById('batchMode') || {}).value || 'extract';
    el.textContent = m === 'extract' ? '批量默认按「整理原题」处理，不重新出题。'
      : m === 'generate' ? '批量会按章节让模型重新出题。'
      : '批量会逐份自动判断是现成题还是知识点。';
  },

  /** 从 md 内容里读题库名：题库名:/标题:/名称: → 一级标题 # → 文件名兜底 */
  extractMdName(text, fileName) {
    const lines = String(text || '').split(/\r?\n/);
    // 1) 显式标注：题库名：xxx / 标题：xxx / 名称：xxx
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const ln = lines[i].trim().replace(/^[#>*\s]+/, '').replace(/\*+$/, '').trim();
      const m = /^(?:题库名|题库名称|标题|名称|name)\s*[:：]\s*(.+)$/i.exec(ln);
      if (m && m[1].trim()) return m[1].trim().slice(0, 40);
    }
    // 2) Markdown 一级标题 # xxx（跳过纯分隔/empty）
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const m = /^#{1,2}\s+(.+?)\s*$/.exec(lines[i].trim());
      if (m && m[1].trim() && m[1].length <= 50) return m[1].trim().replace(/\*/g, '').slice(0, 40);
    }
    // 3) 文件名兜底
    return String(fileName || '未命名题库').replace(/\.(md|markdown|txt)$/i, '').slice(0, 40) || '未命名题库';
  },

  /* ---------- 导入模式：现成题目就只整理，知识点整理才让模型出题 ---------- */
  detectImport() {
    const ta = document.getElementById('importText');
    this._detect = LLM.detect(ta ? ta.value : '');
    this.applyImportMode();
  },

  /** 生效的模式：手动指定优先，其次用识别结果 */
  importMode() {
    if (this._importMode === 'extract' || this._importMode === 'generate') return this._importMode;
    return (this._detect && this._detect.mode) || 'generate';
  },

  /** 在「整理原题」和「让模型出题」之间手动切换 */
  toggleImportMode() {
    this._importMode = this.importMode() === 'extract' ? 'generate' : 'extract';
    this.applyImportMode();
  },

  applyImportMode() {
    const tag = document.getElementById('modeTag');
    const txt = document.getElementById('modeText');
    const btn = document.getElementById('modeBtn');
    if (!tag || !txt) return;

    const d = this._detect || { mode: 'generate', questions: 0 };
    const mode = this.importMode();
    const head = this._importMode ? '已按你的选择：' : '';
    const row = document.getElementById('perChapterRow');
    const hint = document.getElementById('perChapterHint');
    const gen = document.getElementById('genBtn');

    if (mode === 'extract') {
      const n = d.questions ? `（约 ${d.questions} 道）` : '';
      tag.textContent = '整理原题';
      tag.className = 'mode-tag ok';
      txt.textContent = head
        ? head + '原样整理资料里的题目，不额外出题。'
        : (d.mode === 'extract' ? `识别到这是现成题目${n}，` : '') + '原样整理，不额外出题。';
      if (btn) btn.textContent = '改让模型出题';
      if (row) row.style.display = 'none';
      if (hint) hint.style.display = 'none';
      if (gen) gen.textContent = '整理成题库';
    } else {
      tag.textContent = '让模型出题';
      tag.className = 'mode-tag';
      txt.textContent = head
        ? head + '按章节把知识点变成选择题。'
        : '没发现现成题目，按章节把知识点变成选择题。';
      if (btn) btn.textContent = '这是现成题目';
      if (row) row.style.display = '';
      if (hint) hint.style.display = '';
      if (gen) gen.textContent = '生成题库';
    }
    if (btn) btn.style.display = '';
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
    const mode = this.importMode();
    btn.disabled = true;
    this.showLoading(mode === 'extract' ? '正在整理资料里的原题…' : '正在阅读资料并出题…');
    try {
      const result = await LLM.structure(text, { perChapter, mode }, (msg) => this.setLoadingText(msg));
      if (!result.questions.length) {
        alert(mode === 'extract'
          ? '没整理出题目。如果这份资料其实是知识点整理，点右上角的「这是现成题目／改让模型出题」切回出题模式。'
          : '模型没有从资料中提取到题目。试试粘贴更完整的题目或知识点内容。');
        return;
      }
      this._preview = result;
      this.renderPreview(result);
      if (result.skipped) {
        alert(`资料较长，只处理了前 ${result.batches} 批（末尾约 ${result.skipped} 批未处理）。\n建议拆成几份分别导入，题量会更完整。`);
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
    const inferred = result.questions.filter(q => q.answerSource === 'inferred').length;
    const items = result.questions.map((q, i) => {
      const letters = (String(q.answer || '').toUpperCase().match(/[A-D]/g) || []);
      const kind = q.type === 'choice' ? (letters.length > 1 ? '多选题' : '单选题') : (typeLabel[q.type] || q.type);
      const flags = [
        q.origin === 'rewritten' ? '<span class="pv-flag">开放题改写</span>' : '',
        q.answerSource === 'inferred' ? '<span class="pv-flag warn">答案由模型补</span>' : ''
      ].join('');
      const opts = (q.options || []).length ? `<div class="pv-opts">${q.options.map(o => {
        const k = String(o).trim().charAt(0).toUpperCase();
        const hit = q.type === 'choice' && letters.indexOf(k) >= 0;
        return `<div class="pv-opt ${hit ? 'hit' : ''}">${this.esc(o)}</div>`;
      }).join('')}</div>` : '';
      return `<div class="preview-q">
        <div class="preview-q-type">${i+1}. ${kind}　${flags}${(q.tags||[]).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}</div>
        <div class="preview-q-stem">${this.formatStem(q.stem)}</div>
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
            <div class="panel-title" style="margin-bottom:2px">预览：${this.esc(result.title)}（共 ${result.questions.length} 题${result.mode === 'extract' ? ' · 原题整理' : ''}）</div>
            <div class="hint-text" style="margin-top:0">${this.esc(result.summary)}</div>
            ${result.fixes && result.fixes.length ? `<div class="pv-fix">✓ 导入前已优化资料格式：${this.esc(result.fixes.join('、'))}</div>` : ''}
            ${result.restored ? `<div class="pv-fix">✓ 已从原文还原 ${result.restored} 道题被模型省略的解析</div>` : ''}
            ${inferred ? `<div class="pv-warn" style="margin-top:8px">有 ${inferred} 道原文没给答案，是模型自己判断的，建议保存前核对一眼。</div>` : ''}
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
      const folderEl = document.getElementById('importFolder');
      const folder = (folderEl && folderEl.value.trim()) || '未分类';
      await this.saveBankObject(r, r.title, folder);
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

  /* ---------- 批量导入：多份 md 各自成库 ---------- */
  async batchImport(files) {
    const sel = document.getElementById('batchMode');
    const batchMode = sel ? (sel.value || 'extract') : 'extract';
    const perChapter = parseInt((document.getElementById('perChapter') || {}).value, 10) || 5;
    const folder = ((document.getElementById('importFolder') || {}).value || '').trim() || '未分类';
    const area = document.getElementById('batchArea');
    const results = [];
    this.showLoading(`准备批量导入 ${files.length} 份资料…`);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const prefix = `批量导入 ${i + 1}/${files.length}：`;
      try {
        this.setLoadingText(prefix + '读取文件…');
        let text = '';
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ext === 'pdf') text = await this.readPdf(f);
        else if (ext === 'docx' || ext === 'doc') text = await this.readDocx(f);
        else text = await f.text();

        if (!text.trim()) { results.push({ file: f.name, ok: false, msg: '文件里没有读到文字' }); continue; }
        if (text.trim().length < 20) { results.push({ file: f.name, ok: false, msg: '内容太少（不足 20 字）' }); continue; }

        const name = this.extractMdName(text, f.name);
        // 模式：显式指定则沿用；auto 则逐份识别
        const mode = batchMode === 'auto' ? (LLM.detect(text).mode || 'generate') : batchMode;
        this.setLoadingText(prefix + name + (mode === 'extract' ? ' · 整理原题…' : ' · 出题…'));
        const result = await LLM.structure(text, { perChapter, mode },
          (msg) => this.setLoadingText(prefix + name + ' · ' + msg));

        if (!result.questions.length) {
          results.push({ file: f.name, name, ok: false, msg: '没整理出题目' });
          continue;
        }
        await this.saveBankObject(result, name, folder);
        results.push({
          file: f.name, name, ok: true, count: result.questions.length,
          mode, skipped: result.skipped || 0, inferred: result.inferred || 0,
          restored: result.restored || 0, fixes: result.fixes || []
        });
      } catch (e) {
        results.push({ file: f.name, ok: false, msg: (e && e.message) || '处理失败' });
      }
    }

    this.hideLoading();
    this.renderBatchResult(results, folder);
  },

  /** 把一份生成结果落库（单份保存与批量共用） */
  async saveBankObject(result, name, folder) {
    const bankId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await DB.putBank({
      id: bankId,
      name: name || result.title || '未命名题库',
      folder: folder || '未分类',
      summary: result.summary || '',
      count: result.questions.length,
      tags: Array.from(new Set(result.questions.flatMap(q => q.tags || []))),
      createdAt: Date.now()
    });
    await DB.putQuestions(result.questions.map(q => {
      const copy = Object.assign({}, q, { bankId });
      delete copy._warn;
      return copy;
    }));
    return bankId;
  },

  renderBatchResult(results, folder) {
    const area = document.getElementById('batchArea');
    if (!area) return;
    const ok = results.filter(r => r.ok);
    const fail = results.filter(r => !r.ok);
    const rows = results.map(r => {
      if (!r.ok) return `<div class="batch-row bad"><span class="batch-ico">✗</span><div><b>${this.esc(r.file)}</b><div class="hint-text">${this.esc(r.msg)}</div></div></div>`;
      const warns = [];
      if (r.skipped) warns.push(`末尾约 ${r.skipped} 批未处理，建议拆细`);
      if (r.inferred) warns.push(`${r.inferred} 道答案由模型补，建议核对`);
      if (r.restored) warns.push(`还原 ${r.restored} 道原文解析`);
      return `<div class="batch-row"><span class="batch-ico">✓</span><div>
        <b>${this.esc(r.name)}</b> <span class="batch-count">${r.count} 题</span>
        <div class="hint-text">来自 ${this.esc(r.file)} · ${r.mode === 'extract' ? '整理原题' : '模型出题'}${warns.length ? ' · <span style="color:var(--clay)">' + this.esc(warns.join('；')) + '</span>' : ''}</div>
      </div></div>`;
    }).join('');
    area.innerHTML = `<div class="batch-result">
      <div class="batch-result-head">
        <div class="panel-title">批量导入完成</div>
        <div class="hint-text" style="margin-top:0">成功 ${ok.length} 份 · 共 ${ok.reduce((n, r) => n + r.count, 0)} 道题${fail.length ? ' · 失败 ' + fail.length + ' 份' : ''} · 归入「${this.esc(folder)}」</div>
      </div>
      <div class="batch-rows">${rows}</div>
      <div class="batch-actions"><button class="btn primary" onclick="App.go('library')">去看题库 →</button></div>
    </div>`;
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ---------- 刷题 ---------- */
  async renderPracticeSelect() {
    this.showTutor(false);
    await this.refreshAttemptCounts();
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
    const sessions = this.allQuizSessions();
    const byKey = {};
    sessions.forEach(x => { byKey[x.key] = x; });
    const jk = k => encodeURIComponent(k);
    const when = t => t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const resumeCards = sessions.map(x => `
      <div class="resume-card">
        <div>
          <div class="resume-title">⏳ ${this.esc((x.bank && x.bank.name) || '上次的练习')}</div>
          <div class="resume-meta">做到第 ${Math.min(x.index + 1, x.questions.length)} / ${x.questions.length} 题${when(x.savedAt) ? ' · ' + when(x.savedAt) : ''}</div>
        </div>
        <div class="resume-actions">
          <button class="btn primary" onclick="App.resumeQuiz(decodeURIComponent('${jk(x.key)}'))">接着做 →</button>
          <button class="btn" onclick="App.restartSession(decodeURIComponent('${jk(x.key)}'))">重开一轮</button>
          <button class="btn" onclick="App.discardQuizSession(decodeURIComponent('${jk(x.key)}'))">不续了</button>
        </div>
      </div>`).join('');
    // 今日待复习卡：艾宾浩斯到期的错题优先安排
    const rv = await Achievements.reviewStats();
    const reviewCard = rv.due > 0 ? `
      <div class="review-card">
        <div>
          <div class="review-card-title">🧠 今天有什么知识可以复习</div>
          <div class="hint-text" style="margin-top:4px">${rv.due} 道题按遗忘曲线排到了今天，趁快忘了再记一遍最牢 · 另有 ${rv.active - rv.due} 道在排队</div>
        </div>
        <button class="btn primary" onclick="App.startReviewQuiz()">开始复习 →</button>
      </div>` : '';

    // 交错练习开关：把各题库打散混着刷，更接近真实考试
    const mixOn = !!this.interleaved;
    const mixBar = `
      <div class="mix-bar">
        <div>
          <div class="mix-title">🔄 交错混合练习</div>
          <div class="hint-text">把 ${banks.length} 套题库打乱混在一起刷，比一科一科刷更抗遗忘</div>
        </div>
        <button class="toggle ${mixOn ? 'on' : ''}" onclick="App.toggleInterleave()" aria-pressed="${mixOn}"><span></span></button>
      </div>`;

    const cards = mixOn
      ? `<div class="quiz-select"><button class="quiz-card mix-card" onclick="App.startMixedQuiz()">
          <div class="quiz-card-title">开始混合练习 ${this.bankDoneBadge('__mix__')}</div>
          <div class="hint-text" style="margin-top:4px">从 ${banks.length} 套题库抽取 · 点击开始</div>
        </button></div>`
      : `<div class="quiz-select">${banks.map(b => {
          const x = byKey[this.sessionKeyFor(b)];
          const act = x ? `App.resumeQuiz(decodeURIComponent('${jk(x.key)}'))` : `App.startQuizById('${b.id}')`;
          const done = this.bankDoneBadge(b.id);
          const hint = x ? `第 ${Math.min(x.index + 1, x.questions.length)} / ${x.questions.length} 题 · 点击继续` : `${b.count} 道题 · 点击开始`;
          return `<button class="quiz-card" onclick="${act}">
            <div class="quiz-card-title">${this.esc(b.name)} ${done}</div>
            <div class="hint-text" style="margin-top:4px">${hint}</div>
          </button>`;
        }).join('')}</div>`;

    el.innerHTML = reviewCard + (resumeCards ? `<div class="resume-list" style="margin-top:14px">${resumeCards}</div>` : '')
      + `<div style="margin-top:14px">${mixBar}</div>`
      + `<div style="margin-top:14px">${cards}</div>`;
  },

  toggleInterleave() {
    this.interleaved = !this.interleaved;
    this.renderPracticeSelect();
  },

  /** 交错混合：从所有题库抽题打散成一整轮 */
  async startMixedQuiz() {
    const banks = await DB.getBanks();
    if (!banks.length) return;
    const groups = await Promise.all(banks.map(b => DB.getQuestions(b.id)));
    let questions = [];
    groups.forEach(qs => { questions = questions.concat(qs); });
    if (!questions.length) { alert('题库里还没有题目'); return; }
    questions = questions.slice().sort(() => Math.random() - 0.5);
    this.currentBank = { id: '__mix__', name: '交错混合练习', folder: '' };
    this.quizQueue = questions;
    this.quizIndex = 0;
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(this.currentBank);
    this.saveQuizSession();
    this.switchView('practice');
    this.renderQuestion();
  },

  /** 间隔复习：只刷今天到期（含逾期）的错题 */
  async startReviewQuiz() {
    const due = await Achievements.dueReviews();
    if (!due.length) { alert('今天没有到期的复习题，继续保持就好～'); return; }
    const all = await DB.allQuestions();
    const qMap = {}; all.forEach(q => qMap[q.id] = q);
    let questions = due.map(r => qMap[r.questionId]).filter(Boolean);
    if (!questions.length) { alert('这些复习题的原题库已被删除，没有可复习的内容'); return; }
    questions = questions.slice().sort(() => Math.random() - 0.5);
    this.currentBank = { id: '__review__', name: `今日复习 · ${questions.length} 道`, folder: '' };
    this.quizQueue = questions;
    this.quizIndex = 0;
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(this.currentBank);
    this.saveQuizSession();
    this.switchView('practice');
    this.renderQuestion();
  },

  /* ---------- 断点续练：每个学科各存一份，切学科不互相覆盖 ---------- */
  sessionKeyFor(bank) {
    if (!bank) return '';
    if (bank.id === '__wrong__') return 'wrong:' + (bank.folder || '');
    if (bank.id === '__fav__') return 'fav:' + (bank.favBankId || '');
    if (bank.id === '__mix__' || bank.id === '__review__') return 'special:' + bank.id;
    return 'bank:' + bank.id;
  },

  readSessionStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(QUIZ_SESSION_KEY) || 'null');
      if (!raw) return { sessions: {}, lastKey: '' };
      // 兼容旧版单槽存档
      if (raw.bank && Array.isArray(raw.questions)) {
        const key = this.sessionKeyFor(raw.bank) || 'legacy';
        return { sessions: { [key]: Object.assign({}, raw, { key }) }, lastKey: key };
      }
      if (!raw.sessions || typeof raw.sessions !== 'object') return { sessions: {}, lastKey: '' };
      return { sessions: raw.sessions, lastKey: raw.lastKey || '' };
    } catch (e) { return { sessions: {}, lastKey: '' }; }
  },

  writeSessionStore(store) {
    try { localStorage.setItem(QUIZ_SESSION_KEY, JSON.stringify(store)); } catch (e) {}
  },

  saveQuizSession(indexOverride) {
    if (!this.currentBank || !this.quizQueue || !this.quizQueue.length) return;
    const key = this._sessionKey || this.sessionKeyFor(this.currentBank);
    if (!key) return;
    this._sessionKey = key;
    const store = this.readSessionStore();
    store.sessions[key] = {
      key,
      bank: Object.assign({}, this.currentBank),
      questions: this.quizQueue,
      index: typeof indexOverride === 'number' ? indexOverride : Math.max(this.quizProgressIndex || 0, this.quizIndex),
      answers: (this.quizAnswers || []).map(a => ({
        qid: a.q && a.q.id, correct: !!a.correct, userAnswer: a.userAnswer
      })),
      savedAt: Date.now()
    };
    store.lastKey = key;
    this.writeSessionStore(store);
  },

  normalizeSession(s, key) {
    if (!s || !Array.isArray(s.questions) || !s.questions.length) return null;
    s.key = key || s.key || '';
    s.index = Math.max(0, Math.min(Number(s.index) || 0, s.questions.length));
    s.answers = Array.isArray(s.answers) ? s.answers : [];
    s.bank = s.bank || { id: '__resume__', name: '上次的练习' };
    return s;
  },

  loadQuizSession(key) {
    const store = this.readSessionStore();
    const k = key || store.lastKey;
    if (!k || !store.sessions[k]) return null;
    return this.normalizeSession(store.sessions[k], k);
  },

  allQuizSessions() {
    const store = this.readSessionStore();
    return Object.keys(store.sessions)
      .map(k => this.normalizeSession(store.sessions[k], k))
      .filter(Boolean)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },

  clearQuizSession(key) {
    const store = this.readSessionStore();
    const k = key || this._sessionKey;
    if (!k) return;
    delete store.sessions[k];
    if (store.lastKey === k) {
      const rest = Object.keys(store.sessions)
        .map(kk => ({ k: kk, t: store.sessions[kk].savedAt || 0 }))
        .sort((a, b) => b.t - a.t);
      store.lastKey = rest.length ? rest[0].k : '';
    }
    this.writeSessionStore(store);
  },

  async goPractice() {
    // 从侧栏点「开始练习」时，有未做完的进度就直接接上最近那一套
    const s = this.loadQuizSession();
    if (s && await this.applySession(s)) return;
    this.renderPracticeSelect();
  },

  async resumeQuiz(key) {
    const s = this.loadQuizSession(key);
    if (s && await this.applySession(s)) return;
    this.renderPracticeSelect();
  },

  async restartSession(key) {
    const s = this.loadQuizSession(key);
    if (!s) return;
    this.clearQuizSession(key);
    if (s.bank && s.bank.id === '__wrong__') return this.startWrongQuiz(s.bank.folder || '');
    if (s.bank && s.bank.id === '__fav__') return this.startFavoriteQuiz(s.bank.favBankId || '');
    return this.startQuizById(s.bank.id);
  },

  discardQuizSession(key) {
    this.clearQuizSession(key);
    if (!key || key === this._sessionKey) {
      this.currentBank = null;
      this.quizQueue = [];
      this.quizIndex = 0;
      this.quizProgressIndex = 0;
      this.quizAnswers = [];
    }
    this.renderPracticeSelect();
  },

  async applySession(s) {
    if (!s || !Array.isArray(s.questions) || !s.questions.length) return false;
    this._sessionKey = s.key || this.sessionKeyFor(s.bank);
    this.currentBank = s.bank;
    this.quizQueue = s.questions;
    this.quizIndex = s.index;
    this.quizProgressIndex = s.index;
    this.quizAnswers = (s.answers || []).map(a => ({
      q: s.questions.find(q => q.id === a.qid) || null,
      correct: !!a.correct,
      userAnswer: a.userAnswer
    }));
    this.quizStartTs = s.savedAt || Date.now();
    this.switchView('practice');
    if (this.quizIndex >= this.quizQueue.length) {
      this.clearQuizSession();
      this.renderQuizDone();
    } else {
      this.renderQuestion();
    }
    return true;
  },

  /** 题目里的「退出练习」：保留进度，回到题库选择页 */
  exitQuiz() {
    this.saveQuizSession();
    this.switchView('practice');
    this.renderPracticeSelect();
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
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(bank);
    this.saveQuizSession();
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
    const ansLetters = (String(q.answer || '').toUpperCase().match(/[A-D]/g) || []);
    const isMulti = q.type === 'choice' && ansLetters.length > 1;
    const kindLabel = q.type === 'choice' ? (isMulti ? '多选题' : '单选题') : (typeLabel[q.type] || '题目');
    let answerUI = '';
    if (q.type === 'choice') {
      answerUI = `<div class="quiz-options">${q.options.map((o, i) => {
        const key = String.fromCharCode(65 + i);
        return `<button class="quiz-option" data-key="${key}" onclick="App.selectChoice('${key}', this)"><span class="opt-key">${key}.</span>${this.esc(o.replace(/^[A-D][\.、]\s*/, ''))}</button>`;
      }).join('')}</div>
      <div class="quiz-footer"><span>${isMulti ? '多选题 · 选出全部正确项' : ''}</span><button class="btn primary" id="submitBtn" disabled onclick="App.submitChoice()">提交答案</button></div>`;
    } else if (q.type === 'blank') {
      answerUI = `<input type="text" class="blank-input" id="blankInput" placeholder="输入你的答案">
      <div class="quiz-footer"><span></span><button class="btn primary" onclick="App.submitBlank()">提交答案</button></div>`;
    } else {
      // 简答/计算题：先自己写思路，点「看参考答案」才展开，避免一眼看到答案
      answerUI = `
        <textarea class="blank-input calc-input" id="calcInput" placeholder="先写下你的思路或计算过程（也可以不写，想好就直接看答案）"></textarea>
        <div class="quiz-footer">
          <span>先自己想一想，再看答案印象更深</span>
          <button class="btn primary" id="revealBtn" onclick="App.revealCalcAnswer()">看参考答案 →</button>
        </div>
        <div id="calcReveal" style="display:none">
          <div class="answer-box ok" style="background:var(--paper-2);border-color:var(--line)">
            <div class="answer-label">参考答案</div>${this.esc(q.answer)}
            ${q.explanation ? '<div style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">' + this.esc(q.explanation) + '</div>' : ''}
          </div>
          <div style="margin-top:16px;font-size:13px;color:var(--ink-2)">对照答案后，这道题你掌握得怎么样？</div>
          <div class="self-assess">
            <button onclick="App.submitSelf('① 空白')">① 完全没思路</button>
            <button onclick="App.submitSelf('② 算错')">② 有思路算错</button>
            <button onclick="App.submitSelf('③ 慢但对')">③ 慢但对</button>
            <button onclick="App.submitSelf('④ 快而准')">④ 快而准</button>
          </div>
        </div>`;
    }

    el.innerHTML = `
      <div class="quiz-stage">
        <div class="quiz-top">
          <div class="quiz-progress-txt">第 ${this.quizIndex+1} / ${this.quizQueue.length} 题</div>
          <div class="quiz-top-actions">
            <button class="btn" onclick="App.fixQuestion()" title="答案或解析对不上？点这里改">这题有误</button>
            <button class="btn" id="favBtn" onclick="App.toggleFavorite()" title="收藏这道题，之后可以在「我的收藏」里反复练">${this._favIds && this._favIds.has(q.id) ? '★ 已收藏' : '☆ 收藏'}</button>
            <button class="btn" onclick="App.exitQuiz()">退出练习</button>
            <button class="btn" onclick="App.go('home')">回到今日</button>
          </div>
        </div>
        <div class="quiz-q-card">
          <div class="quiz-q-num">${kindLabel}　${this.doneBadge(q.id)}${(q.tags||[]).slice(0,3).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}</div>
          <div class="quiz-q-stem">${this.formatStem(q.stem)}</div>
          <div id="answerZone">${answerUI}</div>
          <div id="feedbackZone"></div>
        </div>
      </div>`;
    this._selected = null;
    this._qStart = Date.now();
    this.showTutor(true);
  },

  /* ---------- 边学边问：刷题时的 AI 辅导面板 ---------- */
  showTutor(show) {
    const panel = document.getElementById('tutorPanel');
    if (!panel) return;
    panel.style.display = show ? '' : 'none';
    if (show) this.resetTutorForQuestion();
  },

  /** 换题时重置对话，避免把上一题的上下文带到新题 */
  resetTutorForQuestion() {
    const q = this.quizQueue && this.quizQueue[this.quizIndex];
    const qid = q ? q.id : '';
    if (this._tutorQid === qid) return;
    this._tutorQid = qid;
    this._tutorChat = [];
    const box = document.getElementById('tutorChat');
    if (box) box.innerHTML = `<div class="tutor-tip">对这道题有疑问，就在这儿问吧。<br>比如「这题考什么」「为什么选这个」——不用怕问得太基础。</div>`;
    const quick = document.getElementById('tutorQuick');
    if (quick) quick.style.display = '';
  },

  clearTutor() {
    this._tutorQid = null;
    this._tutorChat = [];
    this.resetTutorForQuestion();
  },

  askQuick(text) {
    const input = document.getElementById('tutorInput');
    if (input) input.value = text;
    this.askAI();
  },

  tutorBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'tutor-msg ' + role;
    div.innerHTML = `<div class="tutor-bubble">${role === 'ai' ? this.esc(text).replace(/\n/g, '<br>') : this.esc(text)}</div>`;
    return div;
  },

  async askAI() {
    const input = document.getElementById('tutorInput');
    const box = document.getElementById('tutorChat');
    const send = document.getElementById('tutorSend');
    if (!input || !box) return;
    const question = (input.value || '').trim();
    if (!question) { alert('先输入你的问题'); return; }
    const q = this.quizQueue && this.quizQueue[this.quizIndex];
    if (!q) { alert('当前没有题目'); return; }

    // 学生是否已经作答：本轮答题记录里有这道题就算答过
    const answered = (this.quizAnswers || []).some(a => a.q && a.q.id === q.id);
    const cfg = await LLM.getConfig();
    const err = LLM.validate(cfg);
    if (err) { alert(err); return; }

    input.value = '';
    box.appendChild(this.tutorBubble('me', question));
    const wait = document.createElement('div');
    wait.className = 'tutor-msg ai';
    wait.innerHTML = '<div class="tutor-bubble tutor-wait">AI 正在想…</div>';
    box.appendChild(wait);
    box.scrollTop = box.scrollHeight;
    if (send) { send.disabled = true; }

    // 构造带当前题目的上下文；未作答时不含答案，避免 AI 剧透
    const lines = [
      '【当前题目】',
      `题型：${q.type === 'choice' ? '选择题' : q.type === 'blank' ? '填空题' : '简答/计算题'}`,
      `题干：${q.stem}`,
    ];
    if (q.options && q.options.length) lines.push('选项：' + q.options.join('  '));
    lines.push(`学生是否已作答：${answered ? '是' : '否（还没作答，不要告诉他正确答案）'}`);
    if (answered) {
      lines.push(`正确答案：${q.answer || '（无）'}`);
      if (q.explanation) lines.push(`参考答案解析：${q.explanation}`);
    }
    if (this._tutorChat && this._tutorChat.length) {
      lines.push('', '【之前的对话】');
      this._tutorChat.forEach(x => lines.push(`${x.role === 'me' ? '学生' : '老师'}：${x.text}`));
    }
    lines.push('', '【学生现在的问题】', question);

    try {
      const reply = await LLM.chat(cfg, lines.join('\n'), LLM.TUTOR_PROMPT);
      this._tutorChat = (this._tutorChat || []).concat([
        { role: 'me', text: question }, { role: 'ai', text: reply }
      ]);
      wait.remove();
      box.appendChild(this.tutorBubble('ai', reply));
      const quick = document.getElementById('tutorQuick');
      if (quick) quick.style.display = 'none';
    } catch (e) {
      wait.remove();
      box.appendChild(this.tutorBubble('ai', '抱歉，没连上模型：' + (e.message || '请稍后重试')));
    } finally {
      if (send) send.disabled = false;
      box.scrollTop = box.scrollHeight;
    }
  },

  /** 多选题：answer 是多个字母（如 "ABD"）时按多选作答 */
  isMultiChoice(q) {
    return ((String(q.answer || '').toUpperCase().match(/[A-D]/g) || []).length > 1);
  },

  selectChoice(key, btn) {
    const q = this.quizQueue[this.quizIndex];
    if (this.isMultiChoice(q)) {
      btn.classList.toggle('selected');
      const cur = new Set(String(this._selected || '').split('').filter(Boolean));
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      this._selected = Array.from(cur).sort().join('');
    } else {
      this._selected = key;
      document.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    }
    const sub = document.getElementById('submitBtn');
    if (sub) sub.disabled = !this._selected;
  },

  async submitChoice() {
    const q = this.quizQueue[this.quizIndex];
    const multi = this.isMultiChoice(q);
    const right = (String(q.answer || '').toUpperCase().match(/[A-D]/g) || []).sort().join('');
    const mine = String(this._selected || '');
    const correct = mine !== '' && (multi ? mine === right : mine.charAt(0) === right.charAt(0));
    document.querySelectorAll('.quiz-option').forEach(b => {
      const k = b.dataset.key;
      if (right.indexOf(k) >= 0) b.classList.add('correct');
      else if (multi ? mine.indexOf(k) >= 0 : k === mine) b.classList.add('wrong');
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

  /** 简答/计算题：先藏起答案，点了才展开 */
  revealCalcAnswer() {
    const box = document.getElementById('calcReveal');
    if (!box) return;
    box.style.display = 'block';
    const btn = document.getElementById('revealBtn');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  },

  async submitSelf(assessment) {
    const q = this.quizQueue[this.quizIndex];
    const correct = assessment.indexOf('④') >= 0 || assessment.indexOf('③') >= 0;
    const input = document.getElementById('calcInput');
    const draft = input && input.value ? input.value.trim() : '';
    const userAnswer = draft ? `我的作答：${draft}\n自评：${assessment}` : assessment;
    document.querySelectorAll('.self-assess button').forEach(b => b.onclick = null);
    await this.afterAnswer(correct, userAnswer, q);
  },

  async afterAnswer(correct, userAnswer, q) {
    const duration = Math.round((Date.now() - this._qStart) / 1000);
    const bankId = q.bankId || this.currentBank.id;
    await Achievements.recordAttempt({
      questionId: q.id, bankId,
      userAnswer, correct, durationSec: duration
    });
    // 间隔复习：答错进队列，复习轮答对推进阶段；变式题是一次性的，不进复习表
    const inReviewQuiz = !!(this.currentBank && this.currentBank.id === '__review__');
    const isVariant = !!(this.currentBank && this.currentBank.id === '__variant__');
    if (!isVariant) await Achievements.updateReview(q.id, bankId, correct, inReviewQuiz);
    // 小积分：答对 +1，复习轮 +2，变式题 +2（肯用 harder 方式练，值得多给）
    if (correct) {
      const pts = inReviewQuiz ? 2 : isVariant ? 2 : 1;
      const reason = inReviewQuiz ? 'review' : isVariant ? 'variant' : 'correct';
      await Achievements.addPoints(pts, reason);
    }
    if (!this._attemptCounts) this._attemptCounts = {};
    this._attemptCounts[q.id] = (this._attemptCounts[q.id] || 0) + 1;
    const doneBankId = q.bankId || (this.currentBank && this.currentBank.id);
    if (doneBankId) {
      if (!this._bankQuestions) this._bankQuestions = {};
      const qm = this._bankQuestions[doneBankId] || (this._bankQuestions[doneBankId] = {});
      qm[q.id] = (qm[q.id] || 0) + 1;
    }
    const numEl = document.querySelector('.quiz-q-num');
    if (numEl) {
      const old = numEl.querySelector('.done-count');
      if (old) old.textContent = `做过 ${this._attemptCounts[q.id]} 遍`;
      else numEl.insertAdjacentHTML('beforeend', this.doneBadge(q.id));
    }
    this.quizAnswers.push({ q, correct, userAnswer });
    // 答完就记下进度：即使此刻关掉窗口，下次也从下一题接着做
    this.quizProgressIndex = this.quizIndex + 1;
    this.saveQuizSession(this.quizProgressIndex);

    const isRight = correct;
    document.getElementById('feedbackZone').innerHTML = `
      <div class="answer-box ${isRight ? 'ok' : 'no'}">
        <div class="answer-label">${isRight ? '真棒！为你感到骄傲！' : '答错啦，再接再厉！'}</div>
        ${q.explanation ? this.esc(q.explanation) : (isRight ? '这题没写解析，答案记住就行。' : '正确答案：' + this.esc(q.answer))}
      </div>
      <div class="quiz-footer">
        <span></span>
        <button class="btn primary" onclick="App.nextQuestion()">${this.quizIndex+1 >= this.quizQueue.length ? '完成练习' : '下一题 →'}</button>
      </div>`;

    // 阶段性鼓励（每 10 题，非模态，不打断）
    const enc = await Achievements.maybeEncourage();
    if (enc) this.showEncourage(enc);
  },

  /** 题目答案/解析对不上时，就地改答案或删掉（写回题库） */
  async fixQuestion() {
    const q = this.quizQueue[this.quizIndex];
    if (!q) return;
    const v = prompt('这题的正确答案应该是（选择题填字母 A/B/C/D）？\n直接输入「删」可以删掉这道废题：', String(q.answer || ''));
    if (v === null || !v.trim()) return;
    const val = v.trim();

    if (val === '删' || val === '删除') {
      if (!confirm('确定删掉这道题吗？删了就没了，题库题数会相应减少。')) return;
      try {
        await DB.deleteQuestion(q.id);
        const bank = (await DB.getBanks()).find(b => b.id === q.bankId);
        if (bank) {
          bank.count = Math.max(0, (bank.count || 1) - 1);
          await DB.putBank(bank);
        }
        this.quizQueue.splice(this.quizIndex, 1);
        if (!this.quizQueue.length) { this.renderQuizDone(); return; }
        if (this.quizIndex >= this.quizQueue.length) this.quizIndex = this.quizQueue.length - 1;
        this.quizProgressIndex = this.quizIndex;
        this.saveQuizSession();
        this.renderQuestion();
      } catch (e) {
        alert('删除失败：' + e.message);
      }
      return;
    }

    q.answer = val;
    const copy = Object.assign({}, q);
    delete copy._warn;
    try {
      await DB.putQuestions([copy]);
      this.saveQuizSession();
      alert('已修正。之后的判分按新答案来；之前答错的记录还在错题本里，重练一次就会更新。');
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  },

  nextQuestion() {
    this.quizIndex++;
    this.quizProgressIndex = this.quizIndex;
    this.saveQuizSession();
    this.renderQuestion();
  },

  renderQuizDone() {
    this.clearQuizSession();
    this.showTutor(false);
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
    const body = rows.slice().reverse().map((r, i) => {
      const min = Math.floor(r.studySeconds / 60);
      const barW = Math.round(min / maxMin * 70);
      const acc = r.accuracy === null ? '—' : r.accuracy + '%';
      const d = new Date(r.date);
      const wd = ['日','一','二','三','四','五','六'][d.getDay()];
      const banks = r.banks || [];
      // 当天练了哪些题库，做成可展开明细
      const detail = banks.length
        ? `<div class="hist-detail" id="histDetail${i}" style="display:none">
            ${banks.map(b => `<div class="hist-bank-row">
              <span class="hist-bank-name">📘 ${this.esc(b.name)}</span>
              <span class="hist-bank-num">${b.count} 题 · 对 ${b.correct} 题</span>
            </div>`).join('')}
          </div>`
        : '';
      const toggle = banks.length
        ? `<button class="hist-toggle" onclick="App.toggleHistDetail(${i})">${banks.length} 套题 ▾</button>`
        : '';
      return `<tr>
        <td>${d.getMonth()+1}/${d.getDate()} <span style="color:var(--ink-3)">周${wd}</span></td>
        <td><span class="hist-bar" style="width:${barW}px"></span>${min} 分</td>
        <td>${r.completed}</td>
        <td>${acc}</td>
        <td>${toggle}${r.tags.slice(0,4).map(t=>'<span class="tag">'+this.esc(t)+'</span>').join(' ')}${r.wrongTags.length ? ' <span style="color:var(--clay);font-size:11px">错题:'+r.wrongTags.slice(0,2).map(this.esc).join('/')+'</span>' : ''}${detail}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="hist-table">
        <thead><tr><th>日期</th><th>学习时长</th><th>完成题数</th><th>正确率</th><th>知识点 / 错题</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="hint-text">最近 ${this.historyDays} 天 · 共学习 ${active.length} 天 · 累计 ${Achievements.formatDuration(rows.reduce((s,r)=>s+r.studySeconds,0))}。点「N 套题」看每天练了什么。</p>`;
  },

  toggleHistDetail(i) {
    const box = document.getElementById('histDetail' + i);
    if (!box) return;
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  },

  /* ---------- 错题本 ---------- */
  async renderWrong() {
    await this.refreshAttemptCounts();
    const list = await Achievements.wrongBook();
    // 复习调度状态（用于标注「今天该复习」）
    const reviews = await DB.allReviews();
    this._reviewMap = {};
    reviews.forEach(r => this._reviewMap[r.questionId] = r);
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
        const rv = this._reviewMap && this._reviewMap[q.id];
        const rvHint = rv && !rv.graduated
          ? ` · <span style="color:var(--orange-deep)">🧠 ${rv.dueAt <= Date.now() ? '今天该复习' : '复习排队中'}</span>`
          : (rv && rv.graduated ? ' · <span style="color:var(--green)">复习已毕业</span>' : '');
        return `<div class="preview-q">
          <div class="preview-q-type">${q.type === 'choice' ? '选择题' : '题目'} · ${this.esc(bankName)} · ${this.doneBadge(q.id)}${solved
            ? ' · <span style="color:var(--green)">已攻克</span>'
            : ' · <span style="color:var(--clay)">仍待攻克</span>'}${rvHint}</div>
          <div class="preview-q-stem">${this.formatStem(q.stem)}</div>
          <div class="answer-box ok" style="margin-top:10px;padding:10px 14px;font-size:12.5px">正确答案：${this.esc(q.answer)}</div>
          <div style="margin-top:8px"><button class="btn mini" onclick="App.makeVariants('${q.id}')">✨ 出变式题练练</button></div>
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
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(this.currentBank);
    this.saveQuizSession();
    this.switchView('practice');
    this.renderQuestion();
  },

  /** 从一道错题生成同考点变式题，生成后直接进入练习（不写入原题库） */
  async makeVariants(questionId) {
    const q = await DB.getQuestion(questionId);
    if (!q) { alert('这道题已被删除'); return; }
    this.showLoading('正在围绕这个考点出变式题…');
    try {
      const { questions } = await LLM.generateVariants(q, 3);
      this.hideLoading();
      this._variantSource = q;
      this._variantCache = this._variantCache || {};
      this._variantCache[questionId] = questions;
      this.startVariantQuiz(questionId);
    } catch (e) {
      this.hideLoading();
      alert('变式题生成失败：' + (e && e.message ? e.message : '请稍后重试'));
    }
  },

  /** 开始一组变式题练习 */
  startVariantQuiz(sourceQuestionId) {
    const questions = this._variantCache && this._variantCache[sourceQuestionId];
    if (!questions || !questions.length) {
      // 重开应用后内存缓存丢失：提示回错题本重新生成（原题还在，不会丢）
      alert('重开应用后变式题需要重新生成，已经带你回错题本。');
      return this.go('wrong');
    }
    const src = this._variantSource || {};
    this.currentBank = {
      id: '__variant__', name: `变式练习 · ${String(src.stem || '错题').slice(0, 16)}`,
      folder: '', sourceQuestionId
    };
    this.quizQueue = questions.slice().sort(() => Math.random() - 0.5);
    this.quizIndex = 0;
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(this.currentBank);
    this.saveQuizSession();
    this.switchView('practice');
    this.renderQuestion();
  },

  /** 练习结束页的「再来一轮」：错题/收藏轮次再练各自那组，普通轮次重刷本题库 */
  retryLastQuiz() {
    if (!this.currentBank) return;
    if (this.currentBank.id === '__wrong__') return this.startWrongQuiz(this.currentBank.folder || '');
    if (this.currentBank.id === '__fav__') return this.startFavoriteQuiz(this.currentBank.favBankId || '');
    if (this.currentBank.id === '__mix__') return this.startMixedQuiz();
    if (this.currentBank.id === '__review__') return this.startReviewQuiz();
    if (this.currentBank.id === '__variant__') return this.startVariantQuiz(this.currentBank.sourceQuestionId);
    return this.startQuizById(this.currentBank.id);
  },

  /* ---------- 收藏题目 ---------- */
  async toggleFavorite() {
    const q = this.quizQueue[this.quizIndex];
    if (!q) return;
    if (!this._favIds) this._favIds = new Set((await DB.getFavorites()).map(f => f.questionId));
    const btn = document.getElementById('favBtn');
    if (this._favIds.has(q.id)) {
      await DB.deleteFavorite(q.id);
      this._favIds.delete(q.id);
      if (btn) btn.textContent = '☆ 收藏';
    } else {
      const banks = await DB.getBanks();
      const bank = banks.find(b => b.id === q.bankId);
      await DB.putFavorite({
        questionId: q.id,
        bankId: q.bankId || '',
        bankName: bank ? bank.name : '',
        folder: bank ? (bank.folder || '') : '',
        ts: Date.now()
      });
      this._favIds.add(q.id);
      if (btn) btn.textContent = '★ 已收藏';
    }
  },

  async renderFavorites() {
    const el = document.getElementById('favoritesBody');
    await this.refreshAttemptCounts();
    const favs = await DB.getFavorites();
    if (!favs.length) {
      el.innerHTML = `<div class="empty"><div class="empty-mark">☆</div>
        <div class="empty-title">还没有收藏的题目</div>
        <div>刷题时点一下「☆ 收藏」，这道题就会出现在这里。</div>
        <div style="margin-top:18px"><button class="btn primary" onclick="App.go('practice')">去刷题</button></div></div>`;
      return;
    }
    const [banks, all] = await Promise.all([DB.getBanks(), DB.allQuestions()]);
    const bankMap = {}; banks.forEach(b => bankMap[b.id] = b);
    const qMap = {}; all.forEach(q => qMap[q.id] = q);
    const groups = {};
    favs.forEach(f => {
      const q = qMap[f.questionId];
      if (!q) return; // 题已被删掉，收藏也失效
      const key = f.bankId || '__none__';
      if (!groups[key]) {
        const b = bankMap[f.bankId];
        groups[key] = {
          key,
          name: b ? b.name : (f.bankName || '已删除的题库'),
          folder: b ? (b.folder || '') : (f.folder || ''),
          items: []
        };
      }
      groups[key].items.push(q);
    });
    const list = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const total = list.reduce((n, g) => n + g.items.length, 0);
    el.innerHTML = `<p class="hint-text" style="margin-bottom:16px">共收藏 ${total} 道题，收藏的题目可以反复刷。</p>`
      + list.map(g => `
        <div class="fav-group">
          <div class="fav-head">
            <div><div class="fav-name">${this.esc(g.name)} <span class="fav-count">${g.items.length} 题</span></div></div>
            <div class="fav-actions">
              <button class="btn primary" onclick="App.startFavoriteQuiz('${this.esc(g.key)}')">刷这些 ↻</button>
              <button class="btn" onclick="App.clearFavoriteGroup('${this.esc(g.key)}')">清空这组</button>
            </div>
          </div>
          ${g.items.map(q => `
            <div class="fav-row">
              <div class="fav-stem">${this.esc(q.stem)} ${this.doneBadge(q.id)}</div>
              <button class="btn" onclick="App.unfavorite('${this.esc(q.id)}')">取消收藏</button>
            </div>`).join('')}
        </div>`).join('');
  },

  async unfavorite(questionId) {
    await DB.deleteFavorite(questionId);
    if (this._favIds) this._favIds.delete(questionId);
    this.renderFavorites();
  },

  async clearFavoriteGroup(bankId) {
    if (!confirm('确定清空这组收藏吗？题目本身不会被删除。')) return;
    const favs = await DB.getFavorites();
    for (const f of favs) {
      if ((f.bankId || '__none__') === bankId) await DB.deleteFavorite(f.questionId);
    }
    if (this._favIds) {
      favs.filter(f => (f.bankId || '__none__') === bankId).forEach(f => this._favIds.delete(f.questionId));
    }
    this.renderFavorites();
  },

  async startFavoriteQuiz(bankId) {
    const favs = await DB.getFavorites();
    const picked = favs.filter(f => !bankId || (f.bankId || '__none__') === bankId);
    const all = await DB.allQuestions();
    const qMap = {}; all.forEach(q => qMap[q.id] = q);
    const questions = picked.map(f => qMap[f.questionId]).filter(Boolean).sort(() => Math.random() - 0.5);
    if (!questions.length) { alert('这组收藏里没有可以刷的题了'); return; }
    const banks = await DB.getBanks();
    const b = banks.find(x => x.id === bankId);
    this.currentBank = {
      id: '__fav__',
      favBankId: bankId || '',
      name: bankId ? `收藏练习 · ${b ? b.name : '已删除的题库'}` : '收藏练习 · 全部',
      folder: b ? (b.folder || '') : ''
    };
    this.quizQueue = questions;
    this.quizIndex = 0;
    this.quizProgressIndex = 0;
    this.quizAnswers = [];
    this.quizStartTs = Date.now();
    this._sessionKey = this.sessionKeyFor(this.currentBank);
    this.saveQuizSession();
    this.switchView('practice');
    this.renderQuestion();
  },

  /* ---------- 成就勋章 ---------- */
  async renderAchievements() {
    const life = await Achievements.lifetimeStats();
    const rec = await Achievements.dailyRecords();
    const today = await Achievements.todayStats();
    const pts = await Achievements.getPoints();
    const rv = await Achievements.reviewStats();
    const all = await DB.getAttempts();
    const totalQ = all.length;
    const right = all.filter(a => a.correct).length;
    const accuracy = totalQ ? Math.round(right / totalQ * 100) : 0;

    const groups = this.buildBadges(life.days, totalQ, accuracy, rec, today);
    const card = b => `
        <div class="ach-card ${b.got ? '' : 'locked'}">
          <div class="ach-medal">${b.got ? b.icon : '🔒'}</div>
          <div class="ach-name">${b.name}</div>
          <div class="ach-desc">${b.got ? (b.gotDescText || b.desc) : b.how}</div>
          ${b.now ? `<div class="ach-now">${b.got ? (b.gotNote || '') : b.now}</div>` : ''}
        </div>`;

    document.getElementById('achievementBody').innerHTML = `
      <div class="ach-overview">
        <div class="ach-stat"><div class="ach-stat-val">${life.days}</div><div class="ach-stat-lbl">累计学习天数</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${Achievements.formatDuration(life.totalSeconds)}</div><div class="ach-stat-lbl">累计学习时长</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${rec.maxQ}<span style="font-size:13px"> 题</span></div><div class="ach-stat-lbl">最佳单日${rec.maxQDate ? ' · ' + rec.maxQDate.slice(5) : ''}</div></div>
        <div class="ach-stat"><div class="ach-stat-val">${accuracy}%</div><div class="ach-stat-lbl">总正确率</div></div>
      </div>

      <div class="points-panel">
        <div class="points-main">
          <div class="points-coin">🏅</div>
          <div><div class="points-big">${pts.total}</div><div class="points-lbl">我的小积分 · 今天 +${pts.today}</div></div>
        </div>
        <div class="points-detail">
          <div>普通答对 <b>+${(pts.byReason || {}).correct || 0}</b> 分</div>
          <div>复习答对 <b>+${(pts.byReason || {}).review || 0}</b> 分</div>
          <div>变式练习 <b>+${(pts.byReason || {}).variant || 0}</b> 分</div>
          <div>复习毕业 <b>${rv.graduated}</b> 题 · 排队 <b>${rv.active}</b> 题</div>
        </div>
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
    // 每日成就是终身的：历史任意一天达标就点亮，所以进度一律按「历史最高」显示，
    // 不能写成「今天 X / N」，否则会让人误以为必须今天刷够。
    const hit = rec.hitDays || {};
    // 点亮后显示「累计达标 N 天」——成就值得反复完成，每天做到都记一笔。
    // 累计天数按历史记录算，今天达标后立即 +1（renderAchievements 会重算 rec）。
    const hitNote = (key, best) => {
      const n = hit[key] || 0;
      return n > 0 ? `累计达标 ${n} 天 · ${best}` : best;
    };
    const qMax = rec.maxQ || 0;
    const minMax = rec.maxMinutes || 0;
    const accMax = rec.maxAccuracy || 0;
    const qBest = `单日最高 ${qMax} 题`;
    const qNow = n => `历史最高 ${qMax} / ${n} 题`;
    const minBest = `最高 ${minMax} 分钟`;
    const minNow = n => `历史最高 ${minMax} / ${n} 分钟`;
    const accBest = `单日最高 ${accMax}%`;

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
      { name: '今日二十题', icon: '🥾', desc: '一天二十道，值得夸一句', how: '单日完成 20 题解锁', got: qMax >= 20, now: qNow(20), gotNote: hitNote('q20', qBest) },
      { name: '半百', icon: '🔥', desc: '一天五十道，很扎实', how: '单日完成 50 题解锁', got: qMax >= 50, now: qNow(50), gotNote: hitNote('q50', qBest) },
      { name: '百题日', icon: '💯', desc: '一天一百道，这一天值得记住', how: '单日完成 100 题解锁', got: qMax >= 100, now: qNow(100), gotNote: hitNote('q100', qBest) },
      { name: '两百题', icon: '🚀', desc: '一天两百道，状态在线', how: '单日完成 200 题解锁', got: qMax >= 200, now: qNow(200), gotNote: hitNote('q200', qBest) },
      { name: '一小时专注', icon: '⏳', desc: '单日学习满一小时', how: '单日学习 60 分钟解锁', got: minMax >= 60, now: minNow(60), gotNote: hitNote('min60', minBest) },
      { name: '两小时深耕', icon: '🕰️', desc: '单日学习满两小时', how: '单日学习 120 分钟解锁', got: minMax >= 120, now: minNow(120), gotNote: hitNote('min120', minBest) },
      { name: '神准日', icon: '🎯', desc: '单日正确率 90% 以上', how: '单日正确率 ≥ 90%（当天 ≥ 20 题）解锁', got: accMax >= 90, now: `历史最高 ${accMax}%`, gotNote: hitNote('acc90', accBest) }
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
    if (!confirm('确定清除所有题库、答题记录、积分和复习进度吗？此操作不可恢复。')) return;
    if (!confirm('请再次确认：真的要清空全部数据？')) return;
    await DB.clearAll();
    // settings 表不清（存着 API Key），但积分和刷题存档要归零
    await DB.setSetting('points', { total: 0, today: 0, date: new Date().toISOString().slice(0, 10), byReason: {} });
    try { localStorage.removeItem(QUIZ_SESSION_KEY); } catch (e) {}
    this._attemptCounts = {}; this._bankQuestions = {};
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
  },

  /** 题干里的代码单独排版：等宽字体、浅色代码块、不折行、关键字高亮。
   *  识别反引号 `code` 与常见代码形态（函数调用、花括号语句、赋值/比较表达式）。 */
  formatStem(stem) {
    const raw = String(stem == null ? '' : stem);
    // 占位符用固定前缀 + 递增序号，内容和序号一一对应，避免编号错位
    const slots = {};
    let seq = 0;
    const hold = code => {
      const key = '\u0001' + (seq++) + '\u0002';
      slots[key] = code;
      return key;
    };

    let s = raw;
    // 1) 反引号代码优先（含换行的必然是块）
    s = s.replace(/`([^`]+)`/g, (m, c) => hold(c));
    // 2) 花括号代码块：int Fib(n) { ... } / if (x) { ... }
    s = s.replace(/[A-Za-z_][\w<>*&:.\s]*\([^)]*\)\s*\{[^{}]{2,400}\}/g, m => hold(m));
    // 3) 纯花括号代码：{ ...; ... }
    s = s.replace(/\{[^{}]*[;=][^{}]{1,300}\}/g, m => hold(m));
    // 4) Python 定义：def f(x): return ...
    s = s.replace(/\b(def\s+\w+\s*\([^)]*\)\s*:\s*[^，。；;]{2,120})/g, m => hold(m.trim()));
    // 5) 独立函数调用：f(3) / max(a,b)（跳过已占位区域）
    s = s.replace(/\b([A-Za-z_]\w*\([^()]{0,80}\))/g, (m, code) => hold(code));

    // 先整体转义；占位符字符 \u0001\u0002 不受 esc 影响
    let out = this.esc(s);
    Object.keys(slots).forEach(key => {
      const code = slots[key];
      const isBlock = /[\n{}]/.test(code) || (code.length > 32 && /[;=]/.test(code));
      const inner = this.highlightCode(this.esc(code));
      const html = isBlock
        ? `<pre class="stem-code"><code>${inner}</code></pre>`
        : `<code class="stem-inline">${inner}</code>`;
      out = out.split(key).join(html);
    });
    // 清理万一残留的占位符
    return out.replace(/[\u0001\u0002]/g, '');
  },

  /** 简单语法高亮：关键字 / 数字 / 字符串（输入必须是已转义文本） */
  highlightCode(escaped) {
    const kw = /\b(int|long|short|char|float|double|void|bool|boolean|string|str|var|let|const|return|if|else|elif|for|while|do|break|continue|new|class|def|function|public|private|static|null|None|True|False|true|false|import|from|print)\b/g;
    return escaped
      .replace(kw, '<span class="code-kw">$1</span>')
      .replace(/(&quot;[^&]{0,120}?&quot;|'[^']{0,120}?')/g, '<span class="code-str">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-num">$1</span>');
  }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
