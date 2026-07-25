// Runs the REAL sunFor/setWhenSunset out of index.html against a stub DOM and a
// stub forecast. The thing under test is not "does it find a sunset" -- it is
// whether the day the sunset was READ FROM is the same day it gets STAMPED ON,
// and whether every dead end says something out loud.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);
const src = fs.readFileSync(APP, "utf8");

// keeps a leading `async ` -- dropping it turns `await` into a SyntaxError
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

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// Two days of forecast, exactly like forecast_days=2, in the destination's own
// zone with an offset -- never a Z, because the real API does not send one.
const DAILY = (days) => ({
  time: days.map(d => d.d),
  sunrise: days.map(d => `${d.d}T${d.rise}`),
  sunset: days.map(d => `${d.d}T${d.set}`),
});
const TWO = DAILY([{ d: "2026-07-25", rise: "05:56", set: "21:03" },
                   { d: "2026-07-26", rise: "05:57", set: "21:01" }]);

function build({ daily = TWO, when = "", to = "Brig", from = "Bern", coord = { x: 46.31, y: 7.98 }, now = "2026-07-25T09:00" } = {}) {
  const els = {};
  const mk = () => {
    const cl = new Set();
    return { innerHTML: "", hidden: true, value: "", dataset: {},
      classList: { add: c => cl.add(c), remove: c => cl.delete(c), contains: c => cl.has(c),
        toggle: (c, on) => { on ? cl.add(c) : cl.delete(c); }, _set: cl } };
  };
  for (const id of ["jrnOut", "sunHint", "segSun", "segNow", "segDep", "segArr", "whenAt", "whenClear"]) els[id] = mk();
  const planned = [];
  const m = new Function("ELS", "PLANNED", "DAILY", "COORD", "NOWLOCAL", `
    const $ = (id) => ELS[id];
    let whenValue = ${JSON.stringify(when)}, whenMode = "now";
    const toName = ${JSON.stringify(to)}, fromName = ${JSON.stringify(from)};
    const jrnConns = [];
    const locations = async () => COORD ? [{ coordinate: COORD }] : [];
    const destWeather = async () => DAILY ? { hourly: null, daily: DAILY } : null;
    const planJourney = () => PLANNED.push(whenValue);
    // freeze the clock: the roll-to-tomorrow branch is time-dependent and a test
    // that drifts with the wall clock is not a test
    const RealDate = Date;
    Date = class extends RealDate {
      constructor(...a){ return a.length ? new RealDate(...a) : new RealDate(NOWLOCAL + "Z"); }
      static now(){ return new RealDate(NOWLOCAL + "Z").getTime(); }
      getTimezoneOffset(){ return 0; }
    };
    ${grab("esc")}
    ${grab("shortStop")}
    ${grab("sunFor")}
    ${grab("setWhenSunset")}
    return { setWhenSunset, sunFor, state: () => ({ whenValue, whenMode }) };
  `)(els, planned, daily, coord, now);
  return { ...m, els, planned, hint: () => els.sunHint.innerHTML };
}

// control: the ordinary case has to work, or every "it explained itself" below
// is just a function that never does anything
{
  const t = build();
  await t.setWhenSunset();
  chk("control: arrive-by is filled with today's sunset", t.state().whenValue === "2026-07-25T21:03", t.state().whenValue);
  chk("control: mode switches to arrive-by", t.state().whenMode === "arr", t.state().whenMode);
  chk("control: it replans", t.planned.length === 1, JSON.stringify(t.planned));
  chk("control: the hint names the time", /21:03/.test(t.hint()), t.hint());
}

// THE regression: a day the user picked must never be quietly swapped for today
{
  const t = build({ when: "2026-08-14T10:00" });   // far outside a 2-day forecast
  await t.setWhenSunset();
  chk("a far-off day is NOT silently moved to today", t.state().whenValue === "2026-08-14T10:00", t.state().whenValue);
  chk("...and it says why", /only known/i.test(t.hint()), t.hint());
  chk("...and it does not replan on a made-up time", t.planned.length === 0, JSON.stringify(t.planned));
}

// a day inside the window is honoured exactly -- not rounded to the first day
{
  const t = build({ when: "2026-07-26T08:00" });
  await t.setWhenSunset();
  chk("tomorrow keeps TOMORROW's sunset", t.state().whenValue === "2026-07-26T21:01", t.state().whenValue);
}

// after sunset, asking for "before sunset" today is a request into the past
{
  const t = build({ now: "2026-07-25T22:30" });
  await t.setWhenSunset();
  chk("an evening tap rolls to the next day", t.state().whenValue === "2026-07-26T21:01", t.state().whenValue);
  chk("...and says it rolled", /tomorrow/i.test(t.hint()), t.hint());
}
{
  const t = build({ now: "2026-07-25T22:30", daily: DAILY([{ d: "2026-07-25", rise: "05:56", set: "21:03" }]) });
  await t.setWhenSunset();
  chk("no day left to roll to -> it says so, not a past arrival", /already set/i.test(t.hint()), t.hint());
  chk("...and leaves the time alone", t.state().whenValue === "", JSON.stringify(t.state().whenValue));
}

// every dead end speaks
{
  const t = build({ coord: null });
  await t.setWhenSunset();
  chk("unplaceable destination is explained", /could not place/i.test(t.hint()), t.hint());
}
{
  const t = build({ daily: null });
  await t.setWhenSunset();
  chk("a dead forecast service is explained", /did not answer/i.test(t.hint()), t.hint());
}
{
  const t = build({ daily: { time: ["2026-07-25"], sunrise: [null], sunset: [null] } });
  await t.setWhenSunset();
  chk("a missing sunset value is explained", /no sunset time/i.test(t.hint()), t.hint());
}

// sunFor reads local wall-clock out of the string, like every other time here
{
  const t = build();
  chk("sunFor reads HH:MM off the offset string", t.sunFor(TWO, "2026-07-26T00:00")?.set === "21:01",
    JSON.stringify(t.sunFor(TWO, "2026-07-26T00:00")));
  chk("sunFor refuses a day it does not have", t.sunFor(TWO, "2026-09-01T00:00") === null);
}

// a station name with a quote must not break out of the hint
{
  const t = build({ to: 'Brig" onclick="alert(1)' });
  await t.setWhenSunset();
  chk("no injected onclick survives escaping", !/onclick="alert/.test(t.hint()), t.hint());
}

// the button has to exist and be wired, or none of the above is reachable
chk("the Sunset button calls setWhenSunset", /onclick="setWhenSunset\(\)"/.test(src),
  "the function is unreachable from the UI -- green tests, invisible feature");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
