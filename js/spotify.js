/*
 * Freeify: Spotify import.
 *
 * Imports your Spotify library's *information* (liked songs, your playlists, saved albums, followed
 * artists, album covers and artist pictures). Spotify's audio is copy-protected and only licensed for
 * Spotify's own apps, so songs show as "not on this device" until you add your own files for them;
 * Freeify then matches the files automatically.
 *
 * Two ways in:
 *  1. Connect: sign in with Spotify (Authorization Code + PKCE, using your own free Spotify developer
 *     app's Client ID). Works on https sites, on http://127.0.0.1, and in the desktop app.
 *  2. Data export: the YourLibrary.json / Playlist*.json files from Spotify's "Download your data".
 */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;

  const AUTH_URL = 'https://accounts.spotify.com/authorize';
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';
  const API = 'https://api.spotify.com/v1';
  const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative user-follow-read';
  const DESKTOP_REDIRECT = 'http://127.0.0.1:43821/callback';
  const KEY = 'freeify:spotify';
  const PKCE_KEY = 'freeify:spotify-pkce';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- saved state

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }

  function save(patch) {
    const next = Object.assign(load(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* storage blocked */ }
    return next;
  }

  const state = () => load();
  const connected = () => !!(load().token && load().token.refresh);

  // ---------------------------------------------------------------- environment

  const isDesktopApp = () => /Electron/i.test(navigator.userAgent);
  const isPhoneApp = () => !!window.Capacitor;

  /** The redirect address to register in the Spotify app, or null with a reason when sign-in can't work here. */
  function redirectInfo() {
    if (isDesktopApp()) return { uri: DESKTOP_REDIRECT };
    if (isPhoneApp()) return { uri: null, reason: 'phone' };
    if (location.protocol === 'file:') return { uri: null, reason: 'file' };
    if (location.hostname === 'localhost') return { uri: null, reason: 'localhost' };
    if (location.protocol !== 'https:' && !/^(127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return { uri: null, reason: 'insecure' };
    return { uri: location.origin + location.pathname };
  }

  // ---------------------------------------------------------------- PKCE sign-in

  function b64url(bytes) {
    let s = '';
    new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomBytes(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  }

  async function connect(clientId) {
    clientId = String(clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) throw new Error('That doesn’t look like a Spotify Client ID (32 letters and numbers).');
    const { uri } = redirectInfo();
    if (!uri) throw new Error('Spotify sign-in is not available here.');
    if (!crypto.subtle) throw new Error('This browser blocks the secure sign-in (needs https or http://127.0.0.1).');
    save({ clientId });
    const verifier = b64url(randomBytes(64));
    const st = b64url(randomBytes(16));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state: st, redirect: uri, clientId }));
    const params = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: uri, scope: SCOPES,
      code_challenge_method: 'S256', code_challenge: challenge, state: st,
    });
    location.assign(`${AUTH_URL}?${params}`);
  }

  async function tokenRequest(body) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description || json.error || `Spotify sign-in failed (${res.status})`);
    return json;
  }

  function storeToken(json) {
    const prev = load().token || {};
    save({ token: { access: json.access_token, refresh: json.refresh_token || prev.refresh, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 } });
  }

  /** Finish sign-in when Spotify sends the browser back with ?code=. Returns null if this isn't a sign-in return. */
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return null;
    let pk = null;
    try { pk = JSON.parse(localStorage.getItem(PKCE_KEY)); } catch (e) { /* ignore */ }
    localStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', location.pathname + '#/import');
    if (q.get('error')) return { ok: false, message: q.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed: ${q.get('error')}` };
    if (!pk || q.get('state') !== pk.state) return { ok: false, message: 'Spotify sign-in expired. Please try again.' };
    try {
      storeToken(await tokenRequest({
        grant_type: 'authorization_code', code: q.get('code'), redirect_uri: pk.redirect,
        client_id: pk.clientId, code_verifier: pk.verifier,
      }));
      const me = await api('/me');
      save({ user: me ? { id: me.id, name: me.display_name || me.id } : null });
      return { ok: true, message: `Connected to Spotify${me && me.display_name ? ` as ${me.display_name}` : ''}.` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async function accessToken(force) {
    const s = load();
    if (!s.token) throw new Error('Not connected to Spotify.');
    if (!force && s.token.access && s.token.expiresAt - Date.now() > 60000) return s.token.access;
    if (!s.token.refresh) throw new Error('Spotify sign-in expired. Please connect again.');
    try {
      storeToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.token.refresh, client_id: s.clientId }));
    } catch (e) {
      save({ token: null });
      throw new Error('Spotify sign-in expired. Please connect again.');
    }
    return load().token.access;
  }

  function disconnect() {
    save({ token: null, user: null });
  }

  // ---------------------------------------------------------------- Web API

  class SpotifyError extends Error {
    constructor(status, message, reason) { super(message); this.status = status; this.reason = reason; }
  }

  async function api(pathOrUrl, attempt) {
    attempt = attempt || 0;
    const token = await accessToken(attempt > 0 && attempt === 1);
    const url = /^https:/.test(pathOrUrl) ? pathOrUrl : API + pathOrUrl;
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (attempt < 3) { await sleep(1500 * (attempt + 1)); return api(pathOrUrl, attempt + 1); }
      throw new Error('Could not reach Spotify. Check your internet connection.');
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const err = (json && json.error) || {};
    if (res.status === 401 && attempt === 0) return api(pathOrUrl, 1);
    if (res.status === 429) {
      if (err.reason === 'QUOTA_EXCEEDED') throw new SpotifyError(429, 'Spotify’s daily limit for your developer app was reached. Try again tomorrow.', 'QUOTA_EXCEEDED');
      if (attempt < 6) {
        const wait = parseInt(res.headers.get('Retry-After'), 10);
        await sleep((wait > 0 ? wait : 2 + attempt * 2) * 1000);
        return api(pathOrUrl, attempt + 2);
      }
    }
    throw new SpotifyError(res.status, err.message || `Spotify error ${res.status}`, err.reason);
  }

  /** Follow `next` links. pick(json) returns the paging object ({ items, next }). */
  async function all(path, pick, onPage) {
    const out = [];
    let url = path;
    for (let guard = 0; url && guard < 400; guard++) {
      const json = await api(url);
      const page = json ? pick(json) : null;
      if (!page) break;
      out.push(...(page.items || []));
      if (onPage) onPage(out.length, page.total);
      url = page.next;
    }
    return out;
  }

  // ---------------------------------------------------------------- mapping

  function pickImage(images, target) {
    if (!images || !images.length) return '';
    target = target || 300;
    const sorted = images.slice().sort((a, b) => Math.abs((a.width || target) - target) - Math.abs((b.width || target) - target));
    return sorted[0].url || '';
  }

  function plainText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
    return (doc.body.textContent || '').trim();
  }

  function mapTrack(t, albumOverride, addedAt) {
    if (!t || (t.type && t.type !== 'track')) return null;
    const album = albumOverride || t.album || {};
    const ref = t.id || t.uri;
    if (!ref || !t.name) return null;
    return {
      ref,
      spotifyId: t.id || null,
      spotifyUri: t.uri || null,
      isrc: (t.external_ids && t.external_ids.isrc) || '',
      title: t.name,
      artists: (t.artists || []).map((a) => a.name).filter(Boolean),
      artistIds: (t.artists || []).map((a) => a.id),
      album: album.name || '',
      albumArtist: (album.artists && album.artists[0] && album.artists[0].name) || '',
      trackNo: t.track_number || 0,
      discNo: t.disc_number || 0,
      year: parseInt(String(album.release_date || '').slice(0, 4), 10) || 0,
      duration: (t.duration_ms || 0) / 1000,
      imageUrl: pickImage(album.images),
      addedAt: addedAt ? Date.parse(addedAt) || 0 : 0,
    };
  }

  // ---------------------------------------------------------------- import via the Web API

  /**
   * opts: { liked, playlists, albums, artists, pictures } (booleans)
   * onProgress(text, done, total)
   */
  async function importLibrary(opts, onProgress) {
    opts = Object.assign({ liked: true, playlists: true, albums: true, artists: true, pictures: true }, opts || {});
    const say = (text, done, total) => { if (onProgress) onProgress(text, done || 0, total || 0); };
    const me = await api('/me');
    const tracks = [];
    const liked = [];
    const playlists = [];
    const artists = new Map();
    const report = { skippedPlaylists: [], stoppedEarly: '' };

    try {
      if (opts.liked) {
        say('Reading your Liked Songs…');
        const items = await all('/me/tracks?limit=50', (j) => j, (n, total) => say('Reading your Liked Songs…', n, total));
        for (const it of items) {
          const m = mapTrack(it.track || it.item, null, it.added_at);
          if (m) { tracks.push(m); liked.push({ ref: m.ref, at: m.addedAt || Date.now() }); }
        }
      }

      if (opts.albums) {
        say('Reading your saved albums…');
        const items = await all('/me/albums?limit=50', (j) => j, (n, total) => say('Reading your saved albums…', n, total));
        for (const it of items) {
          const al = it.album;
          if (!al) continue;
          let list = (al.tracks && al.tracks.items) || [];
          if (al.tracks && al.tracks.next) list = list.concat(await all(al.tracks.next, (j) => j));
          list.forEach((t) => { const m = mapTrack(t, al, it.added_at); if (m) tracks.push(m); });
        }
      }

      if (opts.playlists) {
        say('Reading your playlists…');
        const pls = await all('/me/playlists?limit=50', (j) => j);
        let i = 0;
        for (const p of pls) {
          i++;
          if (!p || !p.id) continue;
          say(`Reading playlist “${p.name}”…`, i, pls.length);
          const mine = (p.owner && me && p.owner.id === me.id) || p.collaborative;
          let items = null;
          try {
            items = await all(`/playlists/${p.id}/items?limit=50`, (j) => j);
          } catch (e) {
            if (e.reason === 'QUOTA_EXCEEDED') throw e;
            if (e.status === 404) {
              try { items = await all(`/playlists/${p.id}/tracks?limit=50`, (j) => j); } catch (e2) { items = null; }
            }
          }
          if (!items) { report.skippedPlaylists.push(p.name); continue; }
          const refs = [];
          for (const it of items) {
            const obj = it.item && typeof it.item === 'object' ? it.item : (it.track && typeof it.track === 'object' ? it.track : null);
            const m = mapTrack(obj, null, it.added_at);
            if (m) { tracks.push(m); refs.push(m.ref); }
          }
          if (!refs.length && !mine) { report.skippedPlaylists.push(p.name); continue; }
          playlists.push({ spotifyId: p.id, name: p.name, description: plainText(p.description), imageUrl: pickImage(p.images, 300), refs });
        }
      }

      if (opts.artists) {
        say('Reading the artists you follow…');
        const items = await all('/me/following?type=artist&limit=50', (j) => j.artists);
        items.forEach((a) => artists.set(a.id, { spotifyId: a.id, name: a.name, imageUrl: pickImage(a.images, 320), followed: true }));
      }

      if (opts.pictures) {
        // Batch artist lookups were removed from Spotify's API, so ask for each artist once.
        const want = new Map();
        for (const t of tracks) {
          const id = t.artistIds[0];
          if (id && !artists.has(id) && !want.has(id)) {
            const known = L.artist(L.artistIdByName(t.artists[0]));
            if (!known || !known.imageId) want.set(id, t.artists[0]);
          }
        }
        let done = 0;
        for (const [id] of want) {
          done++;
          say('Getting artist pictures…', done, want.size);
          try {
            const a = await api(`/artists/${id}`);
            if (a) artists.set(a.id, { spotifyId: a.id, name: a.name, imageUrl: pickImage(a.images, 320) });
          } catch (e) {
            if (e.reason === 'QUOTA_EXCEEDED' || e.status === 429) { report.stoppedEarly = 'pictures'; break; }
          }
          await sleep(120);
        }
      }
    } catch (e) {
      if (e.reason !== 'QUOTA_EXCEEDED' || !tracks.length) throw e;
      report.stoppedEarly = 'quota';
    }

    say('Saving to your library…');
    const stats = await L.addSpotify({ tracks, liked, playlists, artists: [...artists.values()] });
    const summary = Object.assign(stats, report, { at: Date.now() });
    save({ lastImport: summary, user: me ? { id: me.id, name: me.display_name || me.id } : load().user });
    return summary;
  }

  // ---------------------------------------------------------------- import from a data export

  function refFromUri(uri) {
    const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
    return m ? m[1] : null;
  }

  function localTrackFromUri(uri) {
    // spotify:local:Artist:Album:Title:Seconds (parts URL-encoded with + for spaces)
    const parts = String(uri || '').split(':');
    if (parts[1] !== 'local' || parts.length < 6) return null;
    const dec = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return s; } };
    const title = dec(parts[4]);
    if (!title) return null;
    return { ref: uri, spotifyId: null, spotifyUri: null, isrc: '', title, artists: [dec(parts[2])].filter(Boolean), album: dec(parts[3]), albumArtist: '', trackNo: 0, discNo: 0, year: 0, duration: parseInt(parts[5], 10) || 0, imageUrl: '', addedAt: 0 };
  }

  /** Accepts parsed JSON objects from a Spotify data export. Returns import stats, or null if none were Spotify files. */
  async function importExport(docs) {
    const tracks = [];
    const liked = [];
    const playlists = [];
    const artists = [];
    let recognised = false;
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;
      if (Array.isArray(doc.tracks) && doc.tracks.some((t) => t && (t.track || t.trackName) && (t.uri || t.trackUri))) {
        recognised = true;
        for (const t of doc.tracks) {
          const ref = refFromUri(t.uri || t.trackUri);
          if (!ref) continue;
          tracks.push({ ref, spotifyId: ref, spotifyUri: t.uri, isrc: '', title: t.track || t.trackName, artists: [t.artist || t.artistName].filter(Boolean), album: t.album || t.albumName || '', albumArtist: '', trackNo: 0, discNo: 0, year: 0, duration: 0, imageUrl: '', addedAt: 0 });
          liked.push({ ref, at: Date.now() - liked.length });
        }
      }
      if (Array.isArray(doc.artists) && doc.artists.some((a) => a && a.name && a.uri)) {
        recognised = true;
        doc.artists.forEach((a) => artists.push({ name: a.name, spotifyId: String(a.uri).split(':')[2] || null, followed: true }));
      }
      if (Array.isArray(doc.playlists)) {
        recognised = true;
        for (const p of doc.playlists) {
          if (!p || !p.name) continue;
          const refs = [];
          for (const it of p.items || []) {
            let m = null;
            if (it.track && it.track.trackUri) {
              const ref = refFromUri(it.track.trackUri);
              if (ref) m = { ref, spotifyId: ref, spotifyUri: it.track.trackUri, isrc: '', title: it.track.trackName, artists: [it.track.artistName].filter(Boolean), album: it.track.albumName || '', albumArtist: '', trackNo: 0, discNo: 0, year: 0, duration: 0, imageUrl: '', addedAt: Date.parse(it.addedDate) || 0 };
            } else if (it.localTrack && it.localTrack.uri) {
              m = localTrackFromUri(it.localTrack.uri);
            }
            if (m && m.title) { tracks.push(m); refs.push(m.ref); }
          }
          playlists.push({ spotifyId: null, name: p.name, description: plainText(p.description), imageUrl: '', refs });
        }
      }
    }
    if (!recognised) return null;
    return L.addSpotify({ tracks, liked, playlists, artists });
  }

  /** Spotify catalog search (used to find missing covers and artist pictures). */
  /** Spotify catalog search. Development-mode apps get at most 10 results per request. */
  async function search(type, query, limit) {
    const n = Math.max(1, Math.min(10, limit || 5));
    const json = await api(`/search?type=${type}&limit=${n}&q=${encodeURIComponent(query)}`);
    return (json && json[`${type}s`] && json[`${type}s`].items) || [];
  }

  function openUrl(t) {
    if (t && t.spotifyId) return `https://open.spotify.com/track/${t.spotifyId}`;
    if (t) return `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist || ''}`.trim())}`;
    return 'https://open.spotify.com/';
  }

  F.spotify = {
    state, connected, connect, disconnect, handleRedirect, redirectInfo, isDesktopApp, isPhoneApp,
    importLibrary, importExport, search, pickImage, openUrl, mapTrack, DESKTOP_REDIRECT,
  };
})(window.Freeify = window.Freeify || {});
