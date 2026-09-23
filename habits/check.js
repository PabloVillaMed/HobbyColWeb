/* A small pre-ship check for mistakes this codebase has actually made.
   Run from the habits/ directory:  node check.js

   Every rule here earned its place by shipping:
   - $ / $$ confusion broke the completion animation for four releases
   - a stale asset version shipped new HTML against an old stylesheet
   - a missing translation key would show a raw identifier to the user */
const fs = require('fs');

const FILES = ['app.js', 'charts.js', 'i18n.js', 'sounds.js', 'sw.js'];
let failures = 0;

function fail(file, line, message) {
  console.log('  ' + file + (line ? ':' + line : '') + '  ' + message);
  failures++;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

FILES.forEach((file) => {
  const text = fs.readFileSync(file, 'utf8');

  // $ returns one element; only $$ returns an array. The lookbehind lets $$ by.
  const arrayOnSingle = /(?<!\$)\$\([^)]*\)\.(forEach|map|filter|find|slice|some|every)\b/g;
  let m;
  while ((m = arrayOnSingle.exec(text))) {
    fail(file, lineOf(text, m.index), 'usa $(...) con un método de array — ¿querías $$( ?');
  }

  // innerHTML is checked per statement, not per line: the escaping often sits
  // on a continuation line.
  const assigns = /innerHTML\s*=\s*([^;]+);/g;
  while ((m = assigns.exec(text))) {
    const statement = m[1];
    if (!statement.includes('+')) continue;                 // a plain literal
    if (/escapeHtml|iconSvg|MOOD_EMOJI|emoji|t\(/.test(statement)) continue;
    fail(file, lineOf(text, m.index), 'innerHTML concatenado sin escapeHtml a la vista');
  }

  const logs = /console\.log\(/g;
  while ((m = logs.exec(text))) {
    fail(file, lineOf(text, m.index), 'console.log olvidado');
  }
});

// Both languages must define exactly the same keys, or one of them shows a
// raw key where a sentence should be.
global.window = {};
require('./i18n.js');
const STRINGS = global.window.I18N.STRINGS;
const es = Object.keys(STRINGS.es);
const en = Object.keys(STRINGS.en);
const missingEn = es.filter((k) => !en.includes(k));
const missingEs = en.filter((k) => !es.includes(k));
if (missingEn.length) fail('i18n.js', 0, 'faltan en EN: ' + missingEn.join(', '));
if (missingEs.length) fail('i18n.js', 0, 'faltan en ES: ' + missingEs.join(', '));

// The asset version in index.html and sw.js must agree. When they drifted, an
// update served new HTML with the previously cached stylesheet.
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const versionsIn = (text) => [...new Set([...text.matchAll(/\?v=([\d.]+)/g)].map((x) => x[1]))];
const htmlVersions = versionsIn(html);
const swVersions = versionsIn(sw);
if (htmlVersions.length !== 1 || swVersions.length !== 1 || htmlVersions[0] !== swVersions[0]) {
  fail('sw.js', 0, 'versión de assets descuadrada: html [' + htmlVersions + '] vs sw [' + swVersions + ']');
}

// Every file the page loads has to be in the precache, or it is missing offline.
const loaded = [...html.matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))\?/g)].map((x) => x[1]);
loaded.forEach((asset) => {
  if (!sw.includes("'./" + asset)) fail('sw.js', 0, asset + ' no está en el precache');
});

console.log(failures ? failures + ' problema(s)' : 'sin problemas');
process.exit(failures ? 1 : 0);
