// Summit go-no-go across the WEEK ("best day for this trip" -- the planning-
// time weather demand the 140-persona sweep could not see, sourced from real
// users: webcams-before-Rigi, visibility-zero-in-clouds, Jungfraujoch-class
// trips whose whole value is the view). Runs the REAL bestDayHTML +
// planForDay + dayOutlook. The corpus is built around the betrayals: a week
// with no good day faked into a recommendation, no-data days rendered as
// verdicts, an unfetchable outlook rendered like a bad week, an API date
// injected into a handler string, and shipping green but unwired.
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

// ---- bestDayHTML: seven judged days, one honest headline ----
const bestDay = new Function(`
  ${grab("esc")}
  ${grab("wxEmoji")}
  ${grab("summitVerdict")}
  ${grab("bestDayHTML")}
  return bestDayHTML;
`)();
const week = (codes) => ({
  time: ["2026-07-29","2026-07-30","2026-07-31","2026-08-01","2026-08-02","2026-08-03","2026-08-04"],
  weather_code: codes,
});
{
  // today overcast, Friday the first clear day
  const h = bestDay(week([3, 61, 0, 1, 3, 95, 2]));
  chk("every day gets a judged cell", (h.match(/class="smday /g) || []).length === 7, h);
  chk("the first day is 'today', the rest weekday names", /today/.test(h) && /Fri/.test(h), h);
  chk("the headline names the FIRST good day, not a vague maybe",
    /Best day: <b>Fri<\/b>/.test(h) && /clear at the top/.test(h), h);
  chk("good days and bad days are told apart", /smday good/.test(h) && /smday bad/.test(h), h);
  chk("tapping a day plans the trip for THAT date", h.includes("planForDay('2026-07-31')"), h);
  chk("the honesty caveat is always there -- beyond ~3 days cloud is a tendency",
    /tendency, not a promise/.test(h), h);
}
{
  const h = bestDay(week([0, 3, 3, 3, 3, 3, 3]));
  chk("a clear TODAY says so -- no pointer to a lesser future day",
    /Today is a day for it/.test(h) && !/Best day:/.test(h), h);
}
{
  const h = bestDay(week([3, 61, 65, 95, 3, 45, 61]));
  chk("a week with NO good day says exactly that -- a fake 'best' would send someone up into cloud",
    /No clear day at the top in this week/.test(h) && !/Best day:/.test(h), h);
}
{
  const h = bestDay(week([3, null, 0, 3, 3, 3, 3]));
  chk("a no-data day is a '?', not a verdict in either direction",
    /<span class="smday">\?/.test(h), h);
  chk("...and cannot be tapped into a plan", !h.includes("planForDay('2026-07-30')"), h);
  chk("...while the best-day search skips it honestly", /Best day: <b>Fri<\/b>/.test(h), h);
}
{
  const evil = { time: ["2026-07-29", "');alert(1);('"], weather_code: [0, 0] };
  const h = bestDay(evil);
  chk("an API 'date' that is not a literal date NEVER reaches the handler string",
    !h.includes("alert(1)"), h);
  chk("a one-day answer is no outlook -- nothing rendered below two days",
    bestDay({ time: ["2026-07-29"], weather_code: [0] }) === "" && bestDay(null) === "", "");
}

// ---- planForDay: the tap becomes a timed replan ----
const mkPlan = (whenVal) => {
  const calls = { at: null, mode: null };
  const fn = new Function("calls", `
    let whenValue=${JSON.stringify(whenVal)};
    const $=(id)=> id==="whenAt" ? { set value(v){ calls.at=v; }, get value(){ return calls.at; } } : null;
    const setWhen=(m)=>{ calls.mode=m; };
    ${grab("planForDay")}
    return planForDay;
  `)(calls);
  return { fire: (d) => fn(d), calls };
};
{
  const t = mkPlan("2026-07-29T14:30");
  t.fire("2026-08-01");
  chk("the chosen day keeps the journey's own hour", t.calls.at === "2026-08-01T14:30", JSON.stringify(t.calls));
  chk("...and replans as a departure", t.calls.mode === "dep");
  const n = mkPlan("");
  n.fire("2026-08-01");
  chk("no time set yet -> a morning excursion default, 08:00", n.calls.at === "2026-08-01T08:00", JSON.stringify(n.calls));
}

// ---- dayOutlook: an outage must not be cached as a verdict ----
{
  let calls = 0;
  const fetchStub = () => { calls++; return calls === 1
    ? Promise.resolve({ ok: false, status: 500 })
    : Promise.resolve({ ok: true, json: () => Promise.resolve({ daily: { time: ["a"], weather_code: [0] } }) }); };
  const dl = new Function("fetch", `
    const dayOutlookCache={};
    ${grab("dayOutlook")}
    return dayOutlook;
  `)(fetchStub);
  let err = null;
  try { await dl(46.5, 7.9); } catch (e) { err = e; }
  chk("a failed outlook fetch fails loudly with its reason", err && /HTTP 500/.test(err.message), String(err));
  let d2 = null;
  try { d2 = await dl(46.5, 7.9); } catch (e) { d2 = "still-rejected: " + e.message; }
  chk("...and is NOT cached -- the retry really retries",
    d2 && d2.weather_code && d2.weather_code[0] === 0 && calls === 2, "calls=" + calls + " d2=" + d2);
}

// ---- wiring: green-but-unwired is the named defect class ----
chk("fillSummit fetches the outlook beside the day's weather",
  /dayOutlook\(co\.x, co\.y\)\.catch\(\(\)=>"unreachable"\)/.test(src),
  "outlook built but never fetched -- feature dead, tests green");
chk("the card renders it -- and keeps outage and bad-week APART (three outcomes, never two)",
  /days==="unreachable"[\s\S]{0,200}bestDayHTML\(days\)/.test(src),
  "an unfetchable outlook rendered as silence reads as 'no good day'");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the day strip is styled", css.includes(".smstrip") && css.includes(".smday{"), "unstyled = invisible = unshipped");
chk("the caveat is the quiet line", /\.smcav\{[^}]*var\(--faint\)/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
