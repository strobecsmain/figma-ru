// Bundle the editor translation layer into a single self-contained script.
//
// The result is appended verbatim to web_app_binding_renderer.js inside
// app.asar. It has to be self-contained: that preload runs sandboxed, so it
// cannot `require` a sibling file or read the dictionary off disk — the phrases
// are inlined into the engine instead.
//
// The validations here exist because every one of them is a defect the running
// app would express as something other than an error: a duplicate key silently
// loses a translation, a translation that is also a key makes the DOM observer
// oscillate forever, and a missing leading semicolon turns the concatenated
// preload into a call expression that throws at load.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'web');
const ENGINE = path.join(SRC, 'engine.js');
const PHRASES = path.join(SRC, 'phrases.json');
const CHROME_ONLY = path.join(SRC, 'chrome-only.json');
const RAIL = path.join(SRC, 'rail-button.js');

/** Must match engine.js's normalise() — see the collision check below. */
function normalise(text) {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Detect duplicate keys, which `JSON.parse` would silently collapse — the last
 * one wins and an earlier translation disappears without any error.
 */
function findDuplicateKeys(jsonText) {
  const seen = new Set();
  const duplicates = [];
  const keyRe = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  let m;
  while ((m = keyRe.exec(jsonText))) {
    const key = JSON.parse(`"${m[1]}"`);
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  }
  return duplicates;
}

/**
 * Minify the assembled layer with terser when it is available.
 *
 * The archive is size-capped, so shipping the layer as readable commented source
 * wastes budget that would otherwise cost a shipped language dictionary. terser
 * is a build-time dependency only — end users get the .exe — so if it is missing
 * (e.g. a checkout without `npm install`) the layer is shipped unminified rather
 * than failing the build.
 *
 * The `figma-ru:` marker comments MUST survive: tools/verify.js and
 * tools/pristine.js detect the layer by them.
 */
async function minify(code) {
  let terser;
  try {
    terser = require('terser');
  } catch (e) {
    return { code, minified: false };
  }
  const result = await terser.minify(code, {
    compress: true,
    mangle: true,
    format: { comments: /figma-ru/ },
  });
  if (!result.code) throw new Error('terser produced no output');
  return { code: result.code, minified: true };
}

async function buildEditorLayer(options) {
  const opts = options || {};
  const jsonText = fs.readFileSync(PHRASES, 'utf8');

  const duplicates = findDuplicateKeys(jsonText);
  if (duplicates.length) {
    throw new Error(
      `duplicate phrase keys in phrases.json (earlier translations would be lost): ${duplicates.join(', ')}`
    );
  }

  const phrases = JSON.parse(jsonText);
  const keys = new Set(Object.keys(phrases));

  for (const [en, ru] of Object.entries(phrases)) {
    if (typeof ru !== 'string' || !ru) throw new Error(`phrase "${en}" has no translation`);
    if (en === ru) throw new Error(`phrase "${en}" is untranslated (identical to English)`);
    // A translation that is also a key means the engine would translate its own
    // output on the next mutation and never settle.
    if (keys.has(ru)) {
      throw new Error(
        `phrase "${en}" translates to "${ru}", which is itself a key — the DOM observer would ` +
          'rewrite it forever'
      );
    }
  }

  // engine.js registers a normalised alias for every key, first one winning, so
  // two keys that normalise alike are a silent shadow rather than a duplicate.
  const byNormalised = new Map();
  for (const [en, ru] of Object.entries(phrases)) {
    const norm = normalise(en);
    if (!byNormalised.has(norm)) byNormalised.set(norm, new Map());
    byNormalised.get(norm).set(en, ru);
  }
  for (const [norm, group] of byNormalised) {
    const translations = new Set(group.values());
    if (group.size > 1 && translations.size > 1) {
      throw new Error(
        `keys ${[...group.keys()].map((k) => JSON.stringify(k)).join(' and ')} differ only in ` +
          `punctuation but have different translations — only the first would ever be used ` +
          `(normalised form: ${JSON.stringify(norm)})`
      );
    }
  }

  const chromeOnly = JSON.parse(fs.readFileSync(CHROME_ONLY, 'utf8'));
  if (!Array.isArray(chromeOnly)) throw new Error('chrome-only.json must be an array of keys');
  const unknown = chromeOnly.filter((k) => !keys.has(k));
  if (unknown.length) {
    throw new Error(`chrome-only.json lists keys absent from phrases.json: ${unknown.join(', ')}`);
  }

  const engine = fs.readFileSync(ENGINE, 'utf8');
  for (const placeholder of ['__PHRASES__', '__CHROME_ONLY__']) {
    if (!engine.includes(placeholder)) {
      throw new Error(`engine.js no longer has a ${placeholder} placeholder`);
    }
  }

  // JSON.stringify output is valid JS, but `</script` and U+2028/U+2029 would be
  // hazards if this text ever reaches an HTML or JSON context.
  const literal = (value) =>
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

  const code = engine
    .replace('__PHRASES__', () => literal(phrases))
    .replace('__CHROME_ONLY__', () => literal(chromeOnly));

  // The rail button is independent of the dictionary and fails silently on its
  // own, so it is appended rather than woven in: either half can be removed
  // without touching the other.
  const rail = fs.readFileSync(RAIL, 'utf8');

  let assembled = `${code}\n;\n${rail}`;
  let minified = false;
  if (opts.minify !== false) {
    const result = await minify(assembled);
    assembled = result.code;
    minified = result.minified;
  }

  // The host preload is not guaranteed to end in a semicolon, and this file
  // starts with a comment (or, minified, with code). The leading `;` keeps the
  // two from splicing into a call expression either way.
  return {
    code: `;\n${assembled}`,
    phraseCount: keys.size,
    chromeOnlyCount: chromeOnly.length,
    minified,
  };
}

if (require.main === module) {
  buildEditorLayer().then(({ code, phraseCount, chromeOnlyCount, minified }) => {
    console.log(
      `editor layer: ${phraseCount} phrases (${chromeOnlyCount} chrome-only), ` +
        `${(code.length / 1024).toFixed(1)} KB${minified ? ' minified' : ' (not minified)'}`
    );
  });
}

module.exports = { buildEditorLayer, findDuplicateKeys, normalise };
