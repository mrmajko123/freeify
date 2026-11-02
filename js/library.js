/* Freeify: the music library (tracks, albums, artists, playlists, likes). */
(function (F) {
  'use strict';

  const U = F.util;
  const DB = F.db;

  const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|mp4|flac|ogg|oga|opus|wav|wave|webm|weba|aif|aiff|caf)$/i;
  const COVER_MAX = 640;

  const tracks = new Map();
  const playlists = new Map();
  const covers = new Map();
  const coverUrls = new Map();
  const artistInfo = new Map();   // artist id -> { id, name, coverId, spotifyId, followed }
  const fileKeys = new Set();
  const listeners = new Set();
  let recents = [];
  let playlistOrder = [];

  let albumCache = null;
  let artistCache = null;
  let searchCache = null;
  let emitTimer = null;
  let importing = false;

  // ---------------------------------------------------------------- events

  function changed(immediate) {
    albumCache = artistCache = searchCache = null;
    if (immediate && emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    }, importing ? 900 : 30);
  }

  // ---------------------------------------------------------------- init

  async function init() {
    const [t, p, c, r, order, a] = await Promise.all([
      DB.getAll('tracks'), DB.getAll('playlists'), DB.getAll('covers'),
      DB.kvGet('recents'), DB.kvGet('playlistOrder'), DB.getAll('artists'),
    ]);
    t.forEach((x) => { tracks.set(x.id, x); if (x.fileKey) fileKeys.add(x.fileKey); });
    a.forEach((x) => artistInfo.set(x.id, x));
    p.forEach((x) => playlists.set(x.id, x));
    c.forEach((x) => covers.set(x.id, x));
    recents = Array.isArray(r) ? r : [];
    playlistOrder = Array.isArray(order) ? order : [];
  }

  // ---------------------------------------------------------------- covers

  function averageColor(ctx, w, h) {
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    let r = 0, g = 0, b = 0, n = 0, rs = 0, gs = 0, bs = 0, ns = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const lum = (max + min) / 2;
      r += R; g += G; b += B; n++;
      // Prefer saturated, mid-luminance pixels for a "vibrant" tint.
      if (max - min > 40 && lum > 40 && lum < 220) { rs += R; gs += G; bs += B; ns++; }
    }
    if (!n) return null;
    if (ns > n * 0.08) { r = rs / ns; g = gs / ns; b = bs / ns; } else { r /= n; g /= n; b /= n; }
    // Clamp the result into a range that looks good behind white text.
    let [hh, s, l] = rgbToHsl(r, g, b);
    s = Math.min(0.75, s);
    l = Math.max(0.22, Math.min(0.42, l));
    return `hsl(${Math.round(hh * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  async function loadImage(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  /** Downscale embedded art, pick a tint colour, and de-duplicate by content hash. */
  async function makeCover(pic) {
    const id = 'c' + U.hashBytes(pic.data);
    if (covers.has(id)) return covers.get(id);
    const raw = new Blob([pic.data], { type: pic.mime });
    try {
      const img = await loadImage(raw);
      const iw = img.width, ih = img.height;
      const scale = Math.min(1, COVER_MAX / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      let blob = raw;
      if (scale < 1 || raw.size > 350000) {
        blob = (await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88))) || raw;
      }
      const small = document.createElement('canvas');
      small.width = small.height = 32;
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(canvas, 0, 0, 32, 32);
      const color = averageColor(sctx, 32, 32);
      if (img.close) img.close();
      return { id, blob, color };
    } catch (e) {
      return null; // undecodable image: just skip the art
    }
  }

  function coverUrl(id) {
    if (!id) return null;
    let url = coverUrls.get(id);
    if (!url) {
      const c = covers.get(id);
      if (!c) return null;
      if (c.blob) url = URL.createObjectURL(c.blob);
      else if (c.url) url = c.url;
      else return null;
      coverUrls.set(id, url);
    }
    return url;
  }

  /** A cover that lives on the web (Spotify, Wikipedia). Returns its id, creating it if needed. */
  function urlCover(url, pending) {
    if (!url) return null;
    const id = 'u' + U.hash(url);
    if (!covers.has(id) && !pending.has(id)) pending.set(id, { id, url, color: null });
    return id;
  }

  /** Work out tint colours for web covers in the background (needs CORS-enabled images). */
  async function fillCoverColors(list) {
    let n = 0;
    for (const c of list) {
      if (c.color || !c.url) continue;
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = c.url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 32, 32);
        c.color = averageColor(ctx, 32, 32);
        if (c.color) { await DB.put('covers', c); n++; }
      } catch (e) { /* image unavailable or not CORS-enabled: keep default colour */ }
    }
    if (n) changed();
  }

  const coverColor = (id) => (id && covers.has(id) ? covers.get(id).color : null);

  // ---------------------------------------------------------------- import

  function probeDuration(file) {
    return new Promise((resolve) => {
      const a = document.createElement('audio');
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (d) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        a.onloadedmetadata = a.onerror = a.ondurationchange = null;
        a.removeAttribute('src');
        try { a.load(); } catch (e) { /* ignore */ }
        URL.revokeObjectURL(url);
        resolve(d);
      };
      const timer = setTimeout(() => finish(0), 15000);
      a.preload = 'metadata';
      a.muted = true;
      a.onloadedmetadata = () => {
        if (a.duration === Infinity) {
          a.ondurationchange = () => { if (isFinite(a.duration)) finish(a.duration); };
          a.currentTime = 1e9;
        } else finish(a.duration || 0);
      };
      a.onerror = () => finish(-1);
      a.src = url;
    });
  }

  /** Guess metadata from "Artist/Album/01 - Artist - Title.mp3" style paths. */
  function fromPath(file) {
    const rel = file.webkitRelativePath || file.relPath || file.name;
    const parts = rel.split('/').filter(Boolean);
    let name = parts[parts.length - 1].replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    let trackNo = 0;
    const num = name.match(/^(\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/);
    if (num) { trackNo = parseInt(num[1], 10); name = num[2]; }
    let artist = '', title = name;
    const dash = name.split(/\s+[-–—]\s+/);
    if (dash.length >= 2) { artist = dash[0].trim(); title = dash.slice(1).join(' - ').trim(); }
    const album = parts.length >= 2 ? parts[parts.length - 2] : '';
    if (!artist && parts.length >= 3) artist = parts[parts.length - 3];
    return { title: title || name, artist, album, trackNo };
  }

  function isAudio(f) {
    return AUDIO_EXT.test(f.name) || (f.type && f.type.indexOf('audio/') === 0);
  }

  // ---------------------------------------------------------------- matching (Spotify songs <-> your files)

  function normTitle(s) {
    return U.fold(s)
      .replace(/\s*[(\[][^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*\b(remaster(ed)?|version|edit|live|mix|mono|stereo|deluxe|acoustic|radio)\b.*$/, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function normArtist(s) {
    const first = U.fold(s).split(/\s*(?:,|&|;|\/|\bfeat\.?|\bft\.?|\bfeaturing)\s*/)[0] || '';
    return first.replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
  }

  function matchKey(title, artist) {
    const t = normTitle(title);
    return t ? `${t}|${normArtist(artist)}` : null;
  }

  function matchIndex(onlyRemote) {
    const bySp = new Map(), byIsrc = new Map(), byKey = new Map();
    for (const t of tracks.values()) {
      if (onlyRemote && !t.remote) continue;
      if (t.spotifyId) bySp.set(t.spotifyId, t);
      else if (t.spotifyUri) bySp.set(t.spotifyUri, t);
      if (t.isrc) byIsrc.set(t.isrc.toUpperCase(), t);
      const k = matchKey(t.title, primaryArtist(t));
      if (k && (!byKey.has(k) || (byKey.get(k).remote && !t.remote))) byKey.set(k, t);
    }
    return { bySp, byIsrc, byKey };
  }

  function takeMatch(idx, isrc, title, artist) {
    const t = (isrc && idx.byIsrc.get(isrc.toUpperCase())) || idx.byKey.get(matchKey(title, artist));
    if (!t) return null;
    // Remove from the index so two files never claim the same song.
    if (t.isrc) idx.byIsrc.delete(t.isrc.toUpperCase());
    idx.byKey.delete(matchKey(t.title, primaryArtist(t)));
    return t;
  }

  async function importOne(file, lrcs, usedLrc, remoteIdx) {
    const fileKey = `${file.name}|${file.size}`;
    if (fileKeys.has(fileKey)) return 'duplicates';
    fileKeys.add(fileKey);
    try {
      const [tags, duration] = await Promise.all([F.tags.parse(file), probeDuration(file)]);
      if (duration < 0) { fileKeys.delete(fileKey); return 'unsupported'; }
      const guess = fromPath(file);
      const cover = tags.picture ? await makeCover(tags.picture) : null;
      let lyrics = tags.lyrics || '';
      const base = U.baseName(file.name);
      if (lrcs.has(base)) { lyrics = await lrcs.get(base).text(); usedLrc.add(base); }
      const storeFile = file instanceof Blob ? file : new Blob([file]);

      // A song imported from Spotify earlier? Give it this file instead of adding a duplicate.
      const remote = takeMatch(remoteIdx, tags.isrc, tags.title || guess.title, tags.artist || guess.artist || '');
      if (remote) {
        Object.assign(remote, {
          remote: false,
          duration: duration || remote.duration,
          fileName: file.name, fileKey, size: file.size, mime: file.type || '',
          coverId: cover ? cover.id : remote.coverId,
          hasLyrics: remote.hasLyrics || !!lyrics,
          isrc: remote.isrc || tags.isrc || '',
          genre: remote.genre || tags.genre || '',
        });
        await DB.addTrack(remote, storeFile, cover && !covers.has(cover.id) ? cover : null, lyrics);
        if (cover) covers.set(cover.id, cover);
        changed();
        return 'matched';
      }

      const track = {
        id: U.uid(),
        title: tags.title || guess.title,
        artist: tags.artist || guess.artist || '',
        album: tags.album || (tags.title ? '' : guess.album) || '',
        albumArtist: tags.albumArtist || '',
        trackNo: tags.trackNo || guess.trackNo || 0,
        discNo: tags.discNo || 0,
        year: tags.year || 0,
        genre: tags.genre || '',
        duration: duration || 0,
        coverId: cover ? cover.id : null,
        hasLyrics: !!lyrics,
        isrc: tags.isrc || '',
        fileName: file.name,
        fileKey,
        size: file.size,
        mime: file.type || '',
        addedAt: Date.now(),
        likedAt: 0,
        playCount: 0,
        lastPlayed: 0,
      };
      await DB.addTrack(track, storeFile, cover && !covers.has(cover.id) ? cover : null, lyrics);
      if (cover) covers.set(cover.id, cover);
      tracks.set(track.id, track);
      changed();
      return 'added';
    } catch (e) {
      fileKeys.delete(fileKey);
      throw e;
    }
  }

  /**
   * Import a list of Files. onProgress(done, total, fileName) is called after each file.
   * Returns a summary { added, duplicates, unsupported, failed, lyrics, quota }.
   */
  async function importFiles(fileList, onProgress) {
    const all = Array.from(fileList || []);
    const lrcs = new Map();
    const audio = [];
    for (const f of all) {
      if (/\.lrc$/i.test(f.name)) lrcs.set(U.baseName(f.name), f);
      else if (isAudio(f)) audio.push(f);
    }
    const res = { added: 0, matched: 0, duplicates: 0, unsupported: 0, failed: 0, lyrics: 0, quota: false, total: audio.length, ignored: all.length - audio.length - lrcs.size };
    const usedLrc = new Set();
    const remoteIdx = matchIndex(true);
    importing = true;
    let done = 0;
    const queue = audio.slice().sort((a, b) => U.cmp(a.webkitRelativePath || a.relPath || a.name, b.webkitRelativePath || b.relPath || b.name));
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          res[await importOne(f, lrcs, usedLrc, remoteIdx)]++;
        } catch (e) {
          console.error('[freeify] import failed', f.name, e);
          res.failed++;
          if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) { res.quota = true; queue.length = 0; }
        }
        done++;
        if (onProgress) onProgress(done, audio.length, f.name);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      // Lyrics files dropped on their own: attach to matching tracks already in the library.
      for (const [base, f] of lrcs) {
        if (usedLrc.has(base)) continue;
        const match = [...tracks.values()].filter((t) => U.baseName(t.fileName) === base);
        if (!match.length) continue;
        const text = await f.text();
        for (const t of match) {
          await DB.put('lyrics', { id: t.id, text });
          t.hasLyrics = true;
          await DB.put('tracks', t);
          res.lyrics++;
        }
      }
    } finally {
      importing = false;
      changed(true);
    }
    return res;
  }

  // ---------------------------------------------------------------- queries

  const get = (id) => tracks.get(id);
  const all = () => [...tracks.values()];
  const count = () => tracks.size;

  function byAdded() {
    return all().sort((a, b) => b.addedAt - a.addedAt || U.cmp(a.title, b.title)).map((t) => t.id);
  }

  function liked() {
    return all().filter((t) => t.likedAt).sort((a, b) => b.likedAt - a.likedAt).map((t) => t.id);
  }

  function primaryArtist(t) {
    if (t.artists && t.artists.length) return t.artists[0];
    const name = (t.artist || t.albumArtist || '').split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)[0].trim();
    return name || 'Unknown artist';
  }

  function albumArtistOf(t) { return t.albumArtist || primaryArtist(t); }

  function trackOrder(a, b) {
    return (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 999) - (b.trackNo || 999) || U.cmp(a.title, b.title);
  }

  function albums() {
    if (albumCache) return albumCache;
    const m = new Map();
    for (const t of tracks.values()) {
      if (!t.album) continue;
      const key = (albumArtistOf(t) + '\u0001' + t.album).toLowerCase();
      let a = m.get(key);
      if (!a) {
        a = { id: U.hash(key), name: t.album, artist: albumArtistOf(t), year: 0, coverId: null, trackIds: [], addedAt: 0, duration: 0 };
        m.set(key, a);
      }
      a.trackIds.push(t.id);
      a.duration += t.duration || 0;
      if (!a.coverId && t.coverId) a.coverId = t.coverId;
      if (!a.year && t.year) a.year = t.year;
      if (t.addedAt > a.addedAt) a.addedAt = t.addedAt;
    }
    const list = [...m.values()];
    list.forEach((a) => a.trackIds.sort((x, y) => trackOrder(tracks.get(x), tracks.get(y))));
    list.sort((a, b) => U.cmp(a.name, b.name));
    albumCache = { list, byId: new Map(list.map((a) => [a.id, a])) };
    return albumCache;
  }

  function artists() {
    if (artistCache) return artistCache;
    const m = new Map();
    const albumsById = albums();
    for (const t of tracks.values()) {
      const name = primaryArtist(t);
      const key = name.toLowerCase();
      let a = m.get(key);
      if (!a) { a = { id: U.hash('artist:' + key), name, trackIds: [], coverId: null, albumIds: new Set(), plays: 0 }; m.set(key, a); }
      a.trackIds.push(t.id);
      a.plays += t.playCount || 0;
      if (!a.coverId && t.coverId) a.coverId = t.coverId;
    }
    for (const al of albumsById.list) {
      for (const tid of al.trackIds) {
        const a = m.get(primaryArtist(tracks.get(tid)).toLowerCase());
        if (a) a.albumIds.add(al.id);
      }
      const owner = m.get(al.artist.toLowerCase());
      if (owner) owner.albumIds.add(al.id);
    }
    const list = [...m.values()];
    list.forEach((a) => {
      a.trackIds.sort((x, y) => {
        const A = tracks.get(x), B = tracks.get(y);
        return U.cmp(A.album, B.album) || trackOrder(A, B);
      });
      // Prefer the cover of the artist's own album for their picture.
      const own = [...a.albumIds].map((id) => albumsById.byId.get(id)).find((al) => al && al.coverId && al.artist.toLowerCase() === a.name.toLowerCase());
      if (own) a.coverId = own.coverId;
      const info = artistInfo.get(a.id);
      a.imageId = info && info.coverId && covers.has(info.coverId) ? info.coverId : null;
      a.spotifyId = info ? info.spotifyId || null : null;
      a.local = a.trackIds.some((id) => !tracks.get(id).remote);
    });
    list.sort((a, b) => U.cmp(a.name, b.name));
    artistCache = { list, byId: new Map(list.map((a) => [a.id, a])), byName: m };
    return artistCache;
  }

  const album = (id) => albums().byId.get(id) || null;
  const artist = (id) => artists().byId.get(id) || null;

  function albumIdOf(t) {
    if (!t || !t.album) return null;
    return U.hash((albumArtistOf(t) + '\u0001' + t.album).toLowerCase());
  }

  function artistIdOf(t) { return t ? U.hash('artist:' + primaryArtist(t).toLowerCase()) : null; }
  function artistIdByName(name) { return U.hash('artist:' + String(name || '').toLowerCase()); }

  function genres() {
    const m = new Map();
    for (const t of tracks.values()) {
      if (!t.genre) continue;
      const key = t.genre.toLowerCase();
      let g = m.get(key);
      if (!g) { g = { id: encodeURIComponent(key), name: t.genre, trackIds: [], coverId: null }; m.set(key, g); }
      g.trackIds.push(t.id);
      if (!g.coverId && t.coverId) g.coverId = t.coverId;
    }
    return [...m.values()].sort((a, b) => b.trackIds.length - a.trackIds.length);
  }

  function genre(id) {
    const key = String(id || '').toLowerCase();
    return genres().find((g) => g.id === id || g.name.toLowerCase() === key) || null;
  }

  function searchIndex() {
    if (searchCache) return searchCache;
    searchCache = new Map();
    for (const t of tracks.values()) {
      searchCache.set(t.id, U.fold([t.title, t.artist, t.album, t.albumArtist, t.genre, t.fileName].join(' \u0001 ')));
    }
    return searchCache;
  }

  function score(text, q) {
    const s = U.fold(text);
    if (!s) return 0;
    if (s === q) return 100;
    if (s.startsWith(q)) return 80;
    if (s.includes(' ' + q)) return 60;
    if (s.includes(q)) return 40;
    return 0;
  }

  /** Full-text search across tracks, albums and artists. */
  function search(query) {
    const q = U.fold(query).trim();
    if (!q) return { tracks: [], albums: [], artists: [], top: null };
    const words = q.split(/\s+/);
    const idx = searchIndex();
    const found = [];
    for (const [id, text] of idx) {
      if (words.every((w) => text.includes(w))) {
        const t = tracks.get(id);
        found.push({ id, s: Math.max(score(t.title, q) + 5, score(t.artist, q), score(t.album, q) - 5) + Math.min(10, t.playCount || 0) });
      }
    }
    found.sort((a, b) => b.s - a.s || U.cmp(tracks.get(a.id).title, tracks.get(b.id).title));
    const matchAll = (text) => { const f = U.fold(text); return words.every((w) => f.includes(w)); };
    const al = albums().list.filter((a) => matchAll(a.name + ' ' + a.artist))
      .map((a) => ({ a, s: Math.max(score(a.name, q), score(a.artist, q) - 10) })).sort((x, y) => y.s - x.s).map((x) => x.a);
    const ar = artists().list.filter((a) => matchAll(a.name))
      .map((a) => ({ a, s: score(a.name, q) })).sort((x, y) => y.s - x.s).map((x) => x.a);

    let top = null;
    const cands = [];
    if (found.length) cands.push({ kind: 'track', item: found[0].id, s: found[0].s });
    if (al.length) cands.push({ kind: 'album', item: al[0], s: score(al[0].name, q) + 1 });
    if (ar.length) cands.push({ kind: 'artist', item: ar[0], s: score(ar[0].name, q) + 2 });
    cands.sort((a, b) => b.s - a.s);
    if (cands.length) top = cands[0];
    return { tracks: found.map((f) => f.id), albums: al, artists: ar, top };
  }

  // ---------------------------------------------------------------- mutations

  function save(t) { DB.put('tracks', t).catch((e) => console.error(e)); }

  function setLiked(ids, value) {
    const now = Date.now();
    ids.forEach((id, i) => {
      const t = tracks.get(id);
      if (!t) return;
      t.likedAt = value ? now - i : 0;
      save(t);
    });
    changed();
  }

  function toggleLike(id) {
    const t = tracks.get(id);
    if (!t) return false;
    setLiked([id], !t.likedAt);
    return !!t.likedAt;
  }

  function recordPlay(id) {
    const t = tracks.get(id);
    if (!t) return;
    t.playCount = (t.playCount || 0) + 1;
    t.lastPlayed = Date.now();
    save(t);
  }

  async function updateTrack(id, patch) {
    const t = tracks.get(id);
    if (!t) return;
    Object.assign(t, patch);
    await DB.put('tracks', t);
    changed();
  }

  async function setLyrics(id, text) {
    const t = tracks.get(id);
    if (!t) return;
    if (text && text.trim()) await DB.put('lyrics', { id, text });
    else await DB.del('lyrics', id);
    t.hasLyrics = !!(text && text.trim());
    await DB.put('tracks', t);
    changed();
  }

  async function getLyrics(id) {
    const rec = await DB.get('lyrics', id);
    return rec ? rec.text : '';
  }

  async function removeTracks(ids) {
    const set = new Set(ids);
    for (const id of set) {
      const t = tracks.get(id);
      if (t) { if (t.fileKey) fileKeys.delete(t.fileKey); tracks.delete(id); }
    }
    const used = new Set();
    for (const t of tracks.values()) if (t.coverId) used.add(t.coverId);
    for (const p of playlists.values()) if (p.coverId) used.add(p.coverId);
    for (const a of artistInfo.values()) if (a.coverId) used.add(a.coverId);
    const orphans = [...covers.keys()].filter((c) => !used.has(c));
    await DB.removeTracks([...set], orphans);
    orphans.forEach((c) => {
      covers.delete(c);
      if (coverUrls.has(c)) { if (coverUrls.get(c).startsWith('blob:')) URL.revokeObjectURL(coverUrls.get(c)); coverUrls.delete(c); }
    });
    const touched = [];
    for (const p of playlists.values()) {
      const before = p.trackIds.length;
      p.trackIds = p.trackIds.filter((id) => !set.has(id));
      if (p.trackIds.length !== before) { p.updatedAt = Date.now(); touched.push(p); }
    }
    if (touched.length) await DB.putMany('playlists', touched);
    changed();
  }

  const getFile = (id) => DB.getFile(id);

  // ---------------------------------------------------------------- playlists

  function playlistList() {
    const pos = new Map(playlistOrder.map((id, i) => [id, i]));
    return [...playlists.values()].sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id) : -1, pb = pos.has(b.id) ? pos.get(b.id) : -1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
  }

  const playlist = (id) => playlists.get(id) || null;

  function createPlaylist(name, trackIds) {
    const n = playlists.size + 1;
    const p = {
      id: U.uid(),
      name: (name || '').trim() || `My Playlist #${n}`,
      description: '',
      trackIds: (trackIds || []).slice(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    playlists.set(p.id, p);
    playlistOrder = [p.id, ...playlistOrder.filter((id) => playlists.has(id))];
    DB.put('playlists', p);
    DB.kvSet('playlistOrder', playlistOrder);
    changed();
    return p;
  }

  function updatePlaylist(id, patch) {
    const p = playlists.get(id);
    if (!p) return;
    Object.assign(p, patch, { updatedAt: Date.now() });
    DB.put('playlists', p);
    changed();
  }

  function deletePlaylist(id) {
    playlists.delete(id);
    playlistOrder = playlistOrder.filter((x) => x !== id);
    DB.del('playlists', id);
    DB.kvSet('playlistOrder', playlistOrder);
    recents = recents.filter((r) => !(r.type === 'playlist' && r.id === id));
    DB.kvSet('recents', recents);
    changed();
  }

  /** Adds tracks, skipping ones already present. Returns how many were added. */
  function addToPlaylist(id, ids) {
    const p = playlists.get(id);
    if (!p) return 0;
    const have = new Set(p.trackIds);
    const add = ids.filter((x) => !have.has(x) && tracks.has(x) && (have.add(x), true));
    if (!add.length) return 0;
    updatePlaylist(id, { trackIds: p.trackIds.concat(add) });
    return add.length;
  }

  function removeFromPlaylist(id, indexes) {
    const p = playlists.get(id);
    if (!p) return;
    const drop = new Set(indexes);
    updatePlaylist(id, { trackIds: p.trackIds.filter((_, i) => !drop.has(i)) });
  }

  /** Move the entries at `indexes` so they land before position `to`. */
  function movePlaylistTracks(id, indexes, to) {
    const p = playlists.get(id);
    if (!p) return;
    const set = new Set(indexes);
    const sorted = [...set].sort((a, b) => a - b);
    const moving = sorted.map((i) => p.trackIds[i]);
    const before = sorted.filter((i) => i < to).length;
    const rest = p.trackIds.filter((_, i) => !set.has(i));
    rest.splice(Math.max(0, to - before), 0, ...moving);
    updatePlaylist(id, { trackIds: rest });
  }

  // ---------------------------------------------------------------- recents

  function addRecent(ctx) {
    if (!ctx || !ctx.type || ctx.type === 'search' || ctx.type === 'queue') return;
    recents = [{ type: ctx.type, id: ctx.id, at: Date.now() }, ...recents.filter((r) => !(r.type === ctx.type && r.id === ctx.id))].slice(0, 24);
    DB.kvSet('recents', recents);
  }

  const getRecents = () => recents.slice();

  // ---------------------------------------------------------------- stats

  function totals(ids) {
    let d = 0;
    for (const id of ids) { const t = tracks.get(id); if (t) d += t.duration || 0; }
    return d;
  }

  function topTracks(n) {
    return all().filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed).slice(0, n).map((t) => t.id);
  }

  function recentlyPlayedTracks(n) {
    return all().filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n).map((t) => t.id);
  }

  async function wipe() {
    coverUrls.forEach((u) => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); });
    await DB.destroy();
  }

  // ---------------------------------------------------------------- Spotify import

  /**
   * Merge songs, likes, playlists and artists from Spotify into the library.
   * data = { tracks: [{ ref, spotifyId, spotifyUri, isrc, title, artists[], album, albumArtist, trackNo,
   *                     discNo, year, duration, imageUrl, addedAt }],
   *          liked: [{ ref, at }], playlists: [{ spotifyId, name, description, imageUrl, refs[] }],
   *          artists: [{ spotifyId, name, imageUrl, followed }] }
   * Songs you already have as files are linked (and get missing covers/info); others are added as
   * "not on this device" until you add their files.
   */
  async function addSpotify(data) {
    const idx = matchIndex(false);
    const pending = new Map();
    const dirty = new Map();
    const refToId = new Map();
    const stats = { added: 0, linked: 0, updated: 0, liked: 0, playlists: 0, artists: 0 };

    for (const s of data.tracks || []) {
      if (!s || !s.ref || refToId.has(s.ref)) continue;
      const artists = (s.artists || []).filter(Boolean);
      const coverId = urlCover(s.imageUrl, pending);
      let t = idx.bySp.get(s.spotifyId || s.ref) || (s.isrc && idx.byIsrc.get(s.isrc.toUpperCase())) || idx.byKey.get(matchKey(s.title, artists[0] || ''));
      if (t && t.remote) {
        Object.assign(t, {
          title: s.title || t.title, artist: artists.join(', ') || t.artist, artists: artists.length ? artists : t.artists,
          album: s.album || t.album, albumArtist: s.albumArtist || t.albumArtist, trackNo: s.trackNo || t.trackNo,
          discNo: s.discNo || t.discNo, year: s.year || t.year, duration: s.duration || t.duration,
          coverId: coverId || t.coverId, isrc: s.isrc || t.isrc || '',
        });
        stats.updated++;
      } else if (t) {
        // A real file: keep its own tags and only fill the gaps.
        if (!t.album && s.album) { t.album = s.album; if (!t.albumArtist) t.albumArtist = s.albumArtist || ''; }
        if (!t.year && s.year) t.year = s.year;
        if (!t.trackNo && s.trackNo) t.trackNo = s.trackNo;
        if (!t.coverId && coverId) t.coverId = coverId;
        if (!t.isrc && s.isrc) t.isrc = s.isrc;
        stats.linked++;
      } else {
        t = {
          id: U.uid(), title: s.title || 'Unknown song', artist: artists.join(', '), artists,
          album: s.album || '', albumArtist: s.albumArtist || '', trackNo: s.trackNo || 0, discNo: s.discNo || 0,
          year: s.year || 0, genre: '', duration: s.duration || 0, coverId, hasLyrics: false, isrc: s.isrc || '',
          fileName: '', fileKey: null, size: 0, mime: '', remote: true,
          addedAt: s.addedAt || Date.now(), likedAt: 0, playCount: 0, lastPlayed: 0,
        };
        tracks.set(t.id, t);
        if (t.isrc) idx.byIsrc.set(t.isrc.toUpperCase(), t);
        const k = matchKey(t.title, artists[0] || '');
        if (k && !idx.byKey.has(k)) idx.byKey.set(k, t);
        stats.added++;
      }
      if (s.spotifyId && !t.spotifyId) t.spotifyId = s.spotifyId;
      if (s.spotifyUri && !t.spotifyUri) t.spotifyUri = s.spotifyUri;
      if (t.spotifyId) idx.bySp.set(t.spotifyId, t);
      idx.bySp.set(s.ref, t);
      dirty.set(t.id, t);
      refToId.set(s.ref, t.id);
    }

    for (const l of data.liked || []) {
      const t = tracks.get(refToId.get(l.ref));
      if (t && !t.likedAt) { t.likedAt = l.at || Date.now(); dirty.set(t.id, t); stats.liked++; }
    }

    const plDirty = [];
    for (const p of data.playlists || []) {
      const seen = new Set();
      const ids = [];
      for (const ref of p.refs || []) {
        const id = refToId.get(ref);
        if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
      }
      let pl = [...playlists.values()].find((x) => x.source === 'spotify' && (p.spotifyId ? x.spotifyId === p.spotifyId : x.name === p.name));
      const coverId = urlCover(p.imageUrl, pending);
      if (pl) Object.assign(pl, { name: p.name || pl.name, description: p.description || '', trackIds: ids, coverId: coverId || pl.coverId || null, updatedAt: Date.now() });
      else {
        pl = { id: U.uid(), name: p.name || 'Spotify playlist', description: p.description || '', trackIds: ids, createdAt: Date.now(), updatedAt: Date.now(), source: 'spotify', spotifyId: p.spotifyId || null, coverId };
        playlists.set(pl.id, pl);
        playlistOrder.push(pl.id);
      }
      plDirty.push(pl);
      stats.playlists++;
    }

    const artDirty = [];
    for (const a of data.artists || []) {
      if (!a || !a.name) continue;
      const id = artistIdByName(a.name);
      const cur = artistInfo.get(id) || { id, name: a.name };
      if (a.spotifyId) cur.spotifyId = a.spotifyId;
      const cid = urlCover(a.imageUrl, pending);
      if (cid) cur.coverId = cid;
      if (a.followed) cur.followed = true;
      artistInfo.set(id, cur);
      artDirty.push(cur);
      stats.artists++;
    }

    const newCovers = [...pending.values()];
    newCovers.forEach((c) => covers.set(c.id, c));
    await DB.putMany('covers', newCovers);
    await DB.putMany('tracks', [...dirty.values()]);
    await DB.putMany('playlists', plDirty);
    await DB.putMany('artists', artDirty);
    await DB.kvSet('playlistOrder', playlistOrder);
    changed(true);
    fillCoverColors(newCovers);
    return stats;
  }

  /** Give every song of an album that has no cover this web cover. */
  async function setAlbumCover(albumId, url) {
    const a = album(albumId);
    if (!a || !url) return false;
    const pending = new Map();
    const cid = urlCover(url, pending);
    const dirty = a.trackIds.map((id) => tracks.get(id)).filter((t) => t && !t.coverId);
    dirty.forEach((t) => { t.coverId = cid; });
    const newCovers = [...pending.values()];
    newCovers.forEach((c) => covers.set(c.id, c));
    await DB.putMany('covers', newCovers);
    await DB.putMany('tracks', dirty);
    changed();
    fillCoverColors(newCovers);
    return true;
  }

  async function setArtistImage(name, url, spotifyId) {
    if (!name || !url) return false;
    const pending = new Map();
    const id = artistIdByName(name);
    const cur = artistInfo.get(id) || { id, name };
    cur.coverId = urlCover(url, pending);
    if (spotifyId) cur.spotifyId = spotifyId;
    artistInfo.set(id, cur);
    const newCovers = [...pending.values()];
    newCovers.forEach((c) => covers.set(c.id, c));
    await DB.putMany('covers', newCovers);
    await DB.put('artists', cur);
    changed();
    fillCoverColors(newCovers);
    return true;
  }

  const isPlayable = (id) => { const t = tracks.get(id); return !!t && !t.remote; };

  F.library = {
    addSpotify, setAlbumCover, setArtistImage, isPlayable, matchKey,
    init, on: (fn) => listeners.add(fn), changed,
    importFiles, isAudio,
    get, all, count, byAdded, liked, albums, artists, album, artist, albumIdOf, artistIdOf, artistIdByName, primaryArtist,
    genres, genre, search, totals, topTracks, recentlyPlayedTracks,
    coverUrl, coverColor,
    setLiked, toggleLike, recordPlay, updateTrack, setLyrics, getLyrics, removeTracks, getFile,
    playlists: playlistList, playlist, createPlaylist, updatePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, movePlaylistTracks,
    addRecent, recents: getRecents, wipe,
  };
})(window.Freeify = window.Freeify || {});
