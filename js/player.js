/* Freeify: playback engine (context + user queue, shuffle, repeat, media keys). */
(function (F) {
  'use strict';

  const U = F.util;
  const L = F.library;
  const audio = new Audio();
  audio.preload = 'auto';

  const S = {
    context: null,   // { type, id, name, href }
    list: [],        // track ids in the playing context
    order: [],       // play order (indices into list)
    pos: -1,         // position in order
    queue: [],       // user "Add to queue" items, played before the context continues
    current: null,   // current track id
    fromQueue: false,
    shuffle: false,
    repeat: 'off',   // off | all | one
    volume: 0.8,
    muted: false,
  };

  const handlers = {};
  let objectUrl = null;
  let loadToken = 0;
  let counted = false;
  let errorStreak = 0;
  let sleepTimer = null;
  let sleepAtEnd = false;
  let sleepUntil = 0;

  function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  function emit(ev, data) { (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  // ---------------------------------------------------------------- persistence

  const saveState = U.debounce(() => {
    F.db.kvSet('player', {
      context: S.context, list: S.list, order: S.order, pos: S.pos, queue: S.queue,
      current: S.current, fromQueue: S.fromQueue, shuffle: S.shuffle, repeat: S.repeat,
      volume: S.volume, muted: S.muted,
    }).catch(() => {});
  }, 400);

  function saveTimeNow(t) {
    if (S.current) F.db.kvSet('playerTime', { id: S.current, time: t != null ? t : audio.currentTime || 0 }).catch(() => {});
  }
  const saveTime = U.throttle(() => saveTimeNow(), 4000);

  async function restore() {
    const [st, tm] = await Promise.all([F.db.kvGet('player'), F.db.kvGet('playerTime')]).catch(() => [null, null]);
    if (!st) { applyVolume(); return; }
    S.shuffle = !!st.shuffle;
    S.repeat = ['off', 'all', 'one'].includes(st.repeat) ? st.repeat : 'off';
    S.volume = typeof st.volume === 'number' ? st.volume : 0.8;
    S.muted = !!st.muted;
    applyVolume();
    S.context = st.context || null;
    S.list = Array.isArray(st.list) ? st.list : [];
    S.order = Array.isArray(st.order) && st.order.length === S.list.length ? st.order : U.range(S.list.length);
    S.pos = typeof st.pos === 'number' ? st.pos : -1;
    S.queue = Array.isArray(st.queue) ? st.queue : [];
    S.fromQueue = !!st.fromQueue;
    const missing = new Set([...S.list, ...S.queue].filter((id) => !L.get(id)));
    if (missing.size) purge(missing, true);
    if (st.current && L.get(st.current)) {
      await load(st.current, false, tm && tm.id === st.current ? tm.time : 0);
    }
    emit('mode');
    emit('queue');
  }

  // ---------------------------------------------------------------- loading

  async function load(id, autoplay, startAt) {
    const token = ++loadToken;
    const track = L.get(id);
    if (!track) { skipBroken(); return; }
    let blob = null;
    try { blob = await L.getFile(id); } catch (e) { console.error(e); }
    if (token !== loadToken) return;
    if (!blob) {
      emit('error', `The audio for “${track.title}” is missing.`);
      skipBroken();
      return;
    }
    const prevUrl = objectUrl;
    objectUrl = URL.createObjectURL(blob);
    S.current = id;
    counted = false;
    audio.src = objectUrl;
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    if (startAt > 0) {
      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 0.5));
      }, { once: true });
    }
    updateMediaSession(track);
    emit('track', track);
    saveState.flush();
    saveTimeNow(startAt > 0 ? startAt : 0);
    if (autoplay) {
      try { await audio.play(); } catch (e) {
        if (e.name !== 'AbortError') console.warn('[freeify] play() rejected:', e.message);
      }
    }
    emit('state');
  }

  function skipBroken() {
    errorStreak++;
    if (errorStreak > Math.min(8, Math.max(1, S.list.length + S.queue.length))) {
      errorStreak = 0;
      audio.pause();
      emit('error', 'Playback stopped: several tracks in a row could not be played.');
      emit('state');
      return;
    }
    setTimeout(() => next(false, true), 250);
  }

  // ---------------------------------------------------------------- transport

  function playContext(ids, start, context) {
    ids = (ids || []).filter((id) => L.get(id));
    if (!ids.length) return;
    S.list = ids.slice();
    S.context = context || null;
    S.fromQueue = false;
    errorStreak = 0;
    if (typeof start !== 'number' || start < 0 || start >= ids.length) start = S.shuffle ? Math.floor(Math.random() * ids.length) : 0;
    if (S.shuffle) {
      S.order = [start, ...U.shuffle(U.range(ids.length).filter((i) => i !== start))];
      S.pos = 0;
    } else {
      S.order = U.range(ids.length);
      S.pos = start;
    }
    if (context) L.addRecent(context);
    load(S.list[S.order[S.pos]], true);
    emit('queue');
  }

  function play() {
    if (!S.current) return false;
    audio.play().catch(() => {});
    return true;
  }

  function pause() { audio.pause(); }

  function toggle() {
    if (!S.current) return false;
    if (audio.paused) play(); else pause();
    return true;
  }

  function next(auto, fromError) {
    if (auto && S.repeat === 'one' && !fromError && S.current) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (S.queue.length) {
      const id = S.queue.shift();
      S.fromQueue = true;
      load(id, true);
      emit('queue');
      return;
    }
    S.fromQueue = false;
    if (!S.order.length) { audio.pause(); return; }
    if (S.pos + 1 < S.order.length) {
      S.pos++;
      load(S.list[S.order[S.pos]], true);
    } else {
      // End of the context.
      if (S.shuffle) S.order = U.shuffle(U.range(S.list.length));
      S.pos = 0;
      const keepPlaying = S.repeat !== 'off';
      load(S.list[S.order[S.pos]], keepPlaying);
    }
    emit('queue');
  }

  function prev() {
    if (audio.currentTime > 3 || (!S.order.length && S.current)) { seek(0); return; }
    if (S.fromQueue && S.pos >= 0) {
      S.fromQueue = false;
      load(S.list[S.order[S.pos]], true);
      emit('queue');
      return;
    }
    if (S.pos > 0) S.pos--;
    else if (S.repeat === 'all' && S.order.length) S.pos = S.order.length - 1;
    else { seek(0); return; }
    load(S.list[S.order[S.pos]], true);
    emit('queue');
  }

  function seek(t) {
    if (!S.current || !isFinite(t)) return;
    const d = audio.duration;
    audio.currentTime = Math.max(0, isFinite(d) ? Math.min(t, d - 0.05) : t);
    emit('time');
  }

  function seekBy(delta) { seek((audio.currentTime || 0) + delta); }

  // ---------------------------------------------------------------- modes

  function setShuffle(on) {
    S.shuffle = !!on;
    if (S.list.length && S.pos >= 0) {
      const cur = S.order[S.pos];
      if (S.shuffle) {
        S.order = [cur, ...U.shuffle(U.range(S.list.length).filter((i) => i !== cur))];
        S.pos = 0;
      } else {
        S.order = U.range(S.list.length);
        S.pos = cur;
      }
    }
    emit('mode'); emit('queue'); saveState();
  }

  function cycleRepeat() {
    S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
    emit('mode'); saveState();
  }

  function applyVolume() {
    // A squared curve feels more natural to the ear than a linear one.
    audio.volume = Math.max(0, Math.min(1, S.volume * S.volume));
    audio.muted = S.muted;
  }

  function setVolume(v) {
    S.volume = Math.max(0, Math.min(1, v));
    if (S.volume > 0) S.muted = false;
    applyVolume();
    emit('mode'); saveState();
  }

  function toggleMute() {
    if (S.muted || S.volume === 0) { S.muted = false; if (S.volume === 0) S.volume = 0.5; }
    else S.muted = true;
    applyVolume();
    emit('mode'); saveState();
  }

  function setSleep(minutes) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
    sleepAtEnd = false;
    sleepUntil = 0;
    if (minutes === 'end') sleepAtEnd = true;
    else if (minutes > 0) {
      sleepUntil = Date.now() + minutes * 60000;
      sleepTimer = setTimeout(() => { audio.pause(); sleepUntil = 0; emit('sleep'); emit('mode'); }, minutes * 60000);
    }
    emit('mode');
  }

  // ---------------------------------------------------------------- queue

  function addToQueue(ids) {
    S.queue.push(...ids.filter((id) => L.get(id)));
    if (!S.current && S.queue.length) { next(); return; }
    emit('queue'); saveState();
  }

  function playNext(ids) {
    S.queue.unshift(...ids.filter((id) => L.get(id)));
    if (!S.current && S.queue.length) { next(); return; }
    emit('queue'); saveState();
  }

  function removeFromQueue(i) { S.queue.splice(i, 1); emit('queue'); saveState(); }
  function clearQueue() { S.queue = []; emit('queue'); saveState(); }

  function playQueueItem(i) {
    S.queue.splice(0, i);
    next();
  }

  function playContextItem(p) {
    if (p < 0 || p >= S.order.length) return;
    S.pos = p;
    S.fromQueue = false;
    load(S.list[S.order[p]], true);
    emit('queue');
  }

  function upNext(limit) {
    const ctx = [];
    for (let p = S.pos + 1; p < S.order.length && ctx.length < (limit || 100); p++) ctx.push({ id: S.list[S.order[p]], pos: p });
    return { queue: S.queue.slice(), context: ctx, more: Math.max(0, S.order.length - S.pos - 1 - ctx.length) };
  }

  /** Remove deleted tracks from the playing context and queue. */
  function purge(set, silent) {
    S.queue = S.queue.filter((id) => !set.has(id));
    if (S.list.length) {
      const remap = new Map();
      const keep = [];
      S.list.forEach((id, i) => { if (!set.has(id)) { remap.set(i, keep.length); keep.push(id); } });
      let before = 0, found = false;
      for (let p = 0; p < S.order.length; p++) {
        if (!remap.has(S.order[p])) continue;
        if (p === S.pos) { found = true; break; }
        if (p > S.pos) break;
        before++;
      }
      S.order = S.order.filter((i) => remap.has(i)).map((i) => remap.get(i));
      S.list = keep;
      S.pos = found ? before : before - 1;
    }
    if (S.current && set.has(S.current)) {
      audio.pause();
      audio.removeAttribute('src');
      try { audio.load(); } catch (e) { /* ignore */ }
      S.current = null;
      if (navigator.mediaSession) navigator.mediaSession.metadata = null;
      emit('track', null);
    }
    if (!silent) { emit('queue'); emit('state'); saveState(); }
  }

  // ---------------------------------------------------------------- media session

  function updateMediaSession(t) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const url = L.coverUrl(t.coverId);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || '',
        album: t.album || '',
        artwork: url ? [{ src: url, sizes: '512x512' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch (e) { /* ignore */ }
  }

  const positionState = U.throttle(() => {
    if (!navigator.mediaSession || !navigator.mediaSession.setPositionState) return;
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) });
    } catch (e) { /* ignore */ }
  }, 1000);

  if ('mediaSession' in navigator) {
    const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* unsupported */ } };
    set('play', () => play());
    set('pause', () => pause());
    set('stop', () => pause());
    set('previoustrack', () => prev());
    set('nexttrack', () => next());
    set('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
    set('seekforward', (d) => seekBy(d.seekOffset || 10));
    set('seekto', (d) => { if (d.fastSeek && audio.fastSeek) audio.fastSeek(d.seekTime); else seek(d.seekTime); });
  }

  // ---------------------------------------------------------------- audio events

  audio.addEventListener('play', () => {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
    emit('state');
  });
  audio.addEventListener('pause', () => {
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
    saveTimeNow();
    emit('state');
  });
  audio.addEventListener('playing', () => { errorStreak = 0; });
  audio.addEventListener('ended', () => {
    if (sleepAtEnd) { sleepAtEnd = false; emit('sleep'); emit('mode'); emit('state'); return; }
    next(true);
  });
  audio.addEventListener('timeupdate', () => {
    if (!counted && S.current && audio.currentTime >= Math.min(30, (audio.duration || 60) / 2)) {
      counted = true;
      L.recordPlay(S.current);
    }
    positionState();
    saveTime();
    emit('time');
  });
  audio.addEventListener('durationchange', () => emit('time'));
  // Save immediately when the page is hidden or closed so nothing is lost.
  const flush = () => { saveState.flush(); saveTimeNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  audio.addEventListener('error', () => {
    if (!S.current || !audio.getAttribute('src')) return;
    const t = L.get(S.current);
    emit('error', `Can't play “${t ? t.title : 'this track'}”. Your browser may not support this file type.`);
    skipBroken();
  });

  F.player = {
    audio, on, restore,
    playContext, play, pause, toggle, next, prev, seek, seekBy,
    setShuffle, toggleShuffle: () => setShuffle(!S.shuffle), cycleRepeat, setVolume, toggleMute, setSleep,
    addToQueue, playNext, removeFromQueue, clearQueue, playQueueItem, playContextItem, upNext, purge,
    get current() { return S.current; },
    get context() { return S.context; },
    get ctxKey() { return S.context && !S.fromQueue ? S.context.type + ':' + S.context.id : null; },
    get playing() { return !!S.current && !audio.paused; },
    get shuffle() { return S.shuffle; },
    get repeat() { return S.repeat; },
    get volume() { return S.volume; },
    get muted() { return S.muted; },
    get time() { return audio.currentTime || 0; },
    get duration() { return isFinite(audio.duration) ? audio.duration : (S.current && L.get(S.current) ? L.get(S.current).duration : 0); },
    get sleep() { return sleepAtEnd ? 'end' : sleepUntil ? Math.max(0, sleepUntil - Date.now()) : 0; },
    get hasQueue() { return S.queue.length > 0; },
  };
})(window.Freeify = window.Freeify || {});
