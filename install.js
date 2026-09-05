#!/usr/bin/env node
// Apply the Russian localisation patch to the installed Figma desktop app.
//
//   node install.js                patch the current build of every channel found
//   node install.js --all          patch every installed build, not just the newest
//   node install.js --dry-run      report what would change, touch nothing
//   node install.js --shell-only   skip the editor translation layer
//   node install.js --root <dir>   look for installs under <dir> instead of %LOCALAPPDATA%
//
// Stable and beta are the same product with different folder names, so both are
// discovered and patched by the same path; nothing here is channel-specific.
//
// Two independent pieces are installed:
//
//   * The shell — menus, dialogs, tab bar. Figma localises these itself, so this
//     is a real translation: a new i18n/ru.json plus a patch that pins the
//     shell's locale to "ru" (see tools/patch-main.js).
//   * The editor — canvas panels, toolbars, the file browser. These come from
//     figma.com and have no Russian build, so they are translated in the DOM by
//     a layer appended to the web view's preload (see src/web/engine.js).
//
// They are installed independently: if a future Figma build changes the shape
// this patch matches in main.js, the editor layer still goes in and the run
// reports which half is missing, rather than failing outright.
//
// Console output is Russian because that is who this is for. Node writes to the
// console with WriteConsoleW, so Cyrillic renders correctly whatever the code
// page — which is why the .cmd launchers keep their own bodies ASCII.
const fs = require('fs');
const os = require('os');
const path = require('path');

const asar = require('./tools/asar');
const { findInstalls } = require('./tools/find-installs');
const { runningFigmaApps } = require('./tools/proc');
const { patchMain } = require('./tools/patch-main');
const { extractEnglish } = require('./tools/extract-en');
const { buildEditorLayer } = require('./tools/build-editor-layer');
const { packToExactSize } = require('./tools/fit');
const { minifyDictionaries, dropLocale, nextSacrifice } = require('./tools/budget');
const { verifyArchive } = require('./tools/verify');
const { inspectArchive } = require('./tools/pristine');

const LOCALE = 'ru';
const DICT = path.join(__dirname, 'src', 'i18n', `${LOCALE}.json`);

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : undefined;
}
const opts = {
  all: args.includes('--all'),
  dryRun: args.includes('--dry-run'),
  shellOnly: args.includes('--shell-only'),
  root: flagValue('--root'),
};

function prepareBackup(install) {
  if (fs.existsSync(install.backup)) {
    // A backup made from an already-patched archive would be restored as "the
    // original" and then deleted, so it is checked before it is trusted.
    const { stock, reasons } = inspectArchive(install.backup, LOCALE);
    if (!stock) {
      throw new Error(
        `сохранённая копия оригинала повреждена (${reasons.join('; ')}). ` +
          `Удалите файл ${path.basename(install.backup)} и переустановите Figma, ` +
          'иначе восстановить английскую версию будет нечем'
      );
    }
    console.log('  собираю заново из сохранённой копии оригинала');
    return install.backup;
  }

  const { stock, reasons } = inspectArchive(install.asar, LOCALE);
  if (!stock) {
    throw new Error(
      `этот файл Figma уже изменён (${reasons.join('; ')}), а копии оригинала рядом нет. ` +
        'Переустановите Figma, чтобы вернуть исходный файл, и запустите установку снова'
    );
  }
  if (opts.dryRun) {
    console.log(`  скопировал(а) бы оригинал в ${path.basename(install.backup)}`);
    return install.asar;
  }
  fs.copyFileSync(install.asar, install.backup);
  console.log(`  оригинал сохранён: ${path.basename(install.backup)}`);
  return install.backup;
}

async function patchInstall(install, translations) {
  const source = prepareBackup(install);
  const targetSize = fs.statSync(source).size;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ru-'));
  // Staged next to the target, not in %TEMP%: the final step is then a rename on
  // the same volume, which either replaces app.asar completely or not at all. A
  // cross-volume copy can leave it half-written, and a half-written app.asar is
  // indistinguishable from every other failure here — Figma just never opens.
  const staging = path.join(path.dirname(install.asar), 'app.asar.figma-ru-new');
  try {
    const { header, trailer } = asar.extract(source, tmp);

    const mainPath = path.join(tmp, 'main.js');
    const shellPath = path.join(tmp, 'desktop_shell.js');
    const preloadPath = path.join(tmp, 'web_app_binding_renderer.js');

    if (!fs.existsSync(mainPath)) {
      throw new Error('в архиве нет main.js — это не похоже на сборку Figma');
    }

    // Completeness check against the exact build being patched. Strings Figma
    // added since this translation was written simply stay English: the shell
    // looks each key up in [ru, en] order, so a partial dictionary degrades
    // per-string rather than failing.
    const englishSources = [mainPath];
    if (fs.existsSync(shellPath)) englishSources.push(shellPath);
    const english = extractEnglish(englishSources);
    const englishCount = Object.keys(english).length;
    const missing = Object.keys(english).filter((k) => !(k in translations));
    const stale = Object.keys(translations).filter((k) => !(k in english));

    console.log(`  строк интерфейса в этой сборке: ${englishCount}`);
    if (englishCount < Object.keys(translations).length / 2) {
      // Far too few keys means the extractor stopped matching this build, not
      // that Figma deleted most of its strings.
      console.log(
        `  ! найдено подозрительно мало строк (в словаре ${Object.keys(translations).length}). ` +
          'Проверка полноты перевода недостоверна для этой версии'
      );
    } else {
      if (missing.length) {
        console.log(`  ! без перевода останется строк: ${missing.length}`);
        missing.slice(0, 5).forEach((k) => console.log(`      ${k}`));
        if (missing.length > 5) console.log(`      … и ещё ${missing.length - 5}`);
      }
      if (stale.length) {
        console.log(`  ! в этой сборке больше нет строк из словаря: ${stale.length} (не мешает)`);
      }
    }

    // The shell and the editor layer are installed independently.
    let shellPatched = false;
    let mainSource = fs.readFileSync(mainPath, 'utf8');
    try {
      const patched = patchMain(mainSource, LOCALE);
      mainSource = patched.source;
      shellPatched = true;
      patched.applied.forEach((a) => console.log(`  ${a}`));
    } catch (e) {
      console.log(`  ! меню и диалоги останутся английскими: ${e.message}`);
      console.log(`    (сообщите версию Figma: ${install.product} ${install.version})`);
    }

    let layer = null;
    if (!opts.shellOnly) {
      if (!fs.existsSync(preloadPath)) {
        console.log('  ! не найден preload веб-вида — интерфейс редактора не будет переведён');
      } else {
        layer = await buildEditorLayer();
        console.log(
          `  слой редактора: ${layer.phraseCount} фраз, ${(layer.code.length / 1024).toFixed(1)} КБ`
        );
      }
    }

    if (!shellPatched && !layer) {
      throw new Error('не удалось применить ни одну часть перевода');
    }

    if (opts.dryRun) {
      console.log(`  [проверка] ${install.product} ${install.version} — можно патчить`);
      return true;
    }

    if (shellPatched) fs.writeFileSync(mainPath, mainSource, 'utf8');
    if (layer) fs.appendFileSync(preloadPath, `\n${layer.code}\n`, 'utf8');

    // Figma pins the size of app.asar, so anything added has to be paid for.
    // Minifying the dictionaries Figma ships pretty-printed is free — every
    // language keeps working — so it is always applied first.
    const minified = minifyDictionaries(tmp, [LOCALE]);
    console.log(`  освобождено ${minified.reclaimed} Б: словари ${minified.files} языков сжаты`);

    const ruPath = path.join(tmp, 'i18n', `${LOCALE}.json`);
    const ruBase = Buffer.from(JSON.stringify(translations), 'utf8');
    fs.mkdirSync(path.dirname(ruPath), { recursive: true });
    fs.writeFileSync(ruPath, ruBase);
    if (!header.files.i18n) header.files.i18n = { files: {} };
    // Not in the original header; register it so the packer emits it. Size,
    // offset and integrity are filled in by pack().
    header.files.i18n.files[`${LOCALE}.json`] = { size: 0, offset: '0', integrity: {} };

    console.log('  собираю архив, это занимает 5–10 секунд, не закрывайте окно…');

    // If minifying was not enough, give up one shipped language at a time —
    // and say which, because that language stops working in the shell.
    const sacrificed = [];
    let fitted = null;
    for (;;) {
      try {
        fitted = packToExactSize({
          header,
          srcDir: tmp,
          outPath: staging,
          trailer,
          targetSize,
          ballastPath: ruPath,
          ballastBase: ruBase,
        });
        break;
      } catch (e) {
        if (e.code !== 'OVER_BUDGET') throw e;
        const victim = nextSacrifice(tmp, [LOCALE]);
        if (!victim) {
          throw new Error(
            'не хватает места в архиве, и жертвовать больше нечем — сократите ' +
              'src/web/phrases.json и попробуйте снова'
          );
        }
        const freed = dropLocale(tmp, header, victim);
        sacrificed.push(victim);
        console.log(`  не хватает ${e.excess} Б: удаляю словарь «${victim}» (${freed} Б)`);
      }
    }
    if (sacrificed.length) {
      console.log(`  ! в меню Figma перестанут работать языки: ${sacrificed.join(', ')}`);
    }
    console.log(`  размер архива подогнан точно: ${targetSize} Б (запас ${fitted.padding} Б)`);

    // Nothing is overwritten until the rebuilt archive proves sound: a bad one
    // fails identically to every other failure mode here — Figma just exits.
    verifyArchive(staging, {
      size: targetSize,
      trailerBytes: trailer.length,
      locale: LOCALE,
      dictKeys: Object.keys(translations).length,
      editorLayer: Boolean(layer),
      localePinned: shellPatched,
    });
    console.log('  проверка собранного архива пройдена');

    fs.renameSync(staging, install.asar);
    console.log('  готово');
    return true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(staging, { force: true });
  }
}

function reportUpdate(all) {
  // Squirrel installs each new build beside the old one, so an update silently
  // leaves the app unpatched. If an older build here still has our backup, the
  // user is coming back after exactly that.
  const byProduct = new Map();
  for (const i of all) {
    if (!byProduct.has(i.product)) byProduct.set(i.product, []);
    byProduct.get(i.product).push(i);
  }
  for (const [product, builds] of byProduct) {
    const current = builds.find((b) => b.isCurrent);
    if (!current || fs.existsSync(current.backup)) continue;
    const previouslyPatched = builds.find((b) => !b.isCurrent && fs.existsSync(b.backup));
    if (previouslyPatched) {
      console.log(
        `${product} обновилась (${previouslyPatched.version} → ${current.version}). ` +
          'Перевод нужно поставить заново — сейчас сделаю.'
      );
    }
  }
}

async function main() {
  if (!fs.existsSync(DICT)) {
    console.error(`Не найден файл перевода: ${DICT}`);
    process.exit(1);
  }
  const translations = JSON.parse(fs.readFileSync(DICT, 'utf8'));

  const all = findInstalls({ root: opts.root });
  if (!all.length) {
    console.error('Figma не найдена.');
    console.error('Искал в %LOCALAPPDATA% папки «Figma» (стабильная) и «FigmaBeta» (бета),');
    console.error('а также в Program Files.');
    console.error('');
    console.error('Если вы запустили это от имени администратора — не надо: Figma ставится');
    console.error('в профиль пользователя, и из-под администратора её не видно.');
    console.error('Если Figma установлена в другое место, укажите его: --root <папка>');
    process.exit(1);
  }

  reportUpdate(all);
  const installs = opts.all ? all : all.filter((i) => i.isCurrent);
  console.log(`Найдено: ${[...new Set(installs.map((i) => i.product))].join(', ')}`);

  const executables = all.map((i) => i.exe && path.basename(i.exe)).filter(Boolean);
  const running = opts.dryRun ? [] : runningFigmaApps(executables);
  if (running.length) {
    console.error(`\nFigma запущена (${running.join(', ')}). Закройте окно Figma и запустите снова.`);
    console.error('Если окна не видно: Ctrl+Shift+Esc → найдите Figma → «Снять задачу».');
    console.error('Значок «Figma Agent» в трее закрывать не нужно — он не мешает.');
    process.exit(1);
  }

  let ok = 0;
  const failed = [];
  for (const install of installs) {
    console.log(`\n${install.product} ${install.version}`);
    try {
      if (await patchInstall(install, translations)) ok++;
    } catch (e) {
      console.error(`  НЕ УДАЛОСЬ: ${e.message}`);
      console.error('  установленная Figma осталась без изменений');
      failed.push(`${install.product} ${install.version}`);
    }
  }

  console.log(`\n${opts.dryRun ? 'Проверка завершена' : 'Готово'}: ${ok} из ${installs.length}.`);
  if (failed.length) console.log(`Не изменено: ${failed.join(', ')}`);
  if (!opts.dryRun && ok) {
    console.log('');
    console.log('Запустите Figma.');
    console.log('Если Figma не открывается — запустите «Вернуть английский.cmd».');
    console.log('После каждого обновления Figma запускайте этот файл снова.');
  }
  process.exit(ok === installs.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
