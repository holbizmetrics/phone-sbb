// Earlier / later: walking the timetable instead of retyping the time.
//
// The feature is one anchor move and a re-plan, so almost every check here is
// about what it must NOT do:
//   - a step is a REAL request (planJourney), never a re-slice of the list
//   - the anchor it moved is VISIBLE (whenAt + the segment flip), never silent
//   - a step that did not move is SAID, never rendered as a fresh page
//   - the via / category / mode filters ride along, because the step re-runs
//     the whole search rather than building its own query
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// Anchored on the section HEADER, not on a declaration: keying off a code line
// means any mutation to that line takes the whole suite down with a harness
// error instead of a failing check -- silence where a verdict belongs.
const a = src.indexOf("/* ---------- walking the timetable: earlier / later");
const b = src.indexOf("/* ---------- T13: airport / flight mode", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- pager block markers not found");
const fnSrc = src.slice(a, b);
chk("control: the extracted block really is the pager",
  /function pgStep/.test(fnSrc) && /function pgObserve/.test(fnSrc) && /function pgBarHTML/.test(fnSrc), "");

// ---- a fake field ----
const mkEl = () => ({
  value: "", hidden: false,
  classList: {
    _s: new Set(),
    add(...c) { c.forEach(x => this._s.add(x)); },
    remove(...c) { c.forEach(x => this._s.delete(x)); },
    toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
    contains(c) { return this._s.has(c); },
  },
});
const els = { whenAt: mkEl(), whenClear: mkEl(), segNow: mkEl(), segDep: mkEl(), segArr: mkEl() };
let plans = 0;
const ctx = {
  $: id => els[id],
  esc: s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  planJourney: () => { plans++; },
  Date, console,
  jrnConns: [], fromName: "Bern", toName: "Luzern",
  whenMode: "now", whenValue: "",
};
vm.createContext(ctx);
new vm.Script(fnSrc
  + "\nthis.pgStep=pgStep; this.pgBack=pgBack; this.pgObserve=pgObserve;"
  + " this.pgBarHTML=pgBarHTML; this.pgNote=pgNote; this.pgWhyEmpty=pgWhyEmpty; this.pgTimes=pgTimes;"
  + " this.getStuck=()=>pgStuck; this.setStuck=v=>{pgStuck=v}; this.getPrev=()=>pgPrev;"
  + " this.setMode=(m,v)=>{whenMode=m; whenValue=v}; this.getWhen=()=>[whenMode,whenValue];"
  + " this.setConns=c=>{jrnConns=c};").runInContext(ctx);

// A morning list: 08:00, 08:20, 08:40 departures, arriving an hour later.
const conn = (dep, arr, prognosis) => ({
  from: { departure: `2026-07-29T${dep}:00+02:00`, prognosis: prognosis ? { departure: `2026-07-29T${prognosis}:00+02:00` } : undefined },
  to: { arrival: `2026-07-29T${arr}:00+02:00` },
});
const LIST = [conn("08:00", "09:00"), conn("08:20", "09:20"), conn("08:40", "09:40")];
const setList = l => { ctx.setConns(l); };
const reset = () => { ctx.setConns(LIST); ctx.setMode("now", ""); ctx.setStuck(""); plans = 0; };

// ================= a step is a real request =================
{
  reset();
  ctx.pgStep("later");
  chk("PLANTED: a step RE-PLANS -- it is a fresh look-up, never a re-slice of the list on screen",
    plans === 1, String(plans));
  chk("NULL CONTROL: the pager never builds a query of its own, so the via/category/mode filters cannot be dropped",
    !/connections\?|from=|via\[\]|&limit=/.test(fnSrc), "");
  chk("...it moves the anchor the user could have typed, and nothing else",
    /planJourney\(\)/.test(fnSrc) && (fnSrc.match(/whenValue = /g) || []).length >= 1, "");

  reset();
  ctx.setConns([]);
  ctx.pgStep("later");
  chk("with nothing on screen there is nothing to step from, and no request is made", plans === 0, String(plans));
  reset();
  ctx.fromName = "";
  ctx.pgStep("later");
  chk("...and no route means no step either", plans === 0, String(plans));
  ctx.fromName = "Bern";
}

// ================= where it lands =================
{
  reset();
  ctx.pgStep("later");
  const [m, v] = ctx.getWhen();
  chk("stepping later anchors PAST the last departure shown, not at it",
    m === "dep" && v.slice(11) > "08:40", m + " " + v);
  chk("...and 'now' becomes an explicit 'Leave at', because a walked window is no longer 'now'",
    m === "dep", m);

  reset();
  ctx.pgStep("earlier");
  const [m2, v2] = ctx.getWhen();
  chk("stepping earlier anchors BEFORE the first departure shown",
    m2 === "dep" && v2.slice(11) < "08:00", m2 + " " + v2);
  chk("PLANTED: the backward step is at least the width of the list, so a 40-minute window steps 40 minutes",
    v2.slice(11) <= "07:20", v2);

  // a one-connection list has zero width; a zero-width step would never move
  reset();
  setList([conn("08:00", "09:00")]);
  ctx.pgStep("earlier");
  chk("PLANTED: a single-result list still steps a real distance -- a zero-width step would sit still forever",
    ctx.getWhen()[1].slice(11) <= "07:30", ctx.getWhen()[1]);

  // Arrive-by is a different question and is walked on its own axis. The check
  // is EXACT on purpose: the list departs 08:00-08:40 and arrives 09:00-09:40,
  // so an arrive-by step back one list-width lands on 08:20 while a departure
  // step would land on 07:20. A loose "earlier than 09:00" cannot tell those
  // apart -- and it did not, when the mutation was run.
  reset();
  ctx.setMode("arr", "2026-07-29T09:45");
  ctx.pgStep("earlier");
  const [m3, v3] = ctx.getWhen();
  chk("PLANTED: in arrive-by mode the step moves ARRIVALS and stays arrive-by -- it does not silently become a departure",
    m3 === "arr" && v3 === "2026-07-29T08:20", m3 + " " + v3);
  reset();
  ctx.setMode("arr", "2026-07-29T09:45");
  ctx.pgStep("later");
  chk("...and forward on the same axis: past the last ARRIVAL, not past the last departure",
    ctx.getWhen()[1] === "2026-07-29T09:41", ctx.getWhen()[1]);
}

// ================= the anchor stays visible =================
{
  reset();
  ctx.pgStep("later");
  const shown = els.whenAt.value;
  chk("PLANTED: the time it moved to is written into the visible when-field",
    shown === ctx.getWhen()[1] && shown !== "", shown);
  chk("...the field is revealed, so the anchor cannot sit behind a hidden input",
    els.whenAt.hidden === false && els.whenClear.hidden === false, "");
  chk("...and the segment flips to match, so the control never reads 'Now' over a walked window",
    els.segDep.classList.contains("on") && !els.segNow.classList.contains("on"), "");
}

// ================= a step that did not move is SAID =================
{
  // the API answers "nothing earlier" by handing back the same trains
  reset();
  ctx.pgStep("earlier");
  ctx.pgObserve(LIST);
  chk("PLANTED: an 'earlier' that returns the SAME first departure is exhausted, not a fresh page",
    ctx.getStuck() === "earlier", ctx.getStuck());
  chk("...and it is said in words", /first service of the day/.test(ctx.pgNote()), ctx.pgNote());

  reset();
  ctx.pgStep("earlier");
  ctx.pgObserve([conn("07:00", "08:00"), conn("07:30", "08:30")]);
  chk("NULL CONTROL: an 'earlier' that really did move earlier is NOT marked exhausted",
    ctx.getStuck() === "" && ctx.pgNote() === "", ctx.getStuck());

  reset();
  ctx.pgStep("later");
  ctx.pgObserve(LIST);
  chk("the same holds at the other end of the day",
    ctx.getStuck() === "later" && /last service of the day/.test(ctx.pgNote()), ctx.getStuck());

  reset();
  ctx.pgStep("later");
  ctx.pgObserve([]);
  chk("a step that lands on nothing at all is exhausted too", ctx.getStuck() === "later", ctx.getStuck());

  // the exhausted mark is about ONE anchor, not a state of the app
  reset();
  ctx.setStuck("later");
  ctx.pgObserve(LIST);
  chk("PLANTED: a search the user started some other way CLEARS the exhausted mark",
    ctx.getStuck() === "", ctx.getStuck());
}

// ================= the buttons =================
{
  reset();
  const bar = ctx.pgBarHTML();
  chk("the bar offers both directions", /pgStep\('earlier'\)/.test(bar) && /pgStep\('later'\)/.test(bar), bar);
  chk("both carry a spoken label, not a bare glyph",
    (bar.match(/aria-label="[^"]{6,}"/g) || []).length === 2, bar);
  chk("nothing is disabled while both directions are open", !/disabled/.test(bar), bar);

  ctx.setStuck("later");
  const bar2 = ctx.pgBarHTML();
  chk("PLANTED: the exhausted direction is disabled, so it cannot be tapped into the same non-answer",
    /pgStep\('later'\)"[^>]*disabled/.test(bar2), bar2);
  chk("...and the OTHER direction stays live -- being at the end of the day is not being stuck",
    !/pgStep\('earlier'\)"[^>]*disabled/.test(bar2), bar2);
  chk("the label says which axis is being walked in arrive-by mode",
    (ctx.setMode("arr", "2026-07-29T09:00"), /arriving/.test(ctx.pgBarHTML())), ctx.pgBarHTML());
  ctx.setMode("now", "");

  ctx.setConns([]);
  chk("no results, no pager -- there is no window to walk", ctx.pgBarHTML() === "", ctx.pgBarHTML());
  reset();
}

// ================= the way back =================
{
  reset();
  ctx.setMode("dep", "2026-07-29T08:00");
  ctx.pgStep("later");
  ctx.pgObserve([]);
  const why = ctx.pgWhyEmpty();
  chk("PLANTED: a step onto an empty page offers the way BACK, so it cannot strand you with no list to step from",
    /pgBack\(\)/.test(why), why);
  chk("...named by the exact time you left, not an approximation of it", /08:00/.test(why), why);
  plans = 0;
  ctx.pgBack();
  chk("...and going back restores that anchor and re-plans",
    ctx.getWhen()[1] === "2026-07-29T08:00" && plans === 1, ctx.getWhen()[1] + " " + plans);
  chk("...and clears the exhausted mark, since the anchor it described is gone",
    ctx.getStuck() === "", ctx.getStuck());

  reset();
  chk("no step taken means no way-back offer", ctx.pgWhyEmpty() === "", ctx.pgWhyEmpty());
}

// ================= scheduled, not live =================
{
  reset();
  // 08:40 scheduled, running 25 late. Anchoring on the DELAYED time would step
  // past a train still listed at its booked minute.
  setList([conn("08:00", "09:00"), conn("08:40", "09:40", "09:05")]);
  ctx.pgStep("later");
  chk("PLANTED: the step anchors on the SCHEDULED departure, not the live one -- the API's time= filter is scheduled",
    ctx.getWhen()[1].slice(11) <= "08:45", ctx.getWhen()[1]);
  const accessors = (fnSrc.match(/^function pg(?:Dep|Arr)\(c\)\{.*$/gm) || []).join("\n");
  chk("NULL CONTROL: neither time accessor reads a prognosis at all",
    accessors.split("\n").length === 2 && !/prognosis/.test(accessors), accessors);
  reset();
}

// ================= wired to the screen at all =================
{
  chk("the pager rides the share bar the operator asked for, at its far LEFT",
    /<div class="sharebar">\$\{pgBarHTML\(\)\}/.test(src), "");
  chk("...and the stylesheet floats it left rather than re-justifying a bar that may have no pager",
    /\.sharebar \.pager\{[^}]*margin-right:auto/.test(src), "");
  chk("BOTH planners decide whether the step moved BEFORE they build the bar",
    (src.match(/pgObserve\(/g) || []).length >= 4,
    String((src.match(/pgObserve\(/g) || []).length));
  chk("both planners print the exhausted note above the results",
    (src.match(/\+ pgNote\(\)/g) || []).length === 2,
    String((src.match(/\+ pgNote\(\)/g) || []).length));
  chk("both empty branches carry the way back",
    (src.match(/\$\{pgWhyEmpty\(\)\}/g) || []).length === 2,
    String((src.match(/\$\{pgWhyEmpty\(\)\}/g) || []).length));
  chk("PLANTED: the smart planner judges the step on the SETTLED list, never the partial one",
    /if\(!searching\) pgObserve\(top\);/.test(src), "");
  chk("the smart planner drops 'Check the station names' when you have paged off the end -- the names are fine",
    /\(viaName\|\|pgStuck\)\?"":"<br>Check the station names\."/.test(src), "");
  chk("the help sheet explains it", /walk the timetable earlier and later/.test(src), "");
  chk("the disabled state is styled, so a dead direction looks dead", /\.sharebar \.pg\[disabled\]/.test(src), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
