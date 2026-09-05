#!/usr/bin/env node
// Restore the stock Figma desktop app from the backups install.js made.
//
//   node uninstall.js              restore every patched build, any channel
//   node uninstall.js --keep       restore but leave the backup files in place
//   node uninstall.js --root <dir> look under <dir> instead of the usual places
//
// The backup is checked before it is trusted: copying a truncated or already
// patched file over a working app.asar produces the same silent failure as
// every other problem here — Figma simply never opens.
const fs = require('fs');
const path = require('path');

const { findInstalls } = require('./tools/find-installs');
const { runningFigmaApps } = require('./tools/proc');
const { inspectArchive } = require('./tools/pristine');

const args = process.argv.slice(2);
const keepBackups = args.includes('--keep');
const rootIndex = args.indexOf('--root');
const root = rootIndex > -1 ? args[rootIndex + 1] : undefined;

const installs = findInstalls({ root });
const patched = installs.filter((i) => fs.existsSync(i.backup));

if (!patched.length) {
  console.log('Восстанавливать нечего — сохранённых копий оригинала не найдено.');
  console.log('Похоже, перевод не установлен.');
  process.exit(0);
}

const executables = installs.map((i) => i.exe && path.basename(i.exe)).filter(Boolean);
const running = runningFigmaApps(executables);
if (running.length) {
  console.error(`Figma запущена (${running.join(', ')}). Закройте окно Figma и запустите снова.`);
  console.error('Если окна не видно: Ctrl+Shift+Esc → найдите Figma → «Снять задачу».');
  console.error('Значок «Figma Agent» в трее закрывать не нужно — он не мешает.');
  process.exit(1);
}

let ok = 0;
for (const install of patched) {
  const staging = path.join(path.dirname(install.asar), 'app.asar.figma-ru-restore');
  try {
    const { stock, reasons } = inspectArchive(install.backup, 'ru');
    if (!stock) {
      throw new Error(
        `сохранённая копия не похожа на оригинал (${reasons.join('; ')}) — не трогаю. ` +
          'Верните английскую версию, переустановив Figma'
      );
    }

    // Same-volume rename, so app.asar is either replaced completely or not at all.
    fs.copyFileSync(install.backup, staging);
    fs.renameSync(staging, install.asar);
    if (!keepBackups) fs.unlinkSync(install.backup);
    console.log(`восстановлено: ${install.product} ${install.version}`);
    ok++;
  } catch (e) {
    console.error(`НЕ УДАЛОСЬ ${install.product} ${install.version}: ${e.message}`);
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

console.log(`\nГотово: ${ok} из ${patched.length}.`);
if (ok) console.log('Figma снова на английском.');
process.exit(ok === patched.length ? 0 : 1);
