/*
 * Freeify: dependency-free metadata reader.
 * Supports ID3v2.2 / v2.3 / v2.4 (title, artist, album, cover art, lyrics...),
 * ID3v1 as a fallback, and FLAC Vorbis comments + embedded pictures.
 */
(function (F) {
  'use strict';

  const latin1 = new TextDecoder('iso-8859-1');
  const utf8 = new TextDecoder('utf-8');
  const utf16le = new TextDecoder('utf-16le');
  const utf16be = new TextDecoder('utf-16be');

  // ID3v1 genre table (0-79, the original list plus Winamp's first extensions up to 125).
  const GENRES = ('Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,Reggae,Rock,Techno,Industrial,' +
    'Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,Jazz+Funk,Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,' +
    'Alternative Rock,Bass,Soul,Punk,Space,Meditative,Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,Pop-Folk,Eurodance,Dream,Southern Rock,Comedy,Cult,Gangsta,' +
    'Top 40,Christian Rap,Pop/Funk,Jungle,Native American,Cabaret,New Wave,Psychedelic,Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,Rock & Roll,Hard Rock,' +
    'Folk,Folk-Rock,National Folk,Swing,Fast Fusion,Bebop,Latin,Revival,Celtic,Bluegrass,Avantgarde,Gothic Rock,Progressive Rock,Psychedelic Rock,Symphonic Rock,Slow Rock,Big Band,Chorus,Easy Listening,Acoustic,' +
    'Humour,Speech,Chanson,Opera,Chamber Music,Sonata,Symphony,Booty Bass,Primus,Porn Groove,Satire,Slow Jam,Club,Tango,Samba,Folklore,Ballad,Power Ballad,Rhythmic Soul,Freestyle,' +
    'Duet,Punk Rock,Drum Solo,A Cappella,Euro-House,Dance Hall').split(',');

  const FRAME_MAP = {
    TIT2: 'title', TT2: 'title',
    TPE1: 'artist', TP1: 'artist',
    TALB: 'album', TAL: 'album',
    TPE2: 'albumArtist', TP2: 'albumArtist',
    TRCK: 'track', TRK: 'track',
    TPOS: 'disc', TPA: 'disc',
    TYER: 'year', TYE: 'year', TDRC: 'year', TDOR: 'year', TORY: 'year',
    TCON: 'genre', TCO: 'genre',
    TSRC: 'isrc', TRC: 'isrc',
  };

  const VORBIS_MAP = {
    TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist',
    TRACKNUMBER: 'track', DISCNUMBER: 'disc', DATE: 'year', YEAR: 'year', ORIGINALDATE: 'year', GENRE: 'genre',
    LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics', ISRC: 'isrc',
  };

  const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u24 = (b, o) => (b[o] << 16) + (b[o + 1] << 8) + b[o + 2];

  async function readBytes(file, start, end) {
    if (start >= file.size) return new Uint8Array(0);
    return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
  }

  /** Undo ID3 "unsynchronisation" (0xFF 0x00 -> 0xFF). */
  function unsync(bytes) {
    const out = new Uint8Array(bytes.length);
    let j = 0;
    for (let i = 0; i < bytes.length; i++) {
      out[j++] = bytes[i];
      if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
    }
    return out.subarray(0, j);
  }

  function decode(enc, bytes) {
    switch (enc) {
      case 1:
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16le.decode(bytes.subarray(2));
        return utf16le.decode(bytes);
      case 2: return utf16be.decode(bytes);
      case 3: return utf8.decode(bytes);
      default: return latin1.decode(bytes);
    }
  }

  const wide = (enc) => enc === 1 || enc === 2;

  function findTerminator(bytes, start, enc) {
    if (wide(enc)) {
      for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    } else {
      for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
    }
    return -1;
  }

  /** Read a terminated string. Returns [text, indexAfterTerminator]. */
  function readString(bytes, start, enc) {
    const end = findTerminator(bytes, start, enc);
    if (end < 0) return [decode(enc, bytes.subarray(start)), bytes.length];
    return [decode(enc, bytes.subarray(start, end)), end + (wide(enc) ? 2 : 1)];
  }

  function textFrame(data) {
    const enc = data[0];
    const parts = [];
    let i = 1;
    while (i < data.length) {
      const [s, next] = readString(data, i, enc);
      const clean = s.replace(/\0/g, '').trim();
      if (clean) parts.push(clean);
      i = next;
    }
    return parts.join(', ');
  }

  function pictureFrame(data, v22) {
    const enc = data[0];
    let i, mime;
    if (v22) {
      mime = 'image/' + latin1.decode(data.subarray(1, 4)).toLowerCase();
      i = 4;
    } else {
      const end = data.indexOf(0, 1);
      if (end < 0) return null;
      mime = latin1.decode(data.subarray(1, end)).toLowerCase().trim();
      i = end + 1;
    }
    const type = data[i++];
    const [, next] = readString(data, i, enc);
    const img = data.subarray(next);
    return makePicture(mime, type, img);
  }

  function makePicture(mime, type, img) {
    if (!img || img.length < 16) return null;
    if (img[0] === 0x89 && img[1] === 0x50 && img[2] === 0x4e) mime = 'image/png';
    else if (img[0] === 0xff && img[1] === 0xd8) mime = 'image/jpeg';
    else if (img[0] === 0x47 && img[1] === 0x49 && img[2] === 0x46) mime = 'image/gif';
    else if (img[0] === 0x52 && img[1] === 0x49 && img[8] === 0x57 && img[9] === 0x45) mime = 'image/webp';
    else if (!mime || mime.indexOf('/') < 0) mime = 'image/' + (mime || 'jpeg');
    if (mime === 'image/jpg') mime = 'image/jpeg';
    return { mime, type, data: img };
  }

  function lyricsFrame(data) {
    const enc = data[0];
    // 3 byte language, then a content descriptor, then the text.
    const [, next] = readString(data, 4, enc);
    return decode(enc, data.subarray(next)).replace(/\0+$/, '').trim();
  }

  function setPicture(out, pic) {
    if (!pic) return;
    if (!out.picture || (pic.type === 3 && out.picture.type !== 3)) out.picture = pic;
  }

  function handleFrame(id, data, v22, out) {
    if (!data.length) return;
    const key = FRAME_MAP[id];
    if (key) {
      if (!out[key]) {
        const v = textFrame(data);
        if (v) out[key] = v;
      }
    } else if (id === 'APIC' || id === 'PIC') {
      setPicture(out, pictureFrame(data, v22));
    } else if ((id === 'USLT' || id === 'ULT') && !out.lyrics) {
      const l = lyricsFrame(data);
      if (l) out.lyrics = l;
    }
  }

  function parseId3v2(tag, major, flags, out) {
    if ((flags & 0x80) && major < 4) tag = unsync(tag);
    let pos = 0;
    if (flags & 0x40) {
      if (major === 3) pos = 4 + u32(tag, 0);
      else if (major === 4) pos = syncsafe(tag, 0);
    }
    const v22 = major === 2;
    const idLen = v22 ? 3 : 4;
    const headLen = v22 ? 6 : 10;
    while (pos + headLen <= tag.length) {
      if (tag[pos] === 0) break; // padding
      const id = latin1.decode(tag.subarray(pos, pos + idLen));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      let size, fflags = 0;
      if (v22) {
        size = u24(tag, pos + 3);
      } else if (major === 4) {
        // Some writers (old iTunes) store plain integers in v2.4 frames; detect that.
        const raw = tag[pos + 4] | tag[pos + 5] | tag[pos + 6] | tag[pos + 7];
        size = (raw & 0x80) ? u32(tag, pos + 4) : syncsafe(tag, pos + 4);
        fflags = (tag[pos + 8] << 8) | tag[pos + 9];
      } else {
        size = u32(tag, pos + 4);
        fflags = (tag[pos + 8] << 8) | tag[pos + 9];
      }
      pos += headLen;
      if (size <= 0) continue;
      if (pos + size > tag.length) break;
      let data = tag.subarray(pos, pos + size);
      pos += size;
      if (major === 4) {
        if (fflags & 0x000c) continue; // compressed or encrypted: skip
        if (fflags & 0x0040) data = data.subarray(1); // grouping id
        if (fflags & 0x0001) data = data.subarray(4); // data length indicator
        if (fflags & 0x0002) data = unsync(data);
      } else if (major === 3) {
        if (fflags & 0x00c0) continue; // compressed or encrypted: skip
        if (fflags & 0x0020) data = data.subarray(1); // grouping id
      }
      try { handleFrame(id, data, v22, out); } catch (e) { /* ignore a single broken frame */ }
    }
  }

  function parseId3v1(b, out) {
    const str = (s, e) => latin1.decode(b.subarray(s, e)).replace(/\0.*$/s, '').trim();
    if (!out.title) out.title = str(3, 33);
    if (!out.artist) out.artist = str(33, 63);
    if (!out.album) out.album = str(63, 93);
    if (!out.year) out.year = str(93, 97);
    if (!out.track && b[125] === 0 && b[126]) out.track = String(b[126]);
    if (!out.genre && b[127] < GENRES.length) out.genre = GENRES[b[127]];
  }

  function vorbisComments(b, out) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    const vendorLen = dv.getUint32(p, true); p += 4 + vendorLen;
    const count = dv.getUint32(p, true); p += 4;
    for (let i = 0; i < count && p + 4 <= b.length; i++) {
      const len = dv.getUint32(p, true); p += 4;
      const s = utf8.decode(b.subarray(p, p + len)); p += len;
      const eq = s.indexOf('=');
      if (eq < 1) continue;
      const key = VORBIS_MAP[s.slice(0, eq).toUpperCase()];
      const value = s.slice(eq + 1).trim();
      if (key && value && !out[key]) out[key] = value;
    }
  }

  function flacPicture(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0;
    const type = dv.getUint32(p); p += 4;
    const mimeLen = dv.getUint32(p); p += 4;
    const mime = latin1.decode(b.subarray(p, p + mimeLen)); p += mimeLen;
    const descLen = dv.getUint32(p); p += 4 + descLen;
    p += 16; // width, height, depth, colours
    const len = dv.getUint32(p); p += 4;
    return makePicture(mime, type, b.subarray(p, p + len));
  }

  async function parseFlac(file, offset, out) {
    const marker = await readBytes(file, offset, offset + 4);
    if (latin1.decode(marker) !== 'fLaC') return false;
    let pos = offset + 4;
    for (let n = 0; n < 128; n++) {
      const h = await readBytes(file, pos, pos + 4);
      if (h.length < 4) break;
      const last = h[0] & 0x80, type = h[0] & 0x7f, len = u24(h, 1);
      pos += 4;
      if (type === 4 || type === 6) {
        const block = await readBytes(file, pos, pos + len);
        try {
          if (type === 4) vorbisComments(block, out);
          else setPicture(out, flacPicture(block));
        } catch (e) { /* ignore broken block */ }
      }
      pos += len;
      if (last) break;
    }
    return true;
  }

  function firstNumber(s) {
    const m = String(s || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function cleanGenre(g) {
    if (!g) return '';
    // "(17)", "(17)Rock", "17", "Rock"
    return g.split(/,\s*/).map((part) => {
      const m = part.match(/^\((\d+)\)(.*)$/);
      if (m) return m[2].trim() || GENRES[+m[1]] || '';
      if (/^\d+$/.test(part)) return GENRES[+part] || '';
      return part.replace(/^\(\(/, '(').trim();
    }).filter(Boolean)[0] || '';
  }

  function normalize(raw) {
    return {
      title: (raw.title || '').trim(),
      artist: (raw.artist || '').trim(),
      album: (raw.album || '').trim(),
      albumArtist: (raw.albumArtist || '').trim(),
      trackNo: firstNumber(raw.track),
      discNo: firstNumber(raw.disc),
      year: firstNumber(raw.year) || 0,
      genre: cleanGenre(raw.genre),
      picture: raw.picture || null,
      lyrics: raw.lyrics || '',
      isrc: (raw.isrc || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    };
  }

  /** Parse metadata from a File/Blob. Never throws; returns empty fields when nothing is found. */
  async function parse(file) {
    const out = {};
    try {
      const head = await readBytes(file, 0, 10);
      let audioStart = 0;
      if (head.length === 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
        const major = head[3], flags = head[5], size = syncsafe(head, 6);
        audioStart = 10 + size + ((flags & 0x10) ? 10 : 0);
        if (major >= 2 && major <= 4 && size > 0) {
          const tag = await readBytes(file, 10, 10 + size);
          parseId3v2(tag, major, flags, out);
        }
      }
      const isFlac = await parseFlac(file, audioStart, out);
      if (!isFlac && (!out.title || !out.artist) && file.size > 128) {
        const tail = await readBytes(file, file.size - 128, file.size);
        if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) parseId3v1(tail, out);
      }
    } catch (e) {
      console.warn('[freeify] could not read tags from', file.name, e);
    }
    return normalize(out);
  }

  /**
   * Parse lyrics text. Returns { synced, lines: [{ time, text }] }.
   * Understands LRC ("[01:23.45] line"), including multiple stamps per line and [offset:].
   */
  function parseLyrics(text) {
    const lines = [];
    let offset = 0;
    let synced = false;
    String(text || '').split(/\r?\n/).forEach((rawLine) => {
      const off = rawLine.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) { offset = parseInt(off[1], 10) / 1000; return; }
      if (/^\s*\[[a-z]+:.*\]\s*$/i.test(rawLine)) return; // [ar:], [ti:] ... metadata
      const stamps = [];
      let rest = rawLine;
      let m;
      const re = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
      while ((m = rest.match(re))) {
        const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
        stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
        rest = rest.slice(m[0].length);
      }
      const txt = rest.trim();
      if (stamps.length) {
        synced = true;
        stamps.forEach((t) => lines.push({ time: Math.max(0, t - offset), text: txt }));
      } else {
        lines.push({ time: -1, text: txt });
      }
    });
    if (synced) {
      const timed = lines.filter((l) => l.time >= 0).sort((a, b) => a.time - b.time);
      return { synced: true, lines: timed };
    }
    // Trim leading/trailing blank lines for plain lyrics.
    while (lines.length && !lines[0].text) lines.shift();
    while (lines.length && !lines[lines.length - 1].text) lines.pop();
    return { synced: false, lines };
  }

  F.tags = { parse, parseLyrics, GENRES };
})(window.Freeify = window.Freeify || {});
