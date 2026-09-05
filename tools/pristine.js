// Decide whether an app.asar is Figma's own, unpatched archive.
//
// Without this check the installer can destroy the only stock copy. Delete the
// backup to reclaim disk, re-run, and the "original" gets written from an
// already-patched archive; uninstall then restores that as the original and
// removes the backup, leaving no way back except reinstalling Figma. The same
// check guards the restore side, so a truncated or patched backup is never
// copied over a working archive.
const { LAYER_MARKER } = require('./verify');
const asar = require('./asar');

/**
 * @param {string} archivePath
 * @param {string} locale locale id this patch adds
 * @returns {{stock: boolean, reasons: string[]}} reasons list what looks patched
 */
function inspectArchive(archivePath, locale = 'ru') {
  const reasons = [];

  let read;
  try {
    read = asar.readArchive(archivePath);
  } catch (e) {
    return { stock: false, reasons: [`архив не читается (${e.message})`] };
  }
  const { buf, header, dataOffset } = read;

  function readFile(rel) {
    let found = null;
    asar.walkFiles(header, '', (p, entry) => {
      if (p === rel && !asar.isExternal(entry)) found = entry;
    });
    if (!found) return null;
    const start = dataOffset + Number(found.offset);
    return buf.subarray(start, start + found.size);
  }

  if (readFile(`i18n/${locale}.json`)) reasons.push(`в нём уже есть i18n/${locale}.json`);

  const preload = readFile('web_app_binding_renderer.js');
  if (preload && preload.toString('utf8').includes(LAYER_MARKER)) {
    reasons.push('в нём уже есть слой перевода редактора');
  }

  // Keyed on traces this patch leaves behind, never on whether the locale funnel
  // still matches. Those are not the same question: a Figma build whose minified
  // code is shaped differently is pristine but unrecognised, and rejecting it
  // here would abort the whole install — including the editor layer, which does
  // not depend on that code — and advise reinstalling Figma, which would
  // reproduce the very same shape.
  const main = readFile('main.js');
  if (!main) reasons.push('в нём нет main.js');
  else if (new RegExp(`function\\s+[A-Za-z_$][\\w$]*\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*\\)\\s*\\{\\s*return\\s*"${locale}"\\s*\\}`).test(main.toString('utf8'))) {
    reasons.push('язык в нём уже закреплён этим патчем');
  }

  return { stock: reasons.length === 0, reasons };
}

module.exports = { inspectArchive };
