/*
 * Freeify: minimal ZIP reader, so albums downloaded as .zip (for example from Bandcamp) can be added
 * directly. Reads the central directory and extracts only the entries we need, without loading the
 * whole archive into memory. Supports "stored" and "deflate" entries (what music stores use).
 */
(function (F) {
  'use strict';

  const SIG_EOCD = 0x06054b50;
  const SIG_CEN = 0x02014b50;
  const SIG_LOC = 0x04034b50;
  const utf8 = new TextDecoder('utf-8');
  const cp437ish = new TextDecoder('iso-8859-1');

  const bytes = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

  /** List the files inside a zip: [{ name, method, compressedSize, size, offset }]. */
  async function list(file) {
    const tailLen = Math.min(file.size, 22 + 65535);
    const tail = await bytes(file, file.size - tailLen, file.size);
    const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${file.name} is not a zip file.`);
    const count = dv.getUint16(eocd + 10, true);
    const cenSize = dv.getUint32(eocd + 12, true);
    const cenOffset = dv.getUint32(eocd + 16, true);
    if (cenOffset === 0xffffffff || count === 0xffff) throw new Error(`${file.name} is too large (ZIP64 is not supported).`);
    const cen = await bytes(file, cenOffset, cenOffset + cenSize);
    const cv = new DataView(cen.buffer, cen.byteOffset, cen.byteLength);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cen.length; n++) {
      if (cv.getUint32(p, true) !== SIG_CEN) break;
      const flags = cv.getUint16(p + 8, true);
      const method = cv.getUint16(p + 10, true);
      const compressedSize = cv.getUint32(p + 20, true);
      const size = cv.getUint32(p + 24, true);
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commentLen = cv.getUint16(p + 32, true);
      const offset = cv.getUint32(p + 42, true);
      const raw = cen.subarray(p + 46, p + 46 + nameLen);
      const name = (flags & 0x800 ? utf8 : cp437ish).decode(raw);
      if (!name.endsWith('/')) entries.push({ name, method, compressedSize, size, offset, encrypted: !!(flags & 1) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /** Extract one entry as a Blob. */
  async function extract(file, entry) {
    if (entry.encrypted) throw new Error(`${entry.name} is password protected.`);
    const head = await bytes(file, entry.offset, entry.offset + 30);
    const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (hv.getUint32(0, true) !== SIG_LOC) throw new Error(`Damaged zip entry: ${entry.name}`);
    const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    const data = file.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unpack zip files. Unzip it first, then add the songs.');
      return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    }
    throw new Error(`Unsupported compression in ${entry.name}`);
  }

  /**
   * Unpack the useful files (audio, .lrc lyrics) from a zip as File objects.
   * keep(name) decides which entries to extract.
   */
  async function unpack(file, keep) {
    const out = [];
    const base = file.name.replace(/\.zip$/i, '');
    for (const entry of await list(file)) {
      const leaf = entry.name.replace(/^.*\//, '');
      if (!leaf || leaf.startsWith('.') || entry.name.startsWith('__MACOSX/') || !keep(leaf)) continue;
      const blob = await extract(file, entry);
      const f = new File([blob], leaf, { type: '' });
      try { Object.defineProperty(f, 'relPath', { value: `${base}/${entry.name}` }); } catch (e) { /* ignore */ }
      out.push(f);
    }
    return out;
  }

  F.zip = { list, extract, unpack };
})(window.Freeify = window.Freeify || {});
