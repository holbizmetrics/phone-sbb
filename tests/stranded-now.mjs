// Stranded-now board (cross-vendor finding #3, the night-stranding cluster).
// Runs the REAL nightCutoff + tonightGroups + strandedBoard. The corpus is
// built around the ways a night board can betray: "nothing moves" rendered as
// a shrug instead of a verdict; a fetch horizon shorter than the night quietly
// claiming "last tonight" (an absence reading as an assurance); a 06:00 train
// dressed up as a rescue; a swallowed outage becoming a "no"; and shipping
// green but unwired.
process.env.TZ = "Europe/Zurich";   // the cutoff is 04:30 LOCAL; pin the tz the app lives in
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

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const NOW = new Date("2026-07-28T22:00:00+0200").getTime();
const row = (dep, cat, num, to, prog) => ({ category: cat, number: num, to,
  stop: { departure: dep, ...(prog ? { prognosis: { departure: prog } } : {}) } });

// ---- tonightGroups: last run per line+direction, in expiry order ----
const groups = new Function(`${grab("nightCutoff")} ${grab("tonightGroups")} return tonightGroups;`)();
{
  const g = groups([
    row("2026-07-28T22:10:00+0200", "S", "1", "Baar"),
    row("2026-07-28T23:40:00+0200", "S", "1", "Baar"),      // later run of the SAME line
    row("2026-07-28T22:30:00+0200", "IR", "75", "Zug"),
    row("2026-07-29T00:15:00+0200", "S", "1", "Sursee"),    // same line, OTHER direction
  ], NOW);
  chk("each line+direction collapses to its LAST run",
    g.length === 3 && g.find(x => x.to === "Baar").dep === "2026-07-28T23:40:00+0200", JSON.stringify(g));
  chk("sorted by expiry -- the order in which the options die",
    g.map(x => x.to).join(",") === "Zug,Baar,Sursee", g.map(x => x.to).join(","));
}
{
  const g = groups([
    row("2026-07-29T03:30:00+0200", "SN", "1", "NightBus"),
    row("2026-07-29T06:00:00+0200", "S", "1", "Morgen"),    // tomorrow, not a rescue
    row("2026-07-28T21:00:00+0200", "S", "9", "Gone"),      // left an hour ago
    { category: "S", number: "2", to: "NoTime", stop: {} }, // no departure time at all
  ], NOW);
  chk("a 06:00 train is tomorrow, not tonight -- excluded past the 04:30 cutoff",
    !g.some(x => x.to === "Morgen"), JSON.stringify(g));
  chk("a 03:30 night line IS tonight", g.some(x => x.to === "NightBus"));
  chk("an already-departed train is not an option", !g.some(x => x.to === "Gone"));
  chk("a row with no time is skipped, never a crash", !g.some(x => x.to === "NoTime"));
}
{
  const g = groups([
    row("2026-07-28T22:20:00+0200", "S", "1", "Baar", "2026-07-28T22:33:00+0200"),
  ], NOW);
  chk("prognosis beats schedule -- the delayed real time is the one you can still catch",
    g[0].dep === "2026-07-28T22:33:00+0200", JSON.stringify(g));
  chk("empty board -> empty list, not an error", groups([], NOW).length === 0 && groups(null, NOW).length === 0);
}

// ---- strandedBoard: verdicts, horizons, outages ----
const mkNight = ({ board = [], apiErr = null, lim = null } = {}) => {
  const els = {};
  const $ = (id) => els[id] || (els[id] = { innerHTML: "" });
  const fn = new Function("$", "api", "Date", `
    const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
    ${grab("esc")}
    ${grab("hhmm")}
    ${grab("shortStop")}
    ${grab("nightCutoff")}
    ${grab("tonightGroups")}
    ${grab("nightWrap")}
    ${grab("closeNight")}
    ${grab("strandedBoard")}
    return { strandedBoard, closeNight };
  `)($, async () => { if (apiErr) throw new Error(apiErr); return { stationboard: board, station: { name: "Luzern" } }; },
     Object.assign(function(...a){ return new Date(...a); }, Date, { now: () => NOW }));
  return { fn, els, out: () => els.strandedOut.innerHTML };
};
{
  const t = mkNight({ board: [
    row("2026-07-28T23:40:00+0200", "S", "1", "Baar"),
    row("2026-07-28T22:30:00+0200", "IR", "75", "Zug"),
  ]});
  await t.fn.strandedBoard("Luzern");
  chk("each surviving direction gets a row: time, line, destination",
    /23:40/.test(t.out()) && /S 1/.test(t.out()) && /Baar/.test(t.out()) && /Zug/.test(t.out()), t.out());
  chk("...tagged as the LAST of the night", /last tonight/.test(t.out()), t.out());
  chk("a short board (service end in sight) earns NO horizon caveat",
    !/window we could fetch/.test(t.out()), t.out());
  chk("the card can be dismissed", /closeNight/.test(t.out()));
  t.fn.closeNight();
  chk("...and closing empties it", t.out() === "");
}
{
  const t = mkNight({ board: [] });
  await t.fn.strandedBoard("Luzern");
  chk("an empty night is a VERDICT, not a shrug", /Nothing moves from here tonight anymore/.test(t.out()), t.out());
  chk("...with the honest edges named (night buses outside the data, morning not shown)",
    /Night buses/.test(t.out()) && /morning/.test(t.out()), t.out());
}
{
  // 100 rows, all within the next two hours: a full page whose horizon is far
  // short of 04:30 -- "last tonight" would be a claim the data cannot carry
  const big = Array.from({ length: 100 }, (_, i) =>
    row(`2026-07-28T22:${String(10 + Math.floor(i / 3)).padStart(2, "0")}:00+0200`, "S", String(i % 7), "D" + (i % 7)));
  const t = mkNight({ board: big });
  await t.fn.strandedBoard("Luzern");
  chk("a truncated fetch DOWNGRADES the claim -- 'last we can see', never 'last tonight'",
    /last we can see/.test(t.out()) && !/last tonight/.test(t.out()), t.out());
  chk("...and names the visible horizon", /window we could fetch ends at \d\d:\d\d/.test(t.out()), t.out());
}
{
  const t = mkNight({ apiErr: "HTTP 429" });
  await t.fn.strandedBoard("Luzern");
  chk("an outage is an outage, not a 'no' -- and it keeps its reason",
    /outage, not a/.test(t.out()) && /HTTP 429/.test(t.out()), t.out());
  chk("...and does NOT show the nothing-moves verdict", !/Nothing moves/.test(t.out()), t.out());
}
{
  const t = mkNight({ board: [row("2026-07-28T23:00:00+0200", "S", "1", '"><img src=x>')] });
  await t.fn.strandedBoard("Luzern");
  chk("a hostile destination is escaped", !t.out().includes('"><img'), t.out());
  const n = mkNight({});
  await n.fn.strandedBoard("");
  chk("no station is a no-op, never a crash", true);
}

// ---- wiring: green-but-unwired is the named defect class ----
chk("the moon button rides the board head", /class="ngt" id="ngt"/.test(src),
  "strandedBoard built but no button reaches it -- feature dead, tests green");
chk("wireBoardHead binds it to the CURRENT station",
  /\$\("ngt"\); if\(n\) n\.onclick=\(\)=>strandedBoard\(name\)/.test(src));
chk("the panel div exists in the markup", /id="strandedOut"/.test(src));
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the card is styled", css.includes(".night{"), "unstyled = invisible = unshipped");
chk("the caveat is the quiet line (faint), the verdict the loud one (amber)",
  /\.night \.ncav\{[^}]*var\(--faint\)/.test(css) && /\.night \.nnone\{[^}]*var\(--amber\)/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
