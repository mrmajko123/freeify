/*
 * Freeify: finds album covers and artist pictures that are missing from your library.
 * Uses Spotify when you're connected, and Wikipedia (free, no account) otherwise or as a fallback.
 */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const WIKI = 'https://en.wikipedia.org/w/api.php';
  const MUSIC = /\b(band|singer|rapper|musician|songwriter|dj|disc jockey|producer|duo|group|composer|artist|vocalist|guitarist|pianist|orchestra|ensemble|trio|quartet|collective)\b/i;
  const RELEASE = /\b(album|ep|extended play|soundtrack|mixtape|compilation|live album)\b/i;
  const TRIED_KEY = 'artworkTried';
  const RETRY_AFTER = 14 * 86400000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (a, b) => U.fold(a).replace(/[^a-z0-9]+/g, '') === U.fold(b).replace(/[^a-z0-9]+/g, '');
  const startsSame = (title, name) => U.fold(title).replace(/[^a-z0-9]+/g, '').startsWith(U.fold(name).replace(/[^a-z0-9]+/g, ''));

  async function wikiPages(query) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', redirects: '1',
      generator: 'search', gsrsearch: query, gsrlimit: '5',
      prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '500', pilicense: 'any',
    });
    const res = await fetch(`${WIKI}?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    const pages = json.query && json.query.pages ? Object.values(json.query.pages) : [];
    return pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  }

  async function wikiArtist(name) {
    const pages = await wikiPages(`${name} music`);
    const hit = pages.find((p) => p.thumbnail && startsSame(p.title, name) && MUSIC.test(p.description || ''));
    return hit ? hit.thumbnail.source : null;
  }

  async function wikiAlbum(album, artist) {
    const pages = await wikiPages(`${album} ${artist} album`);
    const hit = pages.find((p) => p.thumbnail && startsSame(p.title, album) && RELEASE.test(p.description || '') &&
      (!artist || U.fold(p.description || '').includes(U.fold(artist).split(/[,&]/)[0].trim()) || same(p.title.replace(/\s*\(.*\)$/, ''), album)));
    return hit ? hit.thumbnail.source : null;
  }

  async function spotifyArtist(name) {
    const items = await F.spotify.search('artist', `artist:${name}`);
    const hit = items.find((a) => same(a.name, name) && a.images && a.images.length);
    return hit ? { url: F.spotify.pickImage(hit.images, 320), id: hit.id } : null;
  }

  async function spotifyAlbum(album, artist) {
    const items = await F.spotify.search('album', `album:${album}${artist ? ` artist:${artist}` : ''}`);
    const hit = items.find((a) => same(a.name, album) && a.images && a.images.length && (!artist || (a.artists || []).some((x) => same(x.name, artist))))
      || items.find((a) => startsSame(a.name, album) && a.images && a.images.length);
    return hit ? F.spotify.pickImage(hit.images, 300) : null;
  }

  function missing() {
    const albums = L.albums().list.filter((a) => !a.coverId);
    const artists = L.artists().list.filter((a) => !a.imageId && a.name !== 'Unknown artist');
    return { albums, artists };
  }

  /** Look up everything missing. onProgress(text, done, total). Returns { covers, pictures, checked }. */
  async function findMissing(onProgress, force) {
    const tried = (await F.db.kvGet(TRIED_KEY)) || {};
    const now = Date.now();
    const fresh = (key) => force || !tried[key] || now - tried[key] > RETRY_AFTER;
    const { albums, artists } = missing();
    const todoAlbums = albums.filter((a) => fresh('al:' + a.id));
    const todoArtists = artists.filter((a) => fresh('ar:' + a.id));
    const total = todoAlbums.length + todoArtists.length;
    const useSpotify = F.spotify.connected();
    const out = { covers: 0, pictures: 0, checked: total, source: useSpotify ? 'Spotify and Wikipedia' : 'Wikipedia' };
    let done = 0;
    let spotifyOk = useSpotify;

    const viaSpotify = async (fn) => {
      if (!spotifyOk) return null;
      try { return await fn(); } catch (e) { if (e.status === 429 || e.reason === 'QUOTA_EXCEEDED' || e.status === 401) spotifyOk = false; return null; }
    };
    const viaWiki = async (fn) => { try { return await fn(); } catch (e) { return null; } };

    for (const a of todoAlbums) {
      if (onProgress) onProgress(`Album covers: ${a.name}`, done, total);
      const url = (await viaSpotify(() => spotifyAlbum(a.name, a.artist))) || (await viaWiki(() => wikiAlbum(a.name, a.artist)));
      if (url && await L.setAlbumCover(a.id, url)) out.covers++;
      tried['al:' + a.id] = Date.now();
      done++;
      await sleep(150);
    }
    for (const a of todoArtists) {
      if (onProgress) onProgress(`Artist pictures: ${a.name}`, done, total);
      const sp = await viaSpotify(() => spotifyArtist(a.name));
      const url = sp ? sp.url : await viaWiki(() => wikiArtist(a.name));
      if (url && await L.setArtistImage(a.name, url, sp ? sp.id : null)) out.pictures++;
      tried['ar:' + a.id] = Date.now();
      done++;
      await sleep(150);
    }
    await F.db.kvSet(TRIED_KEY, tried);
    return out;
  }

  F.artwork = { findMissing, missing };
})(window.Freeify = window.Freeify || {});
