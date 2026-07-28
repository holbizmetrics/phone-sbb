// Coordinates-to-stop (cross-vendor finding #4). Runs the REAL nearbyStops +
// nearMe. The corpus is built around the ways "near me" can betray: an address
// or POI offered as somewhere a train stops (id:null rows), a swallowed error
// reason (denied / no-fix / no-stop are three different next moves), the pin
// appearing on the destination field (you stand at From, you dream of To),
// and shipping green but unwired.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
const grab = (n) => {
  // async functions must keep their async keyword or the extraction is a syntax error
  let i = src.indexOf("async function " + n + "(");
  if (i < 0) i = src.indexOf("function " + n + "(");
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

// ---- nearbyStops: only real stops, nearest first ----
const mkNB = (payload) => new Function("api", `${grab("nearbyStops")} return nearbyStops;`)(payload);
{
  const paths = [];
  const nb = mkNB(async (p) => { paths.push(p); return { stations: [
    { id: null, name: "Bahnhofstrasse 12", distance: 10 },      // an address is not a stop
    { id: "8505000", name: "Luzern", distance: 240 },
    { id: "8505007", name: "Luzern, Bahnhof", distance: 120 },
    { id: null, name: "Some POI", distance: 5 },
    { id: "1", name: "A", distance: 900 }, { id: "2", name: "B", distance: 800 },
    { id: "3", name: "C", distance: 700 }, { id: "4", name: "D" },
  ]};});
  const s = await nb(47.0502, 8.3093);
  chk("addresses and POIs (id:null) are dropped -- a street is not where trains stop",
    s.every(x => x.id), JSON.stringify(s));
  chk("nearest stop first", s[0].name === "Luzern, Bahnhof", JSON.stringify(s[0]));
  chk("capped at 5 -- a pick list, not a gazetteer", s.length === 5, String(s.length));
  chk("the request carries the coordinates", /x=47\.050200&y=8\.309300/.test(paths[0]), paths[0]);
  const s2 = await mkNB(async () => ({ stations: [
    { id: "a", name: "A", distance: 50 }, { id: "d", name: "D" }, { id: "b", name: "B", distance: 20 },
  ]}))(47, 8);
  chk("a stop with no distance sinks to the end, it does not fake nearness",
    s2.map(x => x.name).join("") === "BAD", JSON.stringify(s2.map(x => x.name)));
}

// ---- nearMe: the tap, the picks, and the three honest failures ----
function fakeEl(id) {
  const o = { id, value: "", classes: new Set(), children: [], _html: "" };
  o.classList = { add: c => o.classes.add(c), remove: c => o.classes.delete(c), contains: c => o.classes.has(c) };
  Object.defineProperty(o, "innerHTML", {
    get: () => o._html,
    set: (v) => { o._html = v; o.children = [...v.matchAll(/data-n="([^"]*)"/g)].map(m => ({ dataset: { n: m[1] }, onclick: null })); },
  });
  return o;
}
const mkNear = ({ geo = "ok", stations = [], apiErr = null } = {}) => {
  const st = { els: {}, picks: [], pending: null };
  const $ = (id) => st.els[id] || (st.els[id] = fakeEl(id));
  const nav = geo === "none" ? {} : { geolocation: { getCurrentPosition: (ok, bad) => {
    if (geo === "ok") st.pending = ok({ coords: { latitude: 47.0502, longitude: 8.3093 } });
    else bad({ code: geo === "denied" ? 1 : 3 });
  }}};
  const fire = new Function("$", "navigator", "api", "PICKS", `
    ${grab("esc")}
    ${grab("nearbyStops")}
    let fromName="", toName="X", wanName="", wanBudget=0;
    const showDepartures=(n)=>PICKS.push(["board",n]);
    const planJourney=()=>PICKS.push(["plan",fromName]);
    const runWander=()=>PICKS.push(["wander"]);
    ${(src.match(/const NEAR_PICK=\{[\s\S]*?\};/) || [(() => { throw new Error("HARNESS FAILED -- NEAR_PICK not found"); })()])[0]}
    ${grab("nearMsg")}
    ${grab("nearMe")}
    return nearMe;
  `)($, nav, async () => { if (apiErr) throw new Error(apiErr); return { stations }; }, st.picks);
  return { fire, st, $ };
};
const LUZ = [{ id: "1", name: "Luzern", distance: 240.4 }, { id: "2", name: "Luzern, Bahnhof", distance: 320 }];
{
  const t = mkNear({ stations: LUZ });
  t.fire("dep"); await t.st.pending;
  const ac = t.$("acDep");
  chk("nearby stops land in the SAME dropdown the passenger already knows",
    ac.classes.has("show") && /Luzern/.test(ac.innerHTML), ac.innerHTML);
  chk("each row says how far -- 240 m is a different offer than 2 km",
    /240&#8201;m/.test(ac.innerHTML), ac.innerHTML);
  ac.children[0].onclick();
  chk("tapping a stop fills the field and opens the board",
    t.$("iDep").value === "Luzern" && t.st.picks.some(p => p[0] === "board" && p[1] === "Luzern"),
    JSON.stringify(t.st.picks));
  chk("...and the dropdown closes", !ac.classes.has("show"));
}
{
  const t = mkNear({ stations: LUZ });
  t.fire("from"); await t.st.pending;
  t.$("acFrom").children[0].onclick();
  chk("origin pick replans when a destination is already set",
    t.st.picks.some(p => p[0] === "plan" && p[1] === "Luzern"), JSON.stringify(t.st.picks));
}
{
  const denied = mkNear({ geo: "denied" }); denied.fire("dep");
  chk("permission denied says DENIED -- the fix is in the browser, not the app",
    /denied/.test(denied.$("acDep").innerHTML), denied.$("acDep").innerHTML);
  const nofix = mkNear({ geo: "nofix" }); nofix.fire("dep");
  chk("no fix says NO FIX -- try again or type, a different next move",
    /No location fix/.test(nofix.$("acDep").innerHTML), nofix.$("acDep").innerHTML);
  const none = mkNear({ geo: "none" }); none.fire("dep");
  chk("a browser without geolocation is told so", /No location service/.test(none.$("acDep").innerHTML));
  const empty = mkNear({ stations: [] }); empty.fire("dep"); await empty.st.pending;
  chk("no stop nearby is a FINDING, not a shrug", /No stop near here/.test(empty.$("acDep").innerHTML));
  const boom = mkNear({ apiErr: "HTTP 429" }); boom.fire("dep"); await boom.st.pending;
  chk("a failed lookup keeps its reason -- discarded errors are the named defect class",
    /HTTP 429/.test(boom.$("acDep").innerHTML), boom.$("acDep").innerHTML);
}
{
  const t = mkNear({ stations: [{ id: "1", name: '"><img src=x>', distance: 5 }] });
  t.fire("dep"); await t.st.pending;
  chk("a hostile stop name is escaped", !t.$("acDep").innerHTML.includes('"><img'), t.$("acDep").innerHTML);
  const noop = mkNear({}); noop.fire("to"); noop.fire("nonsense");
  chk("an unknown field is a no-op, never a crash", true);
}

// ---- wiring: green-but-unwired is the named defect class ----
chk("all three where-am-I fields carry the pin (board, origin, wander)",
  (src.match(/onclick="nearMe\('(dep|from|wan)'\)"/g) || []).length === 3,
  "found: " + JSON.stringify(src.match(/onclick="nearMe\('[a-z]+'\)"/g)));
chk("the DESTINATION field has no pin -- you stand at From, you dream of To",
  !/nearMe\('to'\)/.test(src));
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the pin is styled", css.includes(".field .loc"), "unstyled = invisible = unshipped");
chk("a filled field swaps the pin for the clear button",
  /\.field\.has \.loc\{display:none\}/.test(css), "both buttons stacked on one spot");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
