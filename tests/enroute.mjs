// Runs the REAL enrouteFind and the REAL shared Overpass client out of index.html.
// Two things are actually being defended here:
//   1. the lat/lon convention. transport.opendata.ch calls latitude "x"; OSM calls
//      it "lat"; the app's own haversine() reads latitude off ".y". Get any one of
//      those backwards and every distance is quietly wrong -- plausible numbers,
//      wrong places, nothing throws.
//   2. "we could not ask OSM" staying distinguishable from "OSM has nothing".
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  const start = src.slice(Math.max(0, i - 6), i) === "async " ? i - 6 : i;
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(start, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};
const grabConst = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- could not extract " + what);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// A connection shaped like the real API: coordinate.x is LATITUDE, .y is LONGITUDE.
const stop = (name, lat, lon, t) => ({ station: { name, coordinate: { x: lat, y: lon } }, arrival: t ? `2026-07-25T${t}:00+02:00` : null, departure: t ? `2026-07-25T${t}:00+02:00` : null });
// Bern -> Spiez -> Interlaken -> Brig, roughly true coordinates
const PASSLIST = [
  stop("Bern", 46.949, 7.439, "09:00"),
  stop("Spiez", 46.686, 7.680, "09:35"),
  stop("Interlaken Ost", 46.690, 7.869, "09:55"),
  stop("Brig", 46.319, 7.988, "10:40"),
];
const osmNode = (name, lat, lon, tags = {}) => ({ type: "node", lat, lon, tags: { name, ...tags } });

function build(elements, passList = PASSLIST) {
  const calls = [];
  const m = new Function("ELEMENTS", "CALLS", "PASSLIST", `
    const jrnConns = [{ sections: [{ journey: { passList: PASSLIST } }] }];
    ${grab("legStops")}
    ${grab("haversine")}
    ${grabConst(/const CP=[^;]+;/, "CP")}
    ${grab("wonderType")}
    ${grabConst(/const NEAR_KM=[^;]+;/, "NEAR_KM")}
    const overpassBBox = (s,w,n,e) => { CALLS.push([s,w,n,e]); return Promise.resolve(ELEMENTS); };
    ${grab("enrouteFind")}
    return { enrouteFind };
  `)(elements, calls, passList);
  return { ...m, calls };
}

// control: without this passing, every "it correctly found nothing" below is
// just a function that never finds anything
{
  const t = build([osmNode("Blausee", 46.686, 7.690, { natural: "waterfall" })]);
  const r = await t.enrouteFind(0);
  chk("control: a wonder beside a middle stop is offered", Array.isArray(r) && r.length === 1, JSON.stringify(r));
  chk("control: it is anchored to the right stop", r?.[0]?.stop?.name === "Spiez", JSON.stringify(r?.[0]?.stop));
  chk("control: it carries that stop's time", r?.[0]?.stop?.t === "09:35", r?.[0]?.stop?.t);
}

// THE convention test: an OSM point sitting exactly on a station must measure 0 km.
// If lat/lon were swapped anywhere in the chain this is hundreds of km instead.
{
  const t = build([osmNode("Exactly Spiez", 46.686, 7.680)]);
  const r = await t.enrouteFind(0);
  chk("a point ON a stop measures ~0 km (lat/lon not swapped)", r?.[0] && r[0].km < 0.05, JSON.stringify(r?.[0]?.km));
}
{
  // swap them and it must NOT be found -- proves the check above has teeth
  const t = build([osmNode("Swapped", 7.680, 46.686)]);
  const r = await t.enrouteFind(0);
  chk("...and the swapped copy is correctly out of range", (r || []).length === 0, JSON.stringify(r));
}

// the endpoints are where you are already going -- not stop-off suggestions
{
  const t = build([osmNode("Beside Bern", 46.949, 7.439), osmNode("Beside Brig", 46.319, 7.988)]);
  const r = await t.enrouteFind(0);
  chk("nothing is offered at the origin or the destination", (r || []).length === 0, JSON.stringify(r));
}

// far away is not "get off here"
{
  // must be far from EVERY middle stop, not just the first one -- the finder
  // anchors to the nearest, so "far from Spiez" alone proves nothing
  const t = build([osmNode("Too far", 46.900, 7.900)]);   // ~24 km north of both
  const r = await t.enrouteFind(0);
  chk("a find beyond NEAR_KM is dropped", (r || []).length === 0, JSON.stringify(r));
}

// one suggestion per stop, and it is the nearest one
{
  const t = build([
    osmNode("Far-ish from Spiez", 46.686, 7.720),
    osmNode("Right at Spiez", 46.686, 7.681),
  ]);
  const r = await t.enrouteFind(0);
  chk("one suggestion per stop", r?.length === 1, JSON.stringify(r));
  chk("...and it is the nearest", r?.[0]?.name === "Right at Spiez", JSON.stringify(r?.[0]?.name));
}

// the list reads in the order you will pass them
{
  const t = build([osmNode("At Interlaken", 46.690, 7.870), osmNode("At Spiez", 46.686, 7.681)]);
  const r = await t.enrouteFind(0);
  chk("finds are ordered by when you get there", (r || []).map(x => x.stop.name).join(">") === "Spiez>Interlaken Ost",
    JSON.stringify((r || []).map(x => [x.stop.name, x.stop.t])));
}

// OSM ways carry center{}, not lat/lon
{
  const t = build([{ type: "way", center: { lat: 46.686, lon: 7.681 }, tags: { name: "A way", waterway: "waterfall" } }]);
  const r = await t.enrouteFind(0);
  chk("a way with center{} is read", r?.length === 1, JSON.stringify(r));
}

// unnamed OSM points cannot be suggested -- "get off at the unnamed thing" is not advice
{
  const t = build([{ type: "node", lat: 46.686, lon: 7.681, tags: { natural: "peak" } }]);
  const r = await t.enrouteFind(0);
  chk("an unnamed point is skipped", (r || []).length === 0, JSON.stringify(r));
}

// unreachable must NOT collapse into empty
{
  const t = build(null);
  const r = await t.enrouteFind(0);
  chk("a dead Overpass returns 'unreachable', not []", r === "unreachable", JSON.stringify(r));
}
{
  const t = build([]);
  const r = await t.enrouteFind(0);
  chk("a genuinely empty corridor returns []", Array.isArray(r) && r.length === 0, JSON.stringify(r));
}

// a two-stop hop has no middle, so there is nothing to offer
{
  const t = build([osmNode("Anything", 46.686, 7.681)], [PASSLIST[0], PASSLIST[3]]);
  const r = await t.enrouteFind(0);
  chk("a journey with no intermediate stops returns null", r === null, JSON.stringify(r));
}

// the bbox has to actually cover the corridor, or the query asks about nowhere
{
  const t = build([]);
  await t.enrouteFind(0);
  const [s, w, n, e] = t.calls[0];
  chk("bbox spans every stop, with padding", s < 46.319 && n > 46.949 && w < 7.439 && e > 7.988,
    JSON.stringify(t.calls[0]));
}

// the shared client: one mirror list, and an outage is never cached as a verdict
{
  const hosts = (src.match(/const OVERPASS_HOSTS=\[[^\]]+\]/) || [""])[0];
  chk("there is exactly one Overpass mirror list", (src.match(/overpass-api\.de\/api\/interpreter/g) || []).length === 1, hosts);
  chk("all four OSM features go through overpassQuery", (src.match(/overpassQuery\(/g) || []).length === 5,
    "expected 1 definition + 4 callers (wonders, en-route, layover step-out, toilets since 2026-09-03)");
}
{
  let tries = 0;
  const q = new Function("COUNT", `
    const fetch = () => { COUNT(); return Promise.reject(new Error("down")); };
    const OVERPASS_HOSTS = ["a", "b"];
    const overpassCache = {};
    ${grab("overpassQuery")}
    return { overpassQuery, overpassCache };
  `)(() => tries++);
  const first = await q.overpassQuery("k", "q");
  chk("all mirrors down -> null", first === null, JSON.stringify(first));
  chk("...it tried every mirror", tries === 2, String(tries));
  chk("...and did not cache the outage", Object.keys(q.overpassCache).length === 0, JSON.stringify(Object.keys(q.overpassCache)));
  await q.overpassQuery("k", "q");
  chk("...so the next tap really re-asks", tries === 4, String(tries));
}

// wiring: the panel has to call it, or none of this is reachable
chk("fillEnroute runs when the sketch panel opens", /fillEnroute\(panel,ci\)/.test(src),
  "the finder is unreachable from the UI -- green tests, invisible feature");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
