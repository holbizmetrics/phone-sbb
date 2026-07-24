// Tier-1 CI gate, part 2: headless-browser smoke.
// Serves the repo locally, loads the page in Chromium, and asserts the shell
// renders + the boot JS ran + there were NO console errors / uncaught exceptions.
// Hermetic: all non-localhost requests are aborted, so the smoke never depends
// on (or hammers) the live transport/weather/Overpass APIs. A fresh load makes
// no external calls anyway (empty localStorage -> empty state, no fetch).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const fp = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
await page.route('**', (route) =>
  route.request().url().startsWith('http://localhost') ? route.continue() : route.abort()
);

let failed = false;
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed = true;
};

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(600); // let boot JS run: clock tick, event wiring

check((await page.title()).length > 0, 'page has a <title>');
check((await page.locator('#tabDep').count()) === 1, 'Departures tab renders');
check((await page.locator('#tabJrn').count()) === 1, 'Journey tab renders');
const clock = (await page.locator('#clk').textContent())?.trim();
check(!!clock && clock !== '--:--', `boot JS ran (clock = ${clock})`);

await page.locator('#tabJrn').click();
check((await page.locator('#smartTog').count()) === 1, 'Smart toggle renders on Journey');
check((await page.locator('#wxTog').count()) === 1, 'Weather toggle renders on Journey');

// Expandable leg -> intermediate stops. The network is aborted here, so a real
// connection never renders; we stub one into the render registry and drive the
// actual tap. This covers the DOM half (delegated toggle, collapse, marker
// filter) that the offline unit test cannot reach.
const stubbed = await page.evaluate(() => { try {
  const stub = {
    from: { departure: '2026-07-24T10:00:00+02:00' },
    to: { arrival: '2026-07-24T11:00:00+02:00' },
    duration: '00d01:00:00', transfers: 0,
    sections: [{ journey: { category: 'IR', number: '16', passList: [
      { station: { name: 'Alpha' }, departure: '2026-07-24T10:00:00+02:00' },
      { station: { name: 'Bahn-2000-Strecke' } },                       // routing marker: no times
      { station: { name: 'Beta' }, arrival: '2026-07-24T10:30:00+02:00', delay: 3, platform: '7' },
      { station: { name: 'Omega' }, arrival: '2026-07-24T11:00:00+02:00' },
    ] } }],
  };
  jrnConns = [stub];
  document.getElementById('jrnOut').innerHTML = connCard(stub, 0);
  return 'ok';
} catch (e) { return 'stub failed: ' + e.message; } });
check(stubbed === 'ok', `leg-stops fixture renders (${stubbed})`);

if (stubbed === 'ok') {
  const legBtn = page.locator('#jrnOut .legs .b2').first();
  check((await legBtn.count()) === 1, 'leg badge renders as a tappable button');
  check((await page.locator('#jrnOut .stops .sline').count()) === 0, 'stops start collapsed');
  await legBtn.click();
  const rows = await page.locator('#jrnOut .stops .sline').count();
  check(rows === 3, `tap expands stops, routing marker dropped (rows=${rows})`);
  const txt = (await page.locator('#jrnOut .stops').textContent()) || '';
  check(!txt.includes('Bahn-2000'), 'no routing marker in output');
  check(txt.includes('+3'), 'delay shown on intermediate stop');
  check(txt.includes('Beta') && txt.includes('Omega'), 'stop names rendered');
  await legBtn.click();
  check((await page.locator('#jrnOut .stops .sline').count()) === 0, 'second tap collapses');
}

check(problems.length === 0, `no console errors / uncaught exceptions (${problems.length})`);
problems.forEach((p) => console.error('     ' + p));

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
