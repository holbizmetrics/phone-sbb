// Curated heritage catalogue (UNSOLVED-GAPS 1.2, the non-algorithmic two-thirds).
// Runs the REAL constant + heritageRuns/heritageAt/heritageSplit + the card
// render inside the REAL specialBoard. Built around the ways a curated calendar
// can lie: a closed period rendered as open; a Wed-Sun product shown on a
// Tuesday; a date-list product shown on an unlisted Sunday; a museum halt that
// is not a station silently dropping the product; a third-party season passed
// off as the operator's; the catalogue going dark with the API when it is
// offline data; and the shipped constant drifting from tools/heritage.json
// (the build --check must be able to come back RED, so it is run against a
// planted stale copy too).
process.env.TZ = "Europe/Zurich";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
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
const grabC = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + what);
  return m[0];
};
let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const CAT = grabC(/const HERITAGE_CATALOGUE=\[[^\n]*\];/, "HERITAGE_CATALOGUE");
const heritageSrc = `
  ${grabC(/const HERITAGE_DOW=\[[^\n]*\];/, "HERITAGE_DOW")}
  ${grabC(/const DAY_NAMES=\[[^\n]*\];/, "DAY_NAMES")}
  ${grab("esc")}
  ${grab("heritageRuns")}
  ${grab("heritageNorm")}
  ${grab("heritageAt")}
  ${grab("heritageSplit")}
  ${grab("heritageDM")}
  ${grab("heritageDaysLabel")}
  ${grab("heritageSeasonText")}
  ${grab("specialCatalogueHTML")}
`;
const pure = new Function(`${CAT} ${heritageSrc}
  return { HERITAGE_CATALOGUE, heritageRuns, heritageAt, heritageSplit, heritageSeasonText, specialCatalogueHTML };`)();
const byId = (id) => pure.HERITAGE_CATALOGUE.find(p => p.id === id);
chk("the shipped catalogue is non-empty and every row carries source + checked + evidence",
  pure.HERITAGE_CATALOGUE.length >= 10 && pure.HERITAGE_CATALOGUE.every(p => /^https:/.test(p.src) && /^\d{4}-\d{2}-\d{2}$/.test(p.c) && ["operator", "third-party"].includes(p.ev)),
  String(pure.HERITAGE_CATALOGUE.length));

// ---- heritageRuns: the calendar, with its ways of lying ----
{
  const gx = byId("glacier-express"), vs = byId("rhb-viaduct-shuttle"), st = byId("sursee-triengen-steam");
  chk("Glacier Express runs on a summer Saturday (12.9.2026)", pure.heritageRuns(gx, "2026-09-12"));
  chk("...and NOT inside its stated closure (11.10.-4.12.2026) -- closed beats season", !pure.heritageRuns(gx, "2026-10-11") && !pure.heritageRuns(gx, "2026-11-15"));
  chk("...and again from 5.12. (open-ended period, no end stated)", pure.heritageRuns(gx, "2026-12-05"));
  // The real Glacier Express closure coincides with a gap between its two seasons, so it
  // cannot prove the closure logic (mutation M1 survived on it). This product's closure is
  // the ONLY thing excluding the date.
  const allYear = { se: [{ f: "2026-01-01", t: "2026-12-31", d: "daily" }], cl: [{ f: "2026-10-11", t: "2026-12-04" }] };
  chk("a closure INSIDE an all-year season is honoured (the closure is the only exclusion here)",
    !pure.heritageRuns(allYear, "2026-11-15") && pure.heritageRuns(allYear, "2026-10-10") && pure.heritageRuns(allYear, "2026-12-05"));
  chk("...and an open-ended closure (no end stated) stays closed", !pure.heritageRuns({ se: allYear.se, cl: [{ f: "2026-10-11", t: null }] }, "2027-01-01"));
  chk("viaduct shuttle: Wed-Sun period -> a Tuesday is NO", !pure.heritageRuns(vs, "2026-09-15"));
  chk("...a Saturday in the same period is YES", pure.heritageRuns(vs, "2026-09-12"));
  chk("...the gap between two periods (1.9.) is NO even on a valid weekday", !pure.heritageRuns(vs, "2026-09-01"));
  chk("date-list product: a listed Sunday (27.9.) is YES", pure.heritageRuns(st, "2026-09-27"));
  chk("...an unlisted Sunday (20.9.) is NO -- 'steam Sundays' is not 'every Sunday'", !pure.heritageRuns(st, "2026-09-20"));
  chk("malformed day, null product, product without seasons -> NO, never a crash",
    !pure.heritageRuns(gx, "12.9.2026") && !pure.heritageRuns(null, "2026-09-12") && !pure.heritageRuns({ se: null, cl: null }, "2026-09-12"));
}

// ---- heritageAt / heritageSplit: who calls here ----
{
  const ids = (l) => l.map(p => p.id).sort().join(",");
  const filisur = "glacier-express,landwasser-express,rhb-historical-train,rhb-viaduct-shuttle";
  chk("Filisur by UIC id (8509195) -> the four products that call there", ids(pure.heritageAt(pure.HERITAGE_CATALOGUE, "8509195", "")) === filisur, ids(pure.heritageAt(pure.HERITAGE_CATALOGUE, "8509195", "")));
  chk("Filisur by NAME only (no id, case/space-insensitive) -> the same four", ids(pure.heritageAt(pure.HERITAGE_CATALOGUE, null, "  filisur ")) === filisur);
  chk("a station on no product (Zürich HB 8503000) -> nothing", pure.heritageAt(pure.HERITAGE_CATALOGUE, "8503000", "Zürich HB").length === 0);
  chk("a museum halt that is NOT a station (Triengen, id null in the data) still matches by name",
    ids(pure.heritageAt(pure.HERITAGE_CATALOGUE, null, "Triengen")) === "sursee-triengen-steam");
  chk("a DIFFERENT id with the same-looking name prefix does not match (Filisur, Dorf)", pure.heritageAt(pure.HERITAGE_CATALOGUE, "8509998", "Filisur, Dorf").length === 0);
  const sep = pure.heritageSplit(pure.HERITAGE_CATALOGUE, "8509195", "Filisur", ["2026-09-12", "2026-09-13"]);
  chk("Filisur, weekend 12./13.9.: all four ON, both days", sep.on.length === 4 && sep.off.length === 0 && sep.on.every(x => x.days.length === 2), JSON.stringify(sep.on.map(x => [x.p.id, x.days])));
  const nov = pure.heritageSplit(pure.HERITAGE_CATALOGUE, "8509195", "Filisur", ["2026-11-07", "2026-11-08"]);
  chk("Filisur, weekend 7./8.11.: all four OFF (closure / season ended) -- the season is not the year", nov.on.length === 0 && nov.off.length === 4, JSON.stringify(nov));
  const sur = pure.heritageSplit(pure.HERITAGE_CATALOGUE, "8502007", "Sursee", ["2026-09-26", "2026-09-27"]);
  chk("Sursee, weekend 26./27.9.: steam train ON for the Sunday only", sur.on.length === 1 && sur.on[0].days.join() === "2026-09-27", JSON.stringify(sur));
  chk("season text keeps the operator's own shape: Wed–Sun 14.5.–28.6., daily 29.6.–30.8., ...",
    /Wed–Sun 14\.5\.–28\.6\., daily 29\.6\.–30\.8\., Wed–Sun 2\.9\.–25\.10\./.test(pure.heritageSeasonText(byId("rhb-viaduct-shuttle"))), pure.heritageSeasonText(byId("rhb-viaduct-shuttle")));
  chk("...a date list reads as dates", /31\.5\., 28\.6\., 26\.7\./.test(pure.heritageSeasonText(byId("sursee-triengen-steam"))));
  chk("...an open end SAYS it is open, not a made-up date", /\(no end stated\)/.test(pure.heritageSeasonText(byId("glacier-express"))));
}

// ---- the card, inside the real specialBoard ----
const mk = ({ station = { name: "Filisur", id: "8509195" }, apiErr = null, now = "2026-09-09T10:00:00+0200", cat = CAT } = {}) => {
  const els = {}, urls = [];
  const $ = (id) => els[id] || (els[id] = { innerHTML: "" });
  const NOW = new Date(now).getTime();
  const fn = new Function("$", "api", "Date", `
    const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
    ${grab("hhmm")}
    ${grab("shortStop")}
    ${grabC(/const HERITAGE_OPS=\[[^\n]*\];/, "HERITAGE_OPS")}
    ${grab("ymdLocal")}
    ${grab("weekendDays")}
    ${grab("specialRows")}
    ${cat}
    ${heritageSrc}
    ${grab("specialWrap")}
    ${grab("closeSpecial")}
    ${grab("specialDayHTML")}
    ${grab("specialBoard")}
    return { specialBoard };
  `)($, async (u) => { urls.push(u); if (apiErr) throw new Error(apiErr); return { stationboard: [], station }; },
    Object.assign(function (...a) { return new Date(...a); }, Date, { now: () => NOW }));
  return { fn, urls, out: () => els.specialOut.innerHTML };
};
{
  const t = mk(); await t.fn.specialBoard("Filisur");
  const o = t.out();
  chk("the calendar section is on the card", /From the operators&#8217; calendars/.test(o), o);
  chk("...with the four Filisur products", /Glacier Express/.test(o) && /Historical train/.test(o) && /Viaduct shuttle/.test(o) && /Landwasser Express/.test(o), o);
  chk("...each saying WHICH days (both days) and its season and reservation", /both days/.test(o) && /daily 14\.5\.–25\.10\./.test(o) && /reservation: mandatory/.test(o), o);
  chk("...with a source link to the operator page", /href="https:\/\/www\.glacierexpress\.ch\/en\/timetable"/.test(o), o);
  chk("...and no third-party tag where the season came from the operator", !/season from a third party/.test(o), o);
  chk("the empty-timetable VERDICT and the calendar COEXIST -- 'no EXT runs' is not 'nothing special'", /No heritage runs we can recognise/.test(o) && /Glacier Express/.test(o), o);
  chk("the coverage caveat names the catalogue size and check date", /10 products, checked 2026-09-08/.test(o), o);
}
{
  const t = mk({ station: { name: "Sursee", id: "8502007" } }); await t.fn.specialBoard("Sursee");
  chk("Sursee, weekend 12./13.9.: the steam train is listed as NOT these days, with its dates",
    /Also calling here, not on these days: Sursee–Triengen public steam train \(31\.5\./.test(t.out()), t.out());
  const u = mk({ station: { name: "Sursee", id: "8502007" }, now: "2026-09-23T10:00:00+0200" }); await u.fn.specialBoard("Sursee");
  chk("...weekend 26./27.9.: ON, Sunday only, and the THIRD-PARTY season is flagged in amber",
    /<b>Sun<\/b>/.test(u.out()) && /season from a third party, not the operator/.test(u.out()), u.out());
}
{
  const t = mk({ station: { name: "Kleindorf", id: "1" } }); await t.fn.specialBoard("Kleindorf");
  chk("a station on no product says so, with the catalogue size -- absence is stated, not blank",
    /No catalogued panorama or heritage product calls at this station \(catalogue: 10 products/.test(t.out()), t.out());
}
{
  const t = mk({ apiErr: "HTTP 429" }); await t.fn.specialBoard("Filisur");
  chk("API outage: the outage line is there AND the calendar still renders (offline data, matched by name)",
    /outage, not a/.test(t.out()) && /Glacier Express/.test(t.out()) && /offline data matched by station name/.test(t.out()), t.out());
  chk("...and no 'no heritage runs' verdict was minted from a failed fetch", !/No heritage runs/.test(t.out()));
}
{
  const planted = `const HERITAGE_CATALOGUE=[{"id":"x","n":"\\"><img src=x>","op":"<b>OP</b>","k":"steam","r":"A – B","s":[{"n":"Filisur","id":"8509195"}],"se":[{"f":"2026-01-01","t":null,"d":"daily"}],"cl":[],"rv":"none","ev":"third-party","src":"https://example.org/x","c":"2026-09-08"}];`;
  const t = mk({ cat: planted }); await t.fn.specialBoard("Filisur");
  chk("hostile product/operator names are escaped", !t.out().includes('"><img') && !t.out().includes("<b>OP</b>"), t.out());
}

// ---- wiring + the build check, both polarities ----
chk("the constant is generated content, not an empty placeholder", /const HERITAGE_CATALOGUE=\[\{/.test(src));
chk("specialBoard uses the catalogue (green-but-unwired is the named defect class)", /heritageSplit\(HERITAGE_CATALOGUE/.test(grab("specialBoard")));
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the calendar rows are styled and the third-party tag is amber", css.includes(".spcl .cmeta{") && /\.spcl \.cev\{[^}]*var\(--amber\)/.test(css));
{
  const root = path.dirname(fileURLToPath(new URL("../index.html", import.meta.url)));
  const tool = path.join(root, "tools", "build-heritage.py");
  const py = ["python3", "python"].find(c => spawnSync(c, ["--version"]).status === 0);
  if (!py) { chk("python available for the build check", false, "no python3 on PATH -- the build --check could not run, which is not a pass"); }
  else {
    const ok = spawnSync(py, [tool, "--check"], { encoding: "utf8" });
    chk("tools/build-heritage.py --check: app.js carries exactly what heritage.json produces", ok.status === 0 && /CURRENT/.test(ok.stdout), ok.stdout + ok.stderr);
    const tmp = path.join(os.tmpdir(), "phone-sbb-heritage-stale-" + process.pid + ".js");
    fs.writeFileSync(tmp, fs.readFileSync(path.join(root, "app.js"), "utf8").replace('"n":"Glacier Express"', '"n":"Glacier Expres"'));
    const bad = spawnSync(py, [tool, "--check", "--app", tmp], { encoding: "utf8" });
    fs.unlinkSync(tmp);
    chk("...and it comes back RED on a planted one-character drift (the check can fail)", bad.status === 1 && /STALE/.test(bad.stdout), bad.stdout + bad.stderr);
    const badJson = path.join(os.tmpdir(), "phone-sbb-heritage-bad-" + process.pid + ".json");
    fs.writeFileSync(badJson, JSON.stringify({ checked: "2026-09-08", products: [{ id: "a", name: "A", operator: "O", kind: "steam", route: "A – B", stops: ["Filisur"], season: [{ from: "2026-05-01", to: "2026-04-01", days: "daily" }], reservation: "x", evidence: { season: "operator", stops: "operator" }, source: "https://e.org", quote: "q" }] }));
    const inv = spawnSync(py, [tool, "--validate", "--json", badJson], { encoding: "utf8" });
    fs.unlinkSync(badJson);
    chk("...and --validate refuses a season whose end precedes its start", inv.status === 2 && /to < from/.test(inv.stdout), inv.stdout + inv.stderr);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
