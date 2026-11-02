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
      <p class="hint"><a class="text-link" href="#/free">No music yet? Get free, legal music</a> · <a class="text-link" href="#/import">Import your playlists and likes from Spotify</a></p>
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
    const away = ids.filter((id) => !L.isPlayable(id)).length;
    const meta = opts.meta || `${U.plural(ids.length, 'song')}${ids.length ? `, <span class="muted">${U.fmtLong(total)}</span>` : ''}${away ? ` · <span class="muted">${away === ids.length ? 'not on this device yet' : `${away} not on this device`}</span>` : ''}`;
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
    const remote = c.ids.filter((id) => !L.isPlayable(id)).length;
    const localOnly = remote > 0 && F.settings.localOnly;
    const ids = localOnly ? c.ids.filter((id) => L.isPlayable(id)) : c.ids;
    return collectionPage(c, {
      ids,
      list: { date: 'addedAt' },
      meta: remote ? `${U.plural(c.ids.length, 'song')} · ${U.plural(c.ids.length - remote, 'song')} on this device` : null,
      extraActions: `<button class="btn btn-ghost" data-act="import-menu">${ic('plus')}<span>Add music</span></button>
        ${remote ? `<button class="chip${localOnly ? ' on' : ''}" data-act="toggle-local-only">On this device only</button>` : ''}`,
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
    const away = a.trackIds.filter((x) => !L.isPlayable(x)).length;
    const awayHtml = away ? ` · <span class="muted">${away === a.trackIds.length ? 'not on this device yet' : `${away} not on this device`}</span>` : '';
    const meta = `${artistHtml}${a.year ? ` · ${a.year}` : ''} · ${U.plural(a.trackIds.length, 'song')}, <span class="muted">${U.fmtLong(a.duration)}</span>${awayHtml}`;
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
          <div class="set-row"><div><strong>Import from Spotify</strong><span>Playlists, likes, album covers and artist pictures.</span></div>
            <a class="btn btn-ghost btn-sm" href="#/import">Open</a></div>
          <div class="set-row"><div><strong>Download free versions automatically</strong><span>When a song in your library that isn’t on this device is released for free (Internet Archive, Jamendo), download it without asking.</span></div>
            <label class="switch"><input type="checkbox" id="auto-free"${F.settings.autoFree ? ' checked' : ''}><span class="slider" aria-hidden="true"></span><span class="sr-only">Download free versions automatically</span></label></div>
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

  // ---------------------------------------------------------------- free music (Internet Archive)

  function licenseBadge(url) {
    const name = F.freemusic.licenseName(url);
    return name ? `<a class="lic" href="${esc(url)}" target="_blank" rel="noopener" title="License">${esc(name)}</a>` : '';
  }

  V.free = function (query) {
    query = query || '';
    const remote = L.all().filter((t) => t.remote).length;
    return {
      html: `<div class="page free-page">
        <h1 class="page-title">Free music</h1>
        <p class="lead-sm">Free and legal downloads, with no ads and no account: music that artists released under Creative Commons
          or public-domain licenses on the <a class="text-link" href="https://archive.org/details/netlabels" target="_blank" rel="noopener">Internet Archive</a>.
          Downloaded songs are yours to keep and play offline.</p>
        <form class="free-search" data-form="free-search" role="search">
          ${ic('search')}<input class="input" id="free-q" name="q" value="${esc(query)}" placeholder="Search free music: artist, album or style (jazz, lo-fi, piano…)" autocomplete="off">
          <button class="btn btn-primary btn-sm" type="submit">Search</button>
        </form>
        ${remote ? `<section class="set-card free-match">
          <div><strong>Find free versions of your Spotify songs</strong>
          <span>${U.plural(remote, 'song')} aren’t on this device. Freeify can look for free, legal releases of the same songs and download them.
          Songs from big record labels are almost never free, so expect only a few matches.
          ${F.settings.autoFree ? 'Freeify also does this automatically in the background. You can turn that off in <a class="text-link" href="#/settings">Settings</a>.' : ''}</span></div>
          <button class="btn btn-ghost btn-sm" data-act="free-match">Find free versions</button>
        </section>` : ''}
        <h2 class="browse-title">${query ? `Albums for “${esc(query)}”` : 'Popular free albums'} <small class="src">Internet Archive</small></h2>
        <div id="free-results"><p class="muted pad">Loading…</p></div>
        ${F.freemusic.jamendoId() ? `<h2 class="browse-title">${query ? `Songs for “${esc(query)}”` : 'Popular this week'} <small class="src">Jamendo</small></h2>
        <div id="jam-results"><p class="muted pad">Loading…</p></div>` : jamendoSetup()}
        <section class="set-card more-sources">
          <h2>${ic('folder')} Free downloads from other sites</h2>
          <p class="lead-sm">These sites don’t let apps download for you, but you can download there and drop the files (or the whole <strong>.zip</strong>) into Freeify:</p>
          <ul class="src-list">
            <li><a href="https://bandcamp.com/tag/free-download" target="_blank" rel="noopener">Bandcamp</a>: many albums are “name your price”: enter 0, download as MP3, then drop the .zip here.</li>
            <li><a href="https://freemusicarchive.org" target="_blank" rel="noopener">Free Music Archive</a>: free Creative Commons songs with a download button.</li>
            <li><a href="https://soundcloud.com" target="_blank" rel="noopener">SoundCloud</a> and <a href="https://audiomack.com" target="_blank" rel="noopener">Audiomack</a>: only songs where the artist turned on “free download”.</li>
          </ul>
          <button class="btn btn-ghost btn-sm" data-act="import-files">${ic('upload')}<span>Add downloaded files or .zip</span></button>
        </section>
        ${F.freemusic.jamendoId() ? `<p class="fine">Jamendo is connected. <button class="link-btn" data-act="jam-remove">Remove Jamendo</button></p>` : ''}
      </div>`,
      color: 'hsl(38 55% 28%)',
      title: 'Free music',
      mount: (root) => fillFreeResults(root, query),
    };
  };

  function jamendoSetup() {
    return `<section class="set-card jam-setup">
      <h2>${ic('plus')} Add Jamendo <span class="pill">600,000+ free songs</span></h2>
      <p class="lead-sm">Jamendo has free, legal music from independent artists. It needs a free key, once:</p>
      <ol class="steps">
        <li>Create a free account on the <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">Jamendo developer site</a>.</li>
        <li>Choose <strong>Create an app</strong>. Any name works, and the website can be <code>https://github.com/mrmajko123/freeify</code>.</li>
        <li>Copy the app’s <strong>Client ID</strong> and paste it here:
          <form class="copy-row" data-form="jam-key"><input class="input" id="jam-key" name="key" placeholder="Jamendo Client ID" autocomplete="off" spellcheck="false"><button class="btn btn-primary btn-sm" type="submit">Save</button></form></li>
      </ol>
      <p class="fine">Jamendo doesn’t allow downloads from inside the web version, so there you’ll get an “Open on Jamendo” button. The desktop and phone apps download directly.</p>
    </section>`;
  }

  function freeRow(t, i, list, have, playing, opts) {
    return `<div class="free-row${have.has(t.id) ? ' owned' : ''}" data-tid="${esc(t.id)}">
      ${opts && opts.cover ? `<div class="cover sm"><img src="${esc(t.image)}" alt="" loading="lazy" draggable="false"></div>` : `<span class="n">${t.trackNo}</span>`}
      <button class="icon-btn free-play${playing === t.id ? ' on' : ''}" data-act="free-preview" data-list="${list}" data-i="${i}" aria-label="Preview ${esc(t.title)}">${ic(playing === t.id ? 'pause' : 'play')}</button>
      <div class="t-meta"><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.artist)}${opts && opts.cover && t.albumId ? ` · <a class="sub-link" href="#/free/album/${encodeURIComponent(t.albumId)}">${esc(t.album)}</a>` : ''}</div></div>
      <span class="dur">${t.duration ? U.fmtTime(t.duration) : ''}</span>
      ${have.has(t.id) ? `<span class="got" title="In your library">${ic('check')}</span>`
        : t.url ? `<button class="icon-btn" data-act="free-dl" data-list="${list}" data-i="${i}" aria-label="Download ${esc(t.title)}" title="Download">${ic('arrow-down')}</button>`
          : `<a class="icon-btn" href="${esc(t.page)}" target="_blank" rel="noopener" title="The artist doesn’t allow downloads. Open it on the site" aria-label="Open ${esc(t.title)} on the site">${ic('link')}</a>`}
    </div>`;
  }

  async function fillJamResults(root, query) {
    const box = root.querySelector('#jam-results');
    if (!box) return;
    try {
      const tracks = await F.freemusic.jamSearch(query);
      if (!root.contains(box)) return;
      V.freeLists = Object.assign(V.freeLists || {}, { jam: tracks });
      const have = F.freemusic.owned();
      box.innerHTML = tracks.length
        ? `<div class="free-list">${tracks.map((t, i) => freeRow(t, i, 'jam', have, F.freemusic.previewing, { cover: true })).join('')}</div>`
        : '<p class="muted pad">No songs found on Jamendo.</p>';
    } catch (e) {
      if (root.contains(box)) box.innerHTML = `<p class="notice">${esc(e.message)}</p>`;
    }
  }

  async function fillFreeResults(root, query) {
    fillJamResults(root, query);
    const box = root.querySelector('#free-results');
    if (!box) return;
    try {
      const r = await F.freemusic.search(query);
      if (!root.contains(box)) return;
      if (!r.albums.length) {
        box.innerHTML = `<div class="empty-state">${ic('search')}<h3>No free music found</h3><p>Try a style like “jazz”, “ambient” or “rock”, or an artist name.</p></div>`;
        return;
      }
      box.innerHTML = `<div class="cards grid-all">${r.albums.map((a) => `<a class="card" href="#/free/album/${encodeURIComponent(a.id)}">
          <div class="card-art"><div class="cover"><img src="${esc(a.image)}" alt="" loading="lazy" draggable="false"></div></div>
          <div class="card-title">${esc(a.title)}</div>
          <div class="card-sub">${esc(a.artist)}</div>
          <div class="card-lic">${esc(F.freemusic.licenseName(a.license))}</div>
        </a>`).join('')}</div>`;
    } catch (e) {
      if (root.contains(box)) box.innerHTML = `<div class="empty-state">${ic('wifi_off')}<h3>Couldn’t load free music</h3><p>${esc(e.message)}</p><a class="btn btn-light" href="${esc(location.hash)}">Try again</a></div>`;
    }
  }

  V.freeAlbum = function (id) {
    return {
      html: `<div class="page collection" id="free-album"><div class="empty-state"><p class="muted">Loading album…</p></div></div>`,
      color: 'hsl(38 45% 26%)',
      title: 'Free music',
      mount: (root) => fillFreeAlbum(root, id),
    };
  };

  async function fillFreeAlbum(root, id) {
    const box = root.querySelector('#free-album');
    if (!box) return;
    let a;
    try {
      a = await F.freemusic.album(id);
    } catch (e) {
      if (root.contains(box)) box.innerHTML = `<div class="empty-state">${ic('note')}<h3>Couldn’t open this album</h3><p>${esc(e.message)}</p><a class="btn btn-light" href="#/free">Back to free music</a></div>`;
      return;
    }
    if (!root.contains(box)) return;
    V.freeAlbumData = a;
    V.freeLists = Object.assign(V.freeLists || {}, { album: a.tracks });
    const site = a.source === 'jamendo' ? 'jamendo.com' : 'archive.org';
    const siteName = a.source === 'jamendo' ? 'Jamendo' : 'the Internet Archive';
    const have = F.freemusic.owned();
    const missing = a.tracks.filter((t) => !have.has(t.id)).length;
    const total = a.tracks.reduce((n, t) => n + (t.duration || 0), 0);
    const playing = F.freemusic.previewing;
    box.innerHTML = `${UI.hero({
      cover: `<div class="cover hero-cover"><img src="${esc(a.image)}" alt="" draggable="false"></div>`,
      kind: 'Free album',
      title: a.title,
      meta: `<strong>${esc(a.artist)}</strong>${a.year ? ` · ${a.year}` : ''} · ${U.plural(a.tracks.length, 'song')}${total ? `, <span class="muted">${U.fmtLong(total)}</span>` : ''} · ${licenseBadge(a.license)}`,
      description: a.description,
    })}
      <div class="page-body">
        <div class="action-bar">
          ${missing && a.tracks.some((t) => t.url && !have.has(t.id)) ? `<button class="btn btn-primary" data-act="free-dl-album">${ic('upload')}<span>Download ${missing === a.tracks.length ? 'album' : `${missing} more`}</span></button>`
            : `<span class="pill">${ic('check', 'inline')} In your library</span>`}
          <a class="btn btn-ghost" href="${esc(a.page)}" target="_blank" rel="noopener">${ic('link')}<span>${site}</span></a>
        </div>
        ${a.tracks.length ? `<div class="free-list">${a.tracks.map((t, i) => freeRow(t, i, 'album', have, playing)).join('')}</div>` : '<p class="empty">This album has no MP3 files to download.</p>'}
        <p class="fine">Free under ${licenseBadge(a.license)} from ${siteName}. Please credit the artist if you share it.</p>
      </div>`;
  }

  // ---------------------------------------------------------------- import (Spotify + artwork)

  V.importer = function () {
    const sp = F.spotify;
    const st = sp.state();
    const info = sp.redirectInfo();
    const last = st.lastImport;
    const miss = F.artwork.missing();
    const steps = (uri) => `<ol class="steps">
        <li>Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a>, log in, and click <strong>Create app</strong>. Any name and description will do.</li>
        <li>Under <strong>Redirect URIs</strong>, add this address exactly:
          <div class="copy-row"><code id="redirect-uri">${esc(uri)}</code><button class="btn btn-ghost btn-sm" data-act="sp-copy" data-text="${esc(uri)}">Copy</button></div></li>
        <li>Tick <strong>Web API</strong>, accept the terms and save. Then open the app's <strong>Settings</strong> and copy its <strong>Client ID</strong>.</li>
        <li>Paste the Client ID here and connect:
          <form class="copy-row" data-form="sp-connect"><input class="input" id="sp-client" name="client" placeholder="Client ID (32 letters and numbers)" value="${esc(st.clientId || '')}" autocomplete="off" spellcheck="false"><button class="btn btn-primary btn-sm" type="submit">Connect</button></form></li>
      </ol>
      <p class="fine">Spotify only lets an account with Premium create these developer apps. No Premium? Use the data export below instead: it's free.</p>`;

    let connectHtml;
    if (sp.connected()) {
      connectHtml = `<div class="sp-status">${ic('check')}<span>Connected${st.user ? ` as <strong>${esc(st.user.name)}</strong>` : ''}</span><button class="link-btn" data-act="sp-disconnect">Disconnect</button></div>
        <div class="checks">
          ${[['liked', 'Liked Songs'], ['playlists', 'Your playlists'], ['albums', 'Saved albums'], ['artists', 'Artists you follow'], ['pictures', 'Artist pictures']]
            .map(([k, label]) => `<label class="check"><input type="checkbox" name="sp-opt" value="${k}" checked><span>${label}</span></label>`).join('')}
        </div>
        <button class="btn btn-primary" data-act="sp-import">${ic('upload')}<span>Import from Spotify</span></button>`;
    } else if (info.uri) {
      connectHtml = steps(info.uri);
    } else {
      const why = {
        phone: 'Signing in to Spotify isn’t available in the phone app yet. Use the data export below, or import on the desktop app or website.',
        file: 'Spotify sign-in needs Freeify to run from a web address. Use the desktop app, the GitHub Pages website, or run <code>npm start</code> and open <code>http://127.0.0.1:8080</code>. Or use the data export below.',
        localhost: `Spotify doesn’t accept “localhost”. Open <a href="${esc(location.href.replace('//localhost', '//127.0.0.1'))}">this page on 127.0.0.1</a> instead.`,
        insecure: 'Spotify sign-in needs a secure (https) address. Use the GitHub Pages website or the desktop app, or the data export below.',
      }[info.reason];
      connectHtml = `<p class="notice">${why}</p>`;
    }

    const lastHtml = last ? `<p class="fine">Last import ${esc(U.fmtDate(last.at))}: ${U.plural(last.added || 0, 'new song')}, ${U.plural(last.linked || 0, 'song')} matched to your files, ${U.plural(last.playlists || 0, 'playlist')}, ${U.plural(last.artists || 0, 'artist')}.${last.skippedPlaylists && last.skippedPlaylists.length ? ` ${U.plural(last.skippedPlaylists.length, 'playlist')} made by other people couldn’t be read (Spotify only shares playlists you own or collaborate on).` : ''}</p>` : '';

    return {
      html: `<div class="page importer">
        <h1 class="page-title">Import</h1>
        <section class="set-card">
          <h2>${ic('link')} Connect your Spotify account</h2>
          <p class="lead-sm">Brings in your Liked Songs, your playlists, saved albums and followed artists, with album covers and artist pictures.</p>
          ${connectHtml}
          ${lastHtml}
        </section>
        <section class="set-card">
          <h2>${ic('folder')} Import a Spotify data export <span class="pill">Free, no Premium</span></h2>
          <ol class="steps">
            <li>On spotify.com open <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">Account → Privacy settings</a> and request <strong>Account data</strong>.</li>
            <li>Spotify emails you a download link (usually within a few days). Unzip it.</li>
            <li>Add <code>YourLibrary.json</code> and the <code>Playlist…json</code> files here (or drop them on the window).</li>
          </ol>
          <button class="btn btn-ghost" data-act="sp-export-files">${ic('upload')}<span>Choose export files</span></button>
          <input type="file" id="sp-export-input" accept=".json,application/json" multiple hidden>
        </section>
        <section class="set-card">
          <h2>${ic('image')} Find missing covers and artist pictures</h2>
          <p class="lead-sm">${miss.albums.length || miss.artists.length
            ? `${U.plural(miss.albums.length, 'album')} without a cover and ${U.plural(miss.artists.length, 'artist')} without a picture.`
            : 'Every album has a cover and every artist has a picture.'}
            Looks them up on ${sp.connected() ? 'Spotify, then Wikipedia' : 'Wikipedia'}.</p>
          <button class="btn btn-ghost" data-act="art-find"${miss.albums.length || miss.artists.length ? '' : ' disabled'}>${ic('search')}<span>Find pictures</span></button>
        </section>
        <section class="set-card about">
          <h2>Why don’t Spotify songs play right away?</h2>
          <p>Spotify’s audio is copy-protected and licensed only for Spotify’s own apps, so no app can legally download it.
            Freeify brings in everything else: names, playlists, likes, covers and pictures. Songs that aren’t on this device yet
            are shown greyed out with ${ic('cloud', 'inline')} and can be opened in Spotify. Add your own files for them (songs you bought,
            CDs you ripped, free downloads) and Freeify matches them automatically.</p>
        </section>
      </div>`,
      color: 'hsl(150 35% 22%)',
      title: 'Import',
    };
  };

  function notFound(msg) {
    return { html: `<div class="page"><div class="empty-state">${ic('note')}<h3>${esc(msg)}</h3><p>It may have been removed.</p><a class="btn btn-light" href="#/home">Go home</a></div></div>`, color: null, title: msg };
  }

  F.views = V;
})(window.Freeify = window.Freeify || {});
