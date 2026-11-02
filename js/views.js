/* Freeify: page views. Each returns { html, color, title, ctx?, mount? }. */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const UI = F.ui;
  const ic = F.icon;
  const esc = U.esc;

  const V = {};
  const MAX_SHELF = 12;

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function welcome() {
    return `<div class="welcome">
      <div class="welcome-mark">${ic('logo')}</div>
      <h1>Your music.<br><span class="accent-text">Free forever.</span></h1>
      <p class="lead">Freeify plays the MP3s you already own, with no ads, no account and no subscription.
        Your files stay on this device, and it keeps working offline.</p>
      <div class="welcome-actions">
        <button class="btn btn-primary btn-lg" data-act="import-files">${ic('upload')}<span>Add music files</span></button>
        <button class="btn btn-ghost btn-lg" data-act="import-folder">${ic('folder')}<span>Add a folder</span></button>
      </div>
      <p class="hint">Or drag and drop songs and folders anywhere on this window.</p>
      <ul class="perks">
        <li>${ic('gift')}<div><strong>Free, for real</strong><span>No trials, no premium tier, no ads. Open source under the MIT license.</span></div></li>
        <li>${ic('shield')}<div><strong>Private</strong><span>Nothing is uploaded. There's no account and no tracking.</span></div></li>
        <li>${ic('wifi_off')}<div><strong>Works offline</strong><span>Install it as an app and take your library anywhere.</span></div></li>
        <li>${ic('mic')}<div><strong>Reads your tags</strong><span>Album art, artists, albums and synced lyrics from your files.</span></div></li>
      </ul>
    </div>`;
  }

  function quickTile(c) {
    if (!c) return '';
    return `<a class="quick" href="${c.href}" data-ctx-type="${c.type}" data-ctx-id="${esc(c.id)}">
      ${c.cover('quick-art')}
      <span class="quick-name">${esc(c.name)}</span>
      <button class="play-btn sm js-ctx-play" data-act="play-ctx" data-type="${c.type}" data-id="${esc(c.id)}" data-ctx="${c.type}:${esc(c.id)}" aria-label="Play ${esc(c.name)}">${ic('play')}</button>
    </a>`;
  }

  // ---------------------------------------------------------------- home

  V.home = function () {
    if (!L.count()) return { html: welcome(), color: 'hsl(155 40% 22%)', title: 'Freeify' };

    const tiles = [UI.ctx('liked')];
    const seen = new Set(['liked:liked']);
    const push = (c) => { if (c && !seen.has(c.type + ':' + c.id) && tiles.length < 8) { seen.add(c.type + ':' + c.id); tiles.push(c); } };
    L.recents().forEach((r) => push(UI.ctx(r.type, r.id)));
    push(UI.ctx('library'));
    L.playlists().forEach((p) => push(UI.ctx('playlist', p.id)));
    L.albums().list.slice().sort((a, b) => b.addedAt - a.addedAt).forEach((a) => push(UI.ctx('album', a.id)));

    const albums = L.albums().list;
    const recentAlbums = albums.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_SHELF);
    let recentShelf;
    if (recentAlbums.length >= 2) {
      recentShelf = UI.shelf('Recently added', '#/albums', recentAlbums.map((a) => UI.ctxCard(UI.ctx('album', a.id), a.artist)));
    } else {
      const ids = L.byAdded().slice(0, MAX_SHELF);
      UI.registerList('home-recent', ids, UI.ctxRef(UI.ctx('library')));
      recentShelf = UI.shelf('Recently added', '#/library', ids.map((id, i) => UI.trackCard('home-recent', L.get(id), i)));
    }

    const top = L.topTracks(MAX_SHELF);
    UI.registerList('home-top', top, null);
    const topShelf = top.length >= 3 ? UI.shelf('On repeat', null, top.map((id, i) => UI.trackCard('home-top', L.get(id), i))) : '';

    const jump = L.recents().map((r) => UI.ctx(r.type, r.id)).filter(Boolean).slice(0, MAX_SHELF);
    const jumpShelf = jump.length >= 3 ? UI.shelf('Jump back in', null, jump.map((c) => UI.ctxCard(c))) : '';

    const artists = L.artists().list.slice().sort((a, b) => b.plays - a.plays || b.trackIds.length - a.trackIds.length).slice(0, MAX_SHELF);
    const artistShelf = artists.length ? UI.shelf('Your artists', '#/artists', artists.map((a) => UI.ctxCard(UI.ctx('artist', a.id)))) : '';

    const pls = L.playlists();
    const plShelf = pls.length ? UI.shelf('Your playlists', '#/collection', pls.slice(0, MAX_SHELF).map((p) => UI.ctxCard(UI.ctx('playlist', p.id), `${U.plural(p.trackIds.length, 'song')}`))) : '';

    const albumShelf = albums.length > MAX_SHELF ? UI.shelf('Albums', '#/albums', albums.slice(0, MAX_SHELF).map((a) => UI.ctxCard(UI.ctx('album', a.id), a.artist))) : '';

    const firstColored = tiles.find((c) => c && c.type === 'album') || tiles[0];
    return {
      html: `<div class="page home">
        <h1 class="greeting">${greeting()}</h1>
        <div class="quick-grid">${tiles.map(quickTile).join('')}</div>
        ${jumpShelf}${recentShelf}${topShelf}${plShelf}${artistShelf}${albumShelf}
      </div>`,
      color: firstColored ? firstColored.color : null,
      title: 'Home',
    };
  };

  // ---------------------------------------------------------------- collection views

  function collectionPage(c, opts) {
    const ids = opts.ids || c.ids;
    const total = L.totals(ids);
    const meta = opts.meta || `${U.plural(ids.length, 'song')}${ids.length ? `, <span class="muted">${U.fmtLong(total)}</span>` : ''}`;
    const list = UI.trackList(opts.listKey || `${c.type}:${c.id}`, ids, Object.assign({ ctx: UI.ctxRef(c) }, opts.list || {}));
    return {
      html: `<div class="page collection">
        ${UI.hero({ cover: c.cover('hero-cover'), kind: opts.kind || c.kind, title: c.name, meta, description: opts.description, editable: opts.editable })}
        <div class="page-body">
          ${UI.actionBar(c.type, c.id, opts.extraActions)}
          ${list || (opts.empty != null ? opts.empty : '<p class="empty">Nothing here yet.</p>')}
          ${opts.after || ''}
        </div>
      </div>`,
      color: c.color,
      title: c.name,
      ctx: c,
    };
  }

  V.library = function () {
    const c = UI.ctx('library');
    if (!L.count()) return { html: welcome(), color: c.color, title: 'Your Music' };
    return collectionPage(c, {
      list: { date: 'addedAt' },
      extraActions: `<button class="btn btn-ghost" data-act="import-menu">${ic('plus')}<span>Add music</span></button>`,
    });
  };

  V.liked = function () {
    const c = UI.ctx('liked');
    return collectionPage(c, {
      list: { date: 'likedAt' },
      empty: `<div class="empty-state">${ic('heart')}<h3>Songs you like will appear here</h3><p>Save songs by tapping the heart icon.</p><a class="btn btn-light" href="#/library">Find songs</a></div>`,
    });
  };

  V.playlist = function (id) {
    const c = UI.ctx('playlist', id);
    if (!c) return notFound('Playlist not found');
    const p = L.playlist(id);
    const finder = `<section class="finder">
        <h3>Let's find something for your playlist</h3>
        <div class="finder-search">${ic('search')}<input class="input" id="finder-input" type="search" placeholder="Search your library for songs" autocomplete="off"></div>
        <div id="finder-results"></div>
      </section>`;
    return Object.assign(collectionPage(c, {
      list: { playlistId: id, album: true },
      description: p.description,
      editable: 'rename-playlist',
      empty: '',
      after: finder,
    }), { mount: mountFinder(id) });
  };

  function mountFinder(playlistId) {
    return (root) => {
      const input = root.querySelector('#finder-input');
      const out = root.querySelector('#finder-results');
      if (!input) return;
      const render = () => {
        const q = input.value.trim();
        const p = L.playlist(playlistId);
        if (!p) return;
        const inPl = new Set(p.trackIds);
        const ids = (q ? L.search(q).tracks : L.byAdded()).filter((id) => !inPl.has(id)).slice(0, q ? 30 : 10);
        out.innerHTML = ids.length ? `<div class="finder-list">${ids.map((id) => {
          const t = L.get(id);
          return `<div class="finder-row">${UI.trackCover(t, 'sm')}<div class="t-meta"><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.artist || 'Unknown artist')}</div></div>
            <div class="finder-album">${esc(t.album)}</div><button class="btn btn-outline btn-sm" data-act="finder-add" data-pid="${playlistId}" data-tid="${id}">Add</button></div>`;
        }).join('')}</div>` : (q ? '<p class="muted pad">No matching songs.</p>' : '');
      };
      input.addEventListener('input', U.debounce(render, 120));
      out.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act="finder-add"]');
        if (!b) return;
        e.stopPropagation();
        L.addToPlaylist(b.dataset.pid, [b.dataset.tid]);
        b.closest('.finder-row').remove();
      });
      render();
    };
  }

  V.album = function (id) {
    const c = UI.ctx('album', id);
    if (!c) return notFound('Album not found');
    const a = L.album(id);
    const artistId = L.artistIdByName(a.artist);
    const artistHtml = L.artist(artistId) ? `<a href="#/artist/${artistId}"><strong>${esc(a.artist)}</strong></a>` : `<strong>${esc(a.artist)}</strong>`;
    const meta = `${artistHtml}${a.year ? ` · ${a.year}` : ''} · ${U.plural(a.trackIds.length, 'song')}, <span class="muted">${U.fmtLong(a.duration)}</span>`;
    const more = L.artist(artistId) ? L.artist(artistId).albumIds : new Set();
    const others = [...more].filter((x) => x !== id).map((x) => L.album(x)).filter(Boolean);
    return collectionPage(c, {
      meta,
      list: { album: false, cover: false, number: 'track', sortable: false },
      after: others.length ? UI.shelf(`More by ${a.artist}`, `#/artist/${artistId}`, others.slice(0, MAX_SHELF).map((o) => UI.ctxCard(UI.ctx('album', o.id), o.year ? String(o.year) : 'Album'))) : '',
    });
  };

  V.artist = function (id) {
    const c = UI.ctx('artist', id);
    if (!c) return notFound('Artist not found');
    const a = L.artist(id);
    const popular = a.trackIds.slice().sort((x, y) => (L.get(y).playCount || 0) - (L.get(x).playCount || 0)).slice(0, 5);
    const albums = [...a.albumIds].map((x) => L.album(x)).filter(Boolean).sort((x, y) => (y.year || 0) - (x.year || 0));
    const popList = UI.trackList(`artist-pop:${id}`, popular, { ctx: UI.ctxRef(c), album: true, header: false, sortable: false });
    const allList = a.trackIds.length > 5 ? `<section class="shelf"><header class="shelf-head"><h2>All songs</h2></header>${UI.trackList(`artist:${id}`, a.trackIds, { ctx: UI.ctxRef(c), album: true })}</section>` : '';
    return {
      html: `<div class="page collection artist-page">
        ${UI.hero({ cover: c.cover('hero-cover'), kind: 'Artist', title: a.name, meta: `${U.plural(a.trackIds.length, 'song')}${albums.length ? ` · ${U.plural(albums.length, 'album')}` : ''}` })}
        <div class="page-body">
          ${UI.actionBar('artist', id)}
          <section class="shelf"><header class="shelf-head"><h2>Popular</h2></header>${popList}</section>
          ${albums.length ? UI.shelf('Discography', null, albums.map((al) => UI.ctxCard(UI.ctx('album', al.id), `${al.year || 'Album'}`))) : ''}
          ${allList}
        </div>
      </div>`,
      color: c.color,
      title: a.name,
      ctx: c,
    };
  };

  V.genre = function (id) {
    const c = UI.ctx('genre', id);
    if (!c) return notFound('Genre not found');
    return collectionPage(c, { list: { date: 'addedAt' } });
  };

  // ---------------------------------------------------------------- grids

  V.albums = function () {
    const list = L.albums().list;
    return {
      html: `<div class="page"><h1 class="page-title">Albums</h1>
        ${list.length ? `<div class="cards grid-all">${list.map((a) => UI.ctxCard(UI.ctx('album', a.id), a.artist)).join('')}</div>` : '<p class="empty">Albums appear here once your songs have album tags.</p>'}</div>`,
      color: 'hsl(210 35% 26%)',
      title: 'Albums',
    };
  };

  V.artists = function () {
    const list = L.artists().list;
    return {
      html: `<div class="page"><h1 class="page-title">Artists</h1>
        <div class="cards grid-all">${list.map((a) => UI.ctxCard(UI.ctx('artist', a.id))).join('')}</div></div>`,
      color: 'hsl(280 30% 26%)',
      title: 'Artists',
    };
  };

  // ---------------------------------------------------------------- your library (mobile + full page)

  V.collection = function () {
    const filter = V.collectionFilter || 'all';
    const items = libraryItems(filter);
    return {
      html: `<div class="page"><div class="collection-head"><h1 class="page-title">Your Library</h1>
          <div class="collection-actions">
            <button class="btn btn-ghost btn-sm" data-act="new-playlist">${ic('plus')}<span>Playlist</span></button>
            <button class="btn btn-ghost btn-sm" data-act="import-menu">${ic('upload')}<span>Add music</span></button>
          </div></div>
        <div class="chips">${chips(filter, 'collection-filter')}</div>
        <div class="lib-list big">${items}</div></div>`,
      color: 'hsl(220 15% 22%)',
      title: 'Your Library',
    };
  };

  function chips(active, act) {
    return [['all', 'All'], ['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists']]
      .map(([k, label]) => `<button class="chip${active === k ? ' on' : ''}" data-act="${act}" data-filter="${k}" role="tab" aria-selected="${active === k}">${label}</button>`).join('');
  }
  V.chips = chips;

  function libItem(c, sub) {
    if (!c) return '';
    return `<a class="lib-item" href="${c.href}" data-ctx="${c.type}:${esc(c.id)}" data-ctx-type="${c.type}" data-ctx-id="${esc(c.id)}"${c.type === 'playlist' || c.type === 'liked' ? ` data-drop="${c.type}:${esc(c.id)}"` : ''}>
      ${c.cover(c.round ? 'round sm' : 'sm')}
      <div class="lib-meta"><div class="lib-name">${esc(c.name)}</div><div class="lib-sub">${esc(sub || c.sub)}</div></div>
      <span class="lib-now" aria-hidden="true">${ic('volume-high')}</span>
    </a>`;
  }

  function libraryItems(filter) {
    const out = [];
    if (filter === 'all' || filter === 'playlists') {
      out.push(libItem(UI.ctx('liked')));
      if (filter === 'all') out.push(libItem(UI.ctx('library')));
      L.playlists().forEach((p) => out.push(libItem(UI.ctx('playlist', p.id))));
    }
    if (filter === 'all' || filter === 'albums') L.albums().list.forEach((a) => out.push(libItem(UI.ctx('album', a.id), `Album · ${a.artist}`)));
    if (filter === 'artists') L.artists().list.forEach((a) => out.push(libItem(UI.ctx('artist', a.id))));
    if (filter === 'playlists' && !L.playlists().length) {
      out.push(`<div class="lib-empty"><strong>Create your first playlist</strong><span>It's easy, we'll help you.</span><button class="btn btn-light btn-sm" data-act="new-playlist">Create playlist</button></div>`);
    }
    return out.join('');
  }
  V.libraryItems = libraryItems;

  // ---------------------------------------------------------------- search

  V.search = function (query) {
    query = (query || '').trim();
    if (!query) return browse();
    const r = L.search(query);
    if (!r.tracks.length && !r.albums.length && !r.artists.length) {
      return {
        html: `<div class="page"><div class="empty-state">${ic('search')}<h3>No results found for “${esc(query)}”</h3><p>Check the spelling, or try fewer or different keywords.</p></div></div>`,
        color: null, title: 'Search',
      };
    }
    const ctx = { type: 'search', id: query, name: `Search: ${query}`, href: `#/search/${encodeURIComponent(query)}` };
    let topHtml = '';
    if (r.top) {
      let c, title, sub, play;
      if (r.top.kind === 'track') {
        const t = L.get(r.top.item);
        UI.registerList('search-top', [t.id], ctx);
        c = UI.trackCover(t, 'top-art');
        title = t.title; sub = `Song · ${t.artist || 'Unknown artist'}`;
        play = `<button class="play-btn big top-play" data-act="play-row" aria-label="Play">${ic('play')}</button>`;
        topHtml = `<div class="top-result" data-list="search-top" data-idx="0" data-id="${t.id}">${c}<div class="top-title">${esc(title)}</div><div class="top-sub">${esc(sub)}</div>${play}</div>`;
      } else {
        const cx = UI.ctx(r.top.kind, r.top.item.id);
        topHtml = `<a class="top-result" href="${cx.href}" data-ctx-type="${cx.type}" data-ctx-id="${esc(cx.id)}">${cx.cover('top-art' + (cx.round ? ' round' : ''))}<div class="top-title">${esc(cx.name)}</div><div class="top-sub"><span class="tag">${cx.kind}</span>${r.top.kind === 'album' ? esc(r.top.item.artist) : ''}</div>
          <button class="play-btn big top-play js-ctx-play" data-act="play-ctx" data-type="${cx.type}" data-id="${esc(cx.id)}" data-ctx="${cx.type}:${esc(cx.id)}" aria-label="Play">${ic('play')}</button></a>`;
      }
    }
    const songs = UI.trackList('search', r.tracks, { ctx, album: false, header: false, sortable: false, limit: 4 });
    const all = r.tracks.length > 4 ? `<section class="shelf"><header class="shelf-head"><h2>All songs</h2></header>${UI.trackList('search-all', r.tracks, { ctx, album: true })}</section>` : '';
    return {
      html: `<div class="page search-page">
        <div class="search-top">
          <section class="top-col"><h2>Top result</h2>${topHtml}</section>
          <section class="songs-col"><h2>Songs</h2>${songs || '<p class="muted">No songs match.</p>'}</section>
        </div>
        ${r.artists.length ? UI.shelf('Artists', null, r.artists.slice(0, MAX_SHELF).map((a) => UI.ctxCard(UI.ctx('artist', a.id)))) : ''}
        ${r.albums.length ? UI.shelf('Albums', null, r.albums.slice(0, MAX_SHELF).map((a) => UI.ctxCard(UI.ctx('album', a.id), a.artist))) : ''}
        ${all}
      </div>`,
      color: null,
      title: 'Search',
    };
  };

  function browse() {
    const tiles = [];
    const tile = (href, name, color, coverId) => `<a class="genre-tile" href="${href}" style="background:${color}"><span>${esc(name)}</span>${coverId ? `<img src="${L.coverUrl(coverId)}" alt="" loading="lazy">` : ''}</a>`;
    tiles.push(tile('#/liked', 'Liked Songs', 'hsl(250 55% 45%)', null));
    tiles.push(tile('#/library', 'All songs', 'hsl(160 55% 30%)', null));
    tiles.push(tile('#/albums', 'Albums', 'hsl(20 70% 45%)', (L.albums().list[0] || {}).coverId));
    tiles.push(tile('#/artists', 'Artists', 'hsl(330 60% 40%)', (L.artists().list[0] || {}).coverId));
    const genres = L.genres();
    return {
      html: `<div class="page search-page">
        <h2 class="browse-title">Browse your library</h2>
        <div class="genre-grid">${tiles.join('')}</div>
        ${genres.length ? `<h2 class="browse-title">Genres</h2><div class="genre-grid">${genres.slice(0, 40).map((g) => tile(`#/genre/${g.id}`, g.name, U.seedColor(g.name).replace('32%)', '40%)'), g.coverId)).join('')}</div>` : ''}
      </div>`,
      color: null,
      title: 'Search',
    };
  }

  // ---------------------------------------------------------------- settings

  V.settings = function () {
    const accents = F.ACCENTS;
    const current = F.settings.accent;
    const songs = L.count();
    return {
      html: `<div class="page settings">
        <h1 class="page-title">Settings</h1>
        <section class="set-card">
          <h2>Appearance</h2>
          <div class="set-row"><div><strong>Accent colour</strong><span>Used for buttons, progress and highlights.</span></div>
            <div class="swatches">${accents.map((a) => `<button class="swatch${a.value === current ? ' on' : ''}" style="--c:${a.value}" data-act="accent" data-value="${a.value}" aria-label="${a.name}" title="${a.name}"></button>`).join('')}</div></div>
        </section>
        <section class="set-card">
          <h2>Library &amp; storage</h2>
          <div class="set-row"><div><strong>${U.plural(songs, 'song')}</strong><span id="storage-line">Checking storage…</span></div>
            <button class="btn btn-ghost btn-sm" data-act="import-menu">${ic('plus')}<span>Add music</span></button></div>
          <div class="set-row"><div><strong>Keep my library safe</strong><span id="persist-line">Ask the browser not to clear your music when space runs low.</span></div>
            <button class="btn btn-ghost btn-sm" data-act="persist">Protect</button></div>
          <div class="set-row"><div><strong>Remove all music</strong><span>Deletes every song, playlist and like stored by Freeify on this device.</span></div>
            <button class="btn btn-danger btn-sm" data-act="wipe">Remove all</button></div>
        </section>
        <section class="set-card">
          <h2>Keyboard shortcuts</h2>
          <div class="shortcuts">${F.SHORTCUTS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
        </section>
        <section class="set-card about">
          <h2>About Freeify</h2>
          <p>Freeify is a free and open-source music player for the songs you own. There are no ads, no accounts,
            no tracking and no paid tier. Your music is stored only in this browser on this device.</p>
          <p class="muted">Version ${esc(F.VERSION || '')} · Released under the MIT license.</p>
          <p><a class="btn btn-ghost btn-sm" href="https://github.com/mrmajko123/freeify/releases/latest" target="_blank" rel="noopener">Get the apps for Windows, Mac, Linux, Android and iPhone</a></p>
        </section>
      </div>`,
      color: 'hsl(220 10% 24%)',
      title: 'Settings',
      mount: async (root) => {
        const line = root.querySelector('#storage-line');
        const pl = root.querySelector('#persist-line');
        try {
          if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (line) line.textContent = `Using ${U.fmtBytes(est.usage || 0)} of about ${U.fmtBytes(est.quota || 0)} available to this app.`;
          } else if (line) line.textContent = 'Storage details are not available in this browser.';
          if (navigator.storage && navigator.storage.persisted && pl && await navigator.storage.persisted()) {
            pl.textContent = 'Protected: the browser will not clear your library automatically.';
            const b = root.querySelector('[data-act="persist"]');
            if (b) { b.disabled = true; b.textContent = 'Protected'; }
          }
        } catch (e) { if (line) line.textContent = ''; }
      },
    };
  };

  function notFound(msg) {
    return { html: `<div class="page"><div class="empty-state">${ic('note')}<h3>${esc(msg)}</h3><p>It may have been removed.</p><a class="btn btn-light" href="#/home">Go home</a></div></div>`, color: null, title: msg };
  }

  F.views = V;
})(window.Freeify = window.Freeify || {});
