/* End-to-end test of "search everywhere": library + free sources + Spotify catalog.
 * archive.org, Jamendo and Spotify are mocked, so this runs offline. All names are made up. */
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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
const AUDIO = fs.readFileSync(path.join(M, 'loose/07 - Lo Fi Crew - Rainy Window.mp3'));
const PNG = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png'));
const CC = 'https://creativecommons.org/licenses/by/4.0/';

const IA_ITEMS = {
  'lumen-free': { metadata: { title: 'Free Sessions', creator: 'Lumen Fields', licenseurl: CC }, files: [{ name: 'Paper Moons.mp3', format: 'VBR MP3', title: 'Paper Moons', creator: 'Lumen Fields', track: '1', length: '4' }] },
  'moon-album': { metadata: { title: 'Moon Tapes', creator: 'Night Owls', licenseurl: CC }, files: [{ name: 'Moon Tape.mp3', format: 'VBR MP3', title: 'Moon Tape', length: '4' }] },
};
const SP_ITEMS = [
  { id: 'spPaper', type: 'track', name: 'Paper Moons', uri: 'spotify:track:spPaper', duration_ms: 201000, track_number: 1, disc_number: 1,
    artists: [{ id: 'arLF', name: 'Lumen Fields' }], album: { name: 'Glass Hours', images: [{ url: 'https://i.scdn.co/image/gh', width: 64 }], release_date: '2024-01-01', artists: [{ name: 'Lumen Fields' }] } },
  { id: 'spCity', type: 'track', name: 'City Lights', uri: 'spotify:track:spCity', duration_ms: 6000, track_number: 2, disc_number: 1,
    artists: [{ id: 'arNC', name: 'Neon Coast' }], album: { name: 'Night Drive', images: [], release_date: '2021-01-01', artists: [{ name: 'Neon Coast' }] } },
];

async function mock(ctx, log) {
  await ctx.route('https://archive.org/advancedsearch.php**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    log.ia.push(q);
    let docs = [];
    if (q.includes('creator:("Lumen Fields")')) docs = [{ identifier: 'lumen-free', title: 'Free Sessions', creator: 'Lumen Fields', licenseurl: CC }];
    else if (!q.includes('creator:(') && /moons/.test(q)) docs = [{ identifier: 'moon-album', title: 'Moon Tapes', creator: 'Night Owls', licenseurl: CC }];
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ response: { numFound: docs.length, docs } }) });
  });
  await ctx.route('https://archive.org/metadata/**', (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[2]);
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(IA_ITEMS[id] || {}) });
  });
  await ctx.route('https://archive.org/download/**', (route) => route.fulfill({ headers: CORS, contentType: 'audio/mpeg', body: AUDIO }));
  await ctx.route('https://archive.org/services/img/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://api.jamendo.com/v3.0/**', (route) => {
    const u = new URL(route.request().url());
    log.jam.push(u.searchParams.get('search') || u.searchParams.get('artist_name') || '');
    const results = u.searchParams.get('search') === 'moons' ? [{
      id: '700', name: 'Moonlit Ferry', duration: 4, artist_name: 'Harbor Choir', album_id: '70', album_name: 'Night Crossings', position: '1',
      album_image: 'https://usercontent.jamendo.com/a/70.jpg', license_ccurl: CC, audio: 'https://prod-1.storage.jamendo.com/?trackid=700&format=mp32',
      audiodownload: 'https://prod-1.storage.jamendo.com/download/track/700/mp32/', audiodownload_allowed: true, shareurl: 'https://www.jamendo.com/track/700',
    }] : [];
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ headers: { status: 'success' }, results }) });
  });
  await ctx.route('https://prod-1.storage.jamendo.com/**', (route) => route.fulfill({ headers: CORS, contentType: 'audio/mpeg', body: AUDIO }));
  await ctx.route('https://usercontent.jamendo.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://api.spotify.com/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = new URL(route.request().url());
    if (u.pathname === '/v1/search') {
      log.sp.push(`${u.searchParams.get('q')}|${u.searchParams.get('limit')}`);
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ tracks: { items: SP_ITEMS } }) });
    }
    return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"error":{"status":404}}' });
  });
  await ctx.route('https://i.scdn.co/**', (route) => route.fulfill({ headers: CORS, contentType: 'image/png', body: PNG }));
}

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Pretend Jamendo and Spotify are already set up.
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('freeify:jamendo', 'goodkey1');
    localStorage.setItem('freeify:spotify', JSON.stringify({ clientId: '0123456789abcdef0123456789abcdef', token: { access: 'AT1', refresh: 'RT1', expiresAt: Date.now() + 3600000 }, user: { id: 'u1', name: 'Tester' } }));
  });
  const log = { ia: [], jam: [], sp: [] };
  await mock(ctx, log);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const L = (fn, arg) => page.evaluate(fn, arg);
  const song = (title) => L((t) => { const x = window.Freeify.library.all().find((s) => s.title === t); return x && { remote: !!x.remote, source: x.source, spotifyId: x.spotifyId }; }, title);

  await page.goto(BASE);
  await page.waitForSelector('.welcome');
  await page.setInputFiles('#file-input', [path.join(M, 'Neon Coast/Night Drive/02 City Lights.mp3')]);
  await page.waitForFunction(() => window.Freeify.library.count() === 1);

  // Typing searches the internet only once, after typing pauses.
  await page.goto(BASE + '#/search');
  await page.click('#search-input');
  await page.keyboard.type('moons', { delay: 40 });
  await page.waitForSelector('#ext-sp .ext-row');
  await page.waitForSelector('#ext-free .free-row');
  check(log.sp.length === 1 && log.sp[0] === 'moons|10', `Spotify searched once, for the whole word (${log.sp.join(', ')})`);
  check(log.jam.filter((q) => q).length === 1, 'Jamendo searched once');
  check((await page.textContent('.search-page')).includes('Nothing in your library matches “moons”'), 'library section says nothing local matches');
  check(await page.isVisible('#ext-free .free-row:has-text("Moonlit Ferry") [data-act="free-dl"]'), 'free Jamendo song with a Download button');
  check(await page.isVisible('#ext-free .card:has-text("Moon Tapes")'), 'free Internet Archive album');
  check(await page.isVisible('#ext-sp .ext-row:has-text("Paper Moons") [data-act="sp-save"]'), 'Spotify song with a Save button');
  check(await page.isVisible('#ext-sp .ext-row:has-text("City Lights") .got'), 'Spotify song you already have shows as in your library');
  await snap(page, 'search-01-everywhere.png');

  // Download a free song straight from search.
  await page.click('#ext-free .free-row:has-text("Moonlit Ferry") [data-act="free-dl"]');
  await page.waitForSelector('.toast:has-text("Downloaded 1 song")', { timeout: 20000 });
  const ferry = await song('Moonlit Ferry');
  check(ferry && !ferry.remote && ferry.source === 'jamendo', 'Download saves the free song into the library');
  await page.waitForSelector('#ext-free .free-row:has-text("Moonlit Ferry") .got');
  check(true, 'search results update to show it is in the library');

  // Save a Spotify song: it is added, then its free version downloads automatically.
  await page.click('#ext-sp .ext-row:has-text("Paper Moons") [data-act="sp-save"]');
  await page.waitForSelector('.toast:has-text("Saved “Paper Moons”")');
  await page.waitForSelector('.toast:has-text("Automatically downloaded 1 free song")', { timeout: 20000 });
  const paper = await song('Paper Moons');
  check(paper && !paper.remote && paper.spotifyId === 'spPaper' && paper.source === 'archive', 'saved Spotify song got its free version downloaded automatically');
  await page.waitForSelector('#ext-sp .ext-row:has-text("Paper Moons") .got');
  check(true, 'Spotify result now shows it is in the library');
  await snap(page, 'search-02-saved.png');

  // Local results still come first.
  await page.fill('#search-input', 'city');
  await page.waitForSelector('.search-page .top-result:has-text("City Lights")');
  check(await page.isVisible('#ext-sp'), 'library results and outside results on the same page');

  // Not connected to Spotify: a hint instead of results.
  await L(() => { window.Freeify.spotify.disconnect(); window.Freeify.app.render(true); });
  await page.waitForSelector('#ext-sp .notice:has-text("Connect Spotify")');
  check(true, 'without Spotify, search explains how to add it');

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
