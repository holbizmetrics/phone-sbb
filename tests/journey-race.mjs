// Journey stale-response guard: jrnGen is SHARED between smartPlan and
// plainPlan, so toggling smart off mid-search (or re-tapping mode chips)
// cannot let an older response paint over a newer one. The planted positive
// here is the exact device repro from 2026-07-26: an older request resolving
// LAST must be dropped; the null control proves the guard does not also eat
// the legitimate newest response.
import fs from "fs";
import vm from "vm";

import { src, APP } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// -- static: ONE counter, bumped by BOTH planners, old name gone from code --
chk("both planners bump the shared counter", (src.match(/const gen=\+\+jrnGen;/g) || []).length === 2);
chk("planted negative: no guard still checks the old counter", !/gen!==smartGen/.test(src));
chk("both planners ABORT the superseded sweep (zombie-fetch fix)",
  (src.match(/if\(jrnAbort\) jrnAbort\.abort\(\);/g) || []).length === 2 &&
  (src.match(/jrnAbort = new AbortController\(\);/g) || []).length === 2);
chk("api() forwards the abort signal to fetch", /fetch\(API\+path, signal\?\{signal\}:undefined\)/.test(src));

// -- extract plainPlan + the shared counter --
const a = src.indexOf("let jrnGen = 0;");
const b = src.indexOf("/* Swallowing an error", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- jrnGen/plainPlan markers not found");
const fnSrc = src.slice(a, b);
chk("control: extracted block really is the guarded planner",
  fnSrc.includes("async function plainPlan") && fnSrc.includes("superseded"), fnSrc.slice(0, 80));

const jrnOut = { innerHTML: "" };
let pending = [];
let aborts = 0;
const ctx = {
  AbortController: class { constructor(){ this.signal = {}; } abort(){ aborts++; } },
  fromName: "A", toName: "B", smart: false, weather: false, jrnConns: [],
  $: id => (id === "jrnOut" ? jrnOut : { innerHTML: "" }),
  api: () => new Promise(res => pending.push(res)),
  skel: () => "SKEL",
  whenQS: () => "", modeQS: () => "",
  sunWhyEmpty: () => "", modeWhyEmpty: () => "",
  rememberRoute: () => {}, annotate: c => c,
  // T8's sub-category filter lives inside plainPlan. This test is about the race
  // guard, not about filtering, so the stub passes everything through -- but it
  // has to EXIST, or plainPlan throws before it ever reaches api().
  catSel: [], catFilter: cs => cs, catFilterNote: () => "", catWhyEmpty: () => "",
  connCard: c => `CARD:${c.tag}`, wondersExpanderHTML: () => "",
  smartPlan: () => { throw new Error("smart path must not run in this test"); },
};
vm.createContext(ctx);
new vm.Script(fnSrc + "\nthis.plainPlan = plainPlan; this.planJourney = planJourney; this.errBox = errBox;").runInContext(ctx);

const tick = () => new Promise(r => setTimeout(r, 0));

// planted positive: older request resolves LAST -> must NOT paint
const pA = ctx.plainPlan();            // request A in flight
const resA = pending.shift();
if (typeof resA !== "function") throw new Error("HARNESS FAILED -- plainPlan never reached api(); a dependency stub is missing");
const pB = ctx.plainPlan();            // request B supersedes A
chk("superseding search ABORTS the previous sweep's requests", aborts === 1, String(aborts));
const resB = pending.shift();
resB({ connections: [{ tag: "NEW", to: {} }] });
await pB; await tick();
chk("newest response paints", jrnOut.innerHTML.includes("CARD:NEW"), jrnOut.innerHTML);
resA({ connections: [{ tag: "STALE", to: {} }] });
await pA; await tick();
chk("planted positive: stale response is dropped", !jrnOut.innerHTML.includes("CARD:STALE"), jrnOut.innerHTML);
chk("…and the newest result survives it", jrnOut.innerHTML.includes("CARD:NEW"), jrnOut.innerHTML);

// stale ERROR must not paint either (the catch branch is guarded too)
const pC = ctx.plainPlan();
const resC = pending.shift();          // C in flight…
const pD = ctx.plainPlan();
pending.shift()({ connections: [{ tag: "D", to: {} }] });
await pD; await tick();
resC(Promise.reject(new Error("boom")));   // …then C fails late
await pC.catch(() => {}); await tick();
chk("planted positive: stale FAILURE cannot paint the error box",
  !jrnOut.innerHTML.includes("could not reach") && jrnOut.innerHTML.includes("CARD:D"), jrnOut.innerHTML);

// errBox: the error's message decides the advice -- 429 must NOT blame the connection
const eb = ctx.errBox;
chk("errBox extracted with the planners", typeof eb === "function");
chk("429 names the rate limit, not the connection",
  eb(new Error("HTTP 429")).includes("rate-limiting") && !eb(new Error("HTTP 429")).includes("check your connection"));
chk("other HTTP status is shown verbatim", eb(new Error("HTTP 503")).includes("HTTP 503"));
chk("planted negative: a network TypeError still says check-connection",
  eb(new TypeError("Failed to fetch")).includes("check your connection"));
chk("planted negative: no raw catch body remains in either planner",
  !/could not reach the timetable[\s\S]{0,200}?superseded/.test(fnSrc) &&
  (src.match(/=errBox\(e\);/g) || []).length === 2);

// null control: a single un-raced search still paints normally
const pE = ctx.plainPlan();
pending.shift()({ connections: [{ tag: "SOLO", to: {} }] });
await pE; await tick();
chk("null control: guard does not eat the only response", jrnOut.innerHTML.includes("CARD:SOLO"), jrnOut.innerHTML);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
