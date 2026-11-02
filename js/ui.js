/* Freeify: reusable UI pieces (covers, track lists, cards, menus, dialogs, toasts). */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const ic = F.icon;
  const esc = U.esc;

  const UI = {};
  const lists = new Map();      // list key -> { ids, ctx, origIdx, playlistId, sortable }
  const sortState = new Map();  // list key -> { by, dir }
  UI.lists = lists;
  UI.sortState = sortState;

  // ---------------------------------------------------------------- contexts

  /** Describe a playable collection: liked, library, playlist, album, artist, genre. */
  UI.ctx = function (type, id) {
    switch (type) {
      case 'liked': {
        const ids = L.liked();
        return { type, id: 'liked', name: 'Liked Songs', kind: 'Playlist', sub: `Playlist · ${U.plural(ids.length, 'song')}`, href: '#/liked', ids, color: 'hsl(250 55% 42%)', cover: (cls) => UI.special('liked', cls) };
      }
      case 'library': {
        const ids = L.byAdded();
        return { type, id: 'library', name: 'Your Music', kind: 'Collection', sub: `All songs · ${U.plural(ids.length, 'song')}`, href: '#/library', ids, color: 'hsl(160 45% 26%)', cover: (cls) => UI.special('library', cls) };
      }
      case 'playlist': {
        const p = L.playlist(id);
        if (!p) return null;
        return { type, id, name: p.name, kind: 'Playlist', sub: `Playlist · ${U.plural(p.trackIds.length, 'song')}`, href: `#/playlist/${id}`, ids: p.trackIds.slice(), color: playlistColor(p), cover: (cls) => UI.mosaic(p.trackIds, p.id, cls) };
      }
      case 'album': {
        const a = L.album(id);
        if (!a) return null;
        return { type, id, name: a.name, kind: 'Album', sub: `Album · ${a.artist}`, href: `#/album/${id}`, ids: a.trackIds.slice(), color: L.coverColor(a.coverId) || U.seedColor(a.name), cover: (cls) => UI.cover(a.coverId, a.name, cls, 'disc') };
      }
      case 'artist': {
        const a = L.artist(id);
        if (!a) return null;
        return { type, id, name: a.name, kind: 'Artist', sub: 'Artist', href: `#/artist/${id}`, ids: a.trackIds.slice(), color: L.coverColor(a.coverId) || U.seedColor(a.name), cover: (cls) => UI.cover(a.coverId, a.name, (cls || '') + ' round', 'user'), round: true };
      }
      case 'genre': {
        const g = L.genre(id);
        if (!g) return null;
        return { type, id: g.id, name: g.name, kind: 'Genre', sub: `Genre · ${U.plural(g.trackIds.length, 'song')}`, href: `#/genre/${g.id}`, ids: g.trackIds.slice(), color: U.seedColor(g.name), cover: (cls) => UI.cover(g.coverId, g.name, cls) };
      }
      default: return null;
    }
  };

  function playlistColor(p) {
    for (const id of p.trackIds) {
      const t = L.get(id);
      if (t && t.coverId) return L.coverColor(t.coverId) || U.seedColor(p.id);
    }
    return U.seedColor(p.id);
  }

  UI.ctxRef = (c) => (c ? { type: c.type, id: c.id, name: c.name, href: c.href } : null);

  // ---------------------------------------------------------------- covers

  UI.cover = function (coverId, seed, cls, phIcon) {
    const url = L.coverUrl(coverId);
    if (url) return `<div class="cover ${cls || ''}"><img src="${url}" alt="" loading="lazy" decoding="async" draggable="false"></div>`;
    return `<div class="cover ph ${cls || ''}" style="background:${U.gradient(seed)}">${ic(phIcon || 'note')}</div>`;
  };

  UI.trackCover = function (t, cls) {
    return t ? UI.cover(t.coverId, t.album || t.title, cls) : UI.cover(null, 'none', cls);
  };

  UI.mosaic = function (ids, seed, cls) {
    const seen = [];
    for (const id of ids) {
      const t = L.get(id);
      if (t && t.coverId && !seen.includes(t.coverId)) seen.push(t.coverId);
      if (seen.length === 4) break;
    }
    if (seen.length === 4) {
      return `<div class="cover mosaic ${cls || ''}">${seen.map((c) => `<img src="${L.coverUrl(c)}" alt="" loading="lazy" draggable="false">`).join('')}</div>`;
    }
    if (seen.length) return UI.cover(seen[0], seed, cls);
    return `<div class="cover ph ${cls || ''}" style="background:${U.gradient(seed)}">${ic('playlist')}</div>`;
  };

  UI.special = function (kind, cls) {
    if (kind === 'liked') return `<div class="cover special liked ${cls || ''}">${ic('heart-fill')}</div>`;
    return `<div class="cover special library ${cls || ''}">${ic('note')}</div>`;
  };

  // ---------------------------------------------------------------- track list

  const SORTERS = {
    title: (a, b) => U.cmp(a.title, b.title),
    artist: (a, b) => U.cmp(a.artist, b.artist) || U.cmp(a.album, b.album) || (a.trackNo - b.trackNo),
    album: (a, b) => U.cmp(a.album, b.album) || (a.discNo - b.discNo) || (a.trackNo - b.trackNo),
    addedAt: (a, b) => a.addedAt - b.addedAt,
    likedAt: (a, b) => a.likedAt - b.likedAt,
    duration: (a, b) => a.duration - b.duration,
    plays: (a, b) => (a.playCount || 0) - (b.playCount || 0),
  };

  function headerCell(key, by, label, o, cls) {
    if (o.sortable === false) return `<div class="th ${cls || ''}">${label}</div>`;
    const s = sortState.get(key);
    const active = s && s.by === by;
    const arrow = active ? ic(s.dir > 0 ? 'arrow-up' : 'arrow-down', 'sort-arrow') : '';
    return `<button class="th ${cls || ''}${active ? ' active' : ''}" data-act="sort" data-list="${esc(key)}" data-by="${by}">${label}${arrow}</button>`;
  }

  /**
   * Render a track table.
   * o: { ctx, album: bool, date: 'addedAt'|'likedAt'|null, cover: bool, number: 'index'|'track',
   *      sortable: bool, playlistId, header: bool, limit, artistLink: bool }
   */
  UI.trackList = function (key, ids, o) {
    o = Object.assign({ album: true, date: null, cover: true, number: 'index', sortable: true, header: true, artist: true }, o || {});
    let rows = ids.map((id, i) => ({ id, i, t: L.get(id) })).filter((r) => r.t);
    const s = o.sortable !== false ? sortState.get(key) : null;
    if (s && SORTERS[s.by]) rows.sort((a, b) => SORTERS[s.by](a.t, b.t) * s.dir || a.i - b.i);
    if (o.limit) rows = rows.slice(0, o.limit);
    lists.set(key, {
      ids: rows.map((r) => r.id),
      origIdx: rows.map((r) => r.i),
      ctx: o.ctx || null,
      playlistId: o.playlistId || null,
      reorderable: !!o.playlistId && !s,
    });
    if (!rows.length) return o.empty || '';
    const cls = ['tl', o.album ? 'tl-album' : '', o.date ? 'tl-date' : '', o.cover ? '' : 'tl-nocover'].join(' ');
    const head = o.header ? `<div class="tr th-row">
        <div class="th num">#</div>
        ${headerCell(key, 'title', 'Title', o, 'col-title')}
        ${o.album ? headerCell(key, 'album', 'Album', o, 'col-album') : ''}
        ${o.date ? headerCell(key, o.date, o.date === 'likedAt' ? 'Date liked' : 'Date added', o, 'col-date') : ''}
        ${o.sortable !== false ? `<button class="th col-dur${s && s.by === 'duration' ? ' active' : ''}" data-act="sort" data-list="${esc(key)}" data-by="duration" aria-label="Sort by duration">${ic('clock')}</button>` : `<div class="th col-dur">${ic('clock')}</div>`}
      </div>` : '';
    const body = rows.map((r, idx) => row(key, r.t, idx, o)).join('');
    return `<div class="${cls}" data-list-key="${esc(key)}">${head}<div class="tbody">${body}</div></div>`;
  };

  function row(key, t, idx, o) {
    const albumId = L.albumIdOf(t);
    const artistId = L.artistIdOf(t);
    const num = o.number === 'track' ? (t.trackNo || idx + 1) : idx + 1;
    const artist = t.artist || 'Unknown artist';
    const artistHtml = o.artist ? `<a class="sub-link" href="#/artist/${artistId}" draggable="false">${esc(artist)}</a>` : '';
    return `<div class="tr" data-list="${esc(key)}" data-idx="${idx}" data-id="${t.id}" draggable="true">
      <div class="td num"><span class="n">${num}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><button class="row-play" data-act="play-row" aria-label="Play ${esc(t.title)}">${ic('play')}</button></div>
      <div class="td col-title">${o.cover ? UI.trackCover(t, 'sm') : ''}<div class="t-meta"><div class="t-title">${esc(t.title)}</div>${artistHtml ? `<div class="t-sub">${artistHtml}</div>` : ''}</div></div>
      ${o.album ? `<div class="td col-album">${albumId ? `<a class="sub-link" href="#/album/${albumId}" draggable="false">${esc(t.album)}</a>` : ''}</div>` : ''}
      ${o.date ? `<div class="td col-date">${esc(U.fmtDate(t[o.date]))}</div>` : ''}
      <div class="td col-dur">
        <button class="icon-btn like${t.likedAt ? ' on' : ''}" data-act="like" aria-label="${t.likedAt ? 'Remove from' : 'Save to'} Liked Songs">${ic(t.likedAt ? 'heart-fill' : 'heart')}</button>
        <span class="dur">${U.fmtTime(t.duration)}</span>
        <button class="icon-btn row-more" data-act="row-menu" aria-label="More options for ${esc(t.title)}">${ic('more')}</button>
      </div>
    </div>`;
  }

  UI.setSort = function (key, by) {
    const s = sortState.get(key);
    if (!s || s.by !== by) sortState.set(key, { by, dir: by === 'addedAt' || by === 'likedAt' || by === 'plays' ? -1 : 1 });
    else if ((s.dir === 1) !== (by === 'addedAt' || by === 'likedAt' || by === 'plays')) sortState.set(key, { by, dir: -s.dir });
    else sortState.delete(key);
  };

  // ---------------------------------------------------------------- cards

  /** Card for a collection (album / artist / playlist / liked / library / genre). */
  UI.ctxCard = function (c, sub) {
    if (!c) return '';
    return `<a class="card" href="${c.href}" data-ctx-type="${c.type}" data-ctx-id="${esc(c.id)}">
      <div class="card-art">${c.cover(c.round ? 'round' : '')}
        <button class="card-play js-ctx-play" data-act="play-ctx" data-type="${c.type}" data-id="${esc(c.id)}" data-ctx="${c.type}:${esc(c.id)}" aria-label="Play ${esc(c.name)}">${ic('play')}</button>
      </div>
      <div class="card-title">${esc(c.name)}</div>
      <div class="card-sub">${esc(sub != null ? sub : c.sub)}</div>
    </a>`;
  };

  /** Card for one track that plays within a registered list. */
  UI.trackCard = function (key, t, idx) {
    return `<div class="card track-card" data-list="${esc(key)}" data-idx="${idx}" data-id="${t.id}">
      <div class="card-art">${UI.trackCover(t)}
        <button class="card-play" data-act="play-row" aria-label="Play ${esc(t.title)}">${ic('play')}</button>
      </div>
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-sub">${esc(t.artist || 'Unknown artist')}</div>
    </div>`;
  };

  UI.registerList = function (key, ids, ctx) {
    lists.set(key, { ids: ids.slice(), origIdx: ids.map((_, i) => i), ctx: ctx || null });
  };

  UI.shelf = function (title, href, cards, opts) {
    if (!cards.length) return '';
    return `<section class="shelf${opts && opts.grid ? ' grid' : ''}">
      <header class="shelf-head"><h2>${href ? `<a href="${href}">${esc(title)}</a>` : esc(title)}</h2>${href ? `<a class="show-all" href="${href}">Show all</a>` : ''}</header>
      <div class="cards">${cards.join('')}</div>
    </section>`;
  };

  UI.hero = function (o) {
    return `<section class="hero">
      <div class="hero-art">${o.cover}</div>
      <div class="hero-info">
        <div class="hero-kind">${esc(o.kind || '')}</div>
        <h1 class="hero-title${o.editable ? ' editable' : ''}"${o.editable ? ` data-act="${o.editable}" title="Click to rename"` : ''}>${esc(o.title)}</h1>
        ${o.description ? `<p class="hero-desc">${esc(o.description)}</p>` : ''}
        <div class="hero-meta">${o.meta || ''}</div>
      </div>
    </section>`;
  };

  UI.actionBar = function (ctxType, ctxId, extra) {
    const key = `${ctxType}:${ctxId}`;
    return `<div class="action-bar">
      <button class="play-btn big js-ctx-play" data-act="play-ctx" data-type="${ctxType}" data-id="${esc(ctxId)}" data-ctx="${esc(key)}" aria-label="Play">${ic('play')}</button>
      <button class="icon-btn big" data-act="shuffle-ctx" data-type="${ctxType}" data-id="${esc(ctxId)}" aria-label="Shuffle play" title="Shuffle play">${ic('shuffle')}</button>
      ${extra || ''}
      <button class="icon-btn big" data-act="ctx-menu" data-type="${ctxType}" data-id="${esc(ctxId)}" aria-label="More options">${ic('more')}</button>
    </div>`;
  };

  // ---------------------------------------------------------------- playing indicators

  UI.syncPlaying = function () {
    const cur = F.player.current;
    const playing = F.player.playing;
    const ctxKey = F.player.ctxKey;
    U.$$('.tr[data-id], .q-item[data-id]').forEach((el) => {
      const is = el.dataset.id === cur;
      el.classList.toggle('playing', is);
      el.classList.toggle('paused', is && !playing);
    });
    U.$$('.js-ctx-play').forEach((btn) => {
      const active = btn.dataset.ctx === ctxKey && playing;
      btn.innerHTML = ic(active ? 'pause' : 'play');
      btn.setAttribute('aria-label', active ? 'Pause' : 'Play');
      btn.classList.toggle('active', btn.dataset.ctx === ctxKey);
    });
    U.$$('.lib-item[data-ctx]').forEach((el) => {
      el.classList.toggle('now', el.dataset.ctx === ctxKey);
      el.classList.toggle('now-playing', el.dataset.ctx === ctxKey && playing);
    });
  };

  UI.syncLikes = function () {
    U.$$('.tr[data-id] .like').forEach((btn) => {
      const t = L.get(btn.closest('.tr').dataset.id);
      const on = !!(t && t.likedAt);
      btn.classList.toggle('on', on);
      btn.innerHTML = ic(on ? 'heart-fill' : 'heart');
    });
  };

  // ---------------------------------------------------------------- toasts

  UI.toast = function (msg, opts) {
    opts = opts || {};
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.kind ? ' ' + opts.kind : '');
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button class="toast-action">${esc(opts.action.label)}</button>` : ''}`;
    if (opts.action) el.querySelector('.toast-action').addEventListener('click', () => { opts.action.run(); dismiss(); });
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    setTimeout(dismiss, opts.duration || 3200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  // ---------------------------------------------------------------- context menu

  let menuCleanup = null;

  /** items: [{ label, icon, run, danger, disabled, sep, checked }] */
  UI.menu = function (x, y, items, anchor) {
    UI.closeMenu();
    const el = document.getElementById('menu');
    el.innerHTML = items.map((it, i) => {
      if (it.sep) return '<div class="menu-sep" role="separator"></div>';
      if (it.heading) return `<div class="menu-heading">${esc(it.heading)}</div>`;
      return `<button class="menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>
        ${ic(it.checked ? 'check' : (it.icon || 'note'), it.icon || it.checked ? '' : 'invisible')}<span>${esc(it.label)}</span></button>`;
    }).join('');
    el.hidden = false;
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    if (anchor) {
      const a = anchor.getBoundingClientRect();
      x = a.right - r.width; y = a.bottom + 6;
      if (x < 8) x = a.left;
      if (y + r.height > vh - 8) y = a.top - r.height - 6;
    }
    el.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';
    const first = el.querySelector('.menu-item:not([disabled])');
    if (first) first.focus({ preventScroll: true });

    const onClick = (e) => {
      const btn = e.target.closest('.menu-item');
      if (btn && el.contains(btn)) {
        const it = items[+btn.dataset.i];
        UI.closeMenu();
        if (it && it.run) it.run();
        return;
      }
      if (!el.contains(e.target)) UI.closeMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); UI.closeMenu(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = U.$$('.menu-item:not([disabled])', el);
        const i = btns.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        if (btns[n]) btns[n].focus();
      }
    };
    const onScroll = (e) => { if (!el.contains(e.target)) UI.closeMenu(); };
    setTimeout(() => {
      document.addEventListener('click', onClick, true);
      document.addEventListener('contextmenu', onClick, true);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', UI.closeMenu);
    document.addEventListener('scroll', onScroll, true);
    menuCleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', UI.closeMenu);
      document.removeEventListener('scroll', onScroll, true);
    };
  };

  UI.closeMenu = function () {
    const el = document.getElementById('menu');
    if (el) el.hidden = true;
    if (menuCleanup) { menuCleanup(); menuCleanup = null; }
  };

  // ---------------------------------------------------------------- dialogs

  function openDialog(html, onReady) {
    const dlg = document.getElementById('dialog');
    return new Promise((resolve) => {
      dlg.innerHTML = html;
      let result = null;
      const finish = (value) => { result = value; dlg.close(); };
      const onClose = () => { dlg.removeEventListener('close', onClose); dlg.innerHTML = ''; resolve(result); };
      dlg.addEventListener('close', onClose);
      dlg.addEventListener('click', function backdrop(e) {
        if (e.target === dlg) { dlg.removeEventListener('click', backdrop); finish(null); }
      });
      U.$$('[data-dlg="cancel"]', dlg).forEach((b) => b.addEventListener('click', () => finish(null)));
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      onReady(dlg, finish);
    });
  }

  UI.prompt = function (title, value, opts) {
    opts = opts || {};
    return openDialog(`<form class="dlg" method="dialog">
        <h2>${esc(title)}</h2>
        <input class="input" name="v" value="${esc(value || '')}" placeholder="${esc(opts.placeholder || '')}" maxlength="200" autocomplete="off" required>
        ${opts.description != null ? `<textarea class="input" name="d" rows="3" placeholder="Add an optional description" maxlength="300">${esc(opts.description)}</textarea>` : ''}
        <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg="cancel">Cancel</button><button class="btn btn-primary" type="submit">${esc(opts.ok || 'Save')}</button></div>
      </form>`, (dlg, finish) => {
      const form = dlg.querySelector('form');
      const input = form.elements.v;
      input.focus(); input.select();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        finish(opts.description != null ? { name: v, description: form.elements.d.value.trim() } : v);
      });
    });
  };

  UI.confirm = function (title, message, ok, danger) {
    return openDialog(`<form class="dlg" method="dialog">
        <h2>${esc(title)}</h2><p>${esc(message)}</p>
        <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg="cancel">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(ok || 'OK')}</button></div>
      </form>`, (dlg, finish) => {
      const form = dlg.querySelector('form');
      form.querySelector('[type=submit]').focus();
      form.addEventListener('submit', (e) => { e.preventDefault(); finish(true); });
    }).then((r) => !!r);
  };

  /** Simple form dialog. fields: [{ name, label, value, type }] */
  UI.form = function (title, fields, ok) {
    return openDialog(`<form class="dlg wide" method="dialog">
        <h2>${esc(title)}</h2>
        <div class="fields">${fields.map((f) => `<label class="field${f.full ? ' full' : ''}"><span>${esc(f.label)}</span>${f.type === 'textarea'
          ? `<textarea class="input" name="${f.name}" rows="${f.rows || 6}" placeholder="${esc(f.placeholder || '')}">${esc(f.value)}</textarea>`
          : `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}</div>
        <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg="cancel">Cancel</button><button class="btn btn-primary" type="submit">${esc(ok || 'Save')}</button></div>
      </form>`, (dlg, finish) => {
      const form = dlg.querySelector('form');
      const first = form.querySelector('input, textarea');
      if (first) first.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const out = {};
        fields.forEach((f) => { out[f.name] = form.elements[f.name].value; });
        finish(out);
      });
    });
  };

  /** Pick a playlist (or create a new one). Resolves to a playlist id, 'new', or null. */
  UI.choosePlaylist = function (count) {
    const pls = L.playlists();
    return openDialog(`<div class="dlg">
        <h2>Add ${U.plural(count, 'song')} to playlist</h2>
        <div class="pick-list">
          <button class="pick new" data-pick="new"><div class="cover ph sm">${ic('plus')}</div><span>New playlist</span></button>
          ${pls.map((p) => `<button class="pick" data-pick="${p.id}">${UI.mosaic(p.trackIds, p.id, 'sm')}<span>${esc(p.name)}<small>${U.plural(p.trackIds.length, 'song')}</small></span></button>`).join('')}
        </div>
        <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg="cancel">Cancel</button></div>
      </div>`, (dlg, finish) => {
      U.$$('[data-pick]', dlg).forEach((b) => b.addEventListener('click', () => finish(b.dataset.pick)));
    });
  };

  UI.info = function (title, html) {
    return openDialog(`<div class="dlg wide"><h2>${esc(title)}</h2>${html}<div class="dlg-actions"><button type="button" class="btn btn-primary" data-dlg="cancel">Done</button></div></div>`, () => {});
  };

  F.ui = UI;
})(window.Freeify = window.Freeify || {});
