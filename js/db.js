/* Freeify: tiny promise wrapper around IndexedDB. Everything stays on this device. */
(function (F) {
  'use strict';

  const NAME = 'freeify';
  const VERSION = 1;
  const STORES = ['tracks', 'files', 'covers', 'lyrics', 'playlists', 'kv'];
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available in this browser.')); return; }
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (db.objectStoreNames.contains(s)) continue;
          if (s === 'kv') db.createObjectStore(s);
          else db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('[freeify] database upgrade blocked by another tab');
    });
    return dbPromise;
  }

  /** Run fn(storeMap) inside one transaction; resolves when the transaction commits. */
  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const map = {};
      for (const s of [].concat(stores)) map[s] = tx.objectStore(s);
      let result;
      try { result = fn(map, tx); } catch (e) { tx.abort(); reject(e); return; }
      tx.oncomplete = () => resolve(result && typeof result === 'object' && 'readyState' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  const DB = {
    open,
    get: (store, key) => run(store, 'readonly', (s) => s[store].get(key)),
    getAll: (store) => run(store, 'readonly', (s) => s[store].getAll()),
    put: (store, value) => run(store, 'readwrite', (s) => { s[store].put(value); }),
    del: (store, key) => run(store, 'readwrite', (s) => { s[store].delete(key); }),
    putMany: (store, values) => run(store, 'readwrite', (s) => { values.forEach((v) => s[store].put(v)); }),

    kvGet: (key) => run('kv', 'readonly', (s) => s.kv.get(key)),
    kvSet: (key, value) => run('kv', 'readwrite', (s) => { s.kv.put(value, key); }),

    /** Store a track, its audio file, and (optionally) its cover and lyrics atomically. */
    addTrack(track, file, cover, lyrics) {
      return run(['tracks', 'files', 'covers', 'lyrics'], 'readwrite', (s) => {
        s.tracks.put(track);
        s.files.put({ id: track.id, blob: file });
        if (cover) s.covers.put(cover);
        if (lyrics) s.lyrics.put({ id: track.id, text: lyrics });
      });
    },

    removeTracks(ids, coverIds) {
      return run(['tracks', 'files', 'lyrics', 'covers'], 'readwrite', (s) => {
        ids.forEach((id) => { s.tracks.delete(id); s.files.delete(id); s.lyrics.delete(id); });
        (coverIds || []).forEach((id) => s.covers.delete(id));
      });
    },

    async getFile(id) {
      const rec = await DB.get('files', id);
      return rec ? rec.blob : null;
    },

    async destroy() {
      const db = await open();
      db.close();
      dbPromise = null;
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(NAME);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
        req.onblocked = resolve;
      });
    },
  };

  F.db = DB;
})(window.Freeify = window.Freeify || {});
