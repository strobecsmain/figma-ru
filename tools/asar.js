// Read/write support for Figma's app.asar.
//
// The stock `@electron/asar` package refuses to open this archive: Figma ships a
// ".codesign" pseudo-entry whose `size` is -1000, and current versions of the
// package validate every header entry on read. Electron itself does not
// validate, so the archive is perfectly loadable — we just need our own reader.
//
// Writing reuses the ORIGINAL header as a template so that `unpacked: true`
// flags (payloads living in app.asar.unpacked) and the ".codesign" entry survive
// a rebuild untouched.
//
// THE TRAILER — do not drop it.
// Figma's archive ends with 8 bytes that belong to no file: the last entry's
// offset+size stops short of the end of the file. Rebuild the archive without
// them and Figma will not start. It gets as far as executing main.js, logs its
// first line, and exits — no error, no dialog, no crash report, which makes the
// cause very easy to misattribute to the repacking itself. `readArchive` returns
// these bytes and `pack` writes them back.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024;

/** Parse the two chained pickles at the head of an asar container. */
function readArchive(archivePath) {
  const buf = fs.readFileSync(archivePath);
  const headerPickleSize = buf.readUInt32LE(4);
  const headerStringSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString('utf8', 16, 16 + headerStringSize));
  const dataOffset = 8 + headerPickleSize;

  let end = 0;
  walkFiles(header, '', (rel, entry) => {
    if (!isExternal(entry)) end = Math.max(end, Number(entry.offset) + entry.size);
  });

  return { buf, header, dataOffset, trailer: buf.subarray(dataOffset + end) };
}

/** True for entries whose bytes are not stored inside the archive. */
function isExternal(entry) {
  return Boolean(entry.unpacked) || typeof entry.size !== 'number' || entry.size < 0;
}

function walkFiles(node, rel, visit) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const relPath = path.posix.join(rel, name);
    if (entry.files) walkFiles(entry, relPath, visit);
    else visit(relPath, entry);
  }
}

function extract(archivePath, outDir) {
  const { buf, header, dataOffset, trailer } = readArchive(archivePath);
  let files = 0;
  const external = [];

  walkFiles(header, '', (relPath, entry) => {
    if (isExternal(entry)) {
      external.push(relPath);
      return;
    }
    const target = path.join(outDir, relPath);
    const start = dataOffset + Number(entry.offset);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf.subarray(start, start + entry.size));
    files++;
  });

  return { header, files, external, trailer };
}

function integrityFor(buf) {
  const blocks = [];
  for (let off = 0; off < buf.length; off += BLOCK_SIZE) {
    blocks.push(
      crypto.createHash('sha256').update(buf.subarray(off, off + BLOCK_SIZE)).digest('hex')
    );
  }
  if (blocks.length === 0) {
    blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  }
  return {
    algorithm: 'SHA256',
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

/**
 * Rebuild an archive from `srcDir`, using `templateHeader` (from the original
 * archive) for structure and metadata. The template is mutated in place.
 *
 * `trailer` must be the bytes `readArchive`/`extract` reported for the source
 * archive — omitting them yields a file Figma silently refuses to start from.
 */
function pack(templateHeader, srcDir, outPath, trailer = Buffer.alloc(0)) {
  const chunks = [];
  let offset = 0;
  let packed = 0;
  let passthrough = 0;

  walkFiles(templateHeader, '', (relPath, entry) => {
    if (isExternal(entry)) {
      passthrough++;
      return;
    }
    const buf = fs.readFileSync(path.join(srcDir, relPath));
    chunks.push(buf);
    entry.offset = String(offset);
    entry.size = buf.length;
    if (entry.integrity) entry.integrity = integrityFor(buf);
    offset += buf.length;
    packed++;
  });

  const headerBuf = Buffer.from(JSON.stringify(templateHeader), 'utf8');
  const padding = (4 - (headerBuf.length % 4)) % 4;

  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0); // payload length of the size pickle
  prefix.writeUInt32LE(8 + headerBuf.length + padding, 4); // total header pickle length
  prefix.writeUInt32LE(4 + headerBuf.length + padding, 8); // header pickle payload length
  prefix.writeUInt32LE(headerBuf.length, 12); // header string length

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    Buffer.concat([prefix, headerBuf, Buffer.alloc(padding), ...chunks, trailer])
  );
  return { packed, passthrough, trailerBytes: trailer.length };
}

module.exports = { readArchive, extract, pack, integrityFor, walkFiles, isExternal };
