'use strict';
// Small ten-second chunks in IndexedDB; only one chunk is cached in JavaScript.
window.MedakaFrameStore = class {
  constructor(runId) { this.runId = runId; this.db = null; }
  open(signal) {
    return new Promise((resolve, reject) => {
      let request, settled = false;
      const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      const fail = error => { if (settled) return; settled = true; clean(); reject(error); };
      const cancel = () => fail(new DOMException('解析を中断しました。', 'AbortError'));
      const timer = setTimeout(() => fail(new Error('追跡記録の保存先を開けませんでした。')), 8000);
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      try { request = indexedDB.open('medaka-lab.frames.v1', 1); } catch (e) { fail(e); return; }
      request.onupgradeneeded = () => { request.result.createObjectStore('chunks', { keyPath: ['runId', 'index'] }); };
      request.onerror = () => fail(new Error('追跡記録を端末に保存できません。ブラウザの保存設定を確認してください。'));
      request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; clean(); this.db = request.result; this.db.onversionchange = () => this.db?.close(); resolve(); };
      request.onblocked = () => fail(new Error('別のタブを閉じてから再度お試しください。'));
    });
  }
  put(index, frames) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put({ runId: this.runId, index, createdAt: Date.now(), frames });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('端末の保存容量が不足している可能性があります。途中結果をCSVに保存してください。'));
    });
  }
  get(index) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', 'readonly');
      const req = tx.objectStore('chunks').get([this.runId, index]);
      req.onsuccess = () => resolve(req.result?.frames || []);
      req.onerror = () => reject(new Error('追跡記録を読み込めません。'));
    });
  }
  async dispose() {
    const db = this.db;
    this.db = null; // Idempotent even when pagehide and cancellation run together.
    if (!db) return;
    await new Promise(resolve => {
      try {
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').delete(IDBKeyRange.bound([this.runId, 0], [this.runId, Number.MAX_SAFE_INTEGER]));
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      } catch { resolve(); }
    });
    db.close();
  }
  static cleanupExpired() {
    // Abnormal tab termination may leave chunks; remove only records older than a day.
    const req = indexedDB.open('medaka-lab.frames.v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('chunks', { keyPath: ['runId', 'index'] });
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('chunks', 'readwrite');
      const cursor = tx.objectStore('chunks').openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (c.value.createdAt < Date.now() - 86400000) c.delete(); c.continue(); };
      tx.oncomplete = tx.onerror = tx.onabort = () => db.close();
    };
  }
};
