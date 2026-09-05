// Is the Figma desktop app itself currently running?
//
// Deliberately narrow: %LOCALAPPDATA%\FigmaAgent\figma_agent.exe is a separate
// long-lived font helper that keeps running while the app is closed and does not
// hold a handle on app.asar. Matching it would make the installer refuse to run
// on a perfectly idle machine.
//
// The names to look for come from the installs that were actually discovered,
// so stable ("Figma.exe") and beta ("Figma Beta.exe") are both covered without
// hardcoding either — with those two as the fallback when nothing was passed.
const { execFileSync } = require('child_process');

const DEFAULT_EXECUTABLES = ['figma.exe', 'figma beta.exe'];

/**
 * @param {string[]} [executables] file names to match, case-insensitive
 * @returns {string[]} names of matching processes currently running
 */
function runningFigmaApps(executables) {
  const wanted = new Set(
    (executables && executables.length ? executables : DEFAULT_EXECUTABLES).map((n) =>
      n.toLowerCase()
    )
  );

  let out;
  try {
    out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  } catch {
    return []; // tasklist unavailable — let the file write fail loudly instead
  }

  const names = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)"/);
    if (m && wanted.has(m[1].toLowerCase())) names.add(m[1]);
  }
  return [...names];
}

module.exports = { runningFigmaApps, DEFAULT_EXECUTABLES };
