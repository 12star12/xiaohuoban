/* 本地数据库层：IndexedDB 封装。
   七张表：banks 题库集 / questions 题目 / attempts 答题记录 / favorites 收藏 / reviews 间隔复习调度 / studyTime 有效学习时长 / settings 设置。
   所有数据本地持久化，关闭程序不丢失。 */
(function () {
  const DB_NAME = 'review-quiz-db';
  const DB_VERSION = 3;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('banks')) {
          const s = db.createObjectStore('banks', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('questions')) {
          const s = db.createObjectStore('questions', { keyPath: 'id' });
          s.createIndex('bankId', 'bankId');
        }
        if (!db.objectStoreNames.contains('attempts')) {
          const s = db.createObjectStore('attempts', { keyPath: 'id' });
          s.createIndex('ts', 'ts');
          s.createIndex('questionId', 'questionId');
          s.createIndex('bankId', 'bankId');
        }
        if (!db.objectStoreNames.contains('studyTime')) {
          db.createObjectStore('studyTime', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('favorites')) {
          const s = db.createObjectStore('favorites', { keyPath: 'questionId' });
          s.createIndex('bankId', 'bankId');
          s.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains('reviews')) {
          const s = db.createObjectStore('reviews', { keyPath: 'questionId' });
          s.createIndex('dueAt', 'dueAt');
          s.createIndex('bankId', 'bankId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      try {
        result = fn(s, t);
      } catch (err) {
        reject(err);
        return;
      }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function reqToPromise(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  const DB = {
    // 题库集
    async putBank(bank) {
      return tx('banks', 'readwrite', s => s.put(bank));
    },
    async getBanks() {
      return tx('banks', 'readonly', s => reqToPromise(s.getAll()));
    },
    async deleteBank(bankId) {
      const db = await openDB();
      const t = db.transaction(['banks', 'questions', 'attempts', 'favorites', 'reviews'], 'readwrite');
      t.objectStore('banks').delete(bankId);
      const qIdx = t.objectStore('questions').index('bankId');
      const aIdx = t.objectStore('attempts').index('bankId');
      const fIdx = t.objectStore('favorites').index('bankId');
      const rIdx = t.objectStore('reviews').index('bankId');
      rIdx.getAllKeys(IDBKeyRange.only(bankId)).onsuccess = (e) => {
        e.target.result.forEach(k => t.objectStore('reviews').delete(k));
      };
      fIdx.getAllKeys(IDBKeyRange.only(bankId)).onsuccess = (e) => {
        e.target.result.forEach(k => t.objectStore('favorites').delete(k));
      };
      qIdx.getAllKeys(IDBKeyRange.only(bankId)).onsuccess = (e) => {
        e.target.result.forEach(k => t.objectStore('questions').delete(k));
      };
      aIdx.getAllKeys(IDBKeyRange.only(bankId)).onsuccess = (e) => {
        e.target.result.forEach(k => t.objectStore('attempts').delete(k));
      };
      return new Promise((resolve, reject) => {
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    },

    // 题目
    async putQuestions(questions) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction('questions', 'readwrite');
        const s = t.objectStore('questions');
        questions.forEach(q => s.put(q));
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    },
    async getQuestions(bankId) {
      return tx('questions', 'readonly', s =>
        reqToPromise(s.index('bankId').getAll(IDBKeyRange.only(bankId))));
    },
    async getQuestion(id) {
      return tx('questions', 'readonly', s => reqToPromise(s.get(id)));
    },
    async allQuestions() {
      return tx('questions', 'readonly', s => reqToPromise(s.getAll()));
    },
    async deleteQuestion(id) {
      return tx('questions', 'readwrite', s => s.delete(id));
    },

    // 答题记录（每条记录不可变，只增不改，避免重复计数）
    async addAttempt(a) {
      return tx('attempts', 'readwrite', s => s.add(a));
    },
    async getAttempts() {
      return tx('attempts', 'readonly', s => reqToPromise(s.getAll()));
    },
    async getAttemptsByBank(bankId) {
      return tx('attempts', 'readonly', s =>
        reqToPromise(s.index('bankId').getAll(IDBKeyRange.only(bankId))));
    },

    // 收藏题目
    async putFavorite(f) {
      return tx('favorites', 'readwrite', s => s.put(f));
    },
    async deleteFavorite(questionId) {
      return tx('favorites', 'readwrite', s => s.delete(questionId));
    },
    async getFavorites() {
      return tx('favorites', 'readonly', s => reqToPromise(s.getAll()));
    },

    // 间隔复习调度：每道题一条，dueAt 到期时间戳，stage 当前阶段
    async putReview(r) {
      return tx('reviews', 'readwrite', s => s.put(r));
    },
    async getReview(questionId) {
      return tx('reviews', 'readonly', s => reqToPromise(s.get(questionId)));
    },
    async allReviews() {
      return tx('reviews', 'readonly', s => reqToPromise(s.getAll()));
    },
    async deleteReview(questionId) {
      return tx('reviews', 'readwrite', s => s.delete(questionId));
    },

    // 有效学习时长（按日期累加秒数）
    async addStudyTime(date, seconds) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction('studyTime', 'readwrite');
        const s = t.objectStore('studyTime');
        const r = s.get(date);
        r.onsuccess = () => {
          const cur = r.result || { date, seconds: 0 };
          cur.seconds += seconds;
          s.put(cur);
        };
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    },
    async getStudyTime(date) {
      return tx('studyTime', 'readonly', s => reqToPromise(s.get(date)));
    },
    async allStudyTime() {
      return tx('studyTime', 'readonly', s => reqToPromise(s.getAll()));
    },

    // 设置
    async getSetting(key, fallback) {
      const v = await tx('settings', 'readonly', s => reqToPromise(s.get(key)));
      return v ? v.value : fallback;
    },
    async setSetting(key, value) {
      return tx('settings', 'readwrite', s => s.put({ key, value }));
    },

    // 清空全部数据（危险操作，UI 需二次确认）
    async clearAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(['banks', 'questions', 'attempts', 'favorites', 'reviews', 'studyTime'], 'readwrite');
        ['banks', 'questions', 'attempts', 'favorites', 'reviews', 'studyTime'].forEach(n => t.objectStore(n).clear());
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    }
  };

  window.DB = DB;
})();
