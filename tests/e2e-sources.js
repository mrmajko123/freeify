/* End-to-end test of .zip import (Bandcamp-style albums) and the Jamendo source.
 * Jamendo and archive.org are mocked, so this runs offline. All names are made up. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { serve } = require('./serve');

const M = path.join(__dirname, '.fixtures');
if (!fs.existsSync(M)) { console.error('Fixtures missing: run `bash tests/make-fixtures.sh` first.'); process.exit(1); }
const shots = path.join(__dirname, '.screenshots');
const SNAP = !!process.env.SCREENSHOTS;
if (SNAP) fs.mkdirSync(shots, { recursive: true });
const snap = (p, name) => (SNAP ? p.screenshot({ path: path.join(shots, name) }) : null);

function check(cond, msg) { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok  :', msg); }

/** Build a small .zip in memory (deflate or stored entries), like a Bandcamp album download. */
function makeZip(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x800, 8); cen.writeUInt16LE(e.deflate ? 8 : 0, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(e.data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, end]);
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const AUDIO = fs.readFileSync(path.join(M, 'loose/07 - Lo Fi Crew - Rainy Window.mp3'));
const PNG = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png'));
const CC = 'http://creativecommons.org/licenses/by-sa/3.0/';
const STORE = 'https://prod-1.storage.jamendo.com';
const jamRow = (id, name, extra) => Object.assign({
  id: String(id), name, duration: 4, artist_id: '9', artist_name: 'Harbor Choir', album_id: '500', album_name: 'Tidal Hymns', position: '1',
  releasedate: '2020-04-01', album_image: `https://usercontent.jamendo.com/album/500.jpg`, license_ccurl: CC,
  audio: `${STORE}/?trackid=${id}&format=mp32`, audiodownload: `${STORE}/download/track/${id}/mp32/`, audiodownload_allowed: true,
  shareurl: `https://www.jamendo.com/track/${id}`,
}, extra || {});

async function mock(ctx, log) {
  await ctx.route('https://archive.org/**', (route) => route.fulfill({ headers: CORS, contentType: 'application/json', body: '{"response":{"numFound":0,"docs":[]}}' }));
  await ctx.route('https://api.jamendo.com/v3.0/**', (route) => {
    const u = new URL(route.request().url());
    log.jam.push(u.pathname + '?' + u.searchParams.toString());
    if (u.searchParams.get('client_id') !== 'goodkey1') {
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ headers: { status: 'failed', code: 5, error_message: 'Invalid Client Id' }, results: [] }) });
    }
    let results;
    if (u.pathname.endsWith('/albums/tracks/')) {
      results = [{ id: '500', name: 'Tidal Hymns', artist_name: 'Harbor Choir', releasedate: '2020-04-01', image: 'https://usercontent.jamendo.com/album/500.jpg',
        tracks: [jamRow(111, 'Harbor Dawn', { position: '1' }), jamRow(222, 'Tide Clock', { position: '2' })] }];
    } else {
      results = [jamRow(111, 'Harbor Dawn'), jamRow(333, 'Listen Only', { audiodownload_allowed: false, album_id: '600', album_name: 'Quiet Rooms' })];
    }
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ headers: { status: 'success', code: 0 }, results }) });
  });
  // Track 111 downloads (as in the desktop app); track 222 is blocked like on the real web version.
  // (Mocked responses skip the browser's cross-site check, so the block is simulated as a failed
  // request, which is exactly what a page sees when the real Jamendo server blocks it.)
  await ctx.route(`${STORE}/**`, (route) => {
    const u = route.request().url();
    if (route.request().resourceType() === 'fetch') log.dl.push(u);
    if (u.includes('/download/track/222/')) return route.abort('failed');
    return route.fulfill({ headers: CORS, contentType: 'text/html', body: AUDIO });
  });
  await ctx.route('https://usercontent.jamendo.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
}

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = { jam: [], dl: [] };
  await mock(ctx, log);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|CORS policy/.test(m.text())) errors.push('console: ' + m.text()); });
  const L = (fn, arg) => page.evaluate(fn, arg);
  const song = (title) => L((t) => { const x = window.Freeify.library.all().find((s) => s.title === t); return x && { remote: !!x.remote, artist: x.artist, album: x.album, license: x.license, source: x.source, sourceUrl: x.sourceUrl, lyrics: x.hasLyrics, cover: x.coverId && window.Freeify.library.coverUrl(x.coverId) }; }, title);

  await page.goto(BASE);
  await page.waitForSelector('.welcome');

  // ---- .zip albums
  const zip = makeZip([
    { name: 'Neon Coast - Night Drive/01 Midnight Highway.mp3', data: fs.readFileSync(path.join(M, 'Neon Coast/Night Drive/01 Midnight Highway.mp3')), deflate: true },
    { name: 'Neon Coast - Night Drive/02 City Lights.mp3', data: fs.readFileSync(path.join(M, 'Neon Coast/Night Drive/02 City Lights.mp3')) },
    { name: 'Neon Coast - Night Drive/02 City Lights.lrc', data: fs.readFileSync(path.join(M, 'Neon Coast/Night Drive/02 City Lights.lrc')), deflate: true },
    { name: 'Neon Coast - Night Drive/cover.jpg', data: fs.readFileSync(path.join(M, 'cover1.jpg')) },
    { name: '__MACOSX/Neon Coast - Night Drive/._01 Midnight Highway.mp3', data: Buffer.from('junk') },
  ]);
  await page.setInputFiles('#file-input', [{ name: 'Neon Coast - Night Drive.zip', mimeType: 'application/zip', buffer: zip }]);
  await page.waitForSelector('.toast:has-text("Added 2 songs")', { timeout: 20000 });
  const mh = await song('Midnight Highway');
  const cl = await song('City Lights');
  check(mh && mh.artist === 'Neon Coast' && mh.album === 'Night Drive' && mh.cover, '.zip album unpacked (compressed song, tags and cover read)');
  check(cl && cl.lyrics, 'stored song and its .lrc lyrics from the .zip');
  check(await L(() => window.Freeify.library.count()) === 2, 'images and macOS junk files in the .zip are skipped');
  await page.setInputFiles('#file-input', [{ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') }]);
  await page.waitForSelector('.toast.error:has-text("Couldn’t open broken.zip")');
  check(true, 'a broken .zip shows a clear error');

  // ---- Jamendo setup
  await page.goto(BASE + '#/free');
  await page.waitForSelector('.jam-setup');
  check(await page.isVisible('.more-sources a[href*="bandcamp"]') && await page.isVisible('.more-sources a[href*="freemusicarchive"]'), 'tips for Bandcamp, Free Music Archive, SoundCloud and Audiomack');
  await page.fill('#jam-key', 'badkey00');
  await page.click('[data-form="jam-key"] button[type=submit]');
  await page.waitForSelector('.toast.error:has-text("didn’t accept that Client ID")');
  check(!(await L(() => window.Freeify.freemusic.jamendoId())), 'a wrong Jamendo key is rejected and not saved');
  await page.fill('#jam-key', 'goodkey1');
  await page.click('[data-form="jam-key"] button[type=submit]');
  await page.waitForSelector('.toast:has-text("Jamendo added")');
  await page.waitForSelector('#jam-results .free-row');
  check((await page.$$('#jam-results .free-row')).length === 2, 'popular Jamendo songs listed');
  check(log.jam.some((q) => q.includes('order=popularity_week')), 'popular list asks Jamendo for this week’s most popular');
  check(await page.isVisible('#jam-results .free-row:has-text("Listen Only") a[title*="doesn’t allow downloads"]'), 'songs the artist doesn’t allow downloading link to Jamendo instead');
  await snap(page, 'src-01-jamendo.png');

  // Preview streams; download saves into the library with license and source.
  await page.click('#jam-results .free-row:has-text("Harbor Dawn") [data-act="free-preview"]');
  await page.waitForFunction(() => window.Freeify.freemusic.previewing === 'jam:111');
  check(true, 'Jamendo preview plays');
  await page.click('#jam-results .free-row:has-text("Harbor Dawn") [data-act="free-preview"]');
  await page.click('#jam-results .free-row:has-text("Harbor Dawn") [data-act="free-dl"]');
  await page.waitForSelector('.toast:has-text("Downloaded 1 song")', { timeout: 20000 });
  const hd = await song('Harbor Dawn');
  check(hd && !hd.remote && hd.artist === 'Harbor Choir' && hd.album === 'Tidal Hymns' && hd.source === 'jamendo' && hd.license === CC && hd.sourceUrl === 'https://www.jamendo.com/track/111', 'Jamendo song downloaded with artist, album, license and source');
  check(log.dl.some((u) => u.includes('/download/track/111/mp32/')), 'uses Jamendo’s official download link');

  // Search.
  await page.fill('#free-q', 'harbor');
  const searched = page.waitForRequest((r) => r.url().startsWith('https://api.jamendo.com/') && r.url().includes('search=harbor'), { timeout: 10000 });
  await page.press('#free-q', 'Enter');
  check(!!(await searched), 'search is sent to Jamendo');
  await page.waitForSelector('#jam-results .free-row');

  // Album page: the second song is blocked like on the real web version.
  await page.click('#jam-results .free-row:has-text("Harbor Dawn") a.sub-link');
  await page.waitForSelector('#free-album .free-row');
  check((await page.textContent('#free-album .action-bar')).includes('jamendo.com'), 'Jamendo album page links to jamendo.com');
  check(await page.isVisible('.free-row.owned:has-text("Harbor Dawn")'), 'already-downloaded song is marked');
  await page.click('[data-act="free-dl-album"]');
  await page.waitForSelector('.toast.error:has-text("can’t be downloaded in the web version")', { timeout: 20000 });
  check(await page.isVisible('.toast-action:has-text("Open the site")'), 'blocked downloads offer to open the song on Jamendo');
  check(!(await song('Tide Clock')), 'nothing half-downloaded is added');
  await snap(page, 'src-02-album.png');

  // Remove Jamendo.
  await page.goto(BASE + '#/free');
  await page.click('[data-act="jam-remove"]');
  await page.waitForSelector('.jam-setup');
  check(!(await L(() => window.Freeify.freemusic.jamendoId())), 'Jamendo can be removed');

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
