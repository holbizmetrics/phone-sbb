// Layover step-out: a long change turned into a choice. Runs the REAL
// changeDetails coordinate plumbing, layoverWalkM/layoverRows/lpType and the
// async layoverPOI painter. Built around the betrayals: a walk radius that
// ignores the minutes you have, an outage rendered as "nothing nearby", an
// OSM name injected unescaped, a folded card repainted by a stale fetch, and
// the chip offered on a change you cannot even make.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
const grab = (n) => {
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
const grabConst = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + label);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- changeDetails: the layover's coordinate rides along ----
{
  const changeDetails = new Function(`${grab("changeDetails")} return changeDetails;`)();
  const ride = (arrIso, depIso, co) => [
    { journey: {}, arrival: { arrival: arrIso, station: { name: "Prev", coordinate: { x: 1, y: 2 } } } },
    { journey: {}, departure: { departure: depIso, station: { name: "Olten", coordinate: co } } },
  ];
  const c1 = changeDetails({ sections: ride("2026-07-29T10:00", "2026-07-29T10:25", { x: 47.35, y: 7.9 }) });
  chk("the change carries the change station's own coordinate", c1[0].co && c1[0].co.x === 47.35, JSON.stringify(c1));
  const c2 = changeDetails({ sections: ride("2026-07-29T10:00", "2026-07-29T10:25", null) });
  chk("...falling back to the arriving leg's coordinate, never inventing one",
    c2[0].co && c2[0].co.x === 1, JSON.stringify(c2));
}

// ---- layoverWalkM: the radius is the minutes you actually have ----
const pure = new Function(`
  const CP=c=>String.fromCodePoint(c);
  ${grab("esc")}
  ${grab("haversineKm")}
  ${grabConst(/const LAYOVER_MIN=[^\n]*/, "LAYOVER_MIN")}
  ${grabConst(/const LAYOVER_KEEP=[^\n]*/, "LAYOVER_KEEP")}
  ${grab("layoverWalkM")}
  ${grab("toiletName")}
  ${grab("lpType")}
  ${grab("layoverRows")}
  return { layoverWalkM, lpType, layoverRows };
`)();
{
  chk("a 20' change buys a ~375 m radius (half of 10 usable minutes at 75 m/min)",
    pure.layoverWalkM(20) === 375, String(pure.layoverWalkM(20)));
  chk("a 30' change reaches further", pure.layoverWalkM(30) === 750, String(pure.layoverWalkM(30)));
  chk("...but a layover is not a hike -- the radius caps at 1 km",
    pure.layoverWalkM(60) === 1000 && pure.layoverWalkM(240) === 1000, String(pure.layoverWalkM(60)));
}

// ---- layoverRows: dedupe, sort, honest distances ----
{
  const at = (dLat, tags) => ({ lat: 47 + dLat, lon: 8, tags });
  const els = [
    at(0.003, { name: "Bahnhofcafe", amenity: "cafe" }),          // ~333 m
    at(0.001, { name: "Beck Muller", shop: "bakery" }),           // ~111 m
    at(0.001, { name: "Beck Muller", shop: "bakery" }),           // duplicate name
    at(0.002, { amenity: "cafe" }),                               // nameless -> skipped
    at(0.02,  { name: "Schloss weit weg", historic: "castle" }),  // ~2.2 km -> outside r
    { center: { lat: 47.004, lon: 8 }, tags: { name: "Stadtpark", leisure: "park" } }, // way with center
  ];
  const rows = pure.layoverRows(els, 47, 8, 750);
  chk("nameless spots and out-of-radius spots are dropped, duplicates collapsed",
    rows.length === 3, JSON.stringify(rows.map(r => r.name)));
  chk("sorted by walk time -- the nearest thing first",
    rows[0].name === "Beck Muller" && rows[1].name === "Bahnhofcafe", JSON.stringify(rows.map(r => r.name)));
  chk("walk minutes are ceil'd and never zero", rows[0].walk >= 1 && rows[1].walk === Math.ceil(333.6 / 75), JSON.stringify(rows));
  chk("a way's center counts like a node's point", rows.some(r => r.name === "Stadtpark"), JSON.stringify(rows.map(r => r.name)));
  chk("types map to their own emoji, unknown tags to a plain pin",
    pure.lpType({ amenity: "cafe" }).e === "\u2615" && pure.lpType({}).l === "", "");
  const many = pure.layoverRows(
    Array.from({ length: 10 }, (_, i) => at(0.0005 + i * 0.0001, { name: "Spot " + i, amenity: "cafe" })), 47, 8, 1000);
  chk("the list stops at six -- a layover shortlist, not a directory", many.length === 6, String(many.length));
}

// ---- toilets in the layover (2026-09-06) ----
// A 20-minute change is precisely when you need one, and this panel asked Overpass
// for cafés, bakeries and viewpoints and never toilets. OSM toilets are almost never
// named, so the [name] filter that keeps the café list honest would have dropped
// every one of them -- which is why they need their own row rules.
{
  const at = (dLat, dLon, tags) => ({ lat: 47 + dLat, lon: 8 + dLon, tags });
  chk("toilets have their own type and emoji", pure.lpType({ amenity: "toilets" }).l === "toilets"
    && pure.lpType({ amenity: "toilets" }).e === String.fromCodePoint(0x1F6BB), "");

  const rows = pure.layoverRows([
    at(0.002, 0, { amenity: "toilets" }),                       // nameless, ~222 m
    at(0.001, 0, { name: "Beck Muller", shop: "bakery" }),      // ~111 m
  ], 47, 8, 750);
  chk("an UNNAMED toilet survives the row filter with a synthetic name",
    rows.some(r => r.wc && r.name === "Public toilets"), JSON.stringify(rows.map(r => r.name)));

  const two = pure.layoverRows([
    at(0.004, 0, { amenity: "toilets" }),     // ~444 m, listed FIRST by Overpass
    at(0.001, 0, { amenity: "toilets" }),     // ~111 m, listed second
  ], 47, 8, 750);
  chk("two unnamed toilets at different spots are NOT collapsed into one -- dedupe is by coordinate, not by the shared synthetic name",
    two.filter(r => r.wc).length === 2, JSON.stringify(two));
  chk("...and the NEARER one sorts first, not the one Overpass happened to list first",
    two[0].walk < two[1].walk, JSON.stringify(two.map(r => r.walk)));

  // the guaranteed slot: six cafés nearer than the only toilet
  const crowded = pure.layoverRows([
    ...Array.from({ length: 7 }, (_, i) => at(0.0005 + i * 0.0001, 0, { name: "Cafe " + i, amenity: "cafe" })),
    at(0.006, 0, { amenity: "toilets" }),     // ~666 m, further than all seven cafés
  ], 47, 8, 1000);
  chk("the nearest toilet is GUARANTEED a slot even when six cafés are nearer -- on a layover it is the one row that is not optional",
    crowded.length === 6 && crowded.some(r => r.wc), JSON.stringify(crowded.map(r => r.name)));
  chk("...and it displaces the LAST café, not a nearer one",
    crowded[5].wc === true && crowded[0].name === "Cafe 0", JSON.stringify(crowded.map(r => r.name)));

  // negative: the radius still applies to toilets
  const far = pure.layoverRows([at(0.02, 0, { amenity: "toilets" })], 47, 8, 750);   // ~2.2 km
  chk("a toilet outside the walk radius is still dropped -- the slot guarantee does not reach past the radius",
    far.length === 0, JSON.stringify(far));

  // the query itself asks for them (the rows test feeds elements directly, so this is the only check on the request)
  chk("layoverSpots asks Overpass for amenity=toilets, WITHOUT a [name] filter",
    /\[amenity=toilets\]/.test(grab("layoverSpots")) && !/\[amenity=toilets\]\[name\]/.test(grab("layoverSpots")), "");
}

// ---- layoverPOI: the async painter and its honesty edges ----
const mkPOI = (spotsImpl, chg) => {
  const box = { innerHTML: "", dataset: {} };
  const card = { querySelector: (s) => (s === ".lpoi" ? box : null) };
  const btn = { closest: (s) => (s === ".conn" ? card : null) };
  const fn = new Function("SPOTS", "CHG", `
    const CP=c=>String.fromCodePoint(c);
    ${grab("esc")}
    ${grab("haversineKm")}
    ${grabConst(/const LAYOVER_MIN=[^\n]*/, "LAYOVER_MIN")}
    ${grabConst(/const LAYOVER_KEEP=[^\n]*/, "LAYOVER_KEEP")}
    ${grab("layoverWalkM")}
    ${grab("lpType")}
    ${grab("layoverRows")}
    const layoverSpots=(la,lo,r)=>SPOTS(la,lo,r);
    const jrnConns=[{ _chg: CHG }];
    ${grab("layoverPOI")}
    return layoverPOI;
  `)(spotsImpl, chg);
  return { fire: () => fn(btn, 0, 0), box };
};
const CHG = [{ stn: "Olten", b: 25, co: { x: 47.35, y: 7.9 }, missed: false }];
{
  const t = mkPOI(async () => [{ lat: 47.351, lon: 7.9, tags: { name: "Cafe <script>alert(1)</script>", amenity: "cafe" } }], CHG);
  await t.fire();
  chk("the card names the layover and the station", /25&#8242; at Olten/.test(t.box.innerHTML), t.box.innerHTML);
  chk("an OSM name never runs as markup", !t.box.innerHTML.includes("<script>") && t.box.innerHTML.includes("&lt;script&gt;"), t.box.innerHTML);
  chk("the caveat keeps ten minutes honest", /keep ~10&#8242;/.test(t.box.innerHTML), t.box.innerHTML);
  await t.fire();
  chk("a second tap folds the card away", t.box.innerHTML === "", t.box.innerHTML);
}
{
  const t = mkPOI(async () => [], CHG);
  await t.fire();
  chk("nothing nearby is a verdict that names the walk it checked",
    /Nothing named within a ~\d+&#8242; walk of Olten/.test(t.box.innerHTML), t.box.innerHTML);
}
{
  let calls = 0;
  const t = mkPOI(async () => { calls++; return calls === 1 ? null : [{ lat: 47.351, lon: 7.9, tags: { name: "Da Vinci", amenity: "restaurant" } }]; }, CHG);
  await t.fire();
  chk("a mirror outage is an outage, not a 'no'", /an outage, not a &quot;no&quot;/.test(t.box.innerHTML), t.box.innerHTML);
  await t.fire();
  chk("...and the next tap RETRIES instead of folding the error away",
    calls === 2 && t.box.innerHTML.includes("Da Vinci"), "calls=" + calls + " " + t.box.innerHTML);
}
{
  let release; const gate = new Promise(r => { release = r; });
  const t = mkPOI(async () => { await gate; return [{ lat: 47.351, lon: 7.9, tags: { name: "Late Cafe", amenity: "cafe" } }]; }, CHG);
  const p = t.fire();
  t.box.innerHTML = ""; t.box.dataset.q = "someone-else";   // folded / re-asked while in flight
  release(); await p;
  chk("a stale fetch never repaints a folded card", t.box.innerHTML === "", t.box.innerHTML);
}
{
  const t = mkPOI(async () => { throw new Error("should not fetch"); }, [{ stn: "X", b: 25, co: null, missed: false }]);
  await t.fire();
  chk("no coordinate -> no card, not a guessed one", t.box.innerHTML === "", t.box.innerHTML);
}

// ---- wiring: the chip only where stepping out is real ----
chk("the chip is gated on a makeable change of LAYOVER_MIN+ with a coordinate",
  /!x\.missed && x\.b>=LAYOVER_MIN && x\.co/.test(src), "chip offered on a missed or tiny change");
chk("tapping the chip calls layoverPOI with this connection and this change",
  src.includes("layoverPOI(this,${i},${k})"), "chip built but wired to nothing");
chk("the connection card carries the lpoi container", src.includes(`<div class="lpoi"></div>`), "painter has nowhere to paint");
chk("a failed Overpass ask is not cached as a verdict (shared client contract)",
  /delete overpassCache\[key\]/.test(src), "");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the chip and the card are styled", css.includes(".cxout") && css.includes(".lpoi") && css.includes(".lprow"), "unstyled = invisible = unshipped");
chk("the caveat is the quiet line", /\.lpcav\{[^}]*var\(--faint\)/.test(css));
chk("the help sheet explains the chip", fs.readFileSync(new URL("../index.html", import.meta.url), "utf8").includes("step out?"), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
