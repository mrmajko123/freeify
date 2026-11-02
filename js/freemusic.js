/*
 * Freeify: free, legal music downloads.
 *
 * Searches the Internet Archive (archive.org) for music that its artists released under Creative
 * Commons or public-domain licenses, and downloads it straight into your library: real files you can
 * keep, with no ads and no account. Only items with a Creative Commons / public-domain license are used.
 */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const IA = 'https://archive.org';
  const LICENSED = 'licenseurl:(*creativecommons.org* OR *publicdomain*)';
  const FIELDS = ['identifier', 'title', 'creator', 'licenseurl', 'year', 'date', 'downloads'];

  const albumCache = new Map();
  const searchCache = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- helpers

  /** Remove search-syntax characters so user text can't break the query. */
  function clean(text) {
    return String(text || '').replace(/[()[\]{}:"\\^~*?!+&|/<>=-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

  /** Album descriptions are HTML: keep the words, drop the markup. */
  function plainText(html) {
    const spaced = String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, ' ').replace(/<[^>]+>/g, '');
    const doc = new DOMParser().parseFromString(`<body>${spaced}`, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function licenseName(url) {
    const u = String(url || '').toLowerCase();
    if (!u) return '';
    if (u.includes('publicdomain/zero')) return 'CC0';
    if (u.includes('publicdomain')) return 'Public domain';
    const m = u.match(/licenses\/([a-z-]+)\/(\d(?:\.\d)?)/);
    if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
    if (u.includes('creativecommons')) return 'Creative Commons';
    return 'Free license';
  }

  function parseLength(v) {
    if (v == null || v === '') return 0;
    const s = String(v);
    if (s.includes(':')) return s.split(':').reduce((acc, part) => acc * 60 + (parseFloat(part) || 0), 0);
    return parseFloat(s) || 0;
  }

  function trackNumber(v) {
    const m = String(v || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function titleFromFile(name) {
    return name.replace(/^.*\//, '').replace(/\.mp3$/i, '').replace(/^[\d\s._-]+/, '').replace(/[_]+/g, ' ').trim() || name;
  }

  const thumb = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;
  const fileUrl = (id, name) => `${IA}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

  async function getJson(url) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) return res.json();
        lastError = new Error(`The Internet Archive answered ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastError = new Error('Could not reach the Internet Archive. Check your internet connection.');
      }
      await sleep(800 * (attempt + 1));
    }
    throw lastError;
  }

  // ---------------------------------------------------------------- search

  /** Albums (archive.org items) matching a search; with no query, the most popular free albums. */
  async function search(query, page) {
    const q = clean(query);
    page = page || 1;
    const key = `${q}|${page}`;
    if (searchCache.has(key)) return searchCache.get(key);
    const where = q
      ? `(${q}) AND mediatype:audio AND ${LICENSED}`
      : `collection:netlabels AND mediatype:audio AND ${LICENSED}`;
    const params = new URLSearchParams({ q: where, rows: '30', page: String(page), output: 'json' });
    FIELDS.forEach((f) => params.append('fl[]', f));
    params.append('sort[]', 'downloads desc');
    const json = await getJson(`${IA}/advancedsearch.php?${params}`);
    const docs = (json.response && json.response.docs) || [];
    const albums = docs.map((d) => ({
      id: d.identifier,
      title: first(d.title) || d.identifier,
      artist: [].concat(d.creator || []).join(', ') || 'Unknown artist',
      license: first(d.licenseurl),
      year: parseInt(String(d.year || d.date || '').slice(0, 4), 10) || 0,
      image: thumb(d.identifier),
      page: `${IA}/details/${encodeURIComponent(d.identifier)}`,
    }));
    const out = { albums, total: (json.response && json.response.numFound) || albums.length };
    searchCache.set(key, out);
    return out;
  }

  /** Full album with its songs (MP3 files). */
  async function album(id) {
    if (albumCache.has(id)) return albumCache.get(id);
    const json = await getJson(`${IA}/metadata/${encodeURIComponent(id)}`);
    const meta = json.metadata || {};
    const license = first(meta.licenseurl);
    if (!/creativecommons\.org|publicdomain/i.test(license)) {
      throw new Error('This album isn’t released under a free license, so Freeify won’t download it.');
    }
    const albumTitle = first(meta.title) || id;
    const albumArtist = [].concat(meta.creator || []).join(', ') || 'Unknown artist';
    const year = parseInt(String(first(meta.year) || first(meta.date) || '').slice(0, 4), 10) || 0;
    const mp3s = (json.files || []).filter((f) => /\.mp3$/i.test(f.name) && !/_(?:64|128)kb\.mp3$/i.test(f.name) && !/sample/i.test(f.name));
    // One entry per song: prefer the best MP3 when there are several versions of the same file.
    const rank = (f) => (/^VBR MP3$/i.test(f.format) ? 0 : /^(MP3|320Kbps MP3|256Kbps MP3)$/i.test(f.format) ? 1 : 2);
    const byBase = new Map();
    for (const f of mp3s) {
      const base = f.name.replace(/\.mp3$/i, '').toLowerCase();
      if (!byBase.has(base) || rank(f) < rank(byBase.get(base))) byBase.set(base, f);
    }
    const tracks = [...byBase.values()].map((f) => ({
      id: `${id}/${f.name}`,
      title: first(f.title) || titleFromFile(f.name),
      artist: first(f.creator) || first(f.artist) || albumArtist,
      album: first(f.album) || albumTitle,
      trackNo: trackNumber(f.track),
      duration: parseLength(f.length),
      url: fileUrl(id, f.name),
      fileName: f.name.replace(/^.*\//, ''),
      size: parseInt(f.size, 10) || 0,
    }));
    tracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999) || U.cmp(a.fileName, b.fileName));
    tracks.forEach((t, i) => { if (!t.trackNo) t.trackNo = i + 1; });
    const out = {
      id, title: albumTitle, artist: albumArtist, year, license,
      licenseName: licenseName(license), image: thumb(id), page: `${IA}/details/${encodeURIComponent(id)}`,
      description: plainText(first(meta.description)).slice(0, 400),
      tracks,
    };
    tracks.forEach((t) => Object.assign(t, { license, image: out.image, page: out.page, year, albumId: id }));
    albumCache.set(id, out);
    return out;
  }

  // ---------------------------------------------------------------- download

  /** Which of these free songs are already in the library. */
  function owned() {
    const ids = new Set();
    for (const t of L.all()) if (t.sourceId) ids.add(t.sourceId);
    return ids;
  }

  /**
   * Download songs into the library, one at a time. onProgress(done, total, title).
   * Returns { added, failed, matched }.
   */
  async function download(tracks, onProgress) {
    const have = owned();
    const todo = tracks.filter((t) => !have.has(t.id));
    const res = { added: 0, matched: 0, failed: 0, skipped: tracks.length - todo.length };
    let done = 0;
    for (const t of todo) {
      if (onProgress) onProgress(done, todo.length, t.title);
      try {
        const r = await fetch(t.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const file = new File([blob], t.fileName || `${t.artist} - ${t.title}.mp3`, { type: 'audio/mpeg' });
        Object.defineProperty(file, 'freeMeta', {
          value: {
            title: t.title, artist: t.artist, album: t.album, trackNo: t.trackNo, year: t.year,
            imageUrl: t.image, license: t.license, sourceUrl: t.page, sourceId: t.id, source: 'archive',
          },
        });
        const r2 = await L.importFiles([file]);
        res.added += r2.added;
        res.matched += r2.matched;
        if (r2.duplicates) res.skipped++;
        if (r2.failed || r2.unsupported) res.failed++;
      } catch (e) {
        console.warn('[freeify] download failed', t.url, e);
        res.failed++;
      }
      done++;
      if (onProgress) onProgress(done, todo.length, t.title);
    }
    return res;
  }

  // ---------------------------------------------------------------- free versions of greyed-out songs

  /**
   * For songs that aren't on this device (e.g. imported from Spotify), look for the same song by the
   * same artist released for free, and download exact matches. Most commercial songs won't be found.
   */
  async function findFreeVersions(onProgress) {
    const remote = L.all().filter((t) => t.remote);
    const byArtist = new Map();
    for (const t of remote) {
      const artist = L.primaryArtist(t);
      if (!artist || artist === 'Unknown artist') continue;
      const key = U.fold(artist);
      if (!byArtist.has(key)) byArtist.set(key, { artist, songs: [] });
      byArtist.get(key).songs.push(t);
    }
    const artists = [...byArtist.values()];
    const out = { checked: remote.length, artists: artists.length, found: 0, added: 0, failed: 0 };
    let i = 0;
    for (const group of artists) {
      i++;
      if (onProgress) onProgress(i - 1, artists.length, group.artist);
      try {
        const params = new URLSearchParams({ q: `creator:("${clean(group.artist)}") AND mediatype:audio AND ${LICENSED}`, rows: '15', output: 'json' });
        FIELDS.forEach((f) => params.append('fl[]', f));
        const json = await getJson(`${IA}/advancedsearch.php?${params}`);
        const items = ((json.response && json.response.docs) || [])
          .filter((d) => [].concat(d.creator || []).some((c) => L.matchKey('x', c) === L.matchKey('x', group.artist)));
        const wanted = new Map(group.songs.map((t) => [L.matchKey(t.title, group.artist), t]));
        const picks = [];
        for (const item of items.slice(0, 8)) {
          if (!wanted.size) break;
          let a;
          try { a = await album(item.identifier); } catch (e) { continue; }
          for (const tr of a.tracks) {
            const k = L.matchKey(tr.title, group.artist);
            if (wanted.has(k)) { wanted.delete(k); picks.push(Object.assign({}, tr, { artist: group.artist })); }
          }
          await sleep(150);
        }
        if (picks.length) {
          out.found += picks.length;
          const r = await download(picks);
          out.added += r.added + r.matched;
          out.failed += r.failed;
        }
      } catch (e) {
        console.warn('[freeify] free version search failed for', group.artist, e);
      }
      await sleep(150);
    }
    if (onProgress) onProgress(artists.length, artists.length, '');
    return out;
  }

  // ---------------------------------------------------------------- preview

  const previewAudio = new Audio();
  previewAudio.preload = 'none';
  let previewId = null;
  const previewListeners = new Set();
  const emitPreview = () => previewListeners.forEach((fn) => { try { fn(previewId, !previewAudio.paused); } catch (e) { /* ignore */ } });
  ['play', 'pause', 'ended', 'error'].forEach((ev) => previewAudio.addEventListener(ev, () => {
    if (ev === 'ended' || ev === 'error') previewId = null;
    emitPreview();
  }));

  function preview(t) {
    if (previewId === t.id && !previewAudio.paused) { previewAudio.pause(); return; }
    if (F.player && F.player.playing) F.player.pause();
    previewId = t.id;
    previewAudio.src = t.url;
    previewAudio.play().catch(() => { previewId = null; emitPreview(); });
    emitPreview();
  }

  function stopPreview() {
    if (!previewAudio.paused) previewAudio.pause();
    previewId = null;
    emitPreview();
  }

  F.freemusic = {
    search, album, download, findFreeVersions, owned, licenseName,
    preview, stopPreview, onPreview: (fn) => previewListeners.add(fn),
    get previewing() { return previewAudio.paused ? null : previewId; },
  };
})(window.Freeify = window.Freeify || {});
