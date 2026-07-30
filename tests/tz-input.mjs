// The datetime-local BOUNDARY: which zone does a time FIELD mean?
//
// Everything this app shows is Swiss -- tzNoteHTML says so out loud -- and the
// API reads `date=&time=` as Swiss wall time. So a value written INTO a time
// field must be Swiss too. Three writers were seeding the DEVICE wall clock
// instead, and `whenQS` then shipped that string as if it were Swiss:
//
//   Mumbai, 14:46 Swiss / 18:16 local -> field read 18:30, planner asked 18:30 Swiss (3h30 wrong)
//   Auckland                          -> field read 01:00 TOMORROW (wrong DAY, not just wrong hour)
//
// Measured before the fix across five zones (~/tmp/tz-probe.mjs, 2026-07-30);
// Zurich was the control and agreed, which is why this never showed up in use.
//
// The suite switches process.env.TZ at run time -- Node honours that between
// Date calls -- so every check below is a claim about the CODE, never about the
// machine the suite happens to run on. That matters here more than usual: the
// two suites this change touched had both been bitten by exactly that (see
// pager.mjs's isoAt note and golden-hour.mjs's FakeDate note).
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const grab = name => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`HARNESS FAILED -- function ${name} not found in ${APP}`);
  // brace-match so a mutation inside the body cannot silently truncate the grab
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error(`HARNESS FAILED -- unbalanced braces reading ${name}`);
};

const ctx = { Intl, Date, console };
vm.createContext(ctx);
vm.runInContext(grab("swissLocal") + "\n" + grab("flightArriveBy"), ctx);
chk("control: the extracted helper really is the boundary formatter",
  typeof ctx.swissLocal === "function" && /Europe\/Zurich/.test(grab("swissLocal")), "");

// ---- the property, computed INDEPENDENTLY of the code under test ----
// Not the same formula spelled twice: this asks Intl for Zurich's own reading of
// the instant and rebuilds the string by hand, so a wrong zone in swissLocal
// cannot agree with a wrong zone here.
const zurichReading = ms => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

const ZONES = ["Europe/Zurich", "Asia/Kolkata", "America/New_York", "UTC", "Pacific/Auckland", "Pacific/Honolulu"];
const INSTANTS = [
  Date.UTC(2026, 6, 30, 12, 46),   // summer midday, CEST (+02:00)
  Date.UTC(2026, 6, 30, 22, 10),   // late enough that eastern zones are on the next date
  Date.UTC(2026, 0, 15,  8, 30),   // winter, CET (+01:00) -- the offset is not a constant
  Date.UTC(2026, 2, 29,  0, 30),   // the European DST spring-forward night itself
];

const origTZ = process.env.TZ;
try {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    for (const ms of INSTANTS) {
      const got = ctx.swissLocal(ms), want = zurichReading(ms);
      chk(`swissLocal is Swiss on a ${tz} device (${new Date(ms).toISOString()})`,
        got === want, `got ${got}, Zurich reads ${want}`);
    }
  }

  // The check that would have caught the original bug, stated as a bug and not
  // as a property: the DEVICE reading must NOT be what comes out, in any zone
  // whose wall clock differs from Zurich's.
  let differed = 0;
  for (const tz of ZONES) {
    process.env.TZ = tz;
    const ms = INSTANTS[0];
    const deviceReading = (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-`
      + `${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:`
      + `${String(d.getMinutes()).padStart(2, "0")}`)(new Date(ms));
    if (deviceReading === zurichReading(ms)) continue;          // same wall clock, nothing to distinguish
    differed++;
    chk(`PLANTED: on ${tz} the field is NOT seeded with the device wall clock (${deviceReading})`,
      ctx.swissLocal(ms) !== deviceReading, ctx.swissLocal(ms));
  }
  chk("control: at least three zones really did differ from Zurich, so the checks above discriminated",
    differed >= 3, String(differed));

  // ---- the look-alike that must NOT be 'fixed' ----
  // flightArriveBy parses a string the USER typed and subtracts a buffer from it.
  // Its getTimezoneOffset dance cancels out: it is wall-clock arithmetic, zone
  // neutral by construction, and correct. A careless sweep of getTimezoneOffset
  // through this file would break it, and nothing else in the suite would notice.
  const answers = new Set();
  for (const tz of ZONES) { process.env.TZ = tz; answers.add(ctx.flightArriveBy("2026-07-30T18:00", 90)); }
  chk("flightArriveBy is zone-NEUTRAL -- same answer on all six zones",
    answers.size === 1, [...answers].join(" | "));
  chk("flightArriveBy subtracts the buffer in wall-clock terms",
    [...answers][0] === "2026-07-30T16:30", [...answers][0]);
} finally {
  if (origTZ === undefined) delete process.env.TZ; else process.env.TZ = origTZ;
}

// ---- the call sites: a helper nothing calls is not a fix ----
// Source-level, because these three writers live inside DOM handlers. Each is
// keyed on the assignment, so moving the seed elsewhere turns this red rather
// than quietly passing.
const sites = [
  ["the planner's time field (setWhen)",   grab("setWhen")],
  ["the flight field (setWhenFlight)",     grab("setWhenFlight")],
  ["the pager's anchor (pgLocal)",         grab("pgLocal")],
];
for (const [what, block] of sites) {
  chk(`${what} writes a SWISS value`, /swissLocal\(/.test(block), "no swissLocal in this function");
  chk(`...and ${what} no longer reads the device offset`,
    !/getTimezoneOffset/.test(block), "the device offset is still in here");
}

// The denominator guard, and the reason it is TWO and not one. flightArriveBy
// keeps its offset dance on purpose (wall-clock arithmetic, asserted above);
// the sunset roll keeps its own as the named residual below. Any THIRD one is a
// new site, and it turns this red on the day it lands rather than on the day a
// tourist reports it.
const offsets = [...src.matchAll(/getTimezoneOffset/g)].length;
chk("exactly TWO getTimezoneOffset survive: flightArriveBy's arithmetic and the sunset roll residual",
  offsets === 2, `${offsets} occurrences -- if this went UP a new site skipped swissLocal`);
chk("...and one of them really is flightArriveBy's", /getTimezoneOffset/.test(grab("flightArriveBy")), "");

// The residual, asserted so it cannot be forgotten: the sunset roll-to-tomorrow
// branch still compares a SWISS forecast time against the DEVICE clock, so a
// traveller east of Zurich can be told to come back tomorrow for a sunset that
// has not happened yet. Deliberately left in this pass (its suite's fixtures
// encode the old convention); this check documents it rather than hiding it.
// When it is fixed, this check goes red -- which is the point: come back here.
chk("KNOWN RESIDUAL: the sunset roll still reads the device clock (fix it and this check must be retired)",
  /const now=new Date\(Date\.now\(\)-new Date\(\)\.getTimezoneOffset/.test(src)
  || /const now=swissLocal\(Date\.now\(\)\)/.test(src),
  "neither the old nor the fixed form found -- re-read the sun roll");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
