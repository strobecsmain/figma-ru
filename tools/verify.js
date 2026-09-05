// Check a freshly built archive before it replaces the user's app.asar.
//
// Every way this patch can go wrong produces the same symptom — Figma runs
// main.js, logs one line and exits, with no error anywhere — so a bad archive is
// expensive to diagnose and easy to ship. These assertions run against the
// staged file; only if they all pass does anything get overwritten.
const fs = require('fs');

const asar = require('./asar');

const LAYER_MARKER = 'figma-ru:editor-layer';

/**
 * @param {string} archivePath staged archive
 * @param {object} expect
 * @param {number} expect.size         exact byte size the build must have
 * @param {number} expect.trailerBytes trailing bytes the source archive carried
 * @param {string} expect.locale       locale id the shell is pinned to
 * @param {number} expect.dictKeys     keys the shell dictionary must contain
 * @param {boolean} expect.editorLayer whether the editor layer was installed
 * @returns {string[]} human-readable checks that passed
 * @throws on the first failed check
 */
function verifyArchive(archivePath, expect) {
  const passed = [];

  const actualSize = fs.statSync(archivePath).size;
  if (actualSize !== expect.size) {
    throw new Error(
      `archive is ${actualSize} bytes, must be exactly ${expect.size} — Figma checks this and ` +
        'would refuse to start'
    );
  }
  passed.push(`size is exactly ${expect.size} bytes`);

  let read;
  try {
    read = asar.readArchive(archivePath);
  } catch (e) {
    throw new Error(`archive header is unreadable: ${e.message}`);
  }
  const { buf, header, dataOffset, trailer } = read;

  if (trailer.length !== expect.trailerBytes) {
    throw new Error(
      `archive trailer is ${trailer.length} bytes, expected ${expect.trailerBytes} — Figma will ` +
        'not start without it'
    );
  }
  passed.push(`${trailer.length}-byte trailer preserved`);

  // Every stored entry must lie inside the file. A truncated or misaligned pack
  // shows up here rather than as a silent boot failure.
  let entries = 0;
  asar.walkFiles(header, '', (rel, entry) => {
    if (asar.isExternal(entry)) return;
    entries++;
    const start = dataOffset + Number(entry.offset);
    if (start < dataOffset || start + entry.size > buf.length) {
      throw new Error(`entry ${rel} points outside the archive (${start}+${entry.size})`);
    }
  });
  passed.push(`${entries} entries lie within bounds`);

  function readFile(rel) {
    let found = null;
    asar.walkFiles(header, '', (path_, entry) => {
      if (path_ === rel && !asar.isExternal(entry)) found = entry;
    });
    if (!found) throw new Error(`missing from archive: ${rel}`);
    const start = dataOffset + Number(found.offset);
    return buf.subarray(start, start + found.size);
  }

  const dictPath = `i18n/${expect.locale}.json`;
  let dict;
  try {
    dict = JSON.parse(readFile(dictPath).toString('utf8'));
  } catch (e) {
    throw new Error(`${dictPath} is not valid JSON: ${e.message}`);
  }
  const keyCount = Object.keys(dict).length;
  if (keyCount < expect.dictKeys) {
    throw new Error(`${dictPath} has ${keyCount} keys, expected ${expect.dictKeys}`);
  }
  passed.push(`${dictPath} parses with ${keyCount} keys`);

  // Only assert the pin when the shell half was actually applied: a build whose
  // main.js no longer matches is installed with the editor layer alone.
  if (expect.localePinned !== false) {
    const main = readFile('main.js').toString('utf8');
    const pinned = new RegExp(
      'function\\s+[A-Za-z_$][\\w$]*\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{\\s*return\\s*' +
        JSON.stringify(expect.locale) +
        '\\s*\\}'
    );
    if (!pinned.test(main)) {
      throw new Error(`main.js does not contain the locale pinned to "${expect.locale}"`);
    }
    passed.push(`main.js locale pinned to "${expect.locale}"`);
  }

  if (expect.editorLayer) {
    const preload = readFile('web_app_binding_renderer.js').toString('utf8');
    if (!preload.includes(LAYER_MARKER)) {
      throw new Error('web_app_binding_renderer.js does not carry the editor layer');
    }
    passed.push('editor layer present in the web view preload');
  }

  return passed;
}

module.exports = { verifyArchive, LAYER_MARKER };
