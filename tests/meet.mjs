// T12: meet in the middle. The roadmap named ONE trap for this feature -- N x M
// queries against a volunteer API -- so the load-bearing checks here are the
// bound (never more than 2+MEET_FB requests, fallback capped even when the
// route offers more candidates) and the trigger (button tap only, never on
// render). The rest pins fairness math, the marker-filter inherited from
// legStops, superseded-request hygiene, and honest empty states.
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- static: the trigger is a tap, and only a tap ----
{
  chk("index.html has the meet button wired to meetMiddle()",
    /id="meetBtn"[^>]*onclick="meetMiddle\(\)"/s.test(src) || /onclick="meetMiddle\(\)"[^>]*id="meetBtn"/s.test(src),
    "");
  chk("meetOut exists for results", /id="meetOut"/.test(src), "");
  // app.js must never CALL meetMiddle itself -- render paths, planners, boot.
  // The only call sites are its declaration + the button's onclick attribute.
  const calls = [...src.matchAll(/(?<!function )meetMiddle\(\)/g)].length;
  chk("never-on-render: meetMiddle() is invoked from the button ONLY",
    calls === 1, "call sites: " + calls);
  const fb = src.match(/const MEET_FB = (\d+);/);
  chk("the fallback cap exists and is small", fb && Number(fb[1]) <= 4, fb && fb[1]);
}

// ---- extract the meet block ----
const a = src.indexOf("const MEET_FB");
const b = src.indexOf("async function plainPlan", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- meet block markers not found");
const fnSrc = src.slice(a, b);
chk("control: extracted block is the meet feature",
  fnSrc.includes("async function meetMiddle") && fnSrc.includes("function connStops"), fnSrc.slice(0, 60));

const out = { innerHTML: "" };
const inputs = { iFrom: { value: "" }, iTo: { value: "" } };
let apiCalls = [], aborts = 0, planned = 0, resolvers = null;
const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ctx = {
  AbortController: class { constructor(){ this.signal = {}; } abort(){ aborts++; } },
  fromName: "Aarau", toName: "Bern",
  $: id => id === "meetOut" ? out : (inputs[id] || { value: "", classList: { add(){} } }),
  esc, hhmm: iso => (iso || "").slice(11, 16),
  skel: () => "SKEL", errBox: e => "ERR:" + (e && e.message),
  planJourney: () => { planned++; },
  api: (path) => {
    apiCalls.push(path);
    if (resolvers) return new Promise(res => resolvers.push(res));
    const h = ctx._routes.find(r => path.includes(r.q));
    if (!h) return Promise.resolve({ connections: [] });
    if (h.err) return Promise.reject(new Error(h.err));
    return Promise.resolve({ connections: h.c ? [h.c] : [] });
  },
  _routes: [],
};
vm.createContext(ctx);
new vm.Script(fnSrc + "\nthis.meetMiddle=meetMiddle; this.meetLeg=meetLeg; this.connStops=connStops; this.meetRow=meetRow;"
  + "\nthis.meetInvalidate=meetInvalidate; this._meetState=()=>({rows:meetRows, pair:meetFor});").runInContext(ctx);
const tick = () => new Promise(r => setTimeout(r, 0));
const reset = () => { apiCalls = []; out.innerHTML = ""; resolvers = null; };

const stop = (name, arr) => ({ station: { name }, arrival: arr });
const conn = (fromN, dep, toN, arr, stops) => ({
  from: { station: { name: fromN }, departure: dep },
  to: { station: { name: toN }, arrival: arr },
  sections: [{ journey: { passList: stops } }],
});
const T = m => `2026-07-29T14:${String(m).padStart(2, "0")}:00+0200`;

// ---- connStops: the marker filter is inherited, not re-derived ----
{
  const c = conn("Aarau", T(0), "Bern", T(45), [
    { station: { name: null }, arrival: T(5) },          // terminus-id defect row
    { station: { name: "Bahn-2000-Strecke" } },          // routing marker: no times
    stop("Olten", T(20)), stop("Olten", T(21)),          // duplicate keeps FIRST
  ]);
  const m = ctx.connStops(c);
  chk("connStops drops nameless and timeless marker rows", !m.has(null) && !m.has("Bahn-2000-Strecke") && m.size === 1, m.size);
  chk("duplicate station keeps its first time", m.get("Olten") === T(20), m.get("Olten"));
}

// ---- meetRow: fairness math ----
{
  const r = ctx.meetRow("Olten", T(0), T(20), T(5), T(30));
  chk("ride minutes from each side", r.mA === 20 && r.mB === 25, `${r.mA}/${r.mB}`);
  chk("gap is the fairness number", r.gap === 5, r.gap);
  chk("together = the LATER arrival", r.together === T(30), r.together);
}

// ---- main path: 2 requests, shared stop wins, fairest first ----
{
  reset();
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), [stop("Olten", T(20)), stop("Zofingen", T(10))]) },
    { q: "from=Bern&to=Aarau", c: conn("Bern", T(5), "Aarau", T(50), [stop("Olten", T(30)), stop("Zofingen", T(40))]) },
  ];
  await ctx.meetMiddle();
  chk("base cost is EXACTLY two requests when the routes overlap", apiCalls.length === 2, apiCalls.length);
  chk("a shared stop renders as a candidate", out.innerHTML.includes("Olten"), out.innerHTML.slice(0, 120));
  chk("fairest candidate ranks first (Olten gap 5 before Zofingen gap 25)",
    out.innerHTML.indexOf("Olten") < out.innerHTML.indexOf("Zofingen"), "");
  chk("both origins are excluded as meeting points", !out.innerHTML.includes("<b>Bern</b>") && !out.innerHTML.includes("<b>Aarau</b>"), "");
  chk("the fairness number is spoken", out.innerHTML.includes("fair within 5 min"), "");
}

// ---- the BOUND: fallback stays capped even with more candidates on offer ----
{
  reset();
  const many = Array.from({ length: 9 }, (_, k) => stop("Stop" + k, T(5 + k * 4)));
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), many) },
    { q: "from=Bern&to=Aarau", err: "HTTP 500" },          // reverse direction dead
    ...Array.from({ length: 9 }, (_, k) => ({
      q: "to=Stop" + k, c: conn("Bern", T(6), "Stop" + k, T(30 + k), [] ) })),
  ];
  await ctx.meetMiddle();
  chk("PLANTED BOUND: 9 candidates on the line, but total requests <= 2+MEET_FB",
    apiCalls.length <= 6, "requests: " + apiCalls.length);
  chk("fallback still names meeting points", /Stop\d/.test(out.innerHTML), out.innerHTML.slice(0, 120));
  chk("the fallback says it went the long way", out.innerHTML.includes("the long way"), "");
}

// ---- superseded request hygiene ----
{
  reset(); resolvers = [];
  const p1 = ctx.meetMiddle();                 // 2 requests in flight
  const first = resolvers.splice(0, 2);
  const p2 = ctx.meetMiddle();                 // supersedes
  chk("a second tap ABORTS the first tap's requests", aborts >= 1, String(aborts));
  const second = resolvers.splice(0, 2);
  second[0]({ connections: [conn("Aarau", T(0), "Bern", T(45), [stop("Fresh", T(20))])] });
  second[1]({ connections: [conn("Bern", T(5), "Aarau", T(50), [stop("Fresh", T(30))])] });
  await p2; await tick();
  chk("newest tap paints", out.innerHTML.includes("Fresh"), out.innerHTML.slice(0, 80));
  first[0]({ connections: [conn("Aarau", T(0), "Bern", T(45), [stop("Stale", T(20))])] });
  first[1]({ connections: [conn("Bern", T(5), "Aarau", T(50), [stop("Stale", T(30))])] });
  await p1; await tick();
  chk("planted positive: the stale tap's answer is dropped", !out.innerHTML.includes("Stale"), "");
  chk("...and the fresh result survives it", out.innerHTML.includes("Fresh"), "");
}

// ---- honest states: outage is not absence, absence is not silence ----
{
  reset();
  ctx._routes = [
    { q: "from=Aarau&to=Bern", err: "HTTP 429" },
    { q: "from=Bern&to=Aarau", err: "HTTP 429" },
  ];
  await ctx.meetMiddle();
  chk("both directions FAILING shows the error, not a fake no-route", out.innerHTML.startsWith("ERR:"), out.innerHTML.slice(0, 60));

  reset();
  ctx._routes = [];                            // both answer: zero connections
  await ctx.meetMiddle();
  chk("both directions EMPTY is a real verdict: no line to meet along",
    out.innerHTML.includes("no line to meet along"), out.innerHTML.slice(0, 120));

  reset();
  ctx.fromName = ctx.toName = "Olten";
  await ctx.meetMiddle();
  chk("same station in both fields is answered, not queried",
    apiCalls.length === 0 && out.innerHTML.includes("already meeting"), out.innerHTML.slice(0, 80));
  ctx.fromName = "Aarau"; ctx.toName = "Bern";
}

// ---- XSS: a hostile station name stays inert ----
{
  reset();
  const evil = 'Olten"><img src=x onerror=alert(1)>';
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), [stop(evil, T(20))]) },
    { q: "from=Bern&to=Aarau", c: conn("Bern", T(5), "Aarau", T(50), [stop(evil, T(30))]) },
  ];
  await ctx.meetMiddle();
  chk("station names are escaped in the cards", !out.innerHTML.includes("<img"), "");
}

// ---- meetLeg: planning THEIR leg swaps to their origin ----
{
  reset();
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), [stop("Olten", T(20))]) },
    { q: "from=Bern&to=Aarau", c: conn("Bern", T(5), "Aarau", T(50), [stop("Olten", T(30))]) },
  ];
  await ctx.meetMiddle();
  planned = 0;
  ctx.meetLeg(0, true);
  chk("their leg plans FROM their origin TO the meeting point",
    ctx.fromName === "Bern" && ctx.toName === "Olten" && planned === 1,
    `${ctx.fromName}->${ctx.toName} planned=${planned}`);
}

// ---- stale meeting points (2026-09-06) ----
// The cards are DERIVED from the two fields and nothing retracted them when the
// fields changed: run Meet for A<->B, type C into From, plan -- and the A<->B cards
// stayed up with live "my leg / their leg" buttons planning legs for a pair you had
// abandoned. Operator named the class from a gut feeling; this pins the site.
{
  reset();
  ctx.fromName = "Aarau"; ctx.toName = "Bern";
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), [stop("Olten", T(20))]) },
    { q: "from=Bern&to=Aarau", c: conn("Bern", T(5), "Aarau", T(50), [stop("Olten", T(30))]) },
  ];
  await ctx.meetMiddle();
  chk("control: cards are on screen and the pair is remembered",
    out.innerHTML.includes("Olten") && ctx._meetState().pair && ctx._meetState().pair.from === "Aarau" && ctx._meetState().pair.to === "Bern",
    JSON.stringify(ctx._meetState().pair));

  // the route changes underneath the cards
  ctx.fromName = "Zug";
  ctx.meetInvalidate();
  chk("a replan RETRACTS the cards -- they were computed for a pair that no longer exists",
    !out.innerHTML.includes("Olten") && ctx._meetState().rows.length === 0, out.innerHTML.slice(0, 120));
  chk("...and says so, NAMING the pair they were for, rather than going silent",
    out.innerHTML.includes("Aarau") && out.innerHTML.includes("Bern") && /route changed/.test(out.innerHTML), out.innerHTML.slice(0, 160));
  planned = 0;
  ctx.meetLeg(0, true);
  chk("...and the leg buttons are dead after retraction -- no leg is planned for a stale card",
    planned === 0, "planned=" + planned);

  // negative: nothing on screen -> nothing to retract, no spurious hint
  reset();
  ctx.meetInvalidate();
  chk("retracting when nothing was offered leaves the box empty -- no hint about a pair that never existed",
    out.innerHTML === "", out.innerHTML);
}

// ---- my leg, then their leg: the pre-existing bug the same hunch covered ----
// After "my leg" the live fields hold (me -> meeting point). "their leg" used to read
// toName for their origin -- which by then was the MEETING POINT -- and plan their
// leg from Olten to Olten.
{
  reset();
  ctx.fromName = "Aarau"; ctx.toName = "Bern";
  ctx._routes = [
    { q: "from=Aarau&to=Bern", c: conn("Aarau", T(0), "Bern", T(45), [stop("Olten", T(20))]) },
    { q: "from=Bern&to=Aarau", c: conn("Bern", T(5), "Aarau", T(50), [stop("Olten", T(30))]) },
  ];
  await ctx.meetMiddle();
  let lastOpts = undefined;
  ctx.planJourney = (o) => { planned++; lastOpts = o; };
  ctx.meetLeg(0, false);
  chk("my leg: Aarau -> Olten", ctx.fromName === "Aarau" && ctx.toName === "Olten", `${ctx.fromName}->${ctx.toName}`);
  chk("...and it plans WITHOUT retracting the cards -- this is the one caller that is using them, not abandoning them",
    lastOpts && lastOpts.keepMeet === true, JSON.stringify(lastOpts));
  ctx.meetLeg(0, true);
  chk("their leg AFTER my leg still plans FROM THEIR origin (Bern), not from the meeting point the fields now hold",
    ctx.fromName === "Bern" && ctx.toName === "Olten", `${ctx.fromName}->${ctx.toName}`);
}

// ---- wiring: the retraction is on every OTHER replan path ----
{
  chk("planJourney retracts meeting points unless told to keep them",
    /function planJourney\(opts\)\{\s*if\(!\(opts && opts\.keepMeet\)\) meetInvalidate\(\);/.test(src), "");
  chk("...and meetLeg is the only caller that asks to keep them",
    (src.match(/keepMeet: true/g) || []).length === 1 && /function meetLeg[\s\S]{0,900}?planJourney\(\{ keepMeet: true \}\)/.test(src), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
