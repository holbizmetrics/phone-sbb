// Air & pollen switch (operator idea 2026-11-25): runs the REAL aqBand / aqAt / aqChipText / aqDetailText
// out of app.js, plus wiring checks on the real index.html + app.js.
// Fixtures follow the shape Open-Meteo's air-quality API actually returned on 2026-11-25 (Zurich,
// hourly time/european_aqi/*_pollen, timezone=auto); the spring values are from its 2025-04-15 archive
// (birch max 188.1 grains/m3) -- so the test is not a guess checking itself.
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
const m = src.match(/const AQ_POLLEN=\{[\s\S]*?\};/);
if (!m) throw new Error("HARNESS FAILED -- AQ_POLLEN not found");
const { aqBand, aqAt, aqChipText, aqDetailText } = new Function(
  m[0] + grab("aqBand") + grab("aqAt") + grab("aqChipText") + grab("aqDetailText")
  + "; return {aqBand, aqAt, aqChipText, aqDetailText};")();

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// bands: the provider's own table, both sides of each edge
const B = [[0, "good"], [20, "good"], [20.1, "fair"], [40, "fair"], [41, "moderate"], [60, "moderate"],
           [61, "poor"], [80, "poor"], [81, "very poor"], [100, "very poor"], [101, "extremely poor"]];
for (const [v, w] of B) chk(`EAQI ${v} -> ${w}`, aqBand(v) === w, String(aqBand(v)));
chk("no reading -> no band (never a made-up 'good')", aqBand(null) === null && aqBand(undefined) === null && aqBand(NaN) === null);

const H = (over = {}) => Object.assign({
  time: ["2026-04-15T10:00", "2026-04-15T11:00"],
  european_aqi: [31, 33], alder_pollen: [0.1, 0.1], birch_pollen: [150.4, 188.1], grass_pollen: [3.1, 2.9],
  mugwort_pollen: [0, 0], olive_pollen: [0, 0], ragweed_pollen: [0, 0],
}, over);
const ARR = "2026-04-15T11:20:00+02:00";

let a = aqAt(H(), ARR);
chk("spring: arrival hour picked (11:xx -> 11:00 slot)", a && a.hour === "11:00" && a.aqi === 33, JSON.stringify(a));
chk("spring: highest pollen type is the one shown (birch 188)", a && a.pollen && a.pollen.name === "Birch" && a.pollen.val === 188, JSON.stringify(a));
chk("spring: chip reads 'Air fair · Birch 188'", a && aqChipText(a) === "Air fair · Birch 188", a && aqChipText(a));
chk("detail carries the unit and the source", a && /188 grains\/m³/.test(aqDetailText(a)) && /Open-Meteo/.test(aqDetailText(a)), a && aqDetailText(a));
chk("detail never says high/low about pollen", a && !/\b(high|low|severe|moderate pollen)\b/i.test(aqDetailText(a)), a && aqDetailText(a));

// November (what the live API returned today): every pollen type 0
const NOV = H({ birch_pollen: [0, 0], grass_pollen: [0, 0], alder_pollen: [0, 0], european_aqi: [53, 52] });
a = aqAt(NOV, ARR);
chk("all-zero pollen: no pollen on the chip", a && a.pollen === null && aqChipText(a) === "Air moderate", a && aqChipText(a));
chk("all-zero pollen: detail says so plainly", a && /No pollen in the forecast/.test(aqDetailText(a)));
a = aqAt(H({ birch_pollen: [0.3, 0.4], grass_pollen: [0.2, 0.2], alder_pollen: [0, 0] }), ARR);
chk("pollen that rounds to 0 is not shown as 'Birch 0'", a && a.pollen === null, JSON.stringify(a));

// gaps: Open-Meteo returns null at the edges of its range
a = aqAt(H({ european_aqi: [31, null] }), ARR);
chk("AQI null at that hour: no band, pollen still shown", a && a.band === null && aqChipText(a) === "Birch 188", JSON.stringify(a));
const ALLNULL = { time: ["2026-04-15T11:00"], european_aqi: [null], birch_pollen: [null] };
chk("nothing known for the hour -> no chip at all", aqAt(ALLNULL, ARR) === null);
chk("hour outside the forecast -> no chip", aqAt(H(), "2026-04-20T11:00:00+02:00") === null);
chk("service did not answer -> no chip", aqAt(null, ARR) === null && aqAt({}, ARR) === null);

// wiring: the switch exists, is OFF by default, and every place weather is filled also fills air
const nFill = (src.match(/if\(weather\) fillWeather\(\);/g) || []).length;
const nAir = (src.match(/if\(airq\) fillAir\(\);/g) || []).length;
chk("switch present in the page", /id="aqTog"[^>]*onchange="onAirToggle\(\)"/.test(src));
chk("switch OFF by default (no 'checked', airq starts false)", !/id="aqTog"[^>]*checked/.test(src) && /let airq = false;/.test(src));
chk("fillAir runs at every site fillWeather runs", nFill > 0 && nAir === nFill, `weather=${nFill} air=${nAir}`);
chk("never its own row any more", !/aqrow/.test(src));
chk("destination chip is built when EITHER switch is on", /const wxD = \(cto && arr && \(weather \|\| airq\)\)/.test(src));
chk("tap bubble also opens for leaf-only air chips", /closest\("\.wx\.tappable, \.aq\.tappable"\)/.test(src));

// behaviour: run the REAL fillAir + popText against fake chips (no browser)
const mkEl = (cls, text = "", detail) => {
  const el = { dataset: { t: ARR, lat: "47.378", lon: "8.540" }, textContent: text, cls: new Set(cls.split(" ")),
               attrs: {}, classList: { add: c => el.cls.add(c) }, setAttribute: (k, v) => { el.attrs[k] = v; } };
  if (detail) el.dataset.detail = detail;
  return el;
};
const both = mkEl("wx aq", "☀ 12°", "Clear sky · 12°");
const leaf = mkEl("aq");
const run = new Function("document", "destAir", m[0] + grab("aqBand") + grab("aqAt") + grab("aqDetailText")
  + grab("popText") + "async " + grab("fillAir") + "; return {fillAir, popText};");
const H2 = H();
const doc = { querySelectorAll: sel => sel === ".aq[data-t]" ? [both, leaf] : [] };
const F = run(doc, async () => H2);
await F.fillAir();
chk("Weather+Air chip: weather symbol kept, not replaced by the leaf", both.textContent === "☀ 12°", both.textContent);
chk("Weather+Air bubble: weather line FIRST, then the air & pollen line", F.popText(both) === "Clear sky · 12°\n" + aqDetailText(aqAt(H2, ARR)), JSON.stringify(F.popText(both)));
chk("Air-only chip shows just the leaf", leaf.textContent === "\u{1F33F}" && leaf.cls.has("tappable"), leaf.textContent);
chk("Air-only bubble holds only the air & pollen line", F.popText(leaf) === aqDetailText(aqAt(H2, ARR)), F.popText(leaf));
const quiet = mkEl("aq");
await run({ querySelectorAll: () => [quiet] }, async () => null).fillAir();
chk("service down: leaf chip stays empty and untappable (no fake data)", quiet.textContent === "" && !quiet.cls.has("tappable"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
