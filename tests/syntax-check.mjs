// Tier-1 CI gate, part 1: parse the app's JavaScript — app.js plus any inline
// <script> block still living in index.html. Catches the exact class of typo
// that white-screens the whole page, WITHOUT running the code (vm.Script
// compiles/parses only — browser globals like `document`/`fetch` are never
// touched, so no false failures).
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Every LOCAL script the page loads, in either form. A src= tag whose file is
// missing is itself the white-screen defect, so it fails here rather than
// being skipped.
const units = [];
for (const [, s] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
  if (/^https?:/.test(s)) continue;
  units.push({ name: s, code: fs.readFileSync(new URL('../' + s, import.meta.url), 'utf8') });
}
[...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .forEach((m, i) => units.push({ name: `index.html#inline-script[${i}]`, code: m[1] }));

if (units.length === 0) {
  console.error('✗ index.html loads no script at all — the page would render dead');
  process.exit(1);
}

let ok = true;
for (const u of units) {
  try {
    new vm.Script(u.code, { filename: u.name });
  } catch (e) {
    console.error(`✗ SYNTAX ERROR in ${u.name}:\n  ${e.message}`);
    ok = false;
  }
}

if (ok) console.log(`✓ ${units.length} script unit(s) parse cleanly (${units.map(u => u.name).join(', ')})`);
process.exit(ok ? 0 : 1);
