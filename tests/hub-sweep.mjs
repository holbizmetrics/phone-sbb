// Row 371: the Smart sweep rate-limited ITSELF (one tap = ~11 simultaneous
// requests to a volunteer API), and a hub the server refused simply vanished
// from the answer while a refusal on base/wide killed the whole plan. This runs
// the REAL smartPlan/pooled/sweepHub against a fake API that counts hub requests
// in flight and can plant a 429 (always / once / with a long Retry-After) or a
// hang on any hub. Every positive has its control: the in-flight meter is shown
// to SEE a burst when the cap is lifted, the unswept line is shown to be EMPTY
// when every hub answers, and the retry is shown to happen exactly once.
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };
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
class FakeSignal { constructor(){ this.aborted = false; } }
class FakeAC { constructor(){ this.signal = new FakeSignal(); } abort(){ this.signal.aborted = true; } }

/* plan: {H4: "429", H5: "429-once", H6: "hang", H7: "429-long"}; par = HUB_PAR for this run */
async function run({ plan = {}, par = 3, cap = 60 } = {}) {
  const calls = {}, renders = [];
  let inflight = 0, maxInflight = 0;
  const jrnOut = { innerHTML: "" };
  const api = (path, signal) => new Promise((resolve, reject) => {
    const hub = (decodeURIComponent(path).match(/via\[\]=([^&]+)/) || [])[1];
    if (!hub) return setTimeout(() => resolve({ connections: [{ tag: "DIRECT", to: {} }] }), 5);
    calls[hub] = (calls[hub] || 0) + 1;
    const mode = plan[hub] || "ok";
    if (mode === "hang") return;                       // never answers; the cap must catch it
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    setTimeout(() => {
      inflight--;
      if (mode === "429" || (mode === "429-once" && calls[hub] === 1)) return reject(new Error("HTTP 429"));
      if (mode === "429-long") { const e = new Error("HTTP 429"); e.retryAfter = 60; return reject(e); }
      resolve({ connections: [{ tag: hub, to: {} }] });
    }, 10);
  });
  const ctx = {
    fromName: "A", toName: "B", smart: true, jrnConns: [], jrnGen: 0, jrnAbort: null,
    preferScenic: false, HUBS: ["H1","H2","H3","H4","H5","H6","H7","H8","H9"], SCENIC_HUBS: [],
    AbortController: FakeAC, $: id => (id === "jrnOut" ? jrnOut : { innerHTML: "" }), api,
    skel: () => "SKEL", whenQS: () => "", modeQS: () => "", viaQS: () => "", viaName: "",
    rememberRoute: () => {}, annotate: c => c, connSig: c => JSON.stringify(c),
    catSel: [], catFilter: cs => cs, fillJourneyLastHome: () => {},
    renderSmart: (...a) => { renders.push(a); jrnOut.innerHTML = "PAINTED"; },
    HUB_PAR: par, HUB_RETRY_MS: 5, HUB_CAP: cap, HUB_TIMEOUT: Symbol("t"),
    setTimeout, clearTimeout, Symbol, Promise, Array, Math, Error, RegExp, encodeURIComponent, esc: s => String(s),
  };
  vm.createContext(ctx);
  new vm.Script([grab("withTimeout"), grab("tryConns"), grab("pooled"), grab("sweepHub"), grab("smartPlan")].join("\n")
    + "\nthis.smartPlan = smartPlan;").runInContext(ctx);
  await ctx.smartPlan();
  const settled = renders.find(a => a[3] === false);
  return { calls, maxInflight, renders, settled, unswept: settled ? (settled[7] || []) : null, swept: settled ? settled[1].map(c => c.tag).filter(x => x !== "DIRECT") : null };   // wide's own result rides in `swept` too
}

// ---- the cap: at most HUB_PAR hub requests in flight ----
{
  const r = await run();
  chk("all hubs answer: every one of the 9 is swept and nothing is reported unswept",
    r.swept.length === 9 && r.unswept.length === 0, JSON.stringify(r.swept) + " " + JSON.stringify(r.unswept));
  chk("...with at most HUB_PAR (3) hub requests in flight at any moment", r.maxInflight <= 3, "max in flight " + r.maxInflight);
  const burst = await run({ par: 99 });
  chk("CONTROL: with the cap lifted the meter sees the burst (9 in flight) -- so '<= 3' above is a measurement, not a blind spot",
    burst.maxInflight === 9, "max in flight " + burst.maxInflight);
  chk("the two DIRECT queries are untouched by the pool (first paint still renders on them)",
    r.renders.length === 2 && r.renders[0][3] === true && r.renders[1][3] === false, String(r.renders.length));
}
// ---- a 429 on one hub: the plan survives, the hub is NAMED, the others are swept ----
{
  const r = await run({ plan: { H4: "429" } });
  chk("a hub that 429s twice is reported 'limited' by name, and the plan still renders",
    r.settled && r.unswept.length === 1 && r.unswept[0].hub === "H4" && r.unswept[0].state === "limited", JSON.stringify(r.unswept));
  chk("...the other 8 hubs are swept as before", r.swept.length === 8 && !r.swept.includes("H4"), JSON.stringify(r.swept));
  chk("...and it was retried exactly ONCE, not hammered", r.calls.H4 === 2, "calls " + r.calls.H4);
}
{
  const r = await run({ plan: { H5: "429-once" } });
  chk("a 429 that clears on the retry: the hub is swept and NOT reported", r.swept.includes("H5") && r.unswept.length === 0 && r.calls.H5 === 2,
    JSON.stringify({ swept: r.swept, unswept: r.unswept, calls: r.calls.H5 }));
}
{
  const r = await run({ plan: { H7: "429-long" } });
  chk("a Retry-After longer than the cap is not waited for: one call, reported limited",
    r.calls.H7 === 1 && r.unswept.length === 1 && r.unswept[0].state === "limited", JSON.stringify({ calls: r.calls.H7, unswept: r.unswept }));
}
{
  const r = await run({ plan: { H6: "hang" } });
  chk("a hub that never answers is reported 'timeout' by name (was: silently dropped past the cap)",
    r.unswept.length === 1 && r.unswept[0].hub === "H6" && r.unswept[0].state === "timeout" && r.swept.length === 8, JSON.stringify(r.unswept));
}
// ---- the line the rider sees ----
const note = new Function("esc", `${grab("unsweptNote")} return unsweptNote;`)(s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
chk("unsweptNote names count, hubs and reasons", /2 hub routes unswept: Bern \(rate-limited\), Olten \(timed out\)/.test(note([{ hub: "Bern", state: "limited" }, { hub: "Olten", state: "timeout" }, { hub: "Basel SBB", state: "ok" }])),
  note([{ hub: "Bern", state: "limited" }, { hub: "Olten", state: "timeout" }]));
chk("...says 'not searched, so not none' -- absence is not a verdict", /not searched, so not &quot;none&quot;/.test(note([{ hub: "Bern", state: "failed" }])));
chk("...is EMPTY when every hub answered (the control for the line itself)", note([{ hub: "Bern", state: "ok" }]) === "" && note([]) === "" && note(undefined) === "");
chk("...escapes a hostile hub name", !note([{ hub: '"><img src=x>', state: "failed" }]).includes('"><img'));
// ---- wiring: green-but-unwired is the named defect class ----
chk("smartPlan hands the unswept list to the settled render", /unswept\);\s*$/m.test(grab("smartPlan")) && /const unswept = hubOut\.filter/.test(grab("smartPlan")));
chk("renderSmart prints the note on the settled render only", /\(searching\?"":unsweptNote\(unswept\)\)/.test(grab("renderSmart")));
chk("the shipped cap is small: HUB_PAR <= 4 (probe: six spaced requests cleared, ~11 at once tripped)", /const HUB_PAR = [1-4];/.test(src));
chk("api() carries Retry-After on a refused request", /e\.retryAfter=\+ra/.test(grab("api")));
chk("the old fire-everything shape is gone (no allSettled over hub jobs)", !/Promise\.allSettled\(hubJobs\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
