/* Freeify: app shell, routing, player bar, queue panel, input handling. */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const P = F.player;
  const UI = F.ui;
  const V = F.views;
  const ic = F.icon;
  const esc = U.esc;
  const $ = U.$;
  const $$ = U.$$;

  F.ACCENTS = [
    { name: 'Mint', value: '#3ddc97' },
    { name: 'Sky', value: '#4cc9f0' },
    { name: 'Violet', value: '#a78bfa' },
    { name: 'Rose', value: '#fb7185' },
    { name: 'Amber', value: '#fbbf24' },
    { name: 'Lime', value: '#a3e635' },
  ];

  F.SHORTCUTS = [
    ['Space', 'Play / pause'],
    ['← / →', 'Seek back / forward 5 seconds'],
    ['Shift + ← / →', 'Previous / next song'],
    ['Shift + ↑ / ↓', 'Volume up / down'],
    ['M', 'Mute / unmute'],
    ['S', 'Shuffle on / off'],
    ['R', 'Cycle repeat mode'],
    ['L', 'Like the current song'],
    ['Q', 'Show the queue'],
    ['F', 'Full screen player'],
    ['/', 'Search'],
    ['Ctrl / ⌘ + A', 'Select all songs in a list'],
    ['Enter', 'Play selected songs'],
    ['Delete', 'Remove selected songs from a playlist'],
    ['?', 'Show these shortcuts'],
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('freeify:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('freeify:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  F.settings = {
    accent: store.get('accent', F.ACCENTS[0].value),
    libFilter: store.get('libFilter', 'all'),
    rightTab: store.get('rightTab', 'queue'),
    rightOpen: store.get('rightOpen', false),
    localOnly: store.get('localOnly', false),
  };

  let el = {};
  let route = { name: 'home', args: [] };
  let page = null;
  let seeking = false;
  let sel = { list: null, idxs: new Set(), anchor: -1 };
  let drag = null;
  let fullLyricsOn = false;
  let lyricsState = { id: null, data: null };
  let lastLyric = -1;
  let installEvent = null;
  let importChain = Promise.resolve();

  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const isTouch = () => window.matchMedia('(hover: none)').matches;
  const toast = (m, o) => UI.toast(m, o);
  const go = (hash) => { location.hash = hash; };

  function applyAccent(v) {
    document.documentElement.style.setProperty('--accent', v);
    F.settings.accent = v;
    store.set('accent', v);
  }

  // ================================================================ routing

  const ROUTES = [
    [/^\/?(?:home)?$/, 'home'],
    [/^\/search(?:\/(.*))?$/, 'search'],
    [/^\/library$/, 'library'],
    [/^\/liked$/, 'liked'],
    [/^\/playlist\/([^/]+)$/, 'playlist'],
    [/^\/album\/([^/]+)$/, 'album'],
    [/^\/artist\/([^/]+)$/, 'artist'],
    [/^\/genre\/([^/]+)$/, 'genre'],
    [/^\/albums$/, 'albums'],
    [/^\/artists$/, 'artists'],
    [/^\/collection$/, 'collection'],
    [/^\/settings$/, 'settings'],
    [/^\/import$/, 'importer'],
  ];

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function parseRoute() {
    const path = location.hash.replace(/^#/, '') || '/home';
    for (const [re, name] of ROUTES) {
      const m = path.match(re);
      if (m) { route = { name, args: m.slice(1).map((x) => (x == null ? '' : safeDecode(x))) }; return; }
    }
    route = { name: 'home', args: [] };
  }

  function render(keepScroll) {
    const scroll = el.main.scrollTop;
    // Preserve typed text and focus inside the view across re-renders.
    const inputs = {};
    $$('input[id], textarea[id]', el.view).forEach((i) => { inputs[i.id] = i.value; });
    const focusId = el.view.contains(document.activeElement) ? document.activeElement.id : null;

    UI.lists.clear();
    let res;
    try {
      res = V[route.name](...route.args);
    } catch (e) {
      console.error(e);
      res = { html: `<div class="page"><div class="empty-state">${ic('note')}<h3>Something went wrong</h3><p>${esc(e.message)}</p></div></div>`, color: null };
    }
    page = res;
    el.view.innerHTML = res.html;
    Object.keys(inputs).forEach((id) => { const i = document.getElementById(id); if (i && el.view.contains(i)) i.value = inputs[id]; });
    if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }

    el.main.style.setProperty('--hero', res.color || 'hsl(0 0% 16%)');
    el.main.classList.toggle('has-color', !!res.color);
    el.main.dataset.route = route.name;
    el.topSearch.hidden = route.name !== 'search';
    if (route.name === 'search' && document.activeElement !== el.search) el.search.value = route.args[0] || '';
    if (res.ctx) {
      const c = res.ctx;
      el.topCtx.innerHTML = `<button class="play-btn sm js-ctx-play" data-act="play-ctx" data-type="${c.type}" data-id="${esc(c.id)}" data-ctx="${c.type}:${esc(c.id)}" aria-label="Play">${ic('play')}</button><span>${esc(c.name)}</span>`;
    } else el.topCtx.innerHTML = '';

    if (res.mount) { try { res.mount(el.view); } catch (e) { console.error(e); } }
    el.main.scrollTop = keepScroll ? scroll : 0;
    onScroll();
    sel = { list: null, idxs: new Set(), anchor: -1 };
    UI.syncPlaying();
    syncNav();
    syncTitle();
  }

  function syncNav() {
    const name = route.name;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'library' && a.dataset.nav === 'collection' && isMobile())));
    const hash = location.hash || '#/home';
    $$('.lib-item').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
  }

  function syncTitle() {
    const t = P.current ? L.get(P.current) : null;
    if (t && P.playing) document.title = `${t.title} · ${t.artist || 'Unknown artist'}`;
    else document.title = page && page.title && page.title !== 'Freeify' ? `${page.title} · Freeify` : 'Freeify';
  }

  function onScroll() {
    const y = el.main.scrollTop;
    el.main.style.setProperty('--topbar-alpha', Math.min(1, y / 220).toFixed(3));
    el.main.classList.toggle('scrolled', y > 8);
    el.main.classList.toggle('show-ctx', y > 290 && !!(page && page.ctx));
  }

  // ================================================================ sidebar

  function renderSidebar() {
    el.libChips.innerHTML = V.chips(F.settings.libFilter, 'lib-filter');
    el.libList.innerHTML = V.libraryItems(F.settings.libFilter);
    syncNav();
    UI.syncPlaying();
  }

  // ================================================================ player bar

  function artistLinks(t) {
    if (!t) return '';
    return `<a href="#/artist/${L.artistIdOf(t)}">${esc(t.artist || 'Unknown artist')}</a>`;
  }

  function syncTrack() {
    const t = P.current ? L.get(P.current) : null;
    el.app.classList.toggle('no-track', !t);
    $$('.js-cover').forEach((c) => { c.innerHTML = t ? UI.trackCover(t) : ''; });
    $$('.js-title').forEach((a) => {
      a.textContent = t ? t.title : '';
      const albumId = t && L.albumIdOf(t);
      a.setAttribute('href', albumId ? `#/album/${albumId}` : '#/library');
    });
    $$('.js-artist').forEach((d) => { d.innerHTML = artistLinks(t); });
    syncLike();
    syncTime();
    syncState();
    const color = t ? (L.coverColor(t.coverId) || U.seedColor(t.album || t.title)) : 'hsl(0 0% 20%)';
    el.fullBg.style.setProperty('--np-color', color);
    const ctx = P.context;
    el.fullCtx.textContent = ctx ? ctx.name : (t ? t.album || 'Your Music' : '');
    el.fullCtx.setAttribute('href', ctx && ctx.href ? ctx.href : '#/library');
    $$('.js-lyrics-btn').forEach((b) => b.classList.toggle('dim', !(t && t.hasLyrics)));
    if (fullLyricsOn && !el.full.hidden) fillLyrics(el.fullLyrics);
    renderRight();
  }

  function syncLike() {
    const t = P.current ? L.get(P.current) : null;
    const on = !!(t && t.likedAt);
    $$('.js-like').forEach((b) => {
      b.classList.toggle('on', on);
      b.innerHTML = ic(on ? 'heart-fill' : 'heart');
      b.setAttribute('aria-label', on ? 'Remove from Liked Songs' : 'Save to Liked Songs');
    });
  }

  function syncState() {
    const playing = P.playing;
    $$('.js-play').forEach((b) => {
      b.innerHTML = ic(playing ? 'pause' : 'play');
      b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });
    el.app.classList.toggle('is-playing', playing);
    UI.syncPlaying();
    syncTitle();
  }

  function syncTime() {
    const d = P.duration;
    const t = Math.min(P.time, d || P.time);
    const pct = d ? (t / d) * 100 : 0;
    if (!seeking) {
      $$('.js-seek').forEach((r) => {
        r.value = String(Math.round(pct * 10));
        r.style.setProperty('--p', pct + '%');
      });
      $$('.js-cur').forEach((x) => { x.textContent = U.fmtTime(t); });
    }
    $$('.js-dur').forEach((x) => { x.textContent = U.fmtTime(d); });
    const bar = $('.js-mini-bar');
    if (bar) bar.style.width = pct + '%';
    syncLyrics();
  }

  function syncMode() {
    $$('.js-shuffle').forEach((b) => { b.classList.toggle('active', P.shuffle); b.setAttribute('aria-pressed', P.shuffle); });
    $$('.js-repeat').forEach((b) => {
      b.classList.toggle('active', P.repeat !== 'off');
      b.innerHTML = ic(P.repeat === 'one' ? 'repeat-one' : 'repeat');
      b.setAttribute('aria-label', P.repeat === 'off' ? 'Enable repeat' : P.repeat === 'all' ? 'Enable repeat one' : 'Disable repeat');
    });
    const v = P.muted ? 0 : P.volume;
    $$('.js-vol').forEach((r) => { r.value = String(v); r.style.setProperty('--p', v * 100 + '%'); });
    $$('.js-mute').forEach((b) => {
      b.innerHTML = ic(v === 0 ? 'volume-mute' : v < 0.5 ? 'volume-low' : 'volume-high');
      b.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    });
    $$('.js-sleep').forEach((b) => b.classList.toggle('active', !!P.sleep));
  }

  // ================================================================ right panel (now playing / queue)

  function toggleRight(tab, force) {
    const open = force != null ? force : (el.right.hidden || (tab && F.settings.rightTab !== tab));
    if (tab) { F.settings.rightTab = tab; store.set('rightTab', tab); }
    el.right.hidden = !open;
    el.app.classList.toggle('right-open', open);
    F.settings.rightOpen = open;
    store.set('rightOpen', open);
    renderRight();
  }

  function renderRight() {
    const tab = F.settings.rightTab;
    $$('.js-queue-btn').forEach((b) => b.classList.toggle('active', !el.right.hidden && tab === 'queue'));
    if (el.right.hidden) return;
    $$('.tab', el.right).forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    if (tab === 'queue') renderQueue(); else renderNowPlaying();
    UI.syncPlaying();
  }

  function qItem(id, attrs, removeIndex) {
    const t = L.get(id);
    if (!t) return '';
    return `<div class="q-item" data-id="${id}" ${attrs || ''}>
      ${UI.trackCover(t, 'sm')}
      <div class="t-meta"><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.artist || 'Unknown artist')}</div></div>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      ${removeIndex != null ? `<button class="icon-btn q-remove" data-act="q-remove" data-i="${removeIndex}" aria-label="Remove from queue">${ic('close')}</button>` : ''}
    </div>`;
  }

  function renderQueue() {
    const up = P.upNext(80);
    const ctx = P.context;
    let html = '<h3 class="q-h">Now playing</h3>';
    html += P.current ? qItem(P.current, 'data-act="toggle"') : '<p class="muted pad">Nothing is playing.</p>';
    if (up.queue.length) {
      html += `<div class="q-h-row"><h3 class="q-h">Next in queue</h3><button class="link-btn" data-act="clear-queue">Clear queue</button></div>`;
      html += up.queue.map((id, i) => qItem(id, `data-act="q-play" data-kind="queue" data-i="${i}"`, i)).join('');
    }
    if (up.context.length) {
      html += `<h3 class="q-h">Next from: ${ctx && ctx.href ? `<a href="${ctx.href}">${esc(ctx.name)}</a>` : esc(ctx ? ctx.name : 'your music')}</h3>`;
      html += up.context.map((c) => qItem(c.id, `data-act="q-play" data-kind="ctx" data-i="${c.pos}"`)).join('');
      if (up.more) html += `<p class="muted pad">and ${U.plural(up.more, 'more song')}</p>`;
    }
    if (!up.queue.length && !up.context.length) {
      html += `<div class="q-empty">${ic('queue')}<strong>Your queue is empty</strong><span>Right-click any song and choose “Add to queue”.</span></div>`;
    }
    el.rightBody.innerHTML = `<div class="queue">${html}</div>`;
  }

  function renderNowPlaying() {
    const t = P.current ? L.get(P.current) : null;
    if (!t) {
      el.rightBody.innerHTML = `<div class="q-empty">${ic('note')}<strong>Nothing playing yet</strong><span>Pick a song to get started.</span></div>`;
      return;
    }
    const albumId = L.albumIdOf(t);
    const up = P.upNext(1);
    const nextId = up.queue[0] || (up.context[0] && up.context[0].id);
    const facts = [
      t.album && albumId ? ['Album', `<a href="#/album/${albumId}">${esc(t.album)}</a>`] : null,
      t.year ? ['Year', t.year] : null,
      t.genre ? ['Genre', esc(t.genre)] : null,
      ['Plays', (t.playCount || 0).toLocaleString()],
      ['File', `<span class="file-name">${esc(t.fileName)}</span> · ${U.fmtBytes(t.size)}`],
    ].filter(Boolean);
    el.rightBody.innerHTML = `<div class="np-panel">
      <div class="np-art">${UI.trackCover(t)}</div>
      <div class="np-head">
        <div class="np-head-meta"><a class="np-head-title" href="${albumId ? '#/album/' + albumId : '#/library'}">${esc(t.title)}</a><div class="np-head-artist">${artistLinks(t)}</div></div>
        <button class="icon-btn like js-like" data-act="like-current" aria-label="Save to Liked Songs">${ic('heart')}</button>
      </div>
      <section class="np-card lyrics-card">
        <header><h3>Lyrics</h3><button class="link-btn" data-act="edit-lyrics-current">${t.hasLyrics ? 'Edit' : 'Add'}</button></header>
        <div class="lyrics-scroll" id="np-lyrics"></div>
      </section>
      <section class="np-card">
        <header><h3>About this song</h3><button class="link-btn" data-act="edit-current">Edit</button></header>
        <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      </section>
      ${nextId ? `<section class="np-card"><header><h3>Next in queue</h3><button class="link-btn" data-act="right-tab" data-tab="queue">Open queue</button></header>${qItem(nextId, up.queue.length ? 'data-act="q-play" data-kind="queue" data-i="0"' : `data-act="q-play" data-kind="ctx" data-i="${up.context[0].pos}"`)}</section>` : ''}
    </div>`;
    syncLike();
    fillLyrics($('#np-lyrics'));
  }

  // ================================================================ lyrics

  async function loadLyrics(id) {
    if (lyricsState.id === id && lyricsState.data) return lyricsState.data;
    const text = await L.getLyrics(id);
    lyricsState = { id, data: F.tags.parseLyrics(text) };
    return lyricsState.data;
  }

  async function fillLyrics(box) {
    if (!box) return;
    const id = P.current;
    const t = id ? L.get(id) : null;
    lastLyric = -1;
    if (!t || !t.hasLyrics) {
      box.innerHTML = `<div class="lyrics-empty"><p>${t ? 'No lyrics for this song yet.' : 'Nothing playing.'}</p>${t ? '<button class="btn btn-light btn-sm" data-act="edit-lyrics-current">Add lyrics</button>' : ''}<small>Tip: drop an .lrc file with the same name as the song to get synced lyrics.</small></div>`;
      return;
    }
    const data = await loadLyrics(id);
    if (P.current !== id) return;
    if (!data.lines.length) { box.innerHTML = '<div class="lyrics-empty"><p>No lyrics for this song yet.</p></div>'; return; }
    box.innerHTML = `<div class="lyrics${data.synced ? ' synced' : ''}">${data.lines.map((l, i) =>
      data.synced
        ? `<p class="ly" data-i="${i}" data-act="lyric-seek" data-t="${l.time}">${esc(l.text) || '♪'}</p>`
        : `<p class="ly">${esc(l.text) || '&nbsp;'}</p>`).join('')}</div>`;
    syncLyrics(true);
  }

  function syncLyrics(force) {
    const d = lyricsState.data;
    if (!d || !d.synced || lyricsState.id !== P.current) return;
    const t = P.time + 0.25;
    let i = -1, lo = 0, hi = d.lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (d.lines[mid].time <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (i === lastLyric && !force) return;
    lastLyric = i;
    $$('.lyrics.synced').forEach((box) => {
      $$('.ly', box).forEach((p) => {
        const k = +p.dataset.i;
        p.classList.toggle('active', k === i);
        p.classList.toggle('past', k < i);
      });
      const act = box.querySelector('.ly.active');
      const sc = box.parentElement;
      if (act && sc) sc.scrollTo({ top: act.offsetTop - sc.clientHeight / 2 + act.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' });
    });
  }

  function setFullLyrics(on) {
    fullLyricsOn = on;
    el.full.classList.toggle('lyrics-on', on);
    el.fullLyrics.hidden = !on;
    $$('.js-lyrics-toggle').forEach((b) => b.classList.toggle('active', on));
    if (on) fillLyrics(el.fullLyrics);
  }

  // ================================================================ full screen player

  function openFull(withLyrics) {
    el.full.hidden = false;
    document.body.classList.add('full-open');
    requestAnimationFrame(() => el.full.classList.add('open'));
    if (withLyrics != null) setFullLyrics(!!withLyrics);
    else if (fullLyricsOn) fillLyrics(el.fullLyrics);
    syncTrack();
  }

  function closeFull() {
    el.full.classList.remove('open');
    document.body.classList.remove('full-open');
    setTimeout(() => { if (!el.full.classList.contains('open')) el.full.hidden = true; }, 260);
  }

  // ================================================================ selection

  function isSelected(row) { return sel.list === row.dataset.list && sel.idxs.has(+row.dataset.idx); }

  function selectRow(row, e) {
    e = e || {};
    const key = row.dataset.list, idx = +row.dataset.idx;
    if (sel.list !== key) sel = { list: key, idxs: new Set(), anchor: -1 };
    if (e.shiftKey && sel.anchor >= 0) {
      const a = Math.min(sel.anchor, idx), b = Math.max(sel.anchor, idx);
      if (!(e.ctrlKey || e.metaKey)) sel.idxs.clear();
      for (let i = a; i <= b; i++) sel.idxs.add(i);
    } else if (e.ctrlKey || e.metaKey) {
      if (sel.idxs.has(idx)) sel.idxs.delete(idx); else sel.idxs.add(idx);
      sel.anchor = idx;
    } else {
      sel.idxs = new Set([idx]);
      sel.anchor = idx;
    }
    paintSelection();
  }

  function clearSelection() {
    if (!sel.list) return;
    sel = { list: null, idxs: new Set(), anchor: -1 };
    paintSelection();
  }

  function paintSelection() {
    $$('.tr.selected').forEach((r) => r.classList.remove('selected'));
    if (!sel.list) return;
    $$('.tr[data-list]').forEach((r) => {
      if (r.dataset.list === sel.list && sel.idxs.has(+r.dataset.idx)) r.classList.add('selected');
    });
  }

  function selectionFor(row) {
    const key = row.dataset.list, idx = +row.dataset.idx;
    const reg = UI.lists.get(key);
    if (!reg) return { ids: [], idxs: [] };
    if (sel.list === key && sel.idxs.has(idx) && sel.idxs.size > 1) {
      const idxs = [...sel.idxs].sort((a, b) => a - b);
      return { ids: idxs.map((i) => reg.ids[i]), idxs };
    }
    return { ids: [reg.ids[idx]], idxs: [idx] };
  }

  // ================================================================ playback helpers

  function playRow(rowEl) {
    if (!rowEl) return;
    const reg = UI.lists.get(rowEl.dataset.list);
    if (!reg) return;
    const idx = +rowEl.dataset.idx;
    const id = reg.ids[idx];
    const t = L.get(id);
    if (t && t.remote) { remoteToast(t); return; }
    const key = reg.ctx ? `${reg.ctx.type}:${reg.ctx.id}` : null;
    if (P.current === id && (!key || P.ctxKey === key)) { P.toggle(); return; }
    P.playContext(reg.ids, idx, reg.ctx);
  }

  function playCtx(type, id, shuffle) {
    const key = `${type}:${id}`;
    if (!shuffle && P.ctxKey === key && P.current) { P.toggle(); return; }
    const c = UI.ctx(type, id);
    if (!c) return;
    let ids = c.ids;
    // Use the order shown on screen (e.g. after sorting) when it's the full list.
    for (const reg of UI.lists.values()) {
      if (reg.ctx && reg.ctx.type === type && reg.ctx.id === c.id && reg.ids.length === ids.length) { ids = reg.ids; break; }
    }
    if (!ids.length) { toast(type === 'liked' ? 'Like some songs first: tap the heart next to any song.' : 'Nothing to play here yet.'); return; }
    if (shuffle && !P.shuffle) P.setShuffle(true);
    P.playContext(ids, P.shuffle ? -1 : 0, UI.ctxRef(c));
  }

  function playSomething() {
    if (P.current) { P.toggle(); return; }
    if (!L.count()) { importMenu(null); return; }
    playCtx('library', 'library');
  }

  // ================================================================ menus

  function trackMenu(ids, o) {
    o = o || {};
    ids = ids.filter((id) => L.get(id));
    if (!ids.length) return;
    const n = ids.length;
    const one = n === 1 ? L.get(ids[0]) : null;
    const allLiked = ids.every((id) => L.get(id).likedAt);
    const playable = ids.filter((id) => L.isPlayable(id));
    const p = playable.length;
    const items = [];
    if (p) {
      items.push(
        { label: 'Add to queue', icon: 'queue-add', run: () => { P.addToQueue(playable); toast(p > 1 ? `Added ${p} songs to the queue` : 'Added to queue'); } },
        { label: 'Play next', icon: 'play-next', run: () => { P.playNext(playable); toast(p > 1 ? `${p} songs will play next` : 'Will play next'); } },
      );
    }
    if (one && (one.remote || one.spotifyId)) {
      items.push({ label: 'Open in Spotify', icon: 'link', run: () => window.open(F.spotify.openUrl(one), '_blank', 'noopener') });
    }
    if (items.length) items.push({ sep: true });
    items.push(
      { label: 'Add to playlist…', icon: 'plus', run: () => addToPlaylistFlow(ids) },
      { label: allLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: allLiked ? 'heart-fill' : 'heart', run: () => { L.setLiked(ids, !allLiked); toast(allLiked ? 'Removed from Liked Songs' : 'Added to Liked Songs'); } },
    );
    if (o.playlistId && o.origIdxs) {
      items.push({ label: 'Remove from this playlist', icon: 'close', run: () => { L.removeFromPlaylist(o.playlistId, o.origIdxs); toast(n > 1 ? `Removed ${n} songs` : 'Removed from playlist'); } });
    }
    if (one) {
      items.push({ sep: true });
      items.push({ label: 'Go to artist', icon: 'user', run: () => go(`#/artist/${L.artistIdOf(one)}`) });
      if (L.albumIdOf(one)) items.push({ label: 'Go to album', icon: 'disc', run: () => go(`#/album/${L.albumIdOf(one)}`) });
      items.push({ label: 'Edit details…', icon: 'edit', run: () => editTrack(one.id) });
      items.push({ label: one.hasLyrics ? 'Edit lyrics…' : 'Add lyrics…', icon: 'mic', run: () => editLyrics(one.id) });
    }
    items.push({ sep: true });
    items.push({ label: n > 1 ? `Delete ${n} songs from library` : 'Delete from library', icon: 'trash', danger: true, run: () => deleteTracks(ids) });
    UI.menu(o.x || 0, o.y || 0, items, o.anchor);
  }

  function rowMenu(row, x, y, anchor) {
    const { ids, idxs } = selectionFor(row);
    const reg = UI.lists.get(row.dataset.list);
    const o = { x, y, anchor };
    if (reg && reg.playlistId) { o.playlistId = reg.playlistId; o.origIdxs = idxs.map((i) => reg.origIdx[i]); }
    trackMenu(ids, o);
  }

  function ctxMenu(type, id, pos, anchor) {
    const c = UI.ctx(type, id);
    if (!c) return;
    const items = [
      { label: 'Play', icon: 'play', run: () => playCtx(type, c.id) },
      { label: 'Shuffle play', icon: 'shuffle', run: () => playCtx(type, c.id, true) },
      { label: 'Add to queue', icon: 'queue-add', run: () => { P.addToQueue(c.ids); toast(`Added ${U.plural(c.ids.length, 'song')} to the queue`); } },
    ];
    if (type !== 'playlist') items.push({ label: 'Add to playlist…', icon: 'plus', run: () => addToPlaylistFlow(c.ids) });
    if (type === 'album') {
      const a = L.album(c.id);
      items.push({ label: 'Like all songs', icon: 'heart', run: () => { L.setLiked(c.ids, true); toast('Added to Liked Songs'); } });
      if (a && L.artist(L.artistIdByName(a.artist))) items.push({ sep: true }, { label: 'Go to artist', icon: 'user', run: () => go(`#/artist/${L.artistIdByName(a.artist)}`) });
    }
    if (type === 'playlist') {
      items.push({ sep: true });
      items.push({ label: 'Edit details…', icon: 'edit', run: () => editPlaylist(c.id) });
      items.push({ label: 'Duplicate', icon: 'playlist', run: () => { const p = L.createPlaylist(`${c.name} (copy)`, c.ids); toast(`Created “${p.name}”`); } });
      items.push({ label: 'Delete playlist', icon: 'trash', danger: true, run: () => deletePlaylist(c.id) });
    }
    if (type === 'library') items.push({ sep: true }, { label: 'Add music…', icon: 'upload', run: () => el.fileInput.click() });
    UI.menu(pos ? pos.x : 0, pos ? pos.y : 0, items, anchor);
  }

  function importMenu(anchor) {
    const r = anchor ? null : { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 60 };
    UI.menu(r ? r.x : 0, r ? r.y : 0, [
      { label: 'Add music files…', icon: 'upload', run: () => el.fileInput.click() },
      { label: 'Add a folder…', icon: 'folder', run: () => el.folderInput.click() },
      { sep: true },
      { label: 'Import from Spotify…', icon: 'link', run: () => go('#/import') },
      { label: 'Find missing pictures', icon: 'image', run: () => findArtwork() },
    ], anchor);
  }

  function sleepMenu(anchor) {
    const s = P.sleep;
    const set = (m, label) => ({ label, icon: 'moon', run: () => { P.setSleep(m); toast(m === 'end' ? 'Music will stop at the end of this song' : `Sleep timer set for ${label}`); } });
    const items = [
      { heading: s ? (s === 'end' ? 'Stopping at end of song' : `Stopping in ${Math.ceil(s / 60000)} min`) : 'Sleep timer' },
      set(5, '5 minutes'), set(15, '15 minutes'), set(30, '30 minutes'), set(45, '45 minutes'), set(60, '1 hour'), set('end', 'End of song'),
    ];
    if (s) items.push({ sep: true }, { label: 'Turn off timer', icon: 'close', run: () => { P.setSleep(0); toast('Sleep timer off'); } });
    UI.menu(0, 0, items, anchor);
  }

  // ================================================================ flows

  async function addToPlaylistFlow(ids) {
    const pick = await UI.choosePlaylist(ids.length);
    if (!pick) return;
    if (pick === 'new') {
      const p = L.createPlaylist('', ids);
      toast(`Added to ${p.name}`, { action: { label: 'Open', run: () => go(`#/playlist/${p.id}`) } });
      return;
    }
    const p = L.playlist(pick);
    const n = L.addToPlaylist(pick, ids);
    toast(n ? `Added ${n > 1 ? n + ' songs ' : ''}to ${p.name}` : `Already in ${p.name}`);
  }

  function newPlaylist() {
    const p = L.createPlaylist('');
    go(`#/playlist/${p.id}`);
    toast(`Created “${p.name}”. Click the title to rename it.`);
  }

  async function editPlaylist(id) {
    const p = L.playlist(id);
    if (!p) return;
    const r = await UI.prompt('Edit details', p.name, { description: p.description || '', placeholder: 'Playlist name' });
    if (!r) return;
    L.updatePlaylist(id, { name: r.name, description: r.description });
  }

  async function deletePlaylist(id) {
    const p = L.playlist(id);
    if (!p) return;
    const ok = await UI.confirm('Delete playlist?', `This will delete “${p.name}”. The songs stay in your library.`, 'Delete', true);
    if (!ok) return;
    L.deletePlaylist(id);
    if (route.name === 'playlist' && route.args[0] === id) go('#/home');
    toast('Playlist deleted');
  }

  async function deleteTracks(ids) {
    const n = ids.length;
    const one = n === 1 ? L.get(ids[0]) : null;
    const ok = await UI.confirm(n > 1 ? `Delete ${n} songs?` : 'Delete song?',
      `${one ? `“${one.title}”` : 'These songs'} will be removed from Freeify on this device, including any playlists. Your original files are not touched.`, 'Delete', true);
    if (!ok) return;
    P.purge(new Set(ids));
    await L.removeTracks(ids);
    toast(n > 1 ? `Deleted ${n} songs` : 'Song deleted');
  }

  async function editTrack(id) {
    const t = L.get(id);
    if (!t) return;
    const r = await UI.form('Edit details', [
      { name: 'title', label: 'Title', value: t.title, full: true },
      { name: 'artist', label: 'Artist', value: t.artist },
      { name: 'album', label: 'Album', value: t.album },
      { name: 'albumArtist', label: 'Album artist', value: t.albumArtist, placeholder: 'Same as artist' },
      { name: 'genre', label: 'Genre', value: t.genre },
      { name: 'trackNo', label: 'Track number', value: t.trackNo || '', type: 'number' },
      { name: 'year', label: 'Year', value: t.year || '', type: 'number' },
    ]);
    if (!r) return;
    await L.updateTrack(id, {
      title: r.title.trim() || t.title,
      artist: r.artist.trim(),
      album: r.album.trim(),
      albumArtist: r.albumArtist.trim(),
      genre: r.genre.trim(),
      trackNo: parseInt(r.trackNo, 10) || 0,
      year: parseInt(r.year, 10) || 0,
    });
    if (P.current === id) syncTrack();
    toast('Details saved');
  }

  async function editLyrics(id) {
    const t = L.get(id);
    if (!t) return;
    const text = await L.getLyrics(id);
    const r = await UI.form(`Lyrics: ${t.title}`, [{
      name: 'lyrics', type: 'textarea', rows: 14, full: true, value: text,
      label: 'Paste plain lyrics, or timed LRC lyrics like “[01:23.45] a line” for karaoke-style sync.',
    }]);
    if (r == null) return;
    await L.setLyrics(id, r.lyrics);
    lyricsState = { id: null, data: null };
    if (P.current === id) { renderRight(); if (fullLyricsOn) fillLyrics(el.fullLyrics); }
    toast('Lyrics saved');
  }

  function showShortcuts() {
    UI.info('Keyboard shortcuts', `<div class="shortcuts">${F.SHORTCUTS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`);
  }

  // ================================================================ import

  async function filesFromDataTransfer(dt) {
    const items = Array.from(dt.items || []);
    const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    const plain = Array.from(dt.files || []);
    if (!entries.length) return plain;
    const out = [];
    const readAll = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
    async function walk(entry, path) {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        try { Object.defineProperty(f, 'relPath', { value: path + f.name }); } catch (e) { /* ignore */ }
        out.push(f);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await readAll(reader);
          for (const e of batch) await walk(e, path + entry.name + '/');
        } while (batch.length);
      }
    }
    try {
      for (const e of entries) await walk(e, '');
    } catch (e) {
      console.warn('[freeify] folder read failed, falling back to plain files', e);
      return plain;
    }
    return out;
  }

  function importFiles(files) {
    files = Array.from(files || []);
    if (!files.length) return importChain;
    importChain = importChain.then(() => doImport(files)).catch((e) => { console.error(e); toast('Import failed: ' + e.message, { kind: 'error' }); });
    return importChain;
  }

  function showProgress(title, done, total, text) {
    const card = el.importCard;
    card.hidden = false;
    const pct = total ? (done / total) * 100 : null;
    card.innerHTML = `<div class="ic-head">${ic('upload')}<strong>${esc(title)}</strong><span>${total ? `${done} / ${total}` : ''}</span></div>
      <div class="ic-bar${pct == null ? ' busy' : ''}"><i style="width:${pct == null ? 35 : pct}%"></i></div><div class="ic-file">${esc(text || '')}</div>`;
  }
  const hideProgress = () => { el.importCard.hidden = true; };

  /** Spotify data-export files (YourLibrary.json, Playlist1.json…). */
  async function importJsonFiles(jsonFiles) {
    const docs = [];
    for (const f of jsonFiles) {
      try { docs.push(JSON.parse(await f.text())); } catch (e) { /* not JSON */ }
    }
    showProgress('Importing Spotify data', 0, 0, jsonFiles.map((f) => f.name).join(', '));
    let stats;
    try { stats = await F.spotify.importExport(docs); } finally { hideProgress(); }
    if (!stats) { toast('Those files don’t look like a Spotify data export.', { kind: 'error' }); return; }
    toast(`From Spotify: ${U.plural(stats.added, 'song')} added, ${U.plural(stats.linked, 'song')} matched to your files, ${U.plural(stats.playlists, 'playlist')}`, {
      duration: 7000, action: { label: 'Find pictures', run: () => findArtwork() },
    });
  }

  async function runSpotifyImport() {
    const opts = {};
    $$('input[name="sp-opt"]').forEach((c) => { opts[c.value] = c.checked; });
    showProgress('Importing from Spotify', 0, 0, 'Connecting…');
    try {
      const r = await F.spotify.importLibrary(opts, (text, done, total) => showProgress('Importing from Spotify', done, total, text));
      toast(`From Spotify: ${U.plural(r.added, 'song')} added, ${U.plural(r.linked, 'song')} matched to your files, ${U.plural(r.playlists, 'playlist')}, ${U.plural(r.artists, 'artist')}`, { duration: 7000 });
      if (r.stoppedEarly) toast('Spotify’s request limit was reached, so some pictures are missing. Try “Find pictures” later.', { kind: 'error', duration: 8000 });
    } catch (e) {
      console.error(e);
      toast(e.message || 'Spotify import failed.', { kind: 'error', duration: 8000 });
    } finally {
      hideProgress();
      if (route.name === 'importer') render(true);
    }
  }

  async function findArtwork() {
    showProgress('Finding pictures', 0, 0, 'Starting…');
    try {
      const r = await F.artwork.findMissing((text, done, total) => showProgress('Finding pictures', done, total, text), true);
      toast(r.checked ? `Found ${U.plural(r.covers, 'album cover')} and ${U.plural(r.pictures, 'artist picture')} (${r.source})` : 'Nothing is missing a picture.', { duration: 6000 });
    } catch (e) {
      toast('Picture search failed: ' + e.message, { kind: 'error' });
    } finally {
      hideProgress();
      if (route.name === 'importer') render(true);
    }
  }

  function remoteToast(t) {
    toast(`“${t.title}” isn’t on this device yet. Add the song file to play it here.`, {
      duration: 6000,
      action: { label: 'Open in Spotify', run: () => window.open(F.spotify.openUrl(t), '_blank', 'noopener') },
    });
  }

  async function doImport(files) {
    const jsonFiles = files.filter((f) => /\.json$/i.test(f.name));
    if (jsonFiles.length) {
      await importJsonFiles(jsonFiles);
      files = files.filter((f) => !/\.json$/i.test(f.name));
      if (!files.length) return;
    }
    const audioCount = files.filter((f) => L.isAudio(f)).length;
    const lrcCount = files.filter((f) => /\.lrc$/i.test(f.name)).length;
    if (!audioCount && !lrcCount) {
      toast('No music files found. Freeify can play MP3, M4A, FLAC, OGG, Opus and WAV.', { kind: 'error', duration: 5000 });
      return;
    }
    const paint = (done, total, name) => showProgress('Adding music', done, total, name);
    paint(0, audioCount, 'Reading files…');
    let res;
    try {
      res = await L.importFiles(files, paint);
    } finally {
      hideProgress();
    }
    if (res.quota) toast('Your browser ran out of storage space for music. Free up disk space or remove some songs.', { kind: 'error', duration: 9000 });
    const parts = [];
    if (res.added) parts.push(`Added ${U.plural(res.added, 'song')}`);
    if (res.matched) parts.push(`${U.plural(res.matched, 'Spotify song')} now playable`);
    if (res.duplicates) parts.push(`${res.duplicates} already in your library`);
    if (res.unsupported) parts.push(`${res.unsupported} not playable in this browser`);
    if (res.failed) parts.push(`${res.failed} failed`);
    if (res.lyrics) parts.push(`lyrics added to ${U.plural(res.lyrics, 'song')}`);
    toast(parts.join(' · ') || 'Nothing new to add', {
      kind: res.added || res.matched || res.lyrics ? '' : 'error',
      duration: 5000,
      action: res.added && route.name !== 'library' ? { label: 'View', run: () => go('#/library') } : null,
    });
    if (res.added && navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
    }
  }

  // ================================================================ actions

  const A = {
    'play-row': (b) => playRow(b.closest('[data-list]')),
    'like': (b) => {
      const id = b.closest('[data-id]').dataset.id;
      const on = L.toggleLike(id);
      toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs');
      UI.syncLikes();
      if (id === P.current) syncLike();
    },
    'like-current': () => {
      if (!P.current) return;
      const on = L.toggleLike(P.current);
      syncLike();
      UI.syncLikes();
      toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    },
    'row-menu': (b) => {
      const row = b.closest('.tr');
      if (!isSelected(row)) selectRow(row, {});
      rowMenu(row, 0, 0, b);
    },
    'play-ctx': (b) => playCtx(b.dataset.type, b.dataset.id),
    'shuffle-ctx': (b) => playCtx(b.dataset.type, b.dataset.id, true),
    'ctx-menu': (b) => ctxMenu(b.dataset.type, b.dataset.id, null, b),
    'sort': (b) => { UI.setSort(b.dataset.list, b.dataset.by); render(true); },

    'toggle': () => playSomething(),
    'next': () => P.next(),
    'prev': () => P.prev(),
    'shuffle': () => P.toggleShuffle(),
    'repeat': () => P.cycleRepeat(),
    'mute': () => P.toggleMute(),

    'toggle-queue': () => {
      if (!el.full.hidden) closeFull();
      toggleRight('queue');
    },
    'show-lyrics': () => openFull(true),
    'right-tab': (b) => toggleRight(b.dataset.tab, true),
    'close-right': () => toggleRight(null, false),
    'open-full': () => openFull(),
    'open-full-mobile': () => { if (!isMobile() || !P.current) return false; openFull(); return true; },
    'close-full': () => closeFull(),
    'toggle-full-lyrics': () => setFullLyrics(!fullLyricsOn),
    'full-queue': () => { closeFull(); toggleRight('queue', true); },
    'sleep-menu': (b) => sleepMenu(b),
    'current-menu': (b) => { if (P.current) trackMenu([P.current], { anchor: b }); },
    'edit-current': () => { if (P.current) editTrack(P.current); },
    'edit-lyrics-current': () => { if (P.current) editLyrics(P.current); },
    'lyric-seek': (b) => { P.seek(parseFloat(b.dataset.t)); if (!P.playing) P.play(); },

    'q-play': (b) => { if (b.dataset.kind === 'queue') P.playQueueItem(+b.dataset.i); else P.playContextItem(+b.dataset.i); },
    'q-remove': (b) => P.removeFromQueue(+b.dataset.i),
    'clear-queue': () => P.clearQueue(),

    'new-playlist': () => newPlaylist(),
    'rename-playlist': () => editPlaylist(route.args[0]),
    'import-menu': (b) => importMenu(b),
    'import-files': () => el.fileInput.click(),
    'import-folder': () => el.folderInput.click(),
    'install': async () => {
      if (!installEvent) return;
      installEvent.prompt();
      try { await installEvent.userChoice; } catch (e) { /* ignore */ }
      installEvent = null;
      $('#install-btn').hidden = true;
    },

    'sp-copy': (b) => {
      const text = b.dataset.text;
      const done = () => toast('Copied');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text));
      else toast(text);
    },
    'sp-disconnect': () => { F.spotify.disconnect(); toast('Disconnected from Spotify'); render(true); },
    'sp-import': () => runSpotifyImport(),
    'sp-export-files': () => { const i = $('#sp-export-input'); if (i) i.click(); },
    'art-find': () => findArtwork(),
    'toggle-local-only': () => { F.settings.localOnly = !F.settings.localOnly; store.set('localOnly', F.settings.localOnly); render(true); },

    'back': () => history.back(),
    'forward': () => history.forward(),
    'lib-filter': (b) => { F.settings.libFilter = b.dataset.filter; store.set('libFilter', b.dataset.filter); renderSidebar(); },
    'collection-filter': (b) => { V.collectionFilter = b.dataset.filter; render(true); },
    'accent': (b) => { applyAccent(b.dataset.value); render(true); },
    'persist': async () => {
      if (!navigator.storage || !navigator.storage.persist) { toast('This browser does not support protected storage.'); return; }
      const ok = await navigator.storage.persist();
      toast(ok ? 'Your library is protected.' : 'The browser said no. Installing Freeify as an app usually helps.');
      render(true);
    },
    'wipe': async () => {
      const ok = await UI.confirm('Remove all music?', 'This deletes every song, playlist and like stored by Freeify in this browser. Your original files are not touched.', 'Remove everything', true);
      if (!ok) return;
      P.pause();
      await L.wipe();
      location.hash = '#/home';
      location.reload();
    },
  };

  function onClick(e) {
    if (e.button && e.button !== 0) return;
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled) {
      const fn = A[actEl.dataset.act];
      if (fn) {
        const r = fn(actEl, e);
        if (r !== false) { e.preventDefault(); e.stopPropagation(); }
        if (r !== false) return;
      }
    }
    const row = e.target.closest('.tr[data-list]');
    if (row && !e.target.closest('a, button')) {
      if (isTouch() || isMobile()) playRow(row); else selectRow(row, e);
      return;
    }
    const card = e.target.closest('.track-card[data-list], .top-result[data-list]');
    if (card && !e.target.closest('a, button')) { playRow(card); return; }
    if (!e.target.closest('.menu, dialog, .player, .right')) clearSelection();
  }

  function onDblClick(e) {
    const row = e.target.closest('.tr[data-list]');
    if (row && !e.target.closest('a, button')) { e.preventDefault(); playRow(row); }
  }

  function onContextMenu(e) {
    const row = e.target.closest('.tr[data-list]');
    if (row) {
      e.preventDefault();
      if (!isSelected(row)) selectRow(row, {});
      rowMenu(row, e.clientX, e.clientY);
      return;
    }
    const tc = e.target.closest('.track-card[data-id], .q-item[data-id], .top-result[data-id]');
    if (tc) { e.preventDefault(); trackMenu([tc.dataset.id], { x: e.clientX, y: e.clientY }); return; }
    const card = e.target.closest('[data-ctx-type]');
    if (card) { e.preventDefault(); ctxMenu(card.dataset.ctxType, card.dataset.ctxId, { x: e.clientX, y: e.clientY }); }
  }

  function onKey(e) {
    if (e.defaultPrevented) return;
    if (el.dialog.open || !$('#menu').hidden) return;
    const typing = U.isTyping(e.target);
    if (e.key === 'Escape') {
      if (!el.full.hidden) { closeFull(); return; }
      if (typing) { e.target.blur(); return; }
      clearSelection();
      return;
    }
    if (typing) return;
    if (e.target && e.target.type === 'range' && /^(Arrow|Home|End|Page)/.test(e.key)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && k === 'a') {
      const key = sel.list || ($('.tr[data-list]') || {}).dataset?.list;
      if (!key) return;
      e.preventDefault();
      const reg = UI.lists.get(key);
      sel = { list: key, idxs: new Set(U.range(reg.ids.length)), anchor: 0 };
      paintSelection();
      return;
    }
    if (mod && k === 'k') { e.preventDefault(); focusSearch(); return; }
    if (mod || e.altKey) return;
    const onControl = e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName);
    switch (k) {
      case ' ':
        if (onControl) return;
        e.preventDefault(); playSomething(); break;
      case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) P.prev(); else P.seekBy(-5); break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) P.next(); else P.seekBy(5); break;
      case 'ArrowUp': if (e.shiftKey) { e.preventDefault(); P.setVolume(P.volume + 0.05); } break;
      case 'ArrowDown': if (e.shiftKey) { e.preventDefault(); P.setVolume(P.volume - 0.05); } break;
      case 'm': P.toggleMute(); break;
      case 's': P.toggleShuffle(); toast(P.shuffle ? 'Shuffle on' : 'Shuffle off'); break;
      case 'r': P.cycleRepeat(); toast(P.repeat === 'off' ? 'Repeat off' : P.repeat === 'all' ? 'Repeat all' : 'Repeat one'); break;
      case 'l': A['like-current'](); break;
      case 'q': A['toggle-queue'](); break;
      case 'f': if (el.full.hidden) openFull(); else closeFull(); break;
      case '/': e.preventDefault(); focusSearch(); break;
      case '?': showShortcuts(); break;
      case 'Enter': {
        if (onControl || !sel.list || !sel.idxs.size) return;
        const reg = UI.lists.get(sel.list);
        const first = Math.min(...sel.idxs);
        if (reg) P.playContext(reg.ids, first, reg.ctx);
        break;
      }
      case 'Delete': case 'Backspace': {
        if (!sel.list || !sel.idxs.size) return;
        const reg = UI.lists.get(sel.list);
        if (!reg || !reg.playlistId) return;
        e.preventDefault();
        const idxs = [...sel.idxs].map((i) => reg.origIdx[i]);
        L.removeFromPlaylist(reg.playlistId, idxs);
        toast(idxs.length > 1 ? `Removed ${idxs.length} songs` : 'Removed from playlist');
        break;
      }
      default: break;
    }
  }

  function focusSearch() {
    if (route.name !== 'search') go('#/search');
    requestAnimationFrame(() => { el.search.focus(); el.search.select(); });
  }

  // ================================================================ drag & drop

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  function bindDrop() {
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || drag) return;
      e.preventDefault();
      depth++;
      el.drop.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e) || drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e) || drag) return;
      depth--;
      if (depth <= 0) { depth = 0; el.drop.hidden = true; }
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e) || drag) return;
      e.preventDefault();
      depth = 0;
      el.drop.hidden = true;
      filesFromDataTransfer(e.dataTransfer).then(importFiles);
    });

    // Dragging songs onto playlists / Liked Songs, and reordering playlists.
    const clearMarks = () => $$('.drop-target, .drop-before, .drop-after').forEach((x) => x.classList.remove('drop-target', 'drop-before', 'drop-after'));
    document.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.tr[data-list]');
      if (!row) return;
      if (!isSelected(row)) selectRow(row, {});
      const { ids, idxs } = selectionFor(row);
      drag = { ids, idxs, list: row.dataset.list };
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/x-freeify-tracks', JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', ids.map((id) => (L.get(id) || {}).title).join('\n'));
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = ids.length > 1 ? `${ids.length} songs` : (L.get(ids[0]) || {}).title || '';
      document.body.appendChild(ghost);
      try { e.dataTransfer.setDragImage(ghost, 14, 14); } catch (err) { /* ignore */ }
      setTimeout(() => ghost.remove(), 0);
      document.body.classList.add('dragging-tracks');
    });
    document.addEventListener('dragend', () => {
      drag = null;
      document.body.classList.remove('dragging-tracks');
      clearMarks();
    });
    document.addEventListener('dragover', (e) => {
      if (!drag) return;
      clearMarks();
      const target = e.target.closest('[data-drop]');
      if (target) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; target.classList.add('drop-target'); return; }
      const row = e.target.closest('.tr[data-list]');
      if (row && row.dataset.list === drag.list) {
        const reg = UI.lists.get(row.dataset.list);
        if (reg && reg.reorderable) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const r = row.getBoundingClientRect();
          row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
        }
      }
    });
    document.addEventListener('drop', (e) => {
      if (!drag) return;
      const d = drag;
      const target = e.target.closest('[data-drop]');
      const row = e.target.closest('.tr[data-list]');
      e.preventDefault();
      clearMarks();
      if (target) {
        const [type, id] = target.dataset.drop.split(':');
        if (type === 'liked') { L.setLiked(d.ids, true); toast('Added to Liked Songs'); }
        else {
          const p = L.playlist(id);
          const n = L.addToPlaylist(id, d.ids);
          if (p) toast(n ? `Added to ${p.name}` : `Already in ${p.name}`);
        }
      } else if (row && row.dataset.list === d.list) {
        const reg = UI.lists.get(row.dataset.list);
        if (reg && reg.reorderable) {
          const r = row.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          const to = reg.origIdx[+row.dataset.idx] + (after ? 1 : 0);
          L.movePlaylistTracks(reg.playlistId, d.idxs.map((i) => reg.origIdx[i]), to);
        }
      }
      drag = null;
    });
  }

  // ================================================================ boot

  function bindStatic() {
    document.addEventListener('click', onClick);
    document.addEventListener('dblclick', onDblClick);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKey);
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-form="sp-connect"]');
      if (!form) return;
      e.preventDefault();
      F.spotify.connect(form.elements.client.value).catch((err) => toast(err.message, { kind: 'error', duration: 6000 }));
    });
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'sp-export-input') {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (files.length) importJsonFiles(files);
      }
    });
    window.addEventListener('hashchange', () => {
      parseRoute();
      render();
      if (route.name === 'search' && !isTouch()) el.search.focus({ preventScroll: true });
      UI.closeMenu();
      if (!el.full.hidden) closeFull();
      if (isMobile() && !el.right.hidden) toggleRight(null, false);
    });
    el.main.addEventListener('scroll', onScroll, { passive: true });

    el.search.addEventListener('input', U.debounce(() => {
      const q = el.search.value.trim();
      history.replaceState(null, '', '#/search' + (q ? '/' + encodeURIComponent(q) : ''));
      parseRoute();
      render();
    }, 140));
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('.search-page .tr[data-list]');
        if (first) playRow(first);
      }
    });

    $$('.js-seek').forEach((r) => {
      const preview = () => {
        seeking = true;
        const t = (r.value / 1000) * P.duration;
        r.style.setProperty('--p', r.value / 10 + '%');
        $$('.js-cur').forEach((x) => { x.textContent = U.fmtTime(t); });
      };
      r.addEventListener('input', preview);
      r.addEventListener('change', () => { seeking = false; P.seek((r.value / 1000) * P.duration); });
      r.addEventListener('pointerup', () => { setTimeout(() => { seeking = false; }, 50); });
    });
    $$('.js-vol').forEach((r) => r.addEventListener('input', () => P.setVolume(parseFloat(r.value))));
    $$('.js-vol').forEach((r) => r.addEventListener('wheel', (e) => { e.preventDefault(); P.setVolume(P.volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false }));

    el.fileInput.addEventListener('change', () => { const f = Array.from(el.fileInput.files || []); el.fileInput.value = ''; importFiles(f); });
    el.folderInput.addEventListener('change', () => { const f = Array.from(el.folderInput.files || []); el.folderInput.value = ''; importFiles(f); });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installEvent = e;
      $('#install-btn').hidden = false;
    });
    window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; toast('Freeify installed. Enjoy!'); });

    // Swipe down to close the full-screen player on touch devices.
    let startY = null;
    el.full.addEventListener('touchstart', (e) => { if (!e.target.closest('.range, .full-lyrics')) startY = e.touches[0].clientY; }, { passive: true });
    el.full.addEventListener('touchend', (e) => {
      if (startY != null && e.changedTouches[0].clientY - startY > 120) closeFull();
      startY = null;
    });

    bindDrop();
  }

  /** Extra behaviour when running inside the Android / iPhone app. */
  function bindNativeShell() {
    const cap = window.Capacitor;
    const AppPlugin = cap && cap.Plugins && cap.Plugins.App;
    if (!AppPlugin || !AppPlugin.addListener) return;
    document.documentElement.classList.add('native-app');
    AppPlugin.addListener('backButton', (ev) => {
      if (!$('#menu').hidden) { UI.closeMenu(); return; }
      if (el.dialog.open) { el.dialog.close(); return; }
      if (!el.full.hidden) { closeFull(); return; }
      if (!el.right.hidden && isMobile()) { toggleRight(null, false); return; }
      if (ev && ev.canGoBack !== false && history.length > 1 && route.name !== 'home') history.back();
      else if (AppPlugin.minimizeApp) AppPlugin.minimizeApp(); else if (AppPlugin.exitApp) AppPlugin.exitApp();
    });
  }

  function fatal(msg) {
    document.getElementById('view').innerHTML = `<div class="page"><div class="empty-state">${ic('note')}<h3>Freeify can't start</h3><p>${esc(msg)}</p></div></div>`;
  }

  async function boot() {
    F.hydrateIcons(document);
    el = {
      app: $('#app'), view: $('#view'), main: $('#main-scroll'), topCtx: $('#topbar-ctx'), topSearch: $('#topbar-search'),
      search: $('#search-input'), libList: $('#lib-list'), libChips: $('#lib-chips'), right: $('#right'), rightBody: $('#right-body'),
      full: $('#full'), fullBg: $('#full-bg'), fullCtx: $('#full-ctx'), fullLyrics: $('#full-lyrics'), drop: $('#dropzone'),
      importCard: $('#import-card'), fileInput: $('#file-input'), folderInput: $('#folder-input'), dialog: $('#dialog'),
    };
    applyAccent(F.settings.accent);

    P.on('track', syncTrack);
    P.on('state', syncState);
    P.on('time', syncTime);
    P.on('mode', syncMode);
    P.on('queue', renderRight);
    P.on('error', (m) => toast(m, { kind: 'error', duration: 5000 }));
    P.on('sleep', () => toast('Sleep timer finished. Good night!'));

    try {
      await L.init();
    } catch (e) {
      console.error(e);
      fatal('This browser blocked local storage (IndexedDB). Private browsing modes sometimes do this; try a normal window. ' + (e.message || ''));
      return;
    }

    L.on(() => {
      renderSidebar();
      render(true);
      renderRight();
      if (P.current && !L.get(P.current)) P.purge(new Set([P.current]));
      syncLike();
    });

    const signIn = await F.spotify.handleRedirect();
    parseRoute();
    renderSidebar();
    render();
    bindStatic();
    if (signIn) toast(signIn.message, { kind: signIn.ok ? '' : 'error', duration: 6000 });
    syncMode();
    try { await P.restore(); } catch (e) { console.warn('[freeify] could not restore player', e); }
    syncTrack();
    syncMode();
    if (F.settings.rightOpen && !isMobile()) toggleRight(F.settings.rightTab, true);
    document.body.classList.add('ready');

    bindNativeShell();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[freeify] service worker not registered', e));
    }
  }

  F.app = { importFiles, render, route: () => route };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.Freeify = window.Freeify || {});
