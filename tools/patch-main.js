// Source patches applied to the desktop shell's bundled main.js.
//
// The shell funnels every locale decision through one helper:
//
//   function X_(e){var r;return(r=e.filter(i=>vte.includes(i))[0])!=null?r:fn.DEFAULT}
//
// Three paths reach it: the OS locale at startup, the `locale`/`locales` fields
// restored from settings.json, and — the one that actually decides what you see
// — the "setLocales" IPC message the web app sends once it knows the account
// language. Anything not on Figma's supported list collapses to "en", which is
// why merely dropping an i18n/ru.json next to the shipped dictionaries does
// nothing: the moment the web app reports "en", the shell switches back.
//
// Pinning this one function answers all three paths at once, and the dictionary
// loader then picks up i18n/ru.json on demand (`t.hasDictionary(e)||I6e(e)`), so
// no locale registry needs editing.
//
// Identifiers are minified and change with every Figma build, so the patch
// matches on the shape of the code rather than on names.

const LOCALE_FUNNEL = new RegExp(
  'function\\s+([A-Za-z_$][\\w$]*)\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\{' +
    'var\\s+([A-Za-z_$][\\w$]*);' +
    'return\\s*\\(\\s*\\3\\s*=\\s*\\2\\.filter\\(\\s*([A-Za-z_$][\\w$]*)\\s*=>\\s*' +
    '([A-Za-z_$][\\w$]*)\\.includes\\(\\s*\\4\\s*\\)\\s*\\)\\[0\\]\\s*\\)\\s*!=\\s*null\\s*\\?' +
    '\\s*\\3\\s*:\\s*([A-Za-z_$][\\w$]*)\\.DEFAULT\\s*\\}'
);

/**
 * @param {string} source contents of main.js
 * @param {string} locale locale id to pin the shell to
 * @returns {{source: string, applied: string[]}}
 * @throws if the expected code shape is not found
 */
function patchMain(source, locale = 'ru') {
  const match = source.match(LOCALE_FUNNEL);
  if (!match) {
    // User-facing: this is the one failure a Figma update is likely to cause.
    throw new Error(
      'в этой версии Figma функция выбора языка выглядит иначе, чем ожидает патч'
    );
  }

  const patched = source.replace(
    LOCALE_FUNNEL,
    () => `function ${match[1]}(${match[2]}){return${JSON.stringify(locale)}}`
  );
  return {
    source: patched,
    applied: [`язык оболочки закреплён за «${locale}» (функция ${match[1]})`],
  };
}

module.exports = { patchMain, LOCALE_FUNNEL };
