# Changelog

Freeify version numbers: small updates add 0.0.1 (0.1.0 → 0.1.1), big updates add 0.1 (0.1.x → 0.2.0).

## 0.3.1 - 2026-11-02

More free music sources.

- **Jamendo**: search, preview and download 600,000+ free songs from independent artists. Needs a free
  Jamendo Client ID (the Free music page shows how). Downloads work in the desktop and phone apps; the
  web version offers "Open the site" because Jamendo blocks downloads from web pages
- **.zip albums**: drop a .zip (for example a free or bought Bandcamp album) and Freeify unpacks the
  songs and lyrics automatically
- Tips on the Free music page for Bandcamp, Free Music Archive, SoundCloud and Audiomack, which don't
  allow apps to download for you
- "Find free versions of your Spotify songs" also checks Jamendo

## 0.3.0 - 2026-11-02

Big update: free music, with no ads and no account.

- **Free music** page: search and download songs that artists released under Creative Commons or
  public-domain licenses on the Internet Archive. Real files that stay in your library and play offline
- Album pages with a preview button for every song, single-song downloads and "Download album"
- **Find free versions of your Spotify songs**: looks for free, legal releases of greyed-out songs and
  downloads exact matches, which then play like any other song
- Each downloaded song keeps its license and a link to its source, shown under "About this song"
- Free music is in the sidebar and the phone menu (Settings is the gear button at the top)
- Only freely licensed music is downloaded; albums without a free license are refused

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
