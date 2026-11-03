/* End-to-end test of free music downloads. archive.org is mocked, so this runs offline.
 * All artists, albums and songs are made up. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');

const M = path.join(__dirname, '.fixtures');
if (!fs.existsSync(M)) { console.error('Fixtures missing: run `bash tests/make-fixtures.sh` first.'); process.exit(1); }
const shots = path.join(__dirname, '.screenshots');
const SNAP = !!process.env.SCREENSHOTS;
if (SNAP) fs.mkdirSync(shots, { recursive: true });
const snap = (p, name) => (SNAP ? p.screenshot({ path: path.join(shots, name) }) : null);

function check(cond, msg) { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok  :', msg); }

const CORS = { 'Access-Control-Allow-Origin': '*' };
const AUDIO = fs.readFileSync(path.join(M, 'loose/07 - Lo Fi Crew - Rainy Window.mp3'));
const PNG = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png'));
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

const ITEMS = {
  'paperharbor-lakeside': {
    metadata: { identifier: 'paperharbor-lakeside', title: 'Lakeside Sessions', creator: 'Paper Harbor', licenseurl: CC_BY, year: '2019', description: '<p>Recorded <b>by the lake</b>.</p>' },
    files: [
      { name: '01 Lake Song.mp3', format: 'VBR MP3', title: 'Lake Song', creator: 'Paper Harbor', album: 'Lakeside Sessions', track: '1/3', length: '4.0', size: String(AUDIO.length) },
      { name: '01 Lake Song_64kb.mp3', format: '64Kbps MP3', title: 'Lake Song' },
      { name: '02 Ferry Lights.mp3', format: 'VBR MP3', title: 'Ferry Lights', creator: 'Paper Harbor', track: '2/3', length: '00:04' },
      { name: '03 Last Tram.flac', format: 'Flac', title: 'Last Tram' },
      { name: '03 Last Tram.mp3', format: 'VBR MP3', title: 'Last Tram', track: '3' },
      { name: 'cover.jpg', format: 'JPEG' },
    ],
  },
  'nightbus-radio': {
    metadata: { identifier: 'nightbus-radio', title: 'Night Bus Radio', creator: 'Quiet Signal', licenseurl: 'http://creativecommons.org/publicdomain/zero/1.0/' },
    files: [{ name: 'Night Bus.mp3', format: 'VBR MP3', title: 'Night Bus', length: '4' }],
  },
  'unlicensed-thing': {
    metadata: { identifier: 'unlicensed-thing', title: 'Some Upload', creator: 'Someone' },
    files: [{ name: 'track.mp3', format: 'VBR MP3' }],
  },
};
const doc = (id) => ({ identifier: id, title: ITEMS[id].metadata.title, creator: ITEMS[id].metadata.creator, licenseurl: ITEMS[id].metadata.licenseurl, year: ITEMS[id].metadata.year });

async function mockArchive(ctx, log) {
  await ctx.route('https://archive.org/advancedsearch.php**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    log.search.push(q);
    let docs = [];
    if (!/licenseurl:\(\*creativecommons\.org\* OR \*publicdomain\*\)/.test(q)) docs = [];
    else if (q.includes('creator:("Paper Harbor")')) docs = [doc('paperharbor-lakeside')];
    else if (q.includes('creator:(')) docs = [];
    else if (/lakeside/i.test(q)) docs = [doc('paperharbor-lakeside')];
    else if (q.startsWith('collection:netlabels')) docs = [doc('paperharbor-lakeside'), doc('nightbus-radio')];
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ response: { numFound: docs.length, docs } }) });
  });
  await ctx.route('https://archive.org/metadata/**', (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[2]);
    const item = ITEMS[id];
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(item || {}) });
  });
  await ctx.route('https://archive.org/download/**', (route) => {
    // Count real downloads only (fetch); previews stream through the audio element (media).
    if (route.request().resourceType() === 'fetch') log.downloads.push(decodeURIComponent(new URL(route.request().url()).pathname));
    route.fulfill({ headers: CORS, contentType: 'audio/mpeg', body: AUDIO });
  });
  await ctx.route('https://archive.org/services/img/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
}

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = { search: [], downloads: [] };
  await mockArchive(ctx, log);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const L = (fn, arg) => page.evaluate(fn, arg);
  const song = (title) => L((t) => { const x = window.Freeify.library.all().find((s) => s.title === t); return x && { remote: !!x.remote, artist: x.artist, album: x.album, license: x.license, sourceId: x.sourceId, source: x.source, cover: x.coverId && window.Freeify.library.coverUrl(x.coverId) }; }, title);

  await page.goto(BASE);
  await page.waitForSelector('.welcome');
  check(await page.isVisible('.welcome a[href="#/free"]'), 'welcome screen offers free music');
  check(await page.isVisible('.nav a[data-nav="free"]'), 'Free music is in the sidebar');

  // Songs imported from Spotify that aren't on this device yet.
  const yourLibrary = { tracks: [
    { artist: 'Paper Harbor', album: 'Lakeside Sessions', track: 'Lake Song', uri: 'spotify:track:tLake' },
    { artist: 'Famous Star', album: 'Big Album', track: 'Big Chart Hit', uri: 'spotify:track:tHit' },
  ] };
  await page.setInputFiles('#file-input', [{ name: 'YourLibrary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(yourLibrary)) }]);
  await page.waitForFunction(() => window.Freeify.library.count() === 2);

  // Popular free albums.
  await page.click('.nav a[data-nav="free"]');
  await page.waitForSelector('#free-results .card');
  check((await page.$$('#free-results .card')).length === 2, 'popular free albums load');
  check(log.search.every((q) => q.includes('licenseurl:(*creativecommons.org* OR *publicdomain*)')), 'every search is limited to free licenses');
  check((await page.textContent('#free-results')).includes('CC0'), 'license shown on album cards');
  await snap(page, 'free-01-popular.png');

  // Free versions of greyed-out songs download automatically, without asking.
  await page.waitForSelector('.toast:has-text("Automatically downloaded 1 free song from your library")', { timeout: 20000 });
  const lake = await song('Lake Song');
  check(lake && !lake.remote && lake.license === CC_BY && lake.source === 'archive', 'free version downloaded automatically and linked to the Spotify song');
  check((await song('Big Chart Hit')).remote, 'songs without a free release stay greyed out');
  const creatorSearches = () => log.search.filter((q) => q.startsWith('creator:')).length;
  const before = creatorSearches();
  await L(() => window.Freeify.app.autoFree());
  check(creatorSearches() === before, 'the automatic check doesn’t search again for artists it checked recently');
  // The button still checks everything on request.
  await page.click('[data-act="free-match"]');
  await page.waitForSelector('.toast:has-text("Checked 1 song: none of them are released for free.")', { timeout: 20000 });
  check(creatorSearches() === before + 1, 'the Find free versions button checks again');

  // Search.
  await page.fill('#free-q', 'lakeside (live)');
  await page.press('#free-q', 'Enter');
  await page.waitForFunction(() => location.hash === '#/free/q/lakeside%20(live)');
  // Wait for the new results page (the album card was already on the previous page too).
  await page.waitForSelector('.browse-title:has-text("lakeside (live)")');
  await page.waitForFunction(() => document.querySelectorAll('#free-results .card').length === 1);
  check(!log.search[log.search.length - 1].includes('(live)'), 'search text is cleaned before querying');
  check((await page.textContent('#free-results')).includes('Lakeside Sessions'), 'search results show the matching album');

  // Album page.
  await page.click('#free-results .card:has-text("Lakeside Sessions")');
  await page.waitForSelector('.free-row');
  const rows = await page.$$eval('.free-row .t-title', (els) => els.map((e) => e.textContent));
  check(rows.join('|') === 'Lake Song|Ferry Lights|Last Tram', 'album lists each song once, in order (no 64kb copies or FLAC)');
  check((await page.textContent('.hero-meta')).includes('CC BY 4.0'), 'album shows its license');
  check((await page.textContent('.hero-desc')).trim() === 'Recorded by the lake.', 'album description without HTML');
  check(await page.isVisible('.free-row.owned:has-text("Lake Song")'), 'songs you already have are marked');
  check((await page.textContent('[data-act="free-dl-album"]')).includes('Download 2 more'), 'download button counts what is missing');

  // Preview without downloading.
  await page.click('.free-row:has-text("Ferry Lights") [data-act="free-preview"]');
  await page.waitForFunction(() => !!window.Freeify.freemusic.previewing);
  check(await page.isVisible('.free-row:has-text("Ferry Lights") .free-play.on'), 'preview plays and shows as playing');
  await page.click('.free-row:has-text("Ferry Lights") [data-act="free-preview"]');
  await page.waitForFunction(() => !window.Freeify.freemusic.previewing);
  check(true, 'preview stops when pressed again');
  await snap(page, 'free-02-album.png');

  // Download one song, then the rest of the album.
  await page.click('.free-row:has-text("Ferry Lights") [data-act="free-dl"]');
  await page.waitForSelector('.toast:has-text("Downloaded 1 song")', { timeout: 20000 });
  const ferry = await song('Ferry Lights');
  check(ferry && !ferry.remote && ferry.artist === 'Paper Harbor' && ferry.album === 'Lakeside Sessions' && ferry.license === CC_BY && ferry.sourceId === 'paperharbor-lakeside/02 Ferry Lights.mp3', 'downloaded song has artist, album, license and source');
  check(ferry && ferry.cover === 'https://archive.org/services/img/paperharbor-lakeside', 'downloaded song gets the album cover');
  await page.waitForSelector('.free-row.owned:has-text("Ferry Lights")');
  await page.click('[data-act="free-dl-album"]');
  await page.waitForSelector('.toast:has-text("Downloaded 1 song")', { timeout: 20000 });
  await page.waitForSelector('.pill:has-text("In your library")');
  check(await L(() => window.Freeify.library.count()) === 4, 'album download only fetches missing songs (4 songs in library)');
  check(log.downloads.filter((d) => d.includes('Ferry Lights')).length === 1 && log.downloads.every((d) => !/_64kb|\.flac/.test(d)), 'each file downloaded once, best MP3 only');

  // Downloaded music plays and shows its license.
  await page.goto(BASE + '#/library');
  await page.waitForSelector('.tl .tr[data-id]:not(.remote)');
  await page.dblclick('.tl .tr:has-text("Ferry Lights") .t-title');
  await page.waitForFunction(() => window.Freeify.player.playing);
  await page.click('.player .js-queue-btn');
  await page.click('#right [data-tab="np"]');
  await page.waitForSelector('#right .facts a:has-text("CC BY 4.0")');
  check(await page.isVisible('#right .facts a:has-text("Internet Archive")'), 'now playing shows license and source');
  await snap(page, 'free-03-playing.png');

  // Albums without a free license are refused.
  await page.goto(BASE + '#/free/album/unlicensed-thing');
  await page.waitForSelector('.empty-state:has-text("isn’t released under a free license")');
  check(true, 'refuses albums without a free license');

  // Survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.Freeify.library && window.Freeify.library.count() === 4);
  check((await song('Last Tram')).license === CC_BY, 'downloads persisted after reload');

  // With automatic downloads turned off, nothing downloads until it's switched back on.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx2.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('freeify:autoFree', 'false'); sessionStorage.setItem('seeded', '1'); } });
  await mockArchive(ctx2, { search: [], downloads: [] });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror (auto off): ' + e.message));
  await p2.goto(BASE);
  await p2.waitForSelector('.welcome');
  await p2.setInputFiles('#file-input', [{ name: 'YourLibrary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(yourLibrary)) }]);
  await p2.waitForFunction(() => window.Freeify.library.count() === 2);
  await p2.waitForTimeout(3500);
  check(await p2.evaluate(() => window.Freeify.library.all().every((t) => t.remote)), 'no automatic downloads when the setting is off');
  await p2.goto(BASE + '#/settings');
  await p2.waitForSelector('#auto-free');
  check(!(await p2.isChecked('#auto-free')), 'Settings shows automatic downloads off');
  await p2.click('.switch');
  await p2.waitForSelector('.toast:has-text("Automatically downloaded 1 free song")', { timeout: 20000 });
  check(true, 'switching it on downloads free versions straight away');
  await snap(p2, 'free-04-settings.png');
  await ctx2.close();

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
