// Runs the REAL rememberRoute/renderRoutes out of index.html. No browser needed.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);
const src = fs.readFileSync(APP, "utf8");
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
  const m = new Function("EL", "SAVED", "START", `
    let routeHist = START;
    ${(src.match(/^const LS = \{[^}]+\};/m) || [])[0] || (() => { throw new Error("HARNESS FAILED -- const LS not found"); })()}
    const $ = () => EL;
    const save = (k, v) => SAVED.push(JSON.parse(JSON.stringify(v)));
    ${grab("esc")}
    ${grab("shortStop")}
    ${grab("renderRoutes")}
    ${grab("rememberRoute")}
    return { rememberRoute, renderRoutes, hist: () => routeHist };
  `)(el, saved, start);
  return { ...m, el, saved };
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

// empty history paints nothing at all -- not an empty box with padding
{
  const t = build();
  t.renderRoutes();
  chk("no history -> no chips", t.el.innerHTML === "", JSON.stringify(t.el.innerHTML));
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

// planJourney must be the thing that records, or nothing ever gets remembered
chk("planJourney records the route", /function planJourney\(\)\{\s*rememberRoute\(/.test(src),
  "rememberRoute is not called from planJourney -- history would stay empty forever");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
