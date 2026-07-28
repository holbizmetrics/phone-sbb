// Runs the REAL "last way back" logic out of index.html. No browser, no network.
//
// Two things here are load-bearing and both are negatives.
//
// 1. A service that departed BEFORE you arrive is not a way home. The query is
//    an arrive-by query over the whole evening, so it legitimately returns
//    departures you cannot reach; counting one of those would tell someone
//    standing on a mountain that they have hours left when they have none.
// 2. "We could not ask" and "there is no way back" are opposite facts. This
//    repo has already shipped that bug twice (the en-route finder, the journey
//    search), so an unreachable timetable gets its own outcome and must never
//    render as the one-way warning.
//
// The 03:00 cutoff is not a taste call either: checked against the live API,
// the last two services back from Vitznau leave 22:51 and 23:21 and arrive
// after midnight. A midnight cutoff silently deletes them.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  const i = src.search(new RegExp("(async )?function " + n + "\\("));
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + " :: " + d); }
};

const pure = new Function(`
  ${src.match(/const ISO_LOCAL=.*;/)[0]}
  ${grab("hhmm")}
  ${grab("homeCutoff")}
  ${grab("lastHome")}
  return { homeCutoff, lastHome };
`)();

// ---- harness control ----
// Proves the functions were really lifted. Without it, a homeCutoff that always
// returned null would make several "is null" cases below pass for free.
chk("control: homeCutoff really computes a date",
    pure.homeCutoff("2026-07-27T18:30:00+02:00") === "2026-07-28",
    String(pure.homeCutoff("2026-07-27T18:30:00+02:00")));

// ---- homeCutoff: the window ends the NEXT morning ----
chk("the window rolls into the next day",
    pure.homeCutoff("2026-07-27T23:59:00+02:00") === "2026-07-28");
chk("it rolls over a month end",
    pure.homeCutoff("2026-07-31T20:00:00+02:00") === "2026-08-01",
    String(pure.homeCutoff("2026-07-31T20:00:00+02:00")));
chk("it rolls over a year end",
    pure.homeCutoff("2026-12-31T20:00:00+01:00") === "2027-01-01",
    String(pure.homeCutoff("2026-12-31T20:00:00+01:00")));
chk("it rolls into a leap day",
    pure.homeCutoff("2028-02-28T20:00:00+01:00") === "2028-02-29",
    String(pure.homeCutoff("2028-02-28T20:00:00+01:00")));
// The date is read out of the STRING, never through the device clock -- the
// repo's standing rule, because a phone in another zone re-reads 00:02 as the
// previous day and would ask for the wrong timetable date.
chk("a +14 offset does not shift the calendar day",
    pure.homeCutoff("2026-07-27T00:30:00+14:00") === "2026-07-28",
    String(pure.homeCutoff("2026-07-27T00:30:00+14:00")));
chk("garbage is null", pure.homeCutoff("not a date") === null);
chk("a date with no time is null", pure.homeCutoff("2026-07-27") === null);
chk("undefined is null", pure.homeCutoff(undefined) === null);
chk("null is null", pure.homeCutoff(null) === null);

// ---- lastHome ----
const cn = (dep, arr) => ({ from: { departure: dep }, to: { arrival: arr } });
const D = (t) => "2026-07-27T" + t + ":00+02:00";
const ARRIVE = D("14:00");

let r = pure.lastHome([cn(D("19:51"), D("21:01")), cn(D("22:21"), D("23:26"))], ARRIVE);
chk("picks the latest departure", r && r.dep === D("22:21"), JSON.stringify(r));
chk("carries its arrival", r && r.arr === D("23:26"), JSON.stringify(r));
chk("counts the time you have there", r && r.slack === 8 * 60 + 21, JSON.stringify(r));

// Order is the API's convention, not its promise. Reading the wrong end of an
// unsorted list is the "you have four hours" lie.
r = pure.lastHome([cn(D("22:21"), D("23:26")), cn(D("19:51"), D("21:01"))], ARRIVE);
chk("an unsorted response still yields the LAST train",
    r && r.dep === D("22:21"), JSON.stringify(r));

// THE case. An arrive-by query legitimately returns services that already left.
r = pure.lastHome([cn(D("09:00"), D("10:00")), cn(D("13:59"), D("15:00")),
                   cn(D("18:00"), D("19:00"))], ARRIVE);
chk("a service that left before you arrived is not a way home",
    r && r.dep === D("18:00"), JSON.stringify(r));
chk("nothing after your arrival is null, not the earlier train",
    pure.lastHome([cn(D("09:00"), D("10:00")), cn(D("13:59"), D("15:00"))], ARRIVE) === null,
    JSON.stringify(pure.lastHome([cn(D("09:00"))], ARRIVE)));

// A departure exactly at your arrival minute counts -- you are there.
chk("a departure at your arrival minute still counts",
    (pure.lastHome([cn(ARRIVE, D("15:00"))], ARRIVE) || {}).dep === ARRIVE);

chk("an empty list is null", pure.lastHome([], ARRIVE) === null);
chk("a null list is null", pure.lastHome(null, ARRIVE) === null);
chk("an undefined list is null", pure.lastHome(undefined, ARRIVE) === null);
chk("a malformed row is skipped, not fatal",
    (pure.lastHome([{}, { from: {} }, cn(D("18:00"), D("19:00"))], ARRIVE) || {}).dep === D("18:00"));
chk("an unparseable departure is skipped",
    (pure.lastHome([cn("soon", "later"), cn(D("18:00"), D("19:00"))], ARRIVE) || {}).dep === D("18:00"));
chk("a row with no arrival still answers", (pure.lastHome([cn(D("18:00"))], ARRIVE) || {}).arr === null);
// Without a known arrival there is no honest slack -- null, never 0, because 0
// would render as "you have no time there", which is a claim.
r = pure.lastHome([cn(D("18:00"), D("19:00"))], null);
chk("no arrival time means no slack CLAIM", r && r.dep === D("18:00") && r.slack === null,
    JSON.stringify(r));

// ---- the render: three outcomes, run for real ----
const build = () => {
  const boxes = {};
  const panel = {
    dataset: { open: "1" },
    querySelector: (s) => (boxes[s] = boxes[s] || { innerHTML: "" }),
  };
  return { panel, box: () => panel.querySelector(".homebox") };
};
const mk = (apiFn, conn) => new Function("PANEL", "API", "CONNS", `
  const jrnConns = CONNS;
  const api = API;
  ${src.match(/const ISO_LOCAL=.*;/)[0]}
  ${grab("hhmm")}
  ${grab("homeCutoff")}
  ${grab("lastHome")}
  ${grab("fillLastHome")}
  return fillLastHome(PANEL, 0);
`);
const conn = {
  from: { station: { name: "Luzern" } },
  to: { station: { name: "Vitznau" }, arrival: ARRIVE },
};
const run = async (apiFn, c = conn) => {
  const t = build();
  await mk()(t.panel, apiFn, [c]);
  return { html: t.box().innerHTML, panel: t.panel };
};

{
  const { html } = await run(async () => ({ connections: [cn(D("19:51"), D("21:01")), cn(D("22:21"), D("23:26"))] }));
  chk("the panel names the last way back", html.includes("Last way back"), html);
  chk("it shows the departure and arrival in Swiss local",
      html.includes("22:21") && html.includes("23:26"), html);
  chk("it says how long you have there", html.includes("8h 21") , html);
  chk("a comfortable evening is not flagged tight", !html.includes("tight"), html);
}
{
  const { html } = await run(async () => ({ connections: [cn(D("14:30"), D("15:30"))] }));
  chk("half an hour to catch the last one IS flagged tight", html.includes("tight"), html);
  chk("a tight slack is shown in minutes, not 0h", html.includes("30&#8242;"), html);
}
{
  // A real one-way trip: everything back left before the train got in.
  const { html } = await run(async () => ({ connections: [cn(D("09:00"), D("10:00"))] }));
  chk("a genuine one-way trip warns loudly",
      html.includes("Nothing gets you home tonight") && html.includes("lhnone"), html);
}
{
  // THE outage case. This must NOT read as the one-way warning.
  const { html } = await run(async () => { throw new Error("HTTP 429"); });
  chk("an unreachable timetable says so", html.includes("Could not check"), html);
  chk("an outage is NEVER rendered as 'no way home'",
      !html.includes("Nothing gets you home"), html);
  chk("and it says not to read it as a no", /not\s+read this as/i.test(html), html);
}
{
  // Closing the panel mid-flight must not paint into it afterwards.
  const t = build();
  await mk()(t.panel, async () => { t.panel.dataset.open = ""; return { connections: [cn(D("22:21"), D("23:26"))] }; }, [conn]);
  chk("a panel closed mid-request is not painted into",
      !t.box().innerHTML.includes("Last way back"), t.box().innerHTML);
}
{
  const { html } = await run(async () => { throw new Error("should not be called"); },
    { from: { station: { name: "Luzern" } }, to: { station: {} } });
  chk("an unusable connection asks nothing and says nothing", html === "", html);
}

// ---- the wiring, not just the function ----
const tog = grab("toggleSketch");
chk("toggleSketch creates the box the filler writes into", tog.includes('class="homebox"'), tog);
chk("toggleSketch actually calls fillLastHome", /fillLastHome\(panel,\s*ci\)/.test(tog), tog);
// The request is only made when the panel is opened -- transport.opendata.ch is
// a volunteer service and this would otherwise fire once per result card.
chk("it is not fetched for every card on render",
    !/fillLastHome/.test(grab("connCard")), "connCard should not fetch the return trip");

console.log(`\nlast-home: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
