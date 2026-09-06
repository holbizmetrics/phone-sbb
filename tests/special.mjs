// Special-trains weekend board (UNSOLVED-GAPS 1.2, the heritage-runs question).
// Runs the REAL weekendDays + specialRows + specialBoard. The corpus is built
// around the ways this board can lie: an EXT football shuttle dressed up as a
// steam train (the operator gate is the feature); dropped rows silently
// vanishing instead of being counted; "no specials" claimed when the API was
// down; the weekend computed off the wrong calendar edge; and shipping green
// but unwired. Coverage is honest by design: the allowlist names only
// operators verified against this API, and the board must SAY it is partial.
process.env.TZ = "Europe/Zurich";   // weekendDays is local-clock arithmetic; pin the tz the app lives in
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
const grabC = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + what);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- pure layer: weekendDays ----
const pure = new Function(`
  ${grabC(/const HERITAGE_OPS=\[[^\n]*\];/, "HERITAGE_OPS")}
  ${grab("ymdLocal")}
  ${grab("weekendDays")}
  ${grab("specialRows")}
  return { weekendDays, specialRows };
`)();
{
  const wed = new Date("2026-09-09T10:00:00+0200").getTime();
  chk("midweek -> the coming Sat+Sun", pure.weekendDays(wed).join(",") === "2026-09-12,2026-09-13", pure.weekendDays(wed).join(","));
  const sat = new Date("2026-09-12T08:00:00+0200").getTime();
  chk("on Saturday the weekend starts TODAY", pure.weekendDays(sat).join(",") === "2026-09-12,2026-09-13", pure.weekendDays(sat).join(","));
  const sun = new Date("2026-09-06T14:00:00+0200").getTime();
  chk("on Sunday only today is left of it -- not NEXT weekend", pure.weekendDays(sun).join(",") === "2026-09-06", pure.weekendDays(sun).join(","));
  const eom = new Date("2026-09-30T10:00:00+0200").getTime();
  chk("month edge: Wed 30.9. -> Sat 3.10. + Sun 4.10.", pure.weekendDays(eom).join(",") === "2026-10-03,2026-10-04", pure.weekendDays(eom).join(","));
}

// ---- pure layer: specialRows (the operator gate IS the feature) ----
const row = (dep, cat, num, to, op) => ({ category: cat, number: num, to, operator: op, stop: { departure: dep } });
{
  const r = pure.specialRows([
    row("2026-09-13T10:25:00+0200", "EXT", "031140", "Hinwil", "DVZO"),
    row("2026-09-13T09:30:00+0200", "EXT", "031128", "Hinwil", "DVZO"),
    row("2026-09-13T11:00:00+0200", "EXT", "77", "Bern", "SBB"),        // PLANTED: EXT but a shuttle operator -- must be counted, not shown
    row("2026-09-13T12:00:00+0200", "S", "26", "Rüti ZH", "DVZO"),      // PLANTED: right operator, ordinary category -- not a special
    row("2026-09-14T09:30:00+0200", "EXT", "031150", "Hinwil", "DVZO"), // PLANTED: Monday leaking off the weekend page
  ], "2026-09-13");
  chk("EXT + allowlisted operator qualifies; nothing else does",
    r.rows.length === 2 && r.rows.every(x => x.op === "DVZO"), JSON.stringify(r));
  chk("...sorted by departure, earliest first", r.rows[0].dep === "2026-09-13T09:30:00+0200", JSON.stringify(r.rows));
  chk("an EXT under a foreign operator is COUNTED, never silently dropped", r.extOther === 1, String(r.extOther));
  chk("a DVZO row in an ordinary category is not a special", !r.rows.some(x => x.num === "26"));
  chk("a row from the wrong day is excluded (the fetch pages past midnight)", !r.rows.some(x => x.num === "031150"));
  chk("empty/null board -> empty result, not a crash",
    pure.specialRows([], "2026-09-13").rows.length === 0 && pure.specialRows(null, "2026-09-13").rows.length === 0);
  chk("a row with no departure time is skipped, never a crash",
    pure.specialRows([{ category: "EXT", operator: "DVZO", to: "X", stop: {} }], "2026-09-13").rows.length === 0);
}

// ---- specialBoard: fetch anchoring, verdicts, honesty lines, outages ----
const NOW = new Date("2026-09-09T10:00:00+0200").getTime();   // a Wednesday; weekend = 12./13.
const mkSpec = ({ byDay = {}, apiErr = null } = {}) => {
  const els = {}, urls = [];
  const $ = (id) => els[id] || (els[id] = { innerHTML: "" });
  const fn = new Function("$", "api", "Date", `
    const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
    ${grab("esc")}
    ${grab("hhmm")}
    ${grab("shortStop")}
    ${grabC(/const HERITAGE_OPS=\[[^\n]*\];/, "HERITAGE_OPS")}
    ${grab("ymdLocal")}
    ${grab("weekendDays")}
    ${grab("specialRows")}
    ${grabC(/const DAY_NAMES=\[[^\n]*\];/, "DAY_NAMES")}
    ${grab("specialWrap")}
    ${grab("closeSpecial")}
    ${grab("specialDayHTML")}
    ${grab("specialBoard")}
    return { specialBoard, closeSpecial };
  `)($, async (u) => {
    urls.push(u);
    if (apiErr) throw new Error(apiErr);
    const day = (decodeURIComponent(u).match(/datetime=(\d{4}-\d{2}-\d{2})/) || [])[1];
    return { stationboard: byDay[day] || [], station: { name: "Bauma" } };
  }, Object.assign(function (...a) { return new Date(...a); }, Date, { now: () => NOW }));
  return { fn, els, urls, out: () => els.specialOut.innerHTML };
};
{
  const t = mkSpec({ byDay: {
    "2026-09-12": [row("2026-09-12T09:30:00+0200", "EXT", "031128", "Hinwil", "DVZO")],
    "2026-09-13": [row("2026-09-13T10:25:00+0200", "EXT", "031140", "Hinwil", "DVZO"),
                   row("2026-09-13T11:00:00+0200", "EXT", "77", "Bern", "SBB")],
  }});
  await t.fn.specialBoard("Bauma");
  chk("one anchored fetch per weekend day -- datetime is the parameter this API honours",
    t.urls.length === 2 && /datetime=2026-09-12%2005%3A00/.test(t.urls[0]) && /datetime=2026-09-13%2005%3A00/.test(t.urls[1]), t.urls.join(" | "));
  chk("each special gets a row: time, operator+number, destination",
    /09:30/.test(t.out()) && /DVZO 031128/.test(t.out()) && /Hinwil/.test(t.out()) && /10:25/.test(t.out()), t.out());
  chk("rows sit under their DAY heading", /Sat 12\.9\./.test(t.out()) && /Sun 13\.9\./.test(t.out()), t.out());
  chk("the dropped EXT is a NUMBER on the card, not a silent omission",
    /1 other EXT departure/.test(t.out()) && !/Bern/.test(t.out()), t.out());
  chk("the coverage caveat is ALWAYS there -- the allowlist is not the world",
    /covers only part of the scene/.test(t.out()), t.out());
  chk("the card can be dismissed", /closeSpecial/.test(t.out()));
  t.fn.closeSpecial();
  chk("...and closing empties it", t.out() === "");
}
{
  const t = mkSpec({ byDay: {} });
  await t.fn.specialBoard("Kleindorf");
  chk("an empty weekend is a VERDICT, not a shrug",
    /No heritage runs we can recognise/.test(t.out()), t.out());
  chk("...and still carries the coverage caveat -- 'none we recognise' is not 'none'",
    /covers only part of the scene/.test(t.out()), t.out());
}
{
  const t = mkSpec({ apiErr: "HTTP 429" });
  await t.fn.specialBoard("Bauma");
  chk("an outage is an outage, not a 'no' -- and it keeps its reason",
    /outage, not a/.test(t.out()) && /HTTP 429/.test(t.out()), t.out());
  chk("...and does NOT show the no-specials verdict", !/No heritage runs/.test(t.out()), t.out());
}
{
  const t = mkSpec({ byDay: { "2026-09-12": [row("2026-09-12T09:30:00+0200", "EXT", "1", '"><img src=x>', "DVZO")] } });
  await t.fn.specialBoard("Bauma");
  chk("a hostile destination is escaped", !t.out().includes('"><img'), t.out());
  const n = mkSpec({});
  await n.fn.specialBoard("");
  chk("no station is a no-op, never a crash (and no request is made)", n.urls.length === 0);
}

// ---- wiring: green-but-unwired is the named defect class ----
chk("the steam button rides the board head", /class="spc" id="spc"/.test(src),
  "specialBoard built but no button reaches it -- feature dead, tests green");
chk("wireBoardHead binds it to the CURRENT station",
  /\$\("spc"\); if\(s\) s\.onclick=\(\)=>specialBoard\(name\)/.test(src));
chk("the panel div exists in the markup", /id="specialOut"/.test(src));
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the card is styled", css.includes(".spcl{"), "unstyled = invisible = unshipped");
chk("the caveat is the quiet line (faint), the verdict the loud one (amber)",
  /\.spcl \.ncav\{[^}]*var\(--faint\)/.test(css) && /\.spcl \.nnone\{[^}]*var\(--amber\)/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
