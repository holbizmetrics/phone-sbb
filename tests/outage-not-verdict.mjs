// "We could not reach the timetable" must never be rendered as "this journey
// does not exist."
//
// tryConns() swallowed every error into [], so a refused, rate-limited or
// offline request arrived at the renderer as an empty result and was printed as
// "No connections found. Check the station names." -- sending you to hunt for a
// typo in a station name that is perfectly correct. This is the same class the
// enroute/wonders finder was fixed for earlier ("we could not reach OpenStreetMap"
// vs "there is nothing here"), and it was live on the busiest path in the app.
//
// The distinction is only meaningful for the two DIRECT queries. A hub sweep
// that times out is ordinary and must stay silent -- if a timed-out hub counted
// as an outage, every slow sweep would claim the timetable was unreachable.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);
const src = fs.readFileSync(APP, "utf8");
const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  const start = src.slice(i - 6, i) === "async " ? i - 6 : i;
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(start, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// --- tryConns: does a failure get REPORTED, not just absorbed? ---
const runTry = (mode, withNote) => new Function("MODE", "WITHNOTE", `
  const api = async () => {
    if (MODE === "throw") throw new Error("HTTP 429");
    if (MODE === "empty") return { connections: [] };
    return { connections: [{ id: 1 }] };
  };
  ${grab("tryConns")}
  const note = { failed:false };
  return tryConns("q", WITHNOTE ? note : undefined).then(cs => ({ cs, failed: note.failed }));
`)(mode, withNote);

// CONTROL: the stub must actually be able to throw, or every case below is vacuous.
chk("control: a healthy query returns its connections",
  (await runTry("ok", true)).cs.length === 1);
chk("control: a genuinely empty result is still empty",
  (await runTry("empty", true)).cs.length === 0);

const thrown = await runTry("throw", true);
chk("a failed request still returns an array", Array.isArray(thrown.cs), typeof thrown.cs);
chk("a failed request RAISES the flag", thrown.failed === true,
  "the outage was swallowed -- the renderer cannot tell it from 'no such journey'");
chk("a genuinely empty result does NOT raise the flag", (await runTry("empty", true)).failed === false,
  "an honest 'no connections' would be reported as an outage");
chk("a healthy result does not raise the flag", (await runTry("ok", true)).failed === false);
// The hub path passes no note on purpose. It must not crash on the absent object.
chk("a failing query with no note does not throw", Array.isArray((await runTry("throw", false)).cs),
  "hub sweeps pass no note -- tryConns must tolerate that");

// --- renderSmart: does the flag reach the words on screen? ---
const render = (reqFailed) => new Function("REQFAILED", `
  let out = "";
  const $ = () => ({ set innerHTML(v){ out = v; }, get innerHTML(){ return out; } });
  const connSig = c => String(c && c.id);
  const annotate = c => c;
  const sunWhyEmpty = () => "";
  const modeWhyEmpty = () => "";
  ${grab("renderSmart")}
  renderSmart([], [], null, false, REQFAILED);
  return out;
`)(reqFailed);

const outage = render(true), genuine = render(false);
chk("an outage is not called 'no connections found'", !/No connections found/.test(outage), outage);
chk("an outage never blames the station names", !/station names/i.test(outage), outage);
chk("an outage says the timetable was unreachable", /could not reach the timetable/i.test(outage), outage);
chk("an outage says explicitly that it is not a no", /not a &quot;no&quot;|not a "no"/.test(outage), outage);
chk("an outage offers a retry", /again/i.test(outage), outage);
chk("a genuine empty result still reads as no connections", /No connections found/.test(genuine), genuine);
chk("a genuine empty result may still mention the station names", /station names/i.test(genuine), genuine);
chk("the two states are not the same words", outage !== genuine);

// --- WIRING: the flag has to be threaded, or this all ships green and never runs ---
chk("the direct queries pass a note", (src.match(/tryConns\(`from=[^`]*`,\s*direct\)/g) || []).length === 2,
  "expected both direct queries to report failure; found " +
  (src.match(/tryConns\(`from=[^`]*`,\s*direct\)/g) || []).length);
chk("hub sweeps deliberately pass no note", !/via\[\]=[^`]*`,\s*direct\)/.test(src),
  "a timed-out hub would be reported as the timetable being down");
// Both phases must carry the flag. Counting `renderSmart(` calls and requiring
// every one of them to end in `direct.failed)` is the check that stays true if a
// third render phase is ever added -- matching on the argument list itself does
// not survive a nested call like wide.concat(hubResults).
{
  const calls = [...src.matchAll(/renderSmart\(/g)]
    .map(m => src.slice(m.index, src.indexOf(";", m.index)))
    .filter(c => !c.startsWith("renderSmart(base, swept"));
  chk("both render phases carry the failure flag",
    calls.length === 2 && calls.every(c => /direct\.failed\)$/.test(c)),
    "found " + calls.length + " call(s): " + JSON.stringify(calls));
}
chk("no catch block blames the station names any more", !/Check the station names and try again/.test(src),
  "a network error still tells you to check a name that is correct");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
