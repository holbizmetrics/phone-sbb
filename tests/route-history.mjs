// Runs the REAL rememberRoute/renderRoutes out of index.html. No browser needed.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

function build(start = []) {
  const el = { innerHTML: "" };
  const saved = [];
  const calls = { planned: 0, fields: {} };
  const m = new Function("EL", "SAVED", "START", "CALLS", `
    let routeHist = START;
    let fromName = "", toName = "";
    ${(src.match(/^const LS = \{[^}]+\};/m) || [])[0] || (() => { throw new Error("HARNESS FAILED -- const LS not found"); })()}
    ${(src.match(/^const SEED_ROUTES = \[[\s\S]*?\];/m) || [])[0] || (() => { throw new Error("HARNESS FAILED -- const SEED_ROUTES not found"); })()}
    const $ = (id) => id === "routeChips" ? EL
      : { set value(v){ CALLS.fields[id] = v; }, classList: { add: () => {} } };
    const save = (k, v) => SAVED.push(JSON.parse(JSON.stringify(v)));
    const planJourney = () => { CALLS.planned++; CALLS.from = fromName; CALLS.to = toName; };
    ${grab("esc")}
    ${grab("shortStop")}
    ${grab("shownRoutes")}
    ${grab("renderRoutes")}
    ${grab("rememberRoute")}
    ${grab("useRoute")}
    return { rememberRoute, renderRoutes, useRoute, hist: () => routeHist };
  `)(el, saved, start, calls);
  return { ...m, el, saved, calls };
}

// control: the extraction produced something that actually records
{
  const t = build();
  t.rememberRoute("Zürich HB", "Bern");
  chk("control: a route is recorded at all", t.hist().length === 1, JSON.stringify(t.hist()));
  chk("recorded route keeps both full names", t.hist()[0].f === "Zürich HB" && t.hist()[0].t === "Bern");
  chk("recording persists it", t.saved.length === 1 && t.saved[0].length === 1);
}

// the morning trip and the evening trip are NOT the same trip
{
  const t = build();
  t.rememberRoute("Zürich HB", "Bern");
  t.rememberRoute("Bern", "Zürich HB");
  chk("direction-distinct: both directions kept", t.hist().length === 2,
    JSON.stringify(t.hist()));
}

// searching the same route again moves it to the front, it does not duplicate
{
  const t = build();
  t.rememberRoute("A", "B");
  t.rememberRoute("C", "D");
  t.rememberRoute("A", "B");
  chk("repeat search does not duplicate", t.hist().length === 2, JSON.stringify(t.hist()));
  chk("most recent is first", t.hist()[0].f === "A" && t.hist()[0].t === "B", JSON.stringify(t.hist()[0]));
}

// the list is capped, so it cannot grow without bound in localStorage
{
  const t = build();
  for (let i = 0; i < 12; i++) t.rememberRoute("S" + i, "Bern");
  chk("history caps at 6", t.hist().length === 6, String(t.hist().length));
  chk("the cap drops the OLDEST, not the newest", t.hist()[0].f === "S11", JSON.stringify(t.hist()[0]));
}

// junk must never reach the chip row
{
  const t = build();
  t.rememberRoute("Bern", "Bern");
  t.rememberRoute("", "Bern");
  t.rememberRoute("Bern", "");
  t.rememberRoute(undefined, undefined);
  chk("same-station, empty and undefined routes are all refused", t.hist().length === 0,
    JSON.stringify(t.hist()));
}

// a station name carrying a quote must not break out of the onclick or title
{
  const t = build();
  t.rememberRoute('Bern" onclick="alert(1)', "Zürich HB");
  t.renderRoutes();
  chk("no injected onclick survives escaping", !/onclick="alert/.test(t.el.innerHTML), t.el.innerHTML);
  chk("control: the dangerous name really was recorded", t.hist()[0].f.includes("alert(1)"));
}

// Pamela's ask (2026-07-28, the first real passenger): an empty history must
// OFFER something, not render a blank row for exactly the person who has never
// searched. Seeds are examples -- dimmed, never saved, gone after one real search.
{
  const t = build();
  t.renderRoutes();
  chk("empty history renders seed chips, not a blank row",
    (t.el.innerHTML.match(/class="chip route seed"/g) || []).length >= 3, t.el.innerHTML.slice(0, 160));
  chk("seeds are never written to storage just by rendering", t.saved.length === 0);
  t.useRoute(0);
  chk("tapping a seed plans that journey",
    t.calls.planned === 1 && t.calls.from === "Zürich HB" && t.calls.to === "Bern",
    JSON.stringify(t.calls));
  chk("tapping a seed fills the visible fields too",
    t.calls.fields.iFrom === "Zürich HB" && t.calls.fields.iTo === "Bern",
    JSON.stringify(t.calls.fields));
  chk("even a tapped seed is not saved -- only a real search earns a chip", t.saved.length === 0);
}
{
  const t = build();
  t.rememberRoute("Luzern", "Brig");
  chk("one real search replaces ALL seeds", !/seed/.test(t.el.innerHTML) && /Brig/.test(t.el.innerHTML),
    t.el.innerHTML);
}
{
  const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
  chk("seed chips are styled as suggestions (dimmed)", /\.chip\.route\.seed\{[^}]*opacity/.test(css),
    "unstyled seed class = examples indistinguishable from the passenger's own routes");
}

// the chip has to be tappable back to the right entry
{
  const t = build();
  t.rememberRoute("Zürich HB", "Bern");
  t.rememberRoute("Luzern", "Brig");
  t.renderRoutes();
  chk("chips index back into the history array", /useRoute\(0\)/.test(t.el.innerHTML) && /useRoute\(1\)/.test(t.el.innerHTML), t.el.innerHTML);
  chk("newest chip is the newest route", t.el.innerHTML.indexOf("Luzern") < t.el.innerHTML.indexOf("Bern"), t.el.innerHTML);
}

// A chip is an offer to repeat a journey, so it has to BE a journey. Recording
// from planJourney() -- before any answer is known -- turned every typo into a
// permanent chip, and six slots are few enough that a couple of them evict the
// trips you actually take. So: recorded from the success path of BOTH planners,
// and NOT from planJourney. Both halves are load-bearing; asserting only the
// first would pass a version that never records at all.
chk("planJourney does not record before there is a result",
  !/function planJourney\(\)\{\s*rememberRoute\(/.test(src),
  "recording up front again -- a failed search becomes a permanent chip");
chk("both planners record on success", (src.match(/rememberRoute\(fromName,toName\)/g) || []).length === 2,
  "expected exactly two call sites (plainPlan + smartPlan); found " +
  (src.match(/rememberRoute\(fromName,toName\)/g) || []).length);
chk("the smart path records only with results in hand",
  /if\(base\.length\|\|wide\.length\)\s*rememberRoute\(/.test(src),
  "smartPlan records unconditionally -- an empty sweep would still leave a chip");
chk("the plain path records after the empty-result return",
  (() => { const p = src.indexOf("async function plainPlan");
    const e = src.indexOf("No connections found", p), r = src.indexOf("rememberRoute(fromName,toName)", p);
    return p > 0 && e > 0 && r > e; })(),
  "rememberRoute sits before the no-connections return -- empty results still recorded");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
