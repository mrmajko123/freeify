# Changelog

Freeify version numbers: small updates add 0.0.1 (0.1.0 → 0.1.1), big updates add 0.1 (0.1.x → 0.2.0).

## 0.2.0 - 2026-11-02

Big update: bring your Spotify library into Freeify.

- **Import from Spotify**: Liked Songs, your playlists, saved albums and the artists you follow, with
  album covers and artist pictures. Sign in with a free Spotify developer app (Client ID), or
- **Import a Spotify data export** (no Premium needed): add `YourLibrary.json` and `Playlist…json`
- Songs you already have as files are matched automatically and get the missing covers and album info
- Songs you don't have yet appear greyed out with a cloud icon and can be opened in Spotify; add their
  files later and they become playable, keeping their place in your playlists and likes
- **Find missing pictures**: looks up album covers and artist pictures on Spotify or Wikipedia
- Artist pages show real artist pictures; Spotify playlists keep their cover
- "On this device only" filter in Your Music
- Desktop app: Spotify sign-in works inside the app window

## 0.1.0 - 2026-11-02

First release of Freeify, a free Spotify-style player for the music you own.

- Add MP3, FLAC, M4A, OGG, Opus and WAV files or whole folders, or drag them onto the window
- Reads song names, artists, albums, track numbers and album covers from your files
- Home, Search, Your Library, album, artist and playlist pages, plus a queue and a full screen player
- Playlists, Liked Songs, shuffle, repeat, sleep timer, media keys and keyboard shortcuts
- Synced lyrics from .lrc files
- Remembers your library, playlists and where you stopped listening
- Apps for Windows, macOS, Linux, Android and iPhone (see the install notes below)
