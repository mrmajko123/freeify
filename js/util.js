/* Freeify: small shared helpers. */
(function (F) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  function fnv(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  const U = {
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),

    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]),

    uid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },

    /** Stable short id for a string (two 32-bit FNV-1a hashes, base36). */
    hash: (str) => fnv(str, 0x811c9dc5).toString(36) + fnv(str, 0x9747b28c).toString(36),

    /** FNV-1a over bytes, used to de-duplicate embedded cover art. */
    hashBytes(bytes) {
      let a = 0x811c9dc5, b = 0x9747b28c;
      for (let i = 0; i < bytes.length; i++) {
        a ^= bytes[i]; a = Math.imul(a, 0x01000193);
        b ^= bytes[i]; b = Math.imul(b, 0x01000193);
      }
      return (a >>> 0).toString(36) + (b >>> 0).toString(36) + bytes.length.toString(36);
    },

    collator,
    cmp: (a, b) => collator.compare(a || '', b || ''),

    /** Lowercase, strip accents: used for search matching. */
    fold: (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),

    fmtTime(sec) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      sec = Math.floor(sec);
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      const ss = String(s).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    },

    /** "1 hr 12 min" / "23 min 5 sec" */
    fmtLong(sec) {
      sec = Math.round(sec || 0);
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      if (h) return `${h} hr ${m} min`;
      if (m) return `${m} min ${s} sec`;
      return `${s} sec`;
    },

    fmtDate(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts, day = 86400000;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
      if (diff < day) return `${Math.floor(diff / 3600000)} hr ago`;
      if (diff < 2 * day) return 'Yesterday';
      if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
      if (diff < 30 * day) { const w = Math.floor(diff / (7 * day)); return `${w} week${w > 1 ? 's' : ''} ago`; }
      return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    fmtBytes(n) {
      if (!n) return '0 B';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
    },

    plural: (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`,

    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },

    range: (n) => Array.from({ length: n }, (_, i) => i),

    debounce(fn, ms) {
      let t;
      const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
      d.flush = (...args) => { clearTimeout(t); fn(...args); };
      return d;
    },

    throttle(fn, ms) {
      let last = 0, t = null;
      return (...args) => {
        const now = Date.now(), wait = ms - (now - last);
        if (wait <= 0) { last = now; fn(...args); }
        else if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...args); }, wait);
      };
    },

    /** Pleasant two-stop gradient derived from any string (used for placeholder art). */
    gradient(seed) {
      const h = fnv(String(seed || 'freeify'), 0x811c9dc5) % 360;
      return `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 48) % 360} 60% 22%))`;
    },

    seedColor(seed) {
      const h = fnv(String(seed || 'freeify'), 0x811c9dc5) % 360;
      return `hsl(${h} 45% 32%)`;
    },

    baseName: (name) => String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase(),

    isTyping(el) {
      el = el || document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' && !/^(range|checkbox|radio|button)$/.test(el.type) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    },
  };

  F.util = U;
})(window.Freeify = window.Freeify || {});
