// Tier-1 CI gate, part 1: parse every inline <script> block in index.html.
// Catches the exact class of typo that white-screens the whole page, WITHOUT
// running the code (vm.Script compiles/parses only — browser globals like
// `document`/`fetch` are never touched, so no false failures).
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// inline scripts only (skip any <script src=...>), non-greedy per block
const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

if (blocks.length === 0) {
  console.error('✗ no inline <script> block found in index.html');
  process.exit(1);
}

let ok = true;
blocks.forEach((m, i) => {
  try {
    new vm.Script(m[1], { filename: `index.html#inline-script[${i}]` });
  } catch (e) {
    console.error(`✗ SYNTAX ERROR in inline script #${i}:\n  ${e.message}`);
    ok = false;
  }
});

if (ok) console.log(`✓ ${blocks.length} inline script block(s) parse cleanly`);
process.exit(ok ? 0 : 1);
