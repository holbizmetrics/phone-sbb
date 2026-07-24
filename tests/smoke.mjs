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
    from: { departure: '2026-07-24T10:00:00+02:00', platform: '31' },
    to: { arrival: '2026-07-24T11:00:00+02:00', platform: '2A' },
    duration: '00d01:00:00', transfers: 0,
    _chg: [{ stn: 'Bern', b: 7, pa: '7', pd: '5' }],
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

  // Platform: the one thing you need while standing in the station. Non-numeric
  // platforms (2A, D) are real, so the stub uses one.
  const pf = (await page.locator('#jrnOut .pfrow').textContent()) || '';
  check(pf.includes('31'), `departure platform rendered (${pf.trim()})`);
  check(pf.includes('2A'), 'arrival platform rendered, non-numeric preserved');
  const cx = (await page.locator('#jrnOut .chg').textContent()) || '';
  check(cx.includes('7') && cx.includes('5'), `change shows the platform switch (${cx.trim()})`);
}

// Regression lock for the three traveller-breaking bugs an independent review found
// on 2026-07-25. All three rendered plausibly, so only an assertion catches them.
const rev = await page.evaluate(() => { try {
  const base = () => ({
    from: { departure: '2026-07-24T10:00:00+02:00', platform: '3' },
    to:   { arrival:   '2026-07-24T11:00:00+02:00', platform: '5' },
    duration: '00d01:00:00', transfers: 1,
    sections: [
      { journey: { category: 'IR', number: '16', passList: [] },
        departure: { departure: '2026-07-24T10:00:00+02:00' },
        arrival:   { arrival:   '2026-07-24T10:30:00+02:00', station: { name: 'Bern' } } },
      { journey: { category: 'S', number: '1', passList: [] },
        departure: { departure: '2026-07-24T10:35:00+02:00', station: { name: 'Bern' } },
        arrival:   { arrival:   '2026-07-24T11:00:00+02:00' } },
    ],
  });
  // #2: arrival delayed 20 min PAST the onward departure -> a change you cannot make
  const m = base();
  m.sections[0].arrival.prognosis = { arrival: '2026-07-24T10:55:00+02:00' };
  const mChg = changeDetails(m);
  m._chg = mChg; m._buf = Math.min(...mChg.map(x => x.b)); m._tight = m._buf < TIGHT;
  // #3: departure 11 min late -> the card must agree with the board
  const d = base();
  d.from.prognosis = { departure: '2026-07-24T10:11:00+02:00' };
  d._chg = [];
  // Expected times are derived with the page's own hhmm, never hardcoded: CI runs in
  // UTC and the phone in CET, so a literal "10:11" here asserts the runner's timezone
  // rather than the fix. (It did exactly that on the first run.)
  return { negKept: mChg.some(x => x.missed), missHTML: connCard(m, 0), lateHTML: connCard(d, 0),
           wantLate: hhmm(d.from.prognosis.departure), wantSched: hhmm('2026-07-24T10:00:00+02:00'),
           tickUsesLabel: String(tickBoard).includes('depLabel') };
} catch (e) { return { err: e.message }; } });
check(!rev.err, `review-regression fixture builds (${rev.err || 'ok'})`);
if (!rev.err) {
  check(rev.negKept, 'impossible change is kept, not silently dropped');
  check(rev.missHTML.includes('missed by'), 'missed change is labelled in words');
  check(rev.missHTML.includes('cx tight'), 'missed change is flagged tight');
  check(rev.wantLate !== rev.wantSched, `control: delayed and scheduled times differ (${rev.wantSched} vs ${rev.wantLate})`);
  check(rev.lateHTML.includes(`<div class="tt">${rev.wantLate}`), `journey card shows the real (prognosis) departure (${rev.wantLate})`);
  check(!rev.lateHTML.includes(`<div class="tt">${rev.wantSched}`), 'journey card no longer shows the scheduled time instead');
  check(rev.lateHTML.includes('+11'), 'journey card shows the delay, as the board does');
  check(rev.tickUsesLabel, 'tickBoard uses the one depLabel definition');
}
check(await page.evaluate(() => wxAt({ time: ['2026-07-24T10:00'], weather_code: [0],
  temperature_2m: [null] }, '2026-07-24T10:00:00+02:00') === null),
  'missing temperature returns null, not a confident 0 degrees');
check(await page.evaluate(() => { favs = ["O'Brien \" <b>x</b>"]; renderFavs();
  const b = document.querySelector('#favs .star');
  return !!b && b.dataset.n === "O'Brien \" <b>x</b>" && !document.querySelector('#favs b'); }),
  'station name with quotes/markup cannot break out of the favourite button');

// Elevation: the strip must say where its numbers come from, and must refuse to
// draw a profile through a route with too few samples to have one.
const elev = await page.evaluate(() => { try {
  const pts = [{ x: 8.54, y: 47.38, name: 'A' }, { x: 8.0, y: 47.0, name: 'B' },
               { x: 7.8, y: 47.1, name: 'Peak' }, { x: 7.6, y: 47.2, name: 'C' }];
  return { svg: elevationSVG(pts, [400, 600, 1000, 800]),
           guard: String(fillElevation).includes('pts.length<4'),
           helpHasElev: document.getElementById('help').textContent.includes('ground height at each stop') };
} catch (e) { return { err: e.message }; } });
check(!elev.err, `elevation fixture renders (${elev.err || 'ok'})`);
if (!elev.err) {
  // 400->600->1000 climbs 600; the 1000->800 descent must not cancel any of it
  check(elev.svg.includes('climbs <b>600 m</b>'), 'elevation sums only the climbs, not the descent');
  check(elev.svg.includes('straight between them'), 'elevation strip carries its provenance line');
  check(elev.svg.includes('Peak'), 'high point is labelled by name');
  check(elev.guard, 'fillElevation refuses fewer than 4 samples');
  check(elev.helpHasElev, 'help sheet explains the elevation strip');
}

// Help sheet: the logo opens it, and it must be closable three ways — a modal
// you cannot dismiss on a phone is worse than no modal.
check(!(await page.locator('#help').evaluate((n) => n.classList.contains('on'))), 'help starts closed');
await page.locator('#helpBtn').click();
check(await page.locator('#help').evaluate((n) => n.classList.contains('on')), 'logo opens help');
check((await page.locator('#helpBtn').getAttribute('aria-expanded')) === 'true', 'help button reports expanded');
const helpTxt = (await page.locator('#help').textContent()) || '';
check(helpTxt.includes('platform'), 'help explains the platform display');
check(helpTxt.includes('not GPS'), 'help is honest that the dot is scheduled, not GPS');
await page.keyboard.press('Escape');
check(!(await page.locator('#help').evaluate((n) => n.classList.contains('on'))), 'Escape closes help');
await page.locator('#helpBtn').click();
await page.locator('#help .hclose').click();
check(!(await page.locator('#help').evaluate((n) => n.classList.contains('on'))), 'close button closes help');
await page.locator('#helpBtn').click();
await page.locator('#help').click({ position: { x: 5, y: 5 } });   // the scrim, outside the sheet
check(!(await page.locator('#help').evaluate((n) => n.classList.contains('on'))), 'tapping outside closes help');
check((await page.evaluate(() => document.body.style.overflow)) === '', 'page scroll restored after close');

check(problems.length === 0, `no console errors / uncaught exceptions (${problems.length})`);
problems.forEach((p) => console.error('     ' + p));

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
