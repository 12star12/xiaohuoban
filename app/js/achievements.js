/* 成就与正向激励系统。
   职责：有效学习时长追踪、统计聚合、阶段性鼓励触发、每日名言、学习历史。
   设计：温暖克制，不做排行榜、不做强制打卡。 */

(function () {
  const IDLE_LIMIT = 60 * 1000;   // 60 秒无操作视为停止学习
  const TICK_MS = 1000;           // 每秒检查一次
  const ENCOURAGE_STEP = 10;      // 每完成 10 题触发一次鼓励（可在设置里改）

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const Achievements = {
    _lastActive: Date.now(),
    _running: false,
    _accumSec: 0,       // 尚未落盘的秒数
    _listeners: {},

    on(evt, fn) { (this._listeners[evt] || (this._listeners[evt] = [])).push(fn); },
    emit(evt, data) { (this._listeners[evt] || []).forEach(fn => fn(data)); },

    /** 启动计时器：监听用户活动，页面隐藏或无操作则暂停累计 */
    startTracker() {
      if (this._running) return;
      this._running = true;
      const mark = () => { this._lastActive = Date.now(); };
      ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(e =>
        window.addEventListener(e, mark, { passive: true }));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this._lastActive = Date.now();
      });
      setInterval(() => this.tick(), TICK_MS);
      window.addEventListener('beforeunload', () => this.flush());
    },

    /** 每秒调用：仅在页面可见且有近期操作时累计时长 */
    async tick() {
      const active = !document.hidden && (Date.now() - this._lastActive < IDLE_LIMIT);
      if (!active) {
        if (this._accumSec > 0) await this.flush();
        return;
      }
      this._accumSec += 1;
      if (this._accumSec >= 5) await this.flush();
    },

    async flush() {
      if (this._accumSec <= 0) return;
      const sec = this._accumSec;
      this._accumSec = 0;
      await DB.addStudyTime(today(), sec);
      this.emit('studyTick', { seconds: sec });
    },

    /** 记录一次答题 */
    async recordAttempt(a) {
      await DB.addAttempt({
        id: 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        questionId: a.questionId,
        bankId: a.bankId || '',
        ts: Date.now(),
        userAnswer: a.userAnswer,
        correct: !!a.correct,
        assessment: a.assessment || '',
        durationSec: a.durationSec || 0
      });
    },

    /** 今日统计 */
    async todayStats() {
      const all = await DB.getAttempts();
      const t = today();
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const todayAttempts = all.filter(a => a.ts >= dayStart.getTime());

      const study = await DB.getStudyTime(t);
      const questionsDone = new Set(todayAttempts.map(a => a.questionId)).size;
      const correct = todayAttempts.filter(a => a.correct).length;
      const accuracy = todayAttempts.length ? Math.round(correct / todayAttempts.length * 100) : 0;

      // 掌握知识点：某标签下答对 ≥ 2 次且最近一次答对
      const questions = await DB.allQuestions();
      const qMap = {}; questions.forEach(q => qMap[q.id] = q);
      const tagStat = {};
      all.forEach(a => {
        const q = qMap[a.questionId];
        if (!q) return;
        (q.tags || []).forEach(tag => {
          if (!tagStat[tag]) tagStat[tag] = { right: 0, wrong: 0, lastCorrect: false };
          if (a.correct) tagStat[tag].right++; else tagStat[tag].wrong++;
        });
      });
      // 最近一次答题对错
      all.slice().sort((x, y) => x.ts - y.ts).forEach(a => {
        const q = qMap[a.questionId];
        if (!q) return;
        (q.tags || []).forEach(tag => {
          if (tagStat[tag]) tagStat[tag].lastCorrect = a.correct;
        });
      });
      const mastered = Object.values(tagStat).filter(s => s.right >= 2 && s.lastCorrect && s.right > s.wrong).length;

      const goal = await DB.getSetting('dailyGoal', 20);
      return {
        date: t,
        studySeconds: study ? study.seconds : 0,
        completed: questionsDone,
        attemptCount: todayAttempts.length,
        correct,
        accuracy,
        mastered,
        goal,
        goalPct: Math.min(100, Math.round(questionsDone / goal * 100))
      };
    },

    /** 累计学习天数与总时长 */
    async lifetimeStats() {
      const times = await DB.allStudyTime();
      const days = times.filter(t => t.seconds > 0).length;
      const totalSeconds = times.reduce((s, t) => s + t.seconds, 0);
      return { days, totalSeconds };
    },

    /** 单日纪录：历史上最高的单日题量 / 时长 / 正确率（一天的高光也值得被记住） */
    async dailyRecords() {
      const all = await DB.getAttempts();
      const byDay = {};
      all.forEach(a => {
        const d = new Date(a.ts);
        const key = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        const r = byDay[key] || (byDay[key] = { ids: {}, total: 0, right: 0 });
        r.ids[a.questionId] = 1;
        r.total++;
        if (a.correct) r.right++;
      });

      let maxQ = 0, maxQDate = '';
      let maxAcc = 0, maxAccDate = '';
      // 每个每日成就「达标过几天」——点亮的成就能继续攒天数，反复完成也有意义
      const hit = { q20: 0, q50: 0, q100: 0, q200: 0, min60: 0, min120: 0, acc90: 0 };
      Object.keys(byDay).forEach(k => {
        const r = byDay[k];
        const q = Object.keys(r.ids).length;
        if (q > maxQ) { maxQ = q; maxQDate = k; }
        if (q >= 20) hit.q20++;
        if (q >= 50) hit.q50++;
        if (q >= 100) hit.q100++;
        if (q >= 200) hit.q200++;
        // 题量太少的准确率不算纪录，避免 3 题全对拿 100%
        if (r.total >= 20) {
          const acc = Math.round(r.right / r.total * 100);
          if (acc > maxAcc) { maxAcc = acc; maxAccDate = k; }
          if (acc >= 90) hit.acc90++;
        }
      });

      const times = await DB.allStudyTime();
      let maxMin = 0, maxMinDate = '';
      times.forEach(t => {
        const m = Math.floor((t.seconds || 0) / 60);
        if (m > maxMin) { maxMin = m; maxMinDate = t.date; }
        if (m >= 60) hit.min60++;
        if (m >= 120) hit.min120++;
      });

      return { maxQ, maxQDate, maxMinutes: maxMin, maxMinDate, maxAccuracy: maxAcc, maxAccDate, hitDays: hit };
    },

    /** 判断并触发阶段性鼓励。根据最近表现分类，返回鼓励文案或 null。 */
    async maybeEncourage() {
      const step = await DB.getSetting('encourageStep', ENCOURAGE_STEP);
      const all = await DB.getAttempts();
      // 按实际作答次数触发鼓励：重复刷同一题也算完成，值得被肯定
      const done = all.length;
      const lastNotified = await DB.getSetting('lastEncourageCount', 0);
      if (done < step || done <= lastNotified) return null;
      // 只在跨越 10 的整数倍时触发
      if (Math.floor(done / step) <= Math.floor(lastNotified / step)) return null;
      await DB.setSetting('lastEncourageCount', done);

      const recent = all.slice(-step);
      const right = recent.filter(a => a.correct).length;
      const rate = right / recent.length;
      let category;
      if (rate <= 0.3) category = 'struggling';
      else {
        // 是否有"曾经错的题这次对了"
        const firstWrong = {};
        all.slice().sort((a, b) => a.ts - b.ts).forEach(a => {
          if (!a.correct) firstWrong[a.questionId] = true;
          else if (firstWrong[a.questionId]) firstWrong[a.questionId] = 'recovered';
        });
        const recovered = recent.some(a => a.correct && firstWrong[a.questionId] === 'recovered');
        category = recovered ? 'comeback' : (rate >= 0.7 ? 'mastery' : 'practice');
      }
      const pool = window.Encouragements[category] || window.Encouragements.practice;
      const recentUsed = await DB.getSetting('recentEncourageTexts', []);
      let candidates = pool.filter(t => !recentUsed.includes(t));
      if (!candidates.length) candidates = pool;
      const text = candidates[Math.floor(Math.random() * candidates.length)];
      const nextUsed = recentUsed.concat(text).slice(-6);
      await DB.setSetting('recentEncourageTexts', nextUsed);
      return { text, category, milestone: Math.floor(done / step) * step };
    },

    /** 每日名言：按日期确定性选取，同一天固定 */
    async dailyQuote() {
      const idx = await DB.getSetting('quoteIndex', null);
      // 若用户手动换过且仍在同一天，沿用
      const quoteDate = await DB.getSetting('quoteDate', '');
      const t = today();
      let i;
      if (idx !== null && quoteDate === t) {
        i = idx;
      } else {
        // 以日期为种子的稳定伪随机
        const seed = t.split('-').reduce((s, n) => s * 31 + parseInt(n, 10), 7);
        i = Math.abs(seed) % window.Quotes.length;
        await DB.setSetting('quoteIndex', i);
        await DB.setSetting('quoteDate', t);
      }
      return window.Quotes[i];
    },

    /** 换一句名言 */
    async nextQuote() {
      const cur = await DB.getSetting('quoteIndex', 0);
      const i = (cur + 1) % window.Quotes.length;
      await DB.setSetting('quoteIndex', i);
      await DB.setSetting('quoteDate', today());
      return window.Quotes[i];
    },

    /** 学习历史：按日期聚合最近 N 天 */
    async history(days) {
      days = days || 30;
      const all = await DB.getAttempts();
      const times = await DB.allStudyTime();
      const questions = await DB.allQuestions();
      const qMap = {}; questions.forEach(q => qMap[q.id] = q);
      const timeMap = {}; times.forEach(t => timeMap[t.date] = t.seconds);

      const byDay = {};
      all.forEach(a => {
        const d = dateStr(new Date(a.ts));
        if (!byDay[d]) byDay[d] = { attempts: [], qids: new Set() };
        byDay[d].attempts.push(a);
        byDay[d].qids.add(a.questionId);
      });

      const result = [];
      const base = new Date(); base.setHours(0, 0, 0, 0);
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(base); d.setDate(d.getDate() - i);
        const key = dateStr(d);
        const info = byDay[key] || { attempts: [], qids: new Set() };
        const right = info.attempts.filter(a => a.correct).length;
        const tags = new Set();
        const wrongTags = new Set();
        info.attempts.forEach(a => {
          const q = qMap[a.questionId];
          if (!q) return;
          (q.tags || []).forEach(tag => {
            tags.add(tag);
            if (!a.correct) wrongTags.add(tag);
          });
        });
        result.push({
          date: key,
          studySeconds: timeMap[key] || 0,
          completed: info.qids.size,
          attempts: info.attempts.length,
          correct: right,
          accuracy: info.attempts.length ? Math.round(right / info.attempts.length * 100) : null,
          tags: Array.from(tags),
          wrongTags: Array.from(wrongTags)
        });
      }
      return result;
    },

    /** 错题本：答错过的题，含最近一次表现 */
    async wrongBook() {
      const all = await DB.getAttempts();
      const questions = await DB.allQuestions();
      const qMap = {}; questions.forEach(q => qMap[q.id] = q);
      const wrongIds = new Set(all.filter(a => !a.correct).map(a => a.questionId));
      const lastByQ = {};
      all.slice().sort((a, b) => a.ts - b.ts).forEach(a => lastByQ[a.questionId] = a);
      return Array.from(wrongIds).map(id => {
        const q = qMap[id];
        if (!q) return null;
        return { question: q, lastAttempt: lastByQ[id] };
      }).filter(Boolean);
    },

    formatDuration(sec) {
      sec = Math.floor(sec || 0);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return h + ' 小时 ' + m + ' 分';
      if (m > 0) return m + ' 分钟';
      return sec + ' 秒';
    }
  };

  window.Achievements = Achievements;
})();
