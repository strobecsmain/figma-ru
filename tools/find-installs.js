// Locate Figma desktop installations on this machine.
//
// Figma ships through Squirrel.Windows: every installed build sits side by side
// under %LOCALAPPDATA%\<Product>\app-<version>\ and the launcher points at the
// newest one. Each build carries its own resources\app.asar, so a patch applies
// per build and an update lands unpatched.
//
// Channels are discovered rather than listed. Figma's own bundle names at least
// stable, beta, gov, sycamore and dev, plus branch-named builds, and each ships
// its own Squirrel tree — so any %LOCALAPPDATA%\Figma* folder laid out this way
// is treated as an install.
const fs = require('fs');
const path = require('path');

// Folder name -> label/channel for the ones worth naming nicely.
const KNOWN = {
  figma: { label: 'Figma', channel: 'stable' },
  figmabeta: { label: 'Figma Beta', channel: 'beta' },
  figmagov: { label: 'Figma Gov', channel: 'gov' },
  figmasycamore: { label: 'Figma Sycamore', channel: 'sycamore' },
  figmadev: { label: 'Figma Dev', channel: 'dev' },
};

// Not an app: the font helper installs beside the app with the same prefix.
const NOT_AN_APP = new Set(['figmaagent']);

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The build's own executable. Squirrel puts its stub (squirrel.exe, and
 * sometimes Update.exe) alongside the app, so those are excluded rather than
 * assuming the file is named after the product — beta is "Figma Beta.exe",
 * stable is "Figma.exe", and neither is guaranteed to stay that way.
 */
function findExecutable(buildDir, label) {
  let entries;
  try {
    entries = fs.readdirSync(buildDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
    .map((e) => e.name)
    .filter((name) => !/^(squirrel|update)\.exe$/i.test(name));

  const exact = candidates.find((name) => name.toLowerCase() === `${label.toLowerCase()}.exe`);
  if (exact) return path.join(buildDir, exact);

  // Fall back to the largest .exe: the app binary dwarfs any helper stub.
  let best = null;
  let bestSize = -1;
  for (const name of candidates) {
    const full = path.join(buildDir, name);
    let size;
    try {
      size = fs.statSync(full).size;
    } catch {
      continue;
    }
    if (size > bestSize) {
      bestSize = size;
      best = full;
    }
  }
  return best;
}

function describe(folderName) {
  const key = folderName.toLowerCase();
  if (NOT_AN_APP.has(key)) return null;
  if (KNOWN[key]) return KNOWN[key];
  if (!key.startsWith('figma')) return null;
  return { label: folderName, channel: folderName.slice('Figma'.length).toLowerCase() || 'stable' };
}

function makeInstall(product, version, buildDir, isCurrent) {
  return {
    product: product.label,
    channel: product.channel,
    version,
    buildDir,
    asar: path.join(buildDir, 'resources', 'app.asar'),
    backup: path.join(buildDir, 'resources', 'app.asar.figma-ru-orig'),
    exe: findExecutable(buildDir, product.label),
    isCurrent,
  };
}

/** Squirrel trees: <root>\<Product>\app-<version>\resources\app.asar */
function scanSquirrelRoot(base, found) {
  let folders;
  try {
    folders = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const product = describe(folder.name);
    if (!product) continue;

    const root = path.join(base, folder.name);
    let builds;
    try {
      builds = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    const usable = builds
      .filter((d) => d.isDirectory() && d.name.startsWith('app-'))
      .map((d) => ({ version: d.name.slice('app-'.length), dir: path.join(root, d.name) }))
      // Squirrel leaves a ".dead" marker in folders it failed to clean up.
      .filter((b) => !fs.existsSync(path.join(b.dir, '.dead')))
      .filter((b) => fs.existsSync(path.join(b.dir, 'resources', 'app.asar')))
      .sort((a, b) => compareVersions(b.version, a.version));

    usable.forEach((b, i) => found.push(makeInstall(product, b.version, b.dir, i === 0)));
  }
}

/** Non-Squirrel layout: <ProgramFiles>\Figma\resources\app.asar */
function scanFlatRoot(base, found) {
  let folders;
  try {
    folders = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const product = describe(folder.name);
    if (!product) continue;
    const dir = path.join(base, folder.name);
    if (!fs.existsSync(path.join(dir, 'resources', 'app.asar'))) continue;
    found.push(makeInstall(product, 'установленная', dir, true));
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.root] search under this directory instead of the
 *   standard locations — for installs elsewhere, and for tests. Also read from
 *   the FIGMA_RU_ROOT environment variable.
 */
function findInstalls(opts = {}) {
  const override = opts.root || process.env.FIGMA_RU_ROOT;
  const found = [];

  if (override) {
    scanSquirrelRoot(override, found);
    scanFlatRoot(override, found);
    return found;
  }

  if (process.env.LOCALAPPDATA) scanSquirrelRoot(process.env.LOCALAPPDATA, found);
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)']) {
    if (process.env[key]) scanFlatRoot(process.env[key], found);
  }
  return found;
}

if (require.main === module) {
  const rootArg = process.argv.indexOf('--root');
  const installs = findInstalls(rootArg > -1 ? { root: process.argv[rootArg + 1] } : {});

  if (!installs.length) {
    console.log('Figma не найдена.');
    console.log('Искал в %LOCALAPPDATA% папки Figma / FigmaBeta и в Program Files.');
    console.log('Если Figma установлена в другое место: --root <папка>');
    process.exit(1);
  }
  for (const i of installs) {
    const state = fs.existsSync(i.backup) ? 'переведена' : 'без перевода';
    console.log(`${i.product} ${i.version} [${i.channel}]${i.isCurrent ? ' (текущая)' : ''} — ${state}`);
    console.log(`  ${i.asar}`);
  }
}

module.exports = { findInstalls, compareVersions, findExecutable, KNOWN };
