// Am I on the right train? (cross-vendor finding #2). Runs the REAL
// rightTrainHTML + stopsHTML. The corpus is built around how the check can
// betray its passenger: the destination-sign mismatch ("plan says Sargans,
// train says Chur") rendered as reassurance and not alarm; the first-stop
// check that works after boarding; the portion caveat that must NEVER vanish
// (an absence reads as an assurance -- the one wrong train this check cannot
// catch is the split train); and shipping green but unwired.
import fs from "fs";
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

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const mk = (conns) => new Function(`
  const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
  ${grab("esc")}
  ${grab("hhmm")}
  ${grab("shortStop")}
  const verbundHTML=()=> "";
  const jrnConns=${JSON.stringify(conns)};
  ${grab("rightTrainHTML")}
  ${grab("stopsHTML")}
  return { rightTrainHTML, stopsHTML };
`)();

// A leg Luzern -> Sargans on a train whose sign reads Chur: the classic
// beyond-your-stop headsign.
const section = (over = {}) => ({
  journey: { category: "IC", number: "3", to: "Chur", ...over.journey },
  departure: { station: { name: "Luzern" }, departure: "2026-07-29T08:10:00+0200",
               platform: "7", ...(over.departure || {}) },
  arrival: { station: { name: "Sargans" }, arrival: "2026-07-29T09:55:00+0200" },
});
const rows = [
  { station: { name: "Luzern" }, departure: "2026-07-29T08:10:00+0200" },
  { station: { name: "Arth-Goldau" }, arrival: "2026-07-29T08:34:00+0200" },
  { station: { name: "Sargans" }, arrival: "2026-07-29T09:55:00+0200" },
];
const conn = (s) => [{ sections: [s], to: { station: { name: "Sargans" } } }];

{
  const ui = mk(conn(section()));
  const h = ui.rightTrainHTML(rows, 0, 0);
  chk("the check names the line", /IC 3/.test(h), h);
  chk("the destination SIGN is the headline fact", /sign reads/.test(h) && /Chur/.test(h), h);
  chk("sign beyond the exit stop = reassurance, not alarm",
    /get off earlier, at Sargans/.test(h) && /still your train/.test(h), h);
  chk("departure time and platform are checkable", /08:10/.test(h) && /Pl\./.test(h) && /7/.test(h), h);
  chk("the after-boarding check: first stop named with its time",
    /First stop after boarding/.test(h) && /Arth-Goldau/.test(h) && /08:34/.test(h), h);
  chk("the portion caveat is ALWAYS there -- the one wrong train this cannot catch",
    /portions/i.test(h) && /not in this data/.test(h), h);
}
{
  // prognosis wins: a delayed departure and a changed platform are exactly the
  // moments the scheduled values mislead the person at the platform edge
  const s = section({ departure: { station: { name: "Luzern" },
    departure: "2026-07-29T08:10:00+0200", platform: "7",
    prognosis: { departure: "2026-07-29T08:19:00+0200", platform: "12" } } });
  const h = mk(conn(s)).rightTrainHTML(rows, 0, 0);
  chk("prognosis beats schedule for time and platform", /08:19/.test(h) && /12/.test(h) && !/08:10/.test(h), h);
}
{
  // the train terminates AT the exit stop: no "get off earlier" line -- saying
  // it would be false, and false reassurance is the failure class
  const s = section({ journey: { category: "IC", number: "3", to: "Sargans" } });
  const h = mk(conn(s)).rightTrainHTML(rows, 0, 0);
  chk("sign == exit stop -> no 'earlier' line", !/get off earlier/.test(h) && /Sargans/.test(h), h);
}
{
  // a walk section has no journey: nothing to verify, nothing rendered
  const h = mk([{ sections: [{ walk: {} }] }]).rightTrainHTML(rows, 0, 0);
  chk("a walk leg offers no train to check", h === "", h);
  const h2 = mk(conn(section())).rightTrainHTML(rows, 0, 99);
  chk("a vanished leg index is silence, never a crash", h2 === "", h2);
}
{
  // hostile station names in the API must not break out of the markup
  const s = section({ journey: { category: "IC", number: "3", to: '"><img src=x>' } });
  const h = mk(conn(s)).rightTrainHTML(rows, 0, 0);
  chk("a hostile destination sign is escaped", !h.includes('"><img'), h);
}
{
  const ui = mk(conn(section()));
  chk("the check rides the expanded stop list", /rtc/.test(ui.stopsHTML(rows, 0, 0)),
    "rightTrainHTML built but stopsHTML never shows it -- feature dead, tests green");
  chk("a NON-STOP leg still gets the check -- boarding doubt does not need intermediate stops",
    /rtc/.test(ui.stopsHTML(rows.slice(0, 2), 0, 0)) && /Non-stop/.test(ui.stopsHTML(rows.slice(0, 2), 0, 0)));
  chk("an unavailable stop list still gets the check (sign+time+platform need no passList)",
    /rtc/.test(ui.stopsHTML(null, 0, 0)) && /unavailable/.test(ui.stopsHTML(null, 0, 0)));
  chk("...but without rows there is no first-stop claim to invent",
    !/First stop/.test(ui.stopsHTML(null, 0, 0)), ui.stopsHTML(null, 0, 0));
  chk("no connection identity -> no check (verbund reuse stays untouched)",
    !/rtc/.test(ui.stopsHTML(rows)));
}

// ---- wiring + styling: green-but-unwired is the named defect class ----
chk("stopsHTML computes the check for every return path",
  /const rt = Number\.isInteger\(ci\) \? rightTrainHTML\(rows,ci,si\) : ""/.test(src) &&
  (src.match(/return rt\+|return rt \+/g) || []).length >= 3,
  "a check that only renders on one path silently skips non-stop and unavailable legs");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the check is styled", css.includes(".stops .rtc"), "unstyled = invisible = unshipped");
chk("the portion caveat is the dimmest line, honesty not alarm",
  /\.rtcav\{[^}]*var\(--faint\)/.test(css), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
