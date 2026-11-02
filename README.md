# Freeify

**A Spotify-style music player for the MP3s you already own. Free forever.**

No ads, no account, no subscription, no tracking. Your songs never leave your device. Freeify is a
single web app with zero dependencies and no build step: open `index.html` and start listening.

![Freeify](icons/icon-192.png)

## Features

- **Spotify-style interface.** Home, Search, Your Library sidebar, album/artist/playlist pages,
  a player bar, a queue panel, and a full screen "now playing" view. Works on desktop and phone.
- **Reads your tags.** Title, artist, album, track number, year, genre and **embedded album art**
  from MP3 (ID3v2.2/2.3/2.4 and ID3v1) and FLAC files. Untagged files get sensible names from
  their file and folder names (`Artist/Album/01 - Title.mp3`).
- **Lyrics, including synced karaoke-style lyrics.** Embedded lyrics are shown automatically.
  Drop an `.lrc` file next to a song (same name) to get time-synced lyrics; click a line to jump to it.
- **Playlists:** create, rename, describe, reorder by drag and drop, duplicate, delete.
  Drag songs onto a playlist in the sidebar to add them.
- **Liked Songs**, recently played, "On repeat" (most played), genres, and fast accent-insensitive search.
- **Queue** with "Play next" and "Add to queue", plus shuffle, repeat all / repeat one, and a sleep timer.
- **Keeps your place.** Library, playlists, likes, queue, volume and playback position survive reloads.
- **Media keys and lock screen controls** (Media Session API), plus keyboard shortcuts (press `?`).
- **Works offline and installs as an app** (PWA) when served over http(s).
- Edit song details and lyrics, multi-select with Shift/Ctrl, right-click menus, six accent colours.

## Download

Get the latest version from the **[Releases page](https://github.com/mrmajko123/freeify/releases/latest)**:

| Device | Download |
| --- | --- |
| Windows | `Freeify-Setup-…-Windows-x64.exe` |
| Mac | `…-macOS-arm64.dmg` (Apple chip) or `…-macOS-x64.dmg` (Intel) |
| Linux | `.AppImage` or `.deb` |
| Android | `.apk` |
| iPhone / iPad | unsigned `.ipa` for sideloading, or use the web version with **Add to Home Screen** |
| Any browser | `…-Web.zip`: unzip and open `index.html` |

The release notes explain the one-time warnings you may see, because the installers are not
code-signed (signing certificates cost money).

## Bring your Spotify library

Open **Import** (in the **Add music** menu or Settings). Freeify can bring in your Liked Songs, your
playlists, saved albums and followed artists, with album covers and artist pictures:

- **Connect your Spotify account**: create a free app on the
  [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add the redirect address
  Freeify shows you, and paste the app's Client ID. (Spotify requires the developer app's owner to
  have Premium, and only shares playlists you own or collaborate on.) Works on the website (https or
  `http://127.0.0.1`) and in the desktop app.
- **Import a data export** (free, no Premium): request your data under Spotify's
  *Account → Privacy settings*, then add `YourLibrary.json` and the `Playlist…json` files.

Spotify's audio is copy-protected and licensed only for Spotify's apps, so Freeify imports everything
except the sound itself. Songs you don't have yet show greyed out (with "Open in Spotify"); add your own
files for them and Freeify matches them automatically. **Find missing pictures** fills in album covers
and artist pictures from Spotify or Wikipedia.

## Use it

### Option 1: open it directly

Download or clone this repository and open `index.html` in Chrome, Edge, Firefox or Safari.
Click **Add music files** or **Add a folder**, or drag music onto the window.

### Option 2: free hosting on GitHub Pages

This repository includes a workflow that publishes the app for free:

1. On GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually).
3. Open `https://<your-user>.github.io/freeify/` on any device and use **Install app** to add it
   to your home screen or desktop.

Each device keeps its own library: music you add on your laptop is stored in that browser only.

### Option 3: run a local server

```bash
npm start
```

or, without Node:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Supported formats

MP3 everywhere. FLAC, M4A/AAC, OGG/Opus and WAV play in any browser that supports them
(Chrome and Edge play all of these). Tags and cover art are read from MP3 and FLAC; other formats
use the file name.

Need music? Free Music Archive, Jamendo and the Internet Archive offer lots of free, legal downloads.

## Privacy and storage

- Songs are copied into your browser's private storage (IndexedDB) on this device. Nothing is uploaded.
- Your original files are never modified or deleted.
- Clearing your browser's site data for Freeify removes the library. In **Settings → Keep my library
  safe** you can ask the browser to protect it; installing Freeify as an app makes this more likely.
- How much music fits depends on your free disk space; Settings shows the current usage.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Seek 5 seconds |
| Shift + ← / → | Previous / next song |
| Shift + ↑ / ↓ | Volume |
| M / S / R | Mute / shuffle / repeat |
| L | Like the current song |
| Q / F | Queue / full screen player |
| / or Ctrl + K | Search |
| Ctrl/⌘ + A, Enter, Delete | Select all, play selection, remove from playlist |

## Project layout

```
index.html            App shell
css/styles.css        All styles
js/tags.js            ID3 / FLAC metadata and LRC lyrics parser
js/db.js              IndexedDB storage
js/library.js         Tracks, albums, artists, playlists, search, import, Spotify matching
js/spotify.js         Spotify sign-in (PKCE), library import, data-export import
js/artwork.js         Finds missing album covers and artist pictures
js/player.js          Playback engine: queue, shuffle, repeat, media keys
js/ui.js              Shared UI pieces: track lists, cards, menus, dialogs
js/views.js           Pages: home, search, library, album, artist, playlist, settings
js/app.js             Routing, player bar, queue panel, input handling
sw.js                 Offline cache
desktop/              Windows / macOS / Linux app (Electron)
mobile/               Android / iPhone app (Capacitor)
scripts/              Version bump and packaging helpers
tests/                End-to-end browser test and fixture generator
```

## Development

There is no build step: edit a file and reload. The test suite imports generated songs into
headless Chromium and exercises playback, tags, lyrics, playlists, search, persistence and
the mobile layout. It needs `ffmpeg` and `python3`:

```bash
npm install
npx playwright install chromium
npm test
```

Set `SCREENSHOTS=1` to save screenshots to `tests/.screenshots/`.

## Versions and releases

Version numbers follow a simple rule: small updates add 0.0.1 (0.1.0 → 0.1.1) and big updates add
0.1 (0.1.x → 0.2.0). Change the version with:

```bash
node scripts/bump.js patch   # small update
node scripts/bump.js minor   # big update
```

This updates every file that contains the version and adds a section to `CHANGELOG.md` for you to
fill in. When a new version is pushed, the **Release** workflow runs the tests, builds the Windows,
macOS, Linux, Android and iPhone apps, and publishes them as a GitHub Release.

Desktop apps use [Electron](https://www.electronjs.org) (`desktop/`); the phone apps use
[Capacitor](https://capacitorjs.com) (`mobile/`, see `mobile/README.md` for Android signing).

## License

MIT. Free to use, change and share.
