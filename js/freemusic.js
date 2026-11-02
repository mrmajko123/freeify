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

  async function getJson(url, service) {
    service = service || 'the Internet Archive';
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (res.ok) return res.json();
        lastError = new Error(`${service} answered ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastError = new Error(`Could not reach ${service}. Check your internet connection.`);
      }
      await sleep(800 * (attempt + 1));
    }
    throw lastError;
  }

  // ---------------------------------------------------------------- Jamendo (optional: needs a free Client ID)

  const JAM = 'https://api.jamendo.com/v3.0';
  const JAM_KEY = 'freeify:jamendo';
  const jamCache = new Map();
  const JAM_FORMATS = { audioformat: 'mp32', audiodlformat: 'mp32', imagesize: '300' };

  function jamendoId() {
    try { return localStorage.getItem(JAM_KEY) || ''; } catch (e) { return ''; }
  }

  async function jamGet(path, params, id) {
    id = id || jamendoId();
    if (!id) return [];
    const key = id + path + JSON.stringify(params);
    if (jamCache.has(key)) return jamCache.get(key);
    const json = await getJson(`${JAM}${path}?${new URLSearchParams(Object.assign({ client_id: id, format: 'json' }, params))}`, 'Jamendo');
    if (json.headers && json.headers.status && json.headers.status !== 'success') {
      throw new Error(json.headers.code === 5 ? 'Jamendo didn’t accept that Client ID.' : (json.headers.error_message || 'Jamendo error'));
    }
    jamCache.set(key, json.results || []);
    return json.results || [];
  }

  /** Save (or with an empty value, remove) the Jamendo Client ID after checking it works. */
  async function setJamendoId(id) {
    id = String(id || '').trim();
    jamCache.clear();
    if (!id) { try { localStorage.removeItem(JAM_KEY); } catch (e) { /* ignore */ } return; }
    if (!/^[0-9a-z]{6,40}$/i.test(id)) throw new Error('That doesn’t look like a Jamendo Client ID.');
    await jamGet('/tracks/', { limit: '1' }, id);
    try { localStorage.setItem(JAM_KEY, id); } catch (e) { /* ignore */ }
  }

  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  function jamTrack(r, album) {
    const artist = r.artist_name || (album && album.artist_name) || 'Unknown artist';
    return {
      id: `jam:${r.id}`,
      source: 'jamendo',
      title: r.name,
      artist,
      album: r.album_name || (album && album.name) || '',
      albumId: r.album_id || (album && album.id) ? `jam:${r.album_id || album.id}` : null,
      trackNo: parseInt(r.position, 10) || 0,
      duration: r.duration || 0,
      url: r.audiodownload_allowed !== false && r.audiodownload ? r.audiodownload : null,
      stream: r.audio || '',
      fileName: `${safeName(artist)} - ${safeName(r.name)}.mp3`,
      license: r.license_ccurl || '',
      image: r.album_image || r.image || (album && album.image) || '',
      page: r.shareurl || `https://www.jamendo.com/track/${r.id}`,
      year: parseInt(String(r.releasedate || (album && album.releasedate) || '').slice(0, 4), 10) || 0,
    };
  }

  /** Songs on Jamendo matching a search; with no query, this week's most popular. */
  async function jamSearch(query) {
    if (!jamendoId()) return [];
    const q = String(query || '').trim();
    const params = Object.assign({ limit: '30' }, JAM_FORMATS, q ? { search: q } : { order: 'popularity_week' });
    return (await jamGet('/tracks/', params)).map((r) => jamTrack(r));
  }

  async function jamAlbum(id) {
    const rows = await jamGet('/albums/tracks/', Object.assign({ id }, JAM_FORMATS));
    const a = rows[0];
    if (!a) throw new Error('Jamendo couldn’t find this album.');
    const tracks = (a.tracks || []).map((t) => jamTrack(Object.assign({ album_image: a.image, artist_name: a.artist_name, album_name: a.name, album_id: a.id, releasedate: a.releasedate }, t), a));
    tracks.sort((x, y) => (x.trackNo || 999) - (y.trackNo || 999));
    const license = (tracks.find((t) => t.license) || {}).license || '';
    return {
      id: `jam:${a.id}`, source: 'jamendo', title: a.name, artist: a.artist_name || 'Unknown artist',
      year: parseInt(String(a.releasedate || '').slice(0, 4), 10) || 0, license, licenseName: licenseName(license),
      image: a.image || '', page: `https://www.jamendo.com/album/${a.id}`, description: '', tracks,
    };
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
    if (id.startsWith('jam:')) {
      const a = await jamAlbum(id.slice(4));
      albumCache.set(id, a);
      return a;
    }
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
      id, source: 'archive', title: albumTitle, artist: albumArtist, year, license,
      licenseName: licenseName(license), image: thumb(id), page: `${IA}/details/${encodeURIComponent(id)}`,
      description: plainText(first(meta.description)).slice(0, 400),
      tracks,
    };
    tracks.forEach((t) => Object.assign(t, { source: 'archive', license, image: out.image, page: out.page, year, albumId: id }));
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
  function base64ToBlob(data) {
    if (data instanceof Blob) return data;
    const bin = atob(String(data).replace(/^data:[^,]*,/, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type: 'audio/mpeg' });
  }

  /**
   * Fetch a file. Some music hosts (Jamendo) don't let web pages save their files; the desktop app
   * allows it, and the phone apps fall back to a native download. Throws { blocked: true } otherwise.
   */
  async function fetchBlob(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.blob();
    } catch (e) {
      const native = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (e instanceof TypeError && native && native.request) {
        const r = await native.request({ url, method: 'GET', responseType: 'blob' });
        if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
        return base64ToBlob(r.data);
      }
      if (e instanceof TypeError) { const err = new Error('The site blocked the download.'); err.blocked = true; throw err; }
      throw e;
    }
  }

  async function download(tracks, onProgress) {
    const have = owned();
    const todo = tracks.filter((t) => !have.has(t.id));
    const res = { added: 0, matched: 0, failed: 0, blocked: 0, notAllowed: 0, blockedPage: '', skipped: tracks.length - todo.length };
    let done = 0;
    for (const t of todo) {
      if (onProgress) onProgress(done, todo.length, t.title);
      if (!t.url) { res.notAllowed++; done++; continue; }
      try {
        const blob = await fetchBlob(t.url);
        const file = new File([blob], t.fileName || `${t.artist} - ${t.title}.mp3`, { type: 'audio/mpeg' });
        Object.defineProperty(file, 'freeMeta', {
          value: {
            title: t.title, artist: t.artist, album: t.album, trackNo: t.trackNo, year: t.year,
            imageUrl: t.image, license: t.license, sourceUrl: t.page, sourceId: t.id, source: t.source || 'archive',
          },
        });
        const r2 = await L.importFiles([file]);
        res.added += r2.added;
        res.matched += r2.matched;
        if (r2.duplicates) res.skipped++;
        if (r2.failed || r2.unsupported) res.failed++;
      } catch (e) {
        console.warn('[freeify] download failed', t.url, e);
        if (e.blocked) { res.blocked++; if (!res.blockedPage) res.blockedPage = t.page; } else res.failed++;
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
  const CHECKED_KEY = 'freeChecked';
  const RECHECK_AFTER = 7 * 86400000;

  /**
   * opts.force: check every artist again. Otherwise artists checked in the last 7 days are skipped
   * unless new songs by them were added since (used by the automatic background check).
   */
  async function findFreeVersions(onProgress, opts) {
    opts = opts || {};
    const checked = (await F.db.kvGet(CHECKED_KEY).catch(() => null)) || {};
    const remote = L.all().filter((t) => t.remote);
    const byArtist = new Map();
    for (const t of remote) {
      const artist = L.primaryArtist(t);
      if (!artist || artist === 'Unknown artist') continue;
      const key = U.fold(artist);
      if (!byArtist.has(key)) byArtist.set(key, { artist, songs: [] });
      byArtist.get(key).songs.push(t);
    }
    const now = Date.now();
    const sources = jamendoId() ? 'ia+jam' : 'ia';
    const artists = [...byArtist.entries()]
      .filter(([key, g]) => {
        const c = checked[key];
        return opts.force || !c || now - c.at > RECHECK_AFTER || c.n !== g.songs.length || c.src !== sources;
      })
      .map(([key, g]) => Object.assign(g, { key }));
    const out = { checked: remote.length, artists: artists.length, skippedArtists: byArtist.size - artists.length, found: 0, added: 0, failed: 0, blocked: 0, blockedPage: '' };
    let i = 0;
    for (const group of artists) {
      i++;
      if (onProgress) onProgress(i - 1, artists.length, group.artist);
      let ok = true;
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
        if (wanted.size && jamendoId()) {
          const rows = await jamGet('/tracks/', Object.assign({ artist_name: group.artist, limit: '100' }, JAM_FORMATS));
          for (const r of rows) {
            const tr = jamTrack(r);
            const k = L.matchKey(tr.title, group.artist);
            if (tr.url && wanted.has(k) && L.matchKey('x', tr.artist) === L.matchKey('x', group.artist)) { wanted.delete(k); picks.push(tr); }
          }
        }
        if (picks.length) {
          out.found += picks.length;
          const r = await download(picks);
          out.added += r.added + r.matched;
          out.failed += r.failed;
          out.blocked += r.blocked;
          if (!out.blockedPage) out.blockedPage = r.blockedPage;
          if (r.failed) ok = false;
        }
      } catch (e) {
        ok = false;
        console.warn('[freeify] free version search failed for', group.artist, e);
      }
      // Remember the check (unless it failed, so it is retried next time).
      if (ok) checked[group.key] = { at: Date.now(), n: group.songs.length, src: sources };
      await sleep(150);
    }
    await F.db.kvSet(CHECKED_KEY, checked).catch(() => {});
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
    previewAudio.src = t.stream || t.url;
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
    jamendoId, setJamendoId, jamSearch,
    preview, stopPreview, onPreview: (fn) => previewListeners.add(fn),
    get previewing() { return previewAudio.paused ? null : previewId; },
  };
})(window.Freeify = window.Freeify || {});
