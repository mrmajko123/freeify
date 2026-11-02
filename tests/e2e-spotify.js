/* End-to-end test of the Spotify import, data-export import and artwork finder.
 * Spotify, Wikipedia and image hosts are mocked, so this runs offline. All names are made up. */
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

// A tiny solid-colour PNG for mocked artwork.
function png(r, g, b) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const W = 16;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: W }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: W }, () => [r, g, b]).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const img = (id, w) => ({ url: `https://i.scdn.co/image/${id}`, width: w || 300, height: w || 300 });
const NIGHT_DRIVE = { id: 'alND', name: 'Night Drive', artists: [{ id: 'arNC', name: 'Neon Coast' }], images: [img('nd640', 640), img('nd300')], release_date: '2021-05-01' };
const GLASS = { id: 'alGH', name: 'Glass Hours', artists: [{ id: 'arLF', name: 'Lumen Fields' }], images: [img('gh300')], release_date: '2024-03-01' };
const T_CITY = { id: 'tCity', type: 'track', name: 'City Lights', uri: 'spotify:track:tCity', artists: [{ id: 'arNC', name: 'Neon Coast' }], album: NIGHT_DRIVE, track_number: 2, disc_number: 1, duration_ms: 6000, external_ids: { isrc: 'XX0000000001' } };
const T_PAPER = { id: 'tPaper', type: 'track', name: 'Paper Moons', uri: 'spotify:track:tPaper', artists: [{ id: 'arLF', name: 'Lumen Fields' }, { id: 'arGuest', name: 'Guest Voice' }], album: GLASS, track_number: 1, disc_number: 1, duration_ms: 201000, external_ids: { isrc: 'XX0000000002' } };
const T_STATIC = { id: 'tStatic', type: 'track', name: 'Static Bloom', uri: 'spotify:track:tStatic', artists: [{ id: 'arLF', name: 'Lumen Fields' }], album: GLASS, track_number: 2, disc_number: 1, duration_ms: 187000 };
const LOCAL_SUNRISE = { id: null, type: 'track', is_local: true, name: 'Sunrise Walk', uri: 'spotify:local:Ana+Ruiz:Morning+Light:Sunrise+Walk:5', artists: [{ id: null, name: 'Ana Ruiz' }], album: { name: 'Morning Light', images: [] }, duration_ms: 5000 };

const API = {
  '/v1/me': { id: 'u1', display_name: 'Test Listener' },
  '/v1/me/tracks': { items: [{ added_at: '2026-01-02T10:00:00Z', track: T_CITY }, { added_at: '2026-01-03T10:00:00Z', track: T_PAPER }], next: null, total: 2 },
  '/v1/me/albums': { items: [{ added_at: '2026-01-01T10:00:00Z', album: Object.assign({}, GLASS, { tracks: { items: [Object.assign({}, T_PAPER, { album: undefined }), Object.assign({}, T_STATIC, { album: undefined })], next: null } }) }], next: null, total: 1 },
  '/v1/me/playlists': { items: [
    { id: 'pl1', name: 'Road Songs', description: 'Drive &amp; <a href="#">chill</a>', owner: { id: 'u1' }, collaborative: false, images: [img('pl1', 300)], items: { total: 4 } },
    { id: 'pl2', name: 'Someone Else Mix', description: '', owner: { id: 'other' }, collaborative: false, images: [], items: { total: 9 } },
  ], next: null, total: 2 },
  '/v1/playlists/pl1/items': { items: [
    { added_at: '2026-01-05T00:00:00Z', track: true, item: T_CITY },
    { added_at: '2026-01-05T00:00:00Z', track: true, item: T_STATIC },
    { added_at: '2026-01-05T00:00:00Z', track: false, item: { type: 'episode', id: 'ep1', name: 'Some podcast' } },
    { added_at: '2026-01-05T00:00:00Z', track: true, item: LOCAL_SUNRISE },
  ], next: null, total: 4 },
  '/v1/me/following': { artists: { items: [{ id: 'arLF', name: 'Lumen Fields', images: [img('lf320', 320)] }], next: null, total: 1 } },
  '/v1/artists/arNC': { id: 'arNC', name: 'Neon Coast', images: [img('nc320', 320)] },
  '/v1/artists/arGuest': { id: 'arGuest', name: 'Guest Voice', images: [] },
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function mockNetwork(ctx, log) {
  await ctx.route('https://accounts.spotify.com/authorize**', (route) => {
    const u = new URL(route.request().url());
    log.authorize = Object.fromEntries(u.searchParams);
    const back = `${u.searchParams.get('redirect_uri')}?code=TESTCODE&state=${encodeURIComponent(u.searchParams.get('state'))}`;
    route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
  });
  await ctx.route('https://accounts.spotify.com/api/token', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    log.token = Object.fromEntries(new URLSearchParams(route.request().postData()));
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, token_type: 'Bearer' }) });
  });
  await ctx.route('https://api.spotify.com/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    log.api.push(u.pathname + u.search);
    if (req.headers().authorization !== 'Bearer AT1') return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"error":{"status":401,"message":"bad token"}}' });
    if (u.pathname === '/v1/playlists/pl2/items') return route.fulfill({ status: 403, headers: CORS, contentType: 'application/json', body: '{"error":{"status":403,"message":"Forbidden"}}' });
    if (u.pathname === '/v1/search') {
      const type = u.searchParams.get('type');
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ [`${type}s`]: { items: [] } }) });
    }
    const body = API[u.pathname];
    if (!body) return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"error":{"status":404,"message":"not found"}}' });
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route('https://i.scdn.co/**', (route) => route.fulfill({ headers: CORS, contentType: 'image/png', body: png(200, 60, 120) }));
  await ctx.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ headers: CORS, contentType: 'image/png', body: png(40, 160, 220) }));
  await ctx.route('https://en.wikipedia.org/w/api.php**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('gsrsearch') || '';
    log.wiki.push(q);
    const pages = /^Ana Ruiz/.test(q)
      ? { 7: { pageid: 7, title: 'Ana Ruiz (singer)', index: 1, description: 'Fictional singer-songwriter', thumbnail: { source: 'https://upload.wikimedia.org/thumb/ana.png', width: 300, height: 300 } } }
      : {};
    route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(Object.keys(pages).length ? { query: { pages } } : { batchcomplete: '' }) });
  });
}

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = { api: [], wiki: [] };
  await mockNetwork(ctx, log);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const L = (fn, arg) => page.evaluate(fn, arg);

  // Your own files first.
  await page.goto(BASE);
  await page.waitForSelector('.welcome');
  check(await page.isVisible('a[href="#/import"]'), 'welcome screen links to Spotify import');
  await page.setInputFiles('#file-input', [
    path.join(M, 'Neon Coast/Night Drive/01 Midnight Highway.mp3'),
    path.join(M, 'Neon Coast/Night Drive/02 City Lights.mp3'),
    path.join(M, 'loose/Ana Ruiz - Sunrise Walk.flac'),
  ]);
  await page.waitForFunction(() => window.Freeify.library.count() === 3, null, { timeout: 30000 });
  await page.waitForSelector('#import-card', { state: 'hidden' });

  // Connect to Spotify.
  await page.goto(BASE + '#/import');
  await page.waitForSelector('#redirect-uri');
  check((await page.textContent('#redirect-uri')) === BASE, 'shows the exact redirect address to register: ' + BASE);
  await page.fill('#sp-client', 'nope');
  await page.click('[data-form="sp-connect"] button[type=submit]');
  await page.waitForSelector('.toast.error:has-text("Client ID")');
  check(true, 'rejects a malformed Client ID');
  await page.fill('#sp-client', '0123456789abcdef0123456789abcdef');
  await page.click('[data-form="sp-connect"] button[type=submit]');
  await page.waitForSelector('.toast:has-text("Connected to Spotify as Test Listener")', { timeout: 15000 });
  check(log.authorize.code_challenge_method === 'S256' && log.authorize.scope.includes('user-library-read') && log.authorize.redirect_uri === BASE, 'authorize request uses PKCE + right scopes');
  check(log.token.grant_type === 'authorization_code' && log.token.code === 'TESTCODE' && log.token.code_verifier && log.token.code_verifier.length >= 43, 'code exchanged with verifier');
  check(new URL(page.url()).search === '' && page.url().endsWith('#/import'), 'sign-in code removed from the address bar');
  await page.waitForSelector('[data-act="sp-import"]');
  await snap(page, 'sp-01-connected.png');

  // Import.
  await page.click('[data-act="sp-import"]');
  await page.waitForSelector('.toast:has-text("From Spotify")', { timeout: 30000 });
  console.log('toast:', (await page.textContent('.toast:has-text("From Spotify")')).trim());
  const lib = await L(() => {
    const Lb = window.Freeify.library;
    const by = (t) => Lb.all().find((x) => x.title === t);
    const pick = (t) => t && { id: t.id, remote: !!t.remote, liked: !!t.likedAt, spotifyId: t.spotifyId, cover: !!t.coverId, album: t.album, artist: t.artist };
    const pl = Lb.playlists();
    return {
      count: Lb.count(),
      city: pick(by('City Lights')), paper: pick(by('Paper Moons')), stat: pick(by('Static Bloom')), sunrise: pick(by('Sunrise Walk')),
      playlists: pl.map((p) => ({ name: p.name, desc: p.description, n: p.trackIds.length, ids: p.trackIds, cover: !!p.coverId })),
      lumen: (() => { const a = Lb.artist(Lb.artistIdByName('Lumen Fields')); return a && { image: !!a.imageId, n: a.trackIds.length }; })(),
      neon: (() => { const a = Lb.artist(Lb.artistIdByName('Neon Coast')); return a && { image: !!a.imageId }; })(),
      guest: !!Lb.artist(Lb.artistIdByName('Guest Voice')),
    };
  });
  check(lib.count === 5, `2 new songs added, nothing duplicated (count ${lib.count})`);
  check(lib.city && !lib.city.remote && lib.city.spotifyId === 'tCity' && lib.city.liked, 'Spotify song matched to your own file (stays playable, liked)');
  check(lib.paper && lib.paper.remote && lib.paper.liked && lib.paper.cover && lib.paper.album === 'Glass Hours' && lib.paper.artist === 'Lumen Fields, Guest Voice', 'liked Spotify song added with album, cover, artists');
  check(lib.stat && lib.stat.remote && !lib.stat.liked, 'saved-album song added');
  const road = lib.playlists.find((p) => p.name === 'Road Songs');
  check(road && road.n === 3 && road.desc === 'Drive & chill' && road.cover, 'playlist imported (episode skipped, HTML stripped, cover)');
  check(road && road.ids[0] === lib.city.id && road.ids[2] === lib.sunrise.id, 'playlist uses your own files for matched songs (incl. Spotify local file)');
  check(!lib.playlists.some((p) => p.name === 'Someone Else Mix'), 'unreadable playlist by someone else is skipped');
  check(lib.lumen && lib.lumen.image && lib.lumen.n === 2, 'followed artist has a picture');
  check(lib.neon && lib.neon.image, 'artist picture fetched for imported artist');
  check(!lib.guest, 'featured artists are not split into separate artists');
  check(log.api.some((p) => p.startsWith('/v1/playlists/pl1/items')), 'uses the new playlist items endpoint');
  await page.goto(BASE + '#/import');
  await page.waitForSelector('.fine:has-text("Last import")');
  check(/couldn’t be read/.test(await page.textContent('.fine:has-text("Last import")')), 'import page explains skipped playlists');

  // Not-on-device songs in the UI.
  await page.goto(BASE + '#/library');
  await page.waitForSelector('.tr.remote');
  check((await page.$$('.tr.remote')).length === 2, 'songs not on this device are greyed out');
  await snap(page, 'sp-02-library.png');
  await page.hover('.tr.remote');
  await page.click('.tr.remote .row-play');
  await page.waitForSelector('.toast:has-text("isn’t on this device")');
  check(await page.isVisible('.toast-action:has-text("Open in Spotify")'), 'tapping a missing song offers Open in Spotify');
  await page.click('[data-act="toggle-local-only"]');
  await page.waitForFunction(() => document.querySelectorAll('.tl .tr[data-id]').length === 3);
  check((await page.$$('.tr.remote')).length === 0, '"On this device only" hides missing songs');
  await page.click('[data-act="toggle-local-only"]');

  const glass = await L(() => window.Freeify.library.albums().list.find((a) => a.name === 'Glass Hours').id);
  await page.goto(BASE + '#/album/' + glass);
  await page.waitForSelector('.hero-meta:has-text("not on this device")');
  await page.click('.action-bar .js-ctx-play');
  await page.waitForSelector('.toast.error:has-text("None of these songs are on this device")');
  check(true, 'playing an album with no local songs explains why');
  await snap(page, 'sp-03-album.png');
  const lumenId = await L(() => window.Freeify.library.artistIdByName('Lumen Fields'));
  await page.goto(BASE + '#/artist/' + lumenId);
  await page.waitForSelector('.artist-page .hero-art img[src^="https://i.scdn.co/"]');
  check(true, 'artist page shows the artist picture');
  await snap(page, 'sp-04-artist.png');

  // Playing a playlist skips songs that aren't here.
  const roadId = await L(() => window.Freeify.library.playlists().find((p) => p.name === 'Road Songs').id);
  await page.goto(BASE + '#/playlist/' + roadId);
  await page.click('.action-bar .js-ctx-play');
  await page.waitForFunction(() => window.Freeify.player.playing);
  const upcoming = await L(() => window.Freeify.player.upNext().context.map((c) => window.Freeify.library.get(c.id).title));
  check(!upcoming.includes('Static Bloom'), 'player skips songs that are not on this device');
  await L(() => window.Freeify.player.pause());

  // Adding your own file for a Spotify song makes it playable (matched by name, no duplicate).
  const raw = fs.readFileSync(path.join(M, 'loose/07 - Lo Fi Crew - Rainy Window.mp3'));
  await page.setInputFiles('#file-input', [{ name: 'Lumen Fields - Static Bloom.mp3', mimeType: 'audio/mpeg', buffer: raw }]);
  await page.waitForSelector('.toast:has-text("now playable")', { timeout: 20000 });
  const after = await L(() => { const t = window.Freeify.library.all().find((x) => x.title === 'Static Bloom'); return { remote: t.remote, count: window.Freeify.library.count(), album: t.album }; });
  check(!after.remote && after.count === 5 && after.album === 'Glass Hours', 'adding the file links it to the Spotify song');

  // Data export import (no Premium needed).
  const yourLibrary = { tracks: [{ artist: 'Velvet Static', album: 'Low Tide', track: 'Harbor Glow', uri: 'spotify:track:tHarbor' }, { artist: 'Neon Coast', album: 'Night Drive', track: 'Afterglow', uri: 'spotify:track:tAfter' }], albums: [], artists: [{ name: 'Velvet Static', uri: 'spotify:artist:arVS' }] };
  const playlist1 = { playlists: [{ name: 'Export Mix', lastModifiedDate: '2026-01-01', description: null, items: [
    { track: { trackName: 'Harbor Glow', artistName: 'Velvet Static', albumName: 'Low Tide', trackUri: 'spotify:track:tHarbor' }, episode: null, localTrack: null, addedDate: '2026-01-01' },
    { track: null, episode: null, localTrack: { uri: 'spotify:local:Neon+Coast:Night+Drive:Midnight+Highway:6' }, addedDate: '2026-01-01' },
  ] }] };
  await page.setInputFiles('#file-input', [
    { name: 'YourLibrary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(yourLibrary)) },
    { name: 'Playlist1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(playlist1)) },
  ]);
  await page.waitForSelector('.toast:has-text("From Spotify: 2 songs added")', { timeout: 15000 });
  const exp = await L(() => {
    const Lb = window.Freeify.library;
    const mix = Lb.playlists().find((p) => p.name === 'Export Mix');
    return { mix: mix && mix.trackIds.map((id) => Lb.get(id).title), harbor: Lb.all().find((t) => t.title === 'Harbor Glow'), afterglow: Lb.all().find((t) => t.title === 'Afterglow') };
  });
  check(exp.mix && exp.mix.join('|') === 'Harbor Glow|Midnight Highway', 'export playlist imported, local file entry matched to your file');
  check(exp.harbor && exp.harbor.remote && exp.harbor.likedAt > 0, 'export liked song added');
  check(exp.afterglow && exp.afterglow.remote, 'export song you do not have is added as not on this device');

  // Artwork finder: Spotify search has nothing, Wikipedia has a picture of Ana Ruiz.
  await page.goto(BASE + '#/import');
  await page.click('[data-act="art-find"]');
  await page.waitForSelector('.toast:has-text("artist picture")', { timeout: 30000 });
  const ana = await L(() => { const Lb = window.Freeify.library; const a = Lb.artist(Lb.artistIdByName('Ana Ruiz')); return a && a.imageId && Lb.coverUrl(a.imageId); });
  check(ana === 'https://upload.wikimedia.org/thumb/ana.png', 'missing artist picture found on Wikipedia');
  check(log.api.some((p) => p.startsWith('/v1/search?type=artist')), 'tries Spotify search first when connected');
  await snap(page, 'sp-05-import-page.png');

  // Everything survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.Freeify.library && window.Freeify.library.count() === 7);
  const persisted = await L(() => { const Lb = window.Freeify.library; return { pl: Lb.playlists().length, pic: !!Lb.artist(Lb.artistIdByName('Lumen Fields')).imageId, remote: Lb.all().filter((t) => t.remote).length }; });
  check(persisted.pl === 2 && persisted.pic && persisted.remote === 3, 'Spotify data persisted after reload');

  await page.goto(BASE + '#/import');
  await page.click('[data-act="sp-disconnect"]');
  await page.waitForSelector('#redirect-uri');
  check(true, 'disconnect returns to the connect steps');

  console.log('\nerrors:', errors.length ? errors : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
