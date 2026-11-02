/* End-to-end test: imports real files, plays them, and exercises the UI in headless Chromium.
 * Run `npm test` (generates fixtures with ffmpeg first). Set SCREENSHOTS=1 to save screenshots. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');

const M = path.join(__dirname, '.fixtures');
const shots = path.join(__dirname, '.screenshots');
const SNAP = !!process.env.SCREENSHOTS;
if (SNAP) fs.mkdirSync(shots, { recursive: true });
if (!fs.existsSync(M)) { console.error('Fixtures missing: run `bash tests/make-fixtures.sh` first.'); process.exit(1); }
const snap = (p, name) => (SNAP ? p.screenshot({ path: path.join(shots, name) }) : null);
const files = [
  'Neon Coast/Night Drive/01 Midnight Highway.mp3', 'Neon Coast/Night Drive/02 City Lights.mp3', 'Neon Coast/Night Drive/03 Afterglow.mp3',
  'Neon Coast/Night Drive/02 City Lights.lrc', 'loose/Ana Ruiz - Sunrise Walk.flac', 'loose/Ana Ruiz - Coffee & Rain.flac',
  'loose/07 - Lo Fi Crew - Rainy Window.mp3', 'loose/unicode-v24.mp3', 'loose/notes.txt',
].map((f) => path.join(M, f));

function check(cond, msg) { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok  :', msg); }

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.welcome');
  await snap(page, '01-welcome.png');
  check(await page.isVisible('text=Free forever.'), 'welcome screen shows');

  await page.setInputFiles('#file-input', files);
  await page.waitForFunction(() => window.Freeify.library.count() === 7, null, { timeout: 30000 });
  await page.waitForSelector('#import-card', { state: 'hidden' });
  const toastText = await page.textContent('.toast');
  console.log('toast:', toastText);
  check(/Added 7 songs/.test(toastText), 'import summary toast');

  const tracks = await page.evaluate(() => window.Freeify.library.all().map((t) => ({ title: t.title, artist: t.artist, album: t.album, trackNo: t.trackNo, year: t.year, genre: t.genre, cover: !!t.coverId, lyrics: t.hasLyrics, dur: Math.round(t.duration) })));
  const by = (t) => tracks.find((x) => x.title === t) || {};
  check(by('City Lights').artist === 'Neon Coast' && by('City Lights').album === 'Night Drive' && by('City Lights').trackNo === 2 && by('City Lights').year === 2021, 'ID3v2.3 text frames');
  check(by('City Lights').cover && by('City Lights').lyrics, 'ID3v2.3 cover + LRC lyrics matched');
  check(by('Sunrise Walk').artist === 'Ana Ruiz' && by('Sunrise Walk').album === 'Morning Light' && by('Sunrise Walk').cover, 'FLAC vorbis comments + picture');
  check(by('Rainy Window').artist === 'Lo Fi Crew' && by('Rainy Window').trackNo === 7, 'filename fallback');
  const u = by('Été — Señorita ♫');
  check(u.artist === 'DJ Ünïcode, Guest Star' && u.album === 'Café Sessions' && u.trackNo === 4 && u.year === 2023 && u.genre === 'Rock' && u.cover && u.lyrics, 'ID3v2.4 UTF-16/UTF-8, multi-value, genre code, DLI APIC, USLT');
  check(by('Midnight Highway').dur === 6, 'duration probed');
  const coverCount = await page.evaluate(() => new Set(window.Freeify.library.all().map((t) => t.coverId).filter(Boolean)).size);
  check(coverCount === 3, 'covers de-duplicated (3 unique)');

  await page.waitForSelector('.quick-grid');
  await snap(page, '02-home.png');

  // Library view + play
  await page.goto(BASE + '#/library');
  await page.waitForSelector('.tl .tr[data-id]');
  await snap(page, '03-library.png');
  const firstTitle = await page.textContent('.tl .tr[data-id] .t-title');
  await page.hover('.tl .tr[data-id]');
  await page.click('.tl .tr[data-id] .row-play');
  await page.waitForFunction(() => window.Freeify.player.playing && window.Freeify.player.time > 0.3, null, { timeout: 10000 });
  check(true, 'playback started and time advances');
  check((await page.textContent('.player .np-title')) === firstTitle, 'player bar shows current title');
  check(await page.$eval('.tl .tr[data-id]', (r) => r.classList.contains('playing')), 'playing row highlighted');
  check((await page.title()).includes(firstTitle), 'document title shows song');

  // Next / prev
  await page.click('.player [data-act="next"]');
  await page.waitForFunction((t) => document.querySelector('.player .np-title').textContent !== t, firstTitle);
  const second = await page.textContent('.player .np-title');
  check(second !== firstTitle, 'next track');
  await page.click('.player [data-act="prev"]');
  await page.waitForFunction((t) => document.querySelector('.player .np-title').textContent === t, firstTitle);
  check(true, 'prev track');

  // Seek via keyboard
  await page.click('.page-title, .hero-title');
  const before = await page.evaluate(() => window.Freeify.player.time);
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => window.Freeify.player.time);
  check(after > before + 1, `arrow key seeks (${before.toFixed(1)} -> ${after.toFixed(1)})`);

  // Space toggles pause
  await page.keyboard.press(' ');
  await page.waitForFunction(() => !window.Freeify.player.playing);
  check(true, 'space pauses');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => window.Freeify.player.playing);
  check(true, 'space resumes');

  // Shuffle + repeat
  await page.click('.player .js-shuffle');
  check(await page.evaluate(() => window.Freeify.player.shuffle), 'shuffle on');
  await page.click('.player .js-shuffle');
  await page.click('.player .js-repeat');
  check(await page.evaluate(() => window.Freeify.player.repeat === 'all'), 'repeat all');
  await page.click('.player .js-repeat');
  await page.click('.player .js-repeat');

  // Like current
  await page.click('.player .js-like');
  check(await page.evaluate(() => window.Freeify.library.liked().length === 1), 'liked current song');

  // Context menu: add to queue, play next
  const row = (i) => page.locator('.tl .tr[data-id]').nth(i);
  await page.waitForTimeout(200);
  await row(4).click({ button: 'right', position: { x: 120, y: 20 } });
  await page.waitForSelector('#menu:not([hidden])');
  await snap(page, '04-menu.png');
  await page.click('#menu .menu-item:has-text("Add to queue")');
  check(await page.evaluate(() => window.Freeify.player.upNext().queue.length === 1), 'added to queue');

  // Queue panel
  await page.click('.player .js-queue-btn');
  await page.waitForSelector('#right:not([hidden]) .queue');
  check(await page.isVisible('#right .q-h:has-text("Next in queue")'), 'queue panel shows user queue');
  await snap(page, '05-queue.png');

  // Multi-select with shift, create playlist via dialog
  await row(0).click({ position: { x: 120, y: 20 } });
  await row(2).click({ position: { x: 120, y: 20 }, modifiers: ['Shift'] });
  check((await page.$$('.tr.selected')).length === 3, 'shift-click selects range');
  await row(1).click({ button: 'right', position: { x: 120, y: 20 } });
  await page.click('#menu .menu-item:has-text("Add to playlist")');
  await page.waitForSelector('dialog[open] .pick.new');
  await page.click('dialog[open] .pick.new');
  await page.waitForFunction(() => window.Freeify.library.playlists().length === 1);
  check(await page.evaluate(() => window.Freeify.library.playlists()[0].trackIds.length === 3), 'new playlist with 3 selected songs');

  // Playlist page, rename
  const pid = await page.evaluate(() => window.Freeify.library.playlists()[0].id);
  await page.goto(BASE + '#/playlist/' + pid);
  await page.waitForSelector('.hero-title.editable');
  await page.click('.hero-title.editable');
  await page.fill('dialog[open] input[name=v]', 'Road Trip');
  await page.click('dialog[open] button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.hero-title').textContent === 'Road Trip');
  check(await page.isVisible('.lib-item:has-text("Road Trip")'), 'playlist renamed + sidebar updated');
  // finder adds a song
  await page.click('[data-act="finder-add"]');
  await page.waitForFunction(() => window.Freeify.library.playlists()[0].trackIds.length === 4);
  check(true, 'finder adds song to playlist');
  // drag reorder within playlist
  await page.waitForTimeout(200);
  const firstId = await row(0).getAttribute('data-id');
  await row(0).dragTo(row(2), { targetPosition: { x: 200, y: 40 } });
  await page.waitForTimeout(200);
  const order = await page.evaluate(() => window.Freeify.library.playlists()[0].trackIds);
  check(order.indexOf(firstId) === 2, 'drag reorders playlist (' + order.indexOf(firstId) + ')');
  await snap(page, '06-playlist.png');

  // Play playlist via big play button
  await page.click('.action-bar .js-ctx-play');
  await page.waitForFunction(() => window.Freeify.player.ctxKey && window.Freeify.player.ctxKey.startsWith('playlist:'));
  check(await page.$eval('.action-bar .js-ctx-play', (b) => b.getAttribute('aria-label') === 'Pause'), 'big play button reflects playing');

  // Album page
  const albumId = await page.evaluate(() => window.Freeify.library.albums().list.find((a) => a.name === 'Night Drive').id);
  await page.goto(BASE + '#/album/' + albumId);
  await page.waitForSelector('.hero-title');
  const nums = await page.$$eval('.tl .tr[data-id] .n', (els) => els.map((e) => e.textContent));
  check(nums.join(',') === '1,2,3', 'album shows tracks in track order');
  await snap(page, '07-album.png');

  // Artist page
  await page.click('.hero-meta a');
  await page.waitForSelector('.artist-page');
  check((await page.textContent('.hero-title')) === 'Neon Coast', 'artist page');
  await snap(page, '08-artist.png');

  // Search
  await page.goto(BASE + '#/search');
  await page.waitForSelector('.genre-grid');
  await snap(page, '09-browse.png');
  await page.fill('#search-input', 'senorita');
  await page.waitForSelector('.top-result');
  check((await page.textContent('.top-title')).includes('Señorita'), 'accent-insensitive search');
  await page.fill('#search-input', 'neon');
  await page.waitForSelector('.top-result .top-sub:has-text("Artist")');
  await snap(page, '10-search.png');
  check(true, 'search top result is artist');

  // Lyrics in full screen player: play City Lights
  await page.evaluate(() => {
    const L = window.Freeify.library; const t = L.all().find((x) => x.title === 'City Lights');
    window.Freeify.player.playContext([t.id], 0, null);
  });
  await page.waitForFunction(() => window.Freeify.player.time > 2.2, null, { timeout: 10000 });
  await page.click('.player [data-act="show-lyrics"]');
  await page.waitForSelector('#full.open .ly.active');
  const activeLine = await page.textContent('#full .ly.active');
  check(/signal|morning/.test(activeLine), 'synced lyric highlighted: ' + activeLine);
  await page.waitForTimeout(400);
  await snap(page, '11-full-lyrics.png');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#full', { state: 'hidden' });

  // Now playing tab
  await page.click('#right [data-tab="np"]');
  await page.waitForSelector('#right .np-panel');
  await snap(page, '12-nowplaying.png');

  // Auto-advance at end of track goes to the queued song. Set up the queue here so earlier
  // steps (where short test songs may finish and use up the queue) can't affect it.
  await page.evaluate(() => {
    const L = window.Freeify.library;
    const P = window.Freeify.player;
    const city = L.all().find((x) => x.title === 'City Lights');
    const next = L.all().find((x) => x.title === 'Afterglow');
    P.clearQueue();
    P.playContext([city.id], 0, null);
    P.addToQueue([next.id]);
  });
  await page.waitForFunction(() => {
    const P = window.Freeify.player;
    return P.playing && window.Freeify.library.get(P.current).title === 'City Lights' && P.duration > 1;
  }, null, { timeout: 10000 });
  await page.evaluate(() => { const P = window.Freeify.player; P.seek(P.duration - 0.3); });
  await page.waitForFunction(() => window.Freeify.library.get(window.Freeify.player.current).title === 'Afterglow', null, { timeout: 10000 });
  check(true, 'auto advances to queued song at track end');

  // Settings
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('.settings');
  await page.click('.swatch[title="Violet"]');
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#a78bfa'), 'accent colour changes');
  await snap(page, '13-settings.png');

  // Reload: persistence
  await page.evaluate(() => window.Freeify.player.pause());
  const curBefore = await page.evaluate(() => window.Freeify.player.current);
  const timeBefore = await page.evaluate(() => window.Freeify.player.time);
  await page.reload();
  await page.waitForFunction(() => window.Freeify.library && window.Freeify.library.count() === 7);
  await page.waitForFunction(() => !!window.Freeify.player.current);
  check(await page.evaluate((c) => window.Freeify.player.current === c, curBefore), 'player track restored after reload');
  await page.waitForTimeout(500);
  const timeAfter = await page.evaluate(() => window.Freeify.player.time);
  check(Math.abs(timeAfter - timeBefore) < 1, `playback position restored (${timeBefore.toFixed(1)} -> ${timeAfter.toFixed(1)})`);
  check(await page.evaluate(() => window.Freeify.library.playlists()[0].name === 'Road Trip' && window.Freeify.library.liked().length === 1), 'playlists + likes persisted');
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#a78bfa'), 'accent persisted');

  // Delete a song
  await page.goto(BASE + '#/library');
  await page.waitForSelector('.tl .tr[data-id]');
  const delTitle = await page.textContent('.tl .tr[data-id] .t-title');
  await page.click('.tl .tr[data-id]', { button: 'right', position: { x: 120, y: 20 } });
  await page.click('#menu .menu-item.danger');
  await page.click('dialog[open] button[type=submit]');
  await page.waitForFunction(() => window.Freeify.library.count() === 6);
  check(!(await page.evaluate((t) => window.Freeify.library.all().some((x) => x.title === t), delTitle)), 'deleted song: ' + delTitle);

  // Duplicate import is skipped
  await page.setInputFiles('#file-input', files.slice(1, 3));
  await page.waitForSelector('.toast:has-text("already in your library")', { timeout: 10000 });
  check(await page.evaluate(() => window.Freeify.library.count() === 6), 'duplicates skipped');

  // Mobile layout
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(BASE + '#/home');
  await mp.waitForSelector('.welcome');
  await snap(mp, '14-mobile-welcome.png');
  await mp.setInputFiles('#file-input', files);
  await mp.waitForFunction(() => window.Freeify.library.count() === 7, null, { timeout: 30000 });
  await mp.waitForSelector('#import-card', { state: 'hidden' });
  await mp.waitForSelector('.quick-grid');
  await snap(mp, '15-mobile-home.png');
  await mp.goto(BASE + '#/library');
  await mp.waitForSelector('.tl .tr[data-id]');
  await mp.tap('.tl .tr[data-id] .col-title');
  await mp.waitForFunction(() => window.Freeify.player.playing, null, { timeout: 10000 });
  check(true, 'mobile: tap row plays');
  await snap(mp, '16-mobile-library.png');
  await mp.tap('.player .np');
  await mp.waitForSelector('#full.open');
  await mp.waitForTimeout(400);
  await snap(mp, '17-mobile-full.png');

  // Opening index.html straight from disk (no server) must work too.
  const fp = await browser.newPage();
  fp.on('pageerror', (e) => errors.push('file:// pageerror: ' + e.message));
  await fp.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await fp.waitForSelector('.welcome');
  await fp.setInputFiles('#file-input', files.slice(0, 2));
  await fp.waitForFunction(() => window.Freeify.library.count() === 2, null, { timeout: 20000 });
  check(true, 'works when opened from file://');

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
