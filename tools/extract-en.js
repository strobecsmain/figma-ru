// Extract the desktop shell's English source dictionary out of the bundled JS.
//
// Figma stores the shell's translatable strings in two different shapes:
//
//  * main.js (menus, dialogs, tabs, tab context menu) — esbuild output, one
//    minified binding per string, `<id>={string:"...",context:"..."|`...`}`,
//    registered under a stable key by `to(<bundle>,{ "<key>":()=><id>, ... })`.
//  * desktop_shell.js (`desktop.shell_app.*`, the tab-bar renderer) — inlined
//    JSON entries, `"<key>":{"string":"..."}`.
//
// Together they reproduce the key set shipped in i18n/<locale>.json, which is
// what makes it possible to check a translation for completeness against the
// exact build being patched.
const fs = require('fs');
const path = require('path');

/** Read a JS string literal starting at `i` (which must be a quote char). */
function readStringLiteral(src, i) {
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === quote) return { raw: src.slice(i, j + 1), end: j + 1 };
    else j++;
  }
  return null;
}

function evalLiteral(raw) {
  try {
    return (0, eval)('(' + raw + ')');
  } catch {
    return null;
  }
}

/**
 * esbuild-style bindings: `"<key>":()=><id>` pairs registered through the
 * bundler's export helper.
 *
 * The helper's own name is minified and changes between builds — it is `to(` in
 * 126.9.6 and `eo(` in 126.9.1 — so anchoring on it silently loses two thirds of
 * the dictionary one patch release away, and the installer would then report the
 * translation as complete. The `"desktop.*":()=>id` pairs are self-identifying,
 * so they are scanned directly instead.
 */
function collectEsbuild(src, dict) {
  const keyToId = {};
  const pairRe = /"(desktop\.[^"]+)":\(\)=>([A-Za-z_$][\w$]*)/g;
  let p;
  while ((p = pairRe.exec(src))) keyToId[p[1]] = p[2];

  // Minified declarations are comma-chained (`var a={...},b={...}`), so anchor
  // on the identifier rather than on `var`.
  const idToStr = {};
  const declRe = /([A-Za-z_$][\w$]*)=\{string:/g;
  let d;
  while ((d = declRe.exec(src))) {
    const lit = readStringLiteral(src, declRe.lastIndex);
    if (!lit) continue;
    const value = evalLiteral(lit.raw);
    if (typeof value === 'string') idToStr[d[1]] = value;
  }

  for (const [key, id] of Object.entries(keyToId)) {
    if (idToStr[id] !== undefined) dict[key] = idToStr[id];
  }
}

/** Inlined JSON entries, scanned one at a time. */
function collectInlineJson(src, dict) {
  const anchorRe = /"(desktop\.[^"]+)":\{"string":/g;
  let a;
  while ((a = anchorRe.exec(src))) {
    const lit = readStringLiteral(src, anchorRe.lastIndex);
    if (!lit) continue;
    const value = evalLiteral(lit.raw);
    if (typeof value === 'string' && dict[a[1]] === undefined) dict[a[1]] = value;
  }
}

/**
 * @param {string[]} files paths to main.js and desktop_shell.js
 * @returns {Record<string,string>} translation key -> English string
 */
function extractEnglish(files) {
  const dict = {};
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    collectEsbuild(src, dict);
    collectInlineJson(src, dict);
  }
  return Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
}

if (require.main === module) {
  const sources = process.argv.slice(2, -1);
  const out = process.argv[process.argv.length - 1];
  if (!sources.length || !out) {
    console.error('usage: node extract-en.js <main.js> [desktop_shell.js ...] <out.json>');
    process.exit(1);
  }
  const dict = extractEnglish(sources);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(dict, null, 2), 'utf8');
  console.log(`strings resolved: ${Object.keys(dict).length} -> ${out}`);
}

module.exports = { extractEnglish };
