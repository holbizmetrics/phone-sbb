// Runs the REAL sunFor/setWhenSun/sunWhyEmpty out of index.html against a stub DOM
// and a stub forecast. The thing under test is not "does it find a sunset" -- it is
// whether the day the time was READ FROM is the same day it gets STAMPED ON,
// and whether every dead end says something out loud.
// Sunrise and sunset share one function, so both ends are driven here: they differ
// in which branch is the COMMON one (asking for sunrise during the day almost
// always has to roll to tomorrow), and a shared function makes it cheap to prove
// the rare branch of one is the normal branch of the other.
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

const grabConst = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- could not extract " + what);
  return m[0];
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
  for (const id of ["jrnOut", "sunHint", "segSun", "segRise", "segNow", "segDep", "segArr", "whenAt", "whenClear"]) els[id] = mk();
  const planned = [];
  const m = new Function("ELS", "PLANNED", "DAILY", "COORD", "NOWLOCAL", `
    const $ = (id) => ELS[id];
    let whenValue = ${JSON.stringify(when)}, whenMode = "now";
    const toName = ${JSON.stringify(to)}, fromName = ${JSON.stringify(from)};
    const jrnConns = [];
    const locations = async () => COORD ? [{ coordinate: COORD }] : [];
    const destWeather = async () => DAILY ? { hourly: null, daily: DAILY } : null;
    const planJourney = () => PLANNED.push(whenValue);
    /* Freeze the clock: the roll-to-tomorrow branch is time-dependent and a test
       that drifts with the wall clock is not a test.
       The ZONE has to be frozen too, and the obvious subclass does NOT do it --
       a derived constructor that returns a real Date hands back a real Date, so
       the subclass's getTimezoneOffset override is never reached and the runner's
       own zone leaks in. That passed in CI (UTC, offset 0) and failed on the
       phone (CET, offset -120) for any hour within two hours of the boundary
       under test. Override per instance instead. */
    const RealDate = Date;
    function FakeDate(...a){
      const d = a.length ? new RealDate(...a) : new RealDate(NOWLOCAL + "Z");
      d.getTimezoneOffset = () => 0;
      return d;
    }
    FakeDate.now = () => new RealDate(NOWLOCAL + "Z").getTime();
    FakeDate.prototype = RealDate.prototype;
    Date = FakeDate;
    let sunTarget = null;
    ${grab("esc")}
    ${grab("shortStop")}
    ${grab("sunFor")}
    ${grabConst(/const SUN_WORDS=\{[\s\S]*?\n\};/, "SUN_WORDS")}
    ${grab("setWhenSun")}
    ${grab("sunWhyEmpty")}
    return { setWhenSun, sunFor, sunWhyEmpty, state: () => ({ whenValue, whenMode, sunTarget }) };
  `)(els, planned, daily, coord, now);
  return { ...m, els, planned, hint: () => els.sunHint.innerHTML };
}

// control: the ordinary case has to work, or every "it explained itself" below
// is just a function that never does anything
{
  const t = build();
  await t.setWhenSun("set");
  chk("control: arrive-by is filled with today's sunset", t.state().whenValue === "2026-07-25T21:03", t.state().whenValue);
  chk("control: mode switches to arrive-by", t.state().whenMode === "arr", t.state().whenMode);
  chk("control: it replans", t.planned.length === 1, JSON.stringify(t.planned));
  chk("control: the hint names the time", /21:03/.test(t.hint()), t.hint());
}

// THE regression: a day the user picked must never be quietly swapped for today
{
  const t = build({ when: "2026-08-14T10:00" });   // far outside a 2-day forecast
  await t.setWhenSun("set");
  chk("a far-off day is NOT silently moved to today", t.state().whenValue === "2026-08-14T10:00", t.state().whenValue);
  chk("...and it says why", /only known/i.test(t.hint()), t.hint());
  chk("...and it does not replan on a made-up time", t.planned.length === 0, JSON.stringify(t.planned));
}

// a day inside the window is honoured exactly -- not rounded to the first day
{
  const t = build({ when: "2026-07-26T08:00" });
  await t.setWhenSun("set");
  chk("tomorrow keeps TOMORROW's sunset", t.state().whenValue === "2026-07-26T21:01", t.state().whenValue);
}

// after sunset, asking for "before sunset" today is a request into the past
{
  const t = build({ now: "2026-07-25T22:30" });
  await t.setWhenSun("set");
  chk("an evening tap rolls to the next day", t.state().whenValue === "2026-07-26T21:01", t.state().whenValue);
  chk("...and says it rolled", /tomorrow/i.test(t.hint()), t.hint());
}
{
  const t = build({ now: "2026-07-25T22:30", daily: DAILY([{ d: "2026-07-25", rise: "05:56", set: "21:03" }]) });
  await t.setWhenSun("set");
  chk("no day left to roll to -> it says so, not a past arrival", /already set/i.test(t.hint()), t.hint());
  chk("...and leaves the time alone", t.state().whenValue === "", JSON.stringify(t.state().whenValue));
}

// every dead end speaks
{
  const t = build({ coord: null });
  await t.setWhenSun("set");
  chk("unplaceable destination is explained", /could not place/i.test(t.hint()), t.hint());
}
{
  const t = build({ daily: null });
  await t.setWhenSun("set");
  chk("a dead forecast service is explained", /did not answer/i.test(t.hint()), t.hint());
}
{
  const t = build({ daily: { time: ["2026-07-25"], sunrise: [null], sunset: [null] } });
  await t.setWhenSun("set");
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
  await t.setWhenSun("set");
  chk("no injected onclick survives escaping", !/onclick="alert/.test(t.hint()), t.hint());
}

// ---- sunrise: the same function driven at the other end of the day ----

// control for the whole sunrise half: tapping it before dawn takes TODAY's
// sunrise. Without this, every roll-to-tomorrow assertion below is just a
// function that always rolls.
{
  const t = build({ now: "2026-07-25T04:00" });
  await t.setWhenSun("rise");
  chk("control: a pre-dawn tap takes today's sunrise", t.state().whenValue === "2026-07-25T05:56", t.state().whenValue);
  chk("control: sunrise is also an arrive-by question", t.state().whenMode === "arr", t.state().whenMode);
  chk("control: the hint says sunrise, not sunset", /sunrise/.test(t.hint()) && !/sunset/.test(t.hint()), t.hint());
  chk("control: it does not roll when it need not", !/tomorrow/i.test(t.hint()), t.hint());
}

// THE sunrise case: asking during the day. For sunset this branch is the rare
// one; here it is the normal one, and it must not request a past arrival.
{
  const t = build();                                  // 09:00, sunrise was 05:56
  await t.setWhenSun("rise");
  chk("a daytime tap rolls to TOMORROW's sunrise", t.state().whenValue === "2026-07-26T05:57", t.state().whenValue);
  chk("...and says it rolled", /tomorrow/i.test(t.hint()), t.hint());
}
{
  const t = build({ daily: DAILY([{ d: "2026-07-25", rise: "05:56", set: "21:03" }]) });
  await t.setWhenSun("rise");
  chk("no day left to roll to -> it says the sun already rose", /already risen/i.test(t.hint()), t.hint());
  chk("...and leaves the time alone", t.state().whenValue === "", JSON.stringify(t.state().whenValue));
}

// a picked day is honoured for sunrise exactly as for sunset
{
  const t = build({ when: "2026-07-26T08:00" });
  await t.setWhenSun("rise");
  chk("a picked day keeps THAT day's sunrise", t.state().whenValue === "2026-07-26T05:57", t.state().whenValue);
}
{
  const t = build({ daily: { time: ["2026-07-25"], sunrise: [null], sunset: ["2026-07-25T21:03"] } });
  await t.setWhenSun("rise");
  chk("a missing sunrise value is explained", /no sunrise time/i.test(t.hint()), t.hint());
}

// the two ends must not be the same time -- a copy-paste that reads .set for
// both would pass every "it filled something in" check above
{
  const a = build({ now: "2026-07-25T04:00" }), b = build();
  await a.setWhenSun("rise"); await b.setWhenSun("set");
  chk("sunrise and sunset fill DIFFERENT times", a.state().whenValue !== b.state().whenValue,
    a.state().whenValue + " vs " + b.state().whenValue);
}

// "nothing runs that early" must read as the timetable, not a typo
{
  const t = build({ now: "2026-07-25T04:00" });
  chk("no sun request -> no sun explanation", t.sunWhyEmpty() === "", t.sunWhyEmpty());
  await t.setWhenSun("rise");
  const why = t.sunWhyEmpty();
  chk("an empty result after a sunrise tap explains itself", /sunrise/.test(why) && /05:56/.test(why), why);
  chk("...and does not blame the station name", !/typo|spelling/i.test(why.replace(/not a typo/, "")), why);
  chk("...and offers the way out", /setWhen\('now'\)/.test(why), why);
}

// the buttons have to exist and be wired, or none of the above is reachable
chk("the Sunset button calls setWhenSun('set')", /onclick="setWhenSun\('set'\)"/.test(src),
  "the function is unreachable from the UI -- green tests, invisible feature");
chk("the Sunrise button calls setWhenSun('rise')", /onclick="setWhenSun\('rise'\)"/.test(src),
  "the function is unreachable from the UI -- green tests, invisible feature");
chk("sunWhyEmpty is actually rendered on an empty result", (src.match(/\$\{sunWhyEmpty\(\)/g) || []).length === 2,
  "expected both empty-result sites to call it");
chk("a hand-edited time drops the sun explanation", /sunTarget=null;\s*\/\/ hand-edited/.test(src),
  "otherwise a stale 'nothing runs that early' outlives the request that caused it");
// the emoji are distinct: shipping the sunrise glyph on both buttons was the
// original bug here, and it is invisible to every behavioural assertion above
chk("the two buttons carry different glyphs", /&#127751; Sunset/.test(src) && /&#127749; Sunrise/.test(src),
  "sunset is U+1F307 and sunrise is U+1F305 -- 127749 on both is the old mislabel");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
