// The operator's repro, in a harness, so he never has to do it again:
// rapid mode-chip taps used to stack zombie fetches on the browser's 6-per-host
// connection pool until every new search queued behind the corpses and the app
// read as dead until the tab was closed (~40 device repros across 3 sessions).
//
// This harness models the pool: 6 slots, slow 14-second "wide" responses, and a
// fetch that HONOURS AbortController the way a real browser does (abort frees
// the slot). The planted positive re-creates the OLD behavior (aborts ignored)
// and must wedge; the fixed planner under the same storm must not.
import fs from "fs";
import vm from "vm";

import { src, APP } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// -- extract the planners exactly as journey-race.mjs does --
const a = src.indexOf("let jrnGen = 0;");
const b = src.indexOf("/* Swallowing an error", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- jrnGen/plainPlan markers not found");
const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  const start = src.slice(i - 6, i) === "async " ? i - 6 : i;
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(start, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};
const fnSrc = src.slice(a, b) + "\n" + grab("tryConns") + "\n" + grab("smartPlan");

// -- a browser-shaped connection pool ------------------------------------
// 6 slots per host; a request past the limit WAITS for a slot. Aborting an
// in-flight or queued request frees/skips its slot immediately.
function makePool(honourAbort) {
  const SLOTS = 6;
  let active = 0;
  const queue = [];
  const admit = () => {
    while (active < SLOTS && queue.length) {
      const job = queue.shift();
      if (job.aborted) continue;              // died while queued
      active++;
      job.start();
    }
  };
  // request(ms, signal) resolves after ms of "network time" once a slot frees
  const request = (ms, signal) => new Promise((resolve, reject) => {
    const job = {
      aborted: false, started: false,
      start() {
        job.started = true;
        const t = setTimeout(() => { active--; resolve(); admit(); }, ms);
        if (honourAbort && signal) signal.sub(() => { clearTimeout(t); active--; admit(); });
      },
    };
    if (honourAbort && signal) signal.sub(() => { job.aborted = true; reject(new Error("AbortError")); });
    queue.push(job); admit();
  });
  return { request, stats: () => ({ active, queued: queue.filter(j => !j.aborted).length }) };
}

class FakeSignal {
  constructor(){ this.aborted = false; this._ls = []; }
  sub(fn){ if (this.aborted) fn(); else this._ls.push(fn); }
}
class FakeAC {
  constructor(){ this.signal = new FakeSignal(); }
  abort(){ if (this.signal.aborted) return; this.signal.aborted = true; this.signal._ls.forEach(fn => fn()); }
}

// -- run the real smartPlan under a tap storm -----------------------------
async function storm({ honourAbort, slowMs = 14000, settleMs = 50 }) {
  const pool = makePool(honourAbort);
  const jrnOut = { innerHTML: "" };
  const ctx = {
    fromName: "A", toName: "B", smart: true, weather: false, jrnConns: [],
    preferScenic: false, HUBS: ["H1","H2","H3","H4","H5","H6","H7","H8","H9"], SCENIC_HUBS: [],
    AbortController: FakeAC,
    $: id => (id === "jrnOut" ? jrnOut : { innerHTML: "" }),
    // the app's api(): wide (limit=16) queries are the 14s monsters, others 1s
    api: (path, signal) => {
      const slow = /limit=16/.test(path) ? slowMs : Math.ceil(slowMs / 14);
      return pool.request(slow, signal).then(() => ({ connections: [{ tag: "OK", to: {} }] }));
    },
    skel: () => "SKEL", whenQS: () => "", modeQS: () => "",
    sunWhyEmpty: () => "", modeWhyEmpty: () => "",
    rememberRoute: () => {}, annotate: c => c, connSig: c => JSON.stringify(c),
    // T8's sub-category filter runs inside both planners. This test measures
    // request pressure, not filtering, so it passes everything through -- but an
    // absent stub throws and the storm reads as an outage instead of a paint.
    catSel: [], catFilter: cs => cs, catFilterNote: () => "", catWhyEmpty: () => "",
    connCard: c => "CARD", wondersExpanderHTML: () => "",
    connZoneRib: () => "", fillJourneyLastHome: () => {},
    renderSmart: () => { jrnOut.innerHTML = "PAINTED"; },
    withTimeout: (p) => p.catch(() => []),   // no cap in the harness: the pool is the constraint under test
    setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  new vm.Script(fnSrc + "\nthis.smartPlan = smartPlan;").runInContext(ctx);

  // fake clock: run with real (tiny) timers is impossible at 14s -- so scale:
  // we only care about ORDER + pool occupancy, so use ms as-is but sample the
  // pool right after the storm instead of waiting the full duration.
  const taps = 4;                              // the operator's "a few chip taps"
  for (let i = 0; i < taps; i++) ctx.smartPlan();
  await new Promise(r => setTimeout(r, settleMs));
  return { ...pool.stats(), painted: jrnOut.innerHTML };
}

// planted positive: the OLD world (aborts ignored) -- the pool must be wedged:
// 4 taps x 11 requests all stay alive, saturating all 6 slots with a deep queue.
const before = await storm({ honourAbort: false });
chk("planted positive: without abort, the pool is saturated", before.active === 6, JSON.stringify(before));
chk("planted positive: without abort, a deep zombie queue forms", before.queued > 20, JSON.stringify(before));

// the fix: same storm, aborts honoured -- only the NEWEST sweep may hold slots.
// One sweep is 11 requests (2 direct + 9 hubs), so 6 active + 5 queued, max.
const after = await storm({ honourAbort: true });
chk("with abort, superseded sweeps release the pool", after.active + after.queued <= 11,
  JSON.stringify(after) + " -- more live requests than one sweep can own");
chk("null control: the newest sweep itself is still running", after.active > 0, JSON.stringify(after));

// end-to-end: with time compressed (14s -> 140ms), the storm's FINAL search
// must actually finish and paint -- the operator's symptom was that it never did.
const done = await storm({ honourAbort: true, slowMs: 140, settleMs: 800 });
chk("after the storm, the newest search completes and paints", done.painted === "PAINTED", JSON.stringify(done));
chk("…and the pool is empty again afterwards", done.active === 0 && done.queued === 0, JSON.stringify(done));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
