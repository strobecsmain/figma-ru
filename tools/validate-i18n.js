// Validate src/i18n/ru.json against the English strings extracted from the
// installed app (work/en.json).
//
// Checks, in order of how badly each one breaks the running app:
//   1. key parity      — a missing key silently falls back to English
//   2. ICU parse       — a malformed message throws inside the menu builder
//   3. placeholder set — a dropped {name} renders an empty hole; an invented
//                        one throws at format time
const fs = require('fs');
const path = require('path');
const { IntlMessageFormat } = require('intl-messageformat');

const root = path.join(__dirname, '..');
const enPath = path.join(root, 'work', 'en.json');
const ruPath = path.join(root, 'src', 'i18n', 'ru.json');

if (!fs.existsSync(enPath)) {
  console.error(`missing ${enPath} — run tools/extract-en.js against the installed app first`);
  process.exit(1);
}

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const ru = JSON.parse(fs.readFileSync(ruPath, 'utf8'));

const errors = [];
const warnings = [];

const enKeys = Object.keys(en);
const ruKeys = Object.keys(ru);

for (const k of enKeys) if (!(k in ru)) errors.push(`missing key: ${k}`);
for (const k of ruKeys) if (!(k in en)) warnings.push(`unknown key (not in this app version): ${k}`);

/** Collect argument names an ICU message references. */
function argsOf(ast, acc = new Set()) {
  for (const node of ast) {
    if (node.value !== undefined && node.type === 1) acc.add(node.value); // argument
    if (node.value !== undefined && (node.type === 2 || node.type === 3 || node.type === 4)) {
      acc.add(node.value); // number / date / time
    }
    if (node.type === 5 || node.type === 6) {
      // select / plural
      acc.add(node.value);
      for (const opt of Object.values(node.options || {})) argsOf(opt.value, acc);
    }
    if (node.type === 8 && node.children) argsOf(node.children, acc); // tag
  }
  return acc;
}

function parse(message, locale, key, label) {
  try {
    return new IntlMessageFormat(message, locale);
  } catch (e) {
    errors.push(`${label} ICU parse failed for ${key}: ${e.message}`);
    return null;
  }
}

for (const key of enKeys) {
  if (!(key in ru)) continue;

  const enMsg = en[key];
  const ruMsg = ru[key].string;

  if (typeof ruMsg !== 'string') {
    errors.push(`bad shape for ${key}: expected {"string": "..."}`);
    continue;
  }

  const enFmt = parse(enMsg, 'en', key, 'EN');
  const ruFmt = parse(ruMsg, 'ru', key, 'RU');
  if (!enFmt || !ruFmt) continue;

  const enArgs = argsOf(enFmt.getAst());
  const ruArgs = argsOf(ruFmt.getAst());

  for (const a of enArgs) if (!ruArgs.has(a)) errors.push(`${key}: placeholder {${a}} dropped`);
  for (const a of ruArgs) if (!enArgs.has(a)) errors.push(`${key}: placeholder {${a}} invented`);

  if (ruMsg === enMsg && !/^[\d\s%{}]*$/.test(enMsg) && !/^[A-Za-z0-9 ().+-]+$/.test(enMsg)) {
    warnings.push(`${key}: still identical to English`);
  }
}

// Smoke-test the plural forms against real Russian CLDR rules.
const pluralProbe = [
  ['desktop.shell_app.time_ago.days', 'numDays', [1, 2, 5, 21, 22, 25]],
  ['desktop.shell_app.time_ago.hours', 'numHours', [1, 2, 5, 21]],
  ['desktop.shell_app.time_ago.minutes', 'numMinutes', [1, 3, 11, 31]],
  ['desktop.shell_app.time_ago.months', 'numMonths', [1, 2, 5, 21]],
  ['desktop.shell_app.time_ago.seconds', 'numSeconds', [1, 4, 17, 41]],
  ['desktop.shell_app.time_ago.years', 'numYears', [1, 3, 8, 21]],
];

const samples = [];
for (const [key, arg, values] of pluralProbe) {
  if (!ru[key]) continue;
  const fmt = new IntlMessageFormat(ru[key].string, 'ru');
  samples.push(`  ${key}: ` + values.map((n) => fmt.format({ [arg]: n })).join(' | '));
}

console.log(`keys: en=${enKeys.length} ru=${ruKeys.length}`);
if (samples.length) {
  console.log('plural samples:');
  samples.forEach((s) => console.log(s));
}
if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (errors.length) {
  console.log(`\nerrors (${errors.length}):`);
  errors.forEach((e) => console.log('  x ' + e));
  process.exit(1);
}
console.log('\nOK: ru.json is complete and well-formed.');
