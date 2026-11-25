// P2: fog-top ranking layer over Wander (UNSOLVED-GAPS 1.1). The spec named
// the traps and each gets a planted case here: the GATE (pressure levels are
// never fetched on a clear day -- the layer must cost one tiny request and
// nothing else), the THREE-VALUED verdict ("too close to call" is the state
// that stops the app sending someone up into grey soup -- a binary here lies),
// honest failure (a dead fog request degrades to "no verdict" WITH its reason,
// never to a silently fog-free day), and the model pin (MeteoSwiss -- a global
// model will not resolve the valley boundaries).
import fs from "fs";
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- static: the pin, the gate constant, the wiring ----
{
  chk("the pressure-level request pins the model to MeteoSwiss",
    /models=meteoswiss_icon_ch1/.test(src), "");
  chk("the gate request asks for cloud_cover_low and nothing heavy",
    /hourly=cloud_cover_low&forecast_days=1/.test(src), "");
  chk("runWander runs the fog layer alongside the return checks",
    /wanFog\(cands, stn\)/.test(src), "");
  chk("runWander paints through the fog ranking", /wanFogRank\(show\)/.test(src), "");
  chk("the note line is painted when present", /wanFogNote\s*\?/.test(src), "");
}

// ---- extract the fog block from the weather section ----
const wa = src.indexOf("const FOG_LEVELS");
const wb = Math.min(...["function bestDayHTML", "</script>"].map(p => src.indexOf(p, wa)).filter(i => i >= 0));
if (wa < 0 || !Number.isFinite(wb)) throw new Error("HARNESS FAILED -- fog block markers not found");
const fogSrc = src.slice(wa, wb);
chk("control: extracted block is the fog service",
  fogSrc.includes("function fogTopAt") && fogSrc.includes("function fogVerdict"), fogSrc.slice(0, 60));

// ---- extract the wander-side layer ----
const na = src.indexOf("let wanFogNote");
const nb = Math.min(...["function wanCard", "</script>"].map(p => src.indexOf(p, na)).filter(i => i >= 0));
if (na < 0 || !Number.isFinite(nb)) throw new Error("HARNESS FAILED -- wanFog block markers not found");
const wanFogSrc = src.slice(na, nb);
chk("control: extracted block is the wander fog layer",
  wanFogSrc.includes("async function wanFog") && wanFogSrc.includes("function wanFogRank"), wanFogSrc.slice(0, 60));

// ---- fogTopAt / fogVerdict: the pure derivation ----
const mkPure = () => {
  const ctx = { fetch: () => Promise.reject(new Error("pure tests must not fetch")), Math, Array, Number, Date, Intl };
  vm.createContext(ctx);
  new vm.Script(fogSrc + "\nthis.fogTopAt=fogTopAt; this.fogVerdict=fogVerdict; this.FOG_BAND=FOG_BAND;").runInContext(ctx);
  return ctx;
};
const H = "2026-11-15T09";
// RH saturated at 1000/975/950, collapsed at 925 -> the top is in the 950-925 gap.
const LV = {
  time: [H + ":00"],
  relative_humidity_1000hPa: [97], relative_humidity_975hPa: [95],
  relative_humidity_950hPa: [93], relative_humidity_925hPa: [55],
  temperature_1000hPa: [3], temperature_975hPa: [2.5],
  temperature_950hPa: [2], temperature_925hPa: [5],          // warmer ABOVE = inversion
  geopotential_height_1000hPa: [110], geopotential_height_975hPa: [330],
  geopotential_height_950hPa: [560], geopotential_height_925hPa: [800],
};
{
  const p = mkPure();
  const ft = p.fogTopAt(LV, H + ":00");
  chk("RH collapse between adjacent levels marks the top, mid-gap in metres",
    ft && ft.top === 680, JSON.stringify(ft));
  chk("a temperature inversion across the same gap corroborates it", ft && ft.inv === true, JSON.stringify(ft));
  const noInv = { ...LV, temperature_925hPa: [0] };
  chk("no inversion = top still stands, corroboration honestly absent",
    (x => x && x.top === 680 && x.inv === false)(p.fogTopAt(noInv, H + ":00")), "");
  const clear = { ...LV, relative_humidity_1000hPa: [60], relative_humidity_975hPa: [55], relative_humidity_950hPa: [50] };
  chk("planted negative: no saturated level anywhere -> null, never an invented top",
    p.fogTopAt(clear, H + ":00") === null, "");
  const noZ = { ...LV, geopotential_height_950hPa: [null], geopotential_height_925hPa: [null] };
  chk("planted negative: a collapse with no height data -> null (a top with no metres is not a top)",
    p.fogTopAt(noZ, H + ":00") === null, "");
  chk("planted negative: the wrong hour -> null", p.fogTopAt(LV, "2026-11-15T13:00") === null, "");
  chk("planted negative: no data at all -> null", p.fogTopAt(null, H + ":00") === null, "");
  // the three-valued verdict, band = vertical resolution
  chk("well above the top = above", p.fogVerdict(680 + p.FOG_BAND, 680) === "above", "");
  chk("well below the top = below", p.fogVerdict(680 - p.FOG_BAND, 680) === "below", "");
  chk("inside the band = too close to call -- the state that prevents the soup trip",
    p.fogVerdict(680, 680) === "close", "");
  chk("no elevation -> no verdict", p.fogVerdict(null, 680) === null, "");
  chk("no top -> no verdict", p.fogVerdict(1200, null) === null, "");
}

// ---- wanFog: gate, verdicts, honest failure -- REAL fog fns + stubbed fetch ----
// The clock is pinned inside the vm so the Zurich hour key is deterministic.
const FIXED = Date.parse("2026-11-15T09:30:00+01:00");
const mkWan = ({ low = 85, gateFail = false, levels = LV, elevs = [1200, 680, 300] } = {}) => {
  const calls = [];
  class FDate extends Date { constructor(...a) { a.length ? super(...a) : super(FIXED); } }
  const gateHour = { time: [H + ":00"], cloud_cover_low: [low] };
  const ctx = {
    Math, Array, Number, Intl, Promise, Date: FDate,
    esc: s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    routeElevation: pts => { calls.push("elev:" + pts.length); return Promise.resolve(elevs); },
    fetch: url => {
      calls.push(url.includes("hPa") ? "levels" : "gate");
      if (gateFail && !url.includes("hPa")) return Promise.resolve({ ok: false, status: 503 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hourly: url.includes("hPa") ? levels : gateHour }) });
    },
  };
  vm.createContext(ctx);
  new vm.Script(fogSrc + "\n" + wanFogSrc
    + "\nthis.wanFog=wanFog; this.wanFogRank=wanFogRank; this.getNote=()=>wanFogNote;").runInContext(ctx);
  return { ctx, calls };
};
const STN = { coordinate: { x: 47.05, y: 8.31 } };
const CANDS = () => [
  { name: "High", crd: { x: 47.0, y: 8.6 } },
  { name: "Mid",  crd: { x: 47.1, y: 8.5 } },
  { name: "Low",  crd: { x: 47.2, y: 8.4 } },
  { name: "NoCrd" },                                         // a stop the API gave no coordinate
];
{
  const t = mkWan();
  const cands = CANDS();
  await t.ctx.wanFog(cands, STN);
  chk("fog day: verdicts land per candidate (above/close/below by elevation vs top)",
    cands[0].fog === "above" && cands[1].fog === "close" && cands[2].fog === "below",
    cands.map(c => c.fog).join(","));
  chk("a candidate with no coordinate gets NO verdict, never a borrowed one",
    cands[3].fog === undefined, String(cands[3].fog));
  chk("the note names the top and the corroboration", /680/.test(t.ctx.getNote()) && /inversion confirmed/.test(t.ctx.getNote()), t.ctx.getNote());
  chk("elevation is fetched once, batched, only for candidates with coordinates",
    t.calls.filter(c => c.startsWith("elev")).join(",") === "elev:3", t.calls.join(","));
}
{
  const t = mkWan({ low: 10 });
  const cands = CANDS();
  await t.ctx.wanFog(cands, STN);
  chk("PLANTED GATE: clear day = ONE gate request, pressure levels never fetched",
    t.calls.join(",") === "gate", t.calls.join(","));
  chk("...and no verdicts are minted", cands.every(c => c.fog === undefined), "");
}
{
  const t = mkWan({ gateFail: true });
  const cands = CANDS();
  await t.ctx.wanFog(cands, STN);
  chk("PLANTED HONESTY: a dead fog request keeps its reason on the note line",
    /did not answer/.test(t.ctx.getNote()) && /HTTP 503/.test(t.ctx.getNote()), t.ctx.getNote());
  chk("...and withholds every verdict -- an outage is not a clear day", cands.every(c => c.fog === undefined), "");
}
{
  const t = mkWan({ levels: { ...LV, relative_humidity_1000hPa: [60], relative_humidity_975hPa: [55], relative_humidity_950hPa: [50] } });
  const cands = CANDS();
  await t.ctx.wanFog(cands, STN);
  chk("low cloud but no derivable top = said out loud, no verdict invented",
    /no clean deck top/.test(t.ctx.getNote()) && cands.every(c => c.fog === undefined), t.ctx.getNote());
}
{
  const t = mkWan();
  const cands = CANDS();
  await t.ctx.wanFog(cands, null);
  chk("no origin fix -> the layer stands down without a single request", t.calls.length === 0, t.calls.join(","));
}

// ---- wanFogRank: above first, below last, stable inside groups ----
{
  const t = mkWan();
  const list = [
    { name: "ScenicBelow", fog: "below" }, { name: "PlainAbove", fog: "above" },
    { name: "NoVerdict" }, { name: "ScenicAbove", fog: "above" }, { name: "Close", fog: "close" },
  ];
  const r = t.ctx.wanFogRank(list).map(c => c.name).join(",");
  chk("above-the-deck candidates rank first, below sinks last",
    r === "PlainAbove,ScenicAbove,NoVerdict,Close,ScenicBelow", r);
  chk("stable: inside a group the incoming (scenic-then-longest) order survives",
    r.indexOf("PlainAbove") < r.indexOf("ScenicAbove") && r.indexOf("NoVerdict") < r.indexOf("Close"), r);
  const clearDay = [{ name: "A" }, { name: "B" }, { name: "C" }];
  chk("planted negative: on a clear day (no verdicts) nothing moves",
    t.ctx.wanFogRank(clearDay).map(c => c.name).join(",") === "A,B,C", "");
  chk("wanFogRank does not mutate its input", list[0].name === "ScenicBelow", "");
}

// ---- wanCard: the rib is three-valued and only paints when a verdict exists ----
{
  const ca = src.indexOf("function wanCard");
  const cb = Math.min(...["async function runWander", "</script>"].map(p => src.indexOf(p, ca)).filter(i => i >= 0));
  if (ca < 0 || !Number.isFinite(cb)) throw new Error("HARNESS FAILED -- wanCard markers not found");
  const ctx = {
    Math, Date,
    badge: () => ({ col: "#000", label: "S" }),
    hhmm: iso => (iso || "").slice(11, 16), fmtDur: m => m + "'",
    esc: s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  };
  vm.createContext(ctx);
  new vm.Script(src.slice(ca, cb) + "\nthis.wanCard=wanCard;").runInContext(ctx);
  const base = { name: "Rigi", cat: "S", num: "5", dep: "2026-11-15T10:00:00+0100", arr: "2026-11-15T10:40:00+0100",
    ride: 40, ret: null, retOk: false, lastOk: true, last: null };
  chk("above-the-fog rib names the elevation and the state",
    /above the fog/.test(ctx.wanCard({ ...base, fog: "above", fogElev: 1200 })) , "");
  chk("under-the-fog rib is painted for below", /under the fog/.test(ctx.wanCard({ ...base, fog: "below", fogElev: 300 })), "");
  chk("too-close rib refuses to promise a view",
    /too close to call/.test(ctx.wanCard({ ...base, fog: "close", fogElev: 680 })), "");
  chk("planted negative: no verdict = NO rib -- absence of data never renders as data",
    !/wfog/.test(ctx.wanCard(base)), "");
}

// ---- wanCandidates carries the coordinate the layer needs ----
{
  const a = src.indexOf("function wanCandidates");
  const b = Math.min(...["/* Return legs", "</script>"].map(p => src.indexOf(p, a)).filter(i => i >= 0));
  if (a < 0 || !Number.isFinite(b)) throw new Error("HARNESS FAILED -- wanCandidates markers not found");
  const ctx = { wanName: "Origin", WAN_MIN_RIDE: 10, WAN_MIN_DWELL: 15, WAN_MAX_CAND: 5, isScenic: () => false, Date, Math };
  vm.createContext(ctx);
  new vm.Script(src.slice(a, b) + "\nthis.wanCandidates=wanCandidates;").runInContext(ctx);
  const NOW = Date.parse("2026-11-15T10:00:00+0100");
  const iso = m => new Date(NOW + m * 60000).toISOString();
  const board = [{ category: "S", number: "1", stop: { departure: iso(5) },
    passList: [{ station: { name: "Origin" } },
      { station: { name: "WithCrd", coordinate: { x: 47.05, y: 8.31 } }, arrival: iso(35) },
      { station: { name: "NoCrd" }, arrival: iso(40) }] }];
  const got = ctx.wanCandidates(board, NOW, NOW + 180 * 60000);
  const by = n => got.find(c => c.name === n);
  chk("a candidate carries its coordinate through the filter",
    by("WithCrd") && by("WithCrd").crd && by("WithCrd").crd.x === 47.05, JSON.stringify(by("WithCrd")));
  chk("a coordinate-less stop still qualifies, crd honestly null",
    by("NoCrd") && by("NoCrd").crd === null, JSON.stringify(by("NoCrd")));
}

// ---- shipped, not just green: the rib and note are styled ----
{
  const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
  chk("the fog rib is styled (all three states)",
    css.includes(".wcard .wfog") && css.includes(".wfog.up") && css.includes(".wfog.dn") && css.includes(".wfog.md"),
    "unstyled = invisible = unshipped");
  chk("the note line is styled", css.includes(".wfognote"), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
