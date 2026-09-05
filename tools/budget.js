// Free room inside app.asar for the Russian dictionary and the editor layer.
//
// The archive's total size is fixed (see tools/fit.js), so everything added has
// to be paid for out of what is already there. Two levers, cheapest first:
//
//   1. Minify the dictionaries Figma ships pretty-printed. Non-destructive —
//      every language keeps working — so this is always applied.
//   2. Drop a shipped dictionary entirely. Destructive: that language stops
//      working in the desktop shell, so locales are sacrificed one at a time and
//      only while the archive still does not fit.
//
// Sizes differ between the stable and beta channels and between versions, so the
// plan is computed against the build being patched rather than hardcoded.
const fs = require('fs');
const path = require('path');

// Sacrificed in this order. Russian users are the audience, so the languages
// least likely to be wanted here go first; English is never a candidate because
// it is compiled into main.js rather than shipped as a dictionary.
const SACRIFICE_ORDER = ['ja', 'ko-kr', 'pt-br', 'es-la', 'es-es', 'fr', 'de'];

function localeDir(srcDir) {
  return path.join(srcDir, 'i18n');
}

/** List the locale ids shipped in the extracted tree. */
function shippedLocales(srcDir) {
  const dir = localeDir(srcDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

/**
 * Re-serialise every shipped dictionary without indentation.
 * @returns {{reclaimed: number, files: number}}
 */
function minifyDictionaries(srcDir, skip = []) {
  const dir = localeDir(srcDir);
  let reclaimed = 0;
  let files = 0;

  for (const locale of shippedLocales(srcDir)) {
    if (skip.includes(locale)) continue;
    const file = path.join(dir, `${locale}.json`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // not a dictionary we understand; leave it alone
    }
    const before = fs.statSync(file).size;
    fs.writeFileSync(file, JSON.stringify(parsed), 'utf8');
    const after = fs.statSync(file).size;
    if (after < before) {
      reclaimed += before - after;
      files++;
    }
  }
  return { reclaimed, files };
}

/**
 * Remove one shipped dictionary from both the tree and the header.
 * @returns {number} bytes freed
 */
function dropLocale(srcDir, header, locale) {
  const file = path.join(localeDir(srcDir), `${locale}.json`);
  if (!fs.existsSync(file)) return 0;
  const size = fs.statSync(file).size;
  fs.rmSync(file, { force: true });
  if (header.files && header.files.i18n && header.files.i18n.files) {
    delete header.files.i18n.files[`${locale}.json`];
  }
  return size;
}

/**
 * Pick the next locale to sacrifice: the first one in SACRIFICE_ORDER that is
 * still present, then any remaining shipped locale, never `keep`.
 */
function nextSacrifice(srcDir, keep = []) {
  const present = shippedLocales(srcDir).filter((l) => !keep.includes(l));
  for (const candidate of SACRIFICE_ORDER) {
    if (present.includes(candidate)) return candidate;
  }
  return present[0] || null;
}

module.exports = { minifyDictionaries, dropLocale, nextSacrifice, shippedLocales, SACRIFICE_ORDER };
