// T13: airport / flight mode. The roadmap named exactly one trap, and it is not
// a code bug -- it is a CLAIM: "the check-in buffer is not timetable data. A
// fixed 'be there 2h before' is us inventing an airline's policy... or this
// becomes the one feature that makes someone miss a flight."
//
// So the load-bearing test here is a NEGATIVE one: with nothing stored, the app
// must refuse to pick a buffer -- no arrive-by time, no plan, until the user
// taps a number. Everything else (the arithmetic, the day rollover, the
// permanent caveat, the not-an-airport warning) protects the same claim.
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- static: nothing anywhere hands the buffer a default ----
{
  chk("the stored buffer loads with NO fallback number",
    /let flightBuf = load\(LS\.flightbuf, null\)/.test(src), "");
  chk("planted negative: no numeric default is smuggled into the load",
    !/load\(LS\.flightbuf,\s*\d/.test(src), "");
  chk("index.html wires the flight segment + its panel",
    /id="segFlt"[^>]*onclick="setWhenFlight\(\)"/s.test(src) && /id="fltPanel"/.test(src) && /id="fltAt"/.test(src), "");
  chk("the panel starts hidden", /id="fltPanel"[^>]*hidden/s.test(src), "");
}

// ---- extract the flight block ----
const a = src.indexOf("const FLIGHT_BUFS");
const b = src.indexOf("/* ---------- transport-mode filter", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- flight block markers not found");
const fnSrc = src.slice(a, b);
chk("control: extracted block is the flight feature",
  fnSrc.includes("function renderFlight") && fnSrc.includes("function setWhenFlight"), fnSrc.slice(0, 60));

const els = {};
const mk = () => ({ innerHTML: "", value: "", hidden: false, classList: { c: new Set(),
  add(x){ this.c.add(x); }, remove(x){ this.c.delete(x); }, toggle(x, on){ on ? this.c.add(x) : this.c.delete(x); },
  contains(x){ return this.c.has(x); } } });
for (const id of ["fltPanel", "fltAt", "fltHint", "whenAt", "whenClear", "sunHint",
                  "segNow", "segDep", "segArr", "segSun", "segRise", "segFlt"]) els[id] = mk();

let planned = 0, stored = {};
const ctx = {
  LS: { flightbuf: "rail.flightbuf" },
  load: (k, d) => (k in stored ? stored[k] : d),
  save: (k, v) => { stored[k] = v; },
  $: id => els[id] || mk(),
  esc: s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  shortStop: n => n,
  planJourney: () => { planned++; },
  fromName: "Aarau", toName: "Z\u00fcrich Flughafen",
  whenMode: "now", whenValue: "", sunTarget: null,
  Date, isNaN, Math, JSON,
};
vm.createContext(ctx);
new vm.Script(fnSrc + `
this.setWhenFlight=setWhenFlight; this.setFlightBuf=setFlightBuf; this.renderFlight=renderFlight;
this.onFlightAt=onFlightAt; this.flightArriveBy=flightArriveBy; this.looksLikeAirport=looksLikeAirport;
this.bufWords=bufWords; this.flightOff=flightOff;
this.getBuf=()=>flightBuf; this.setAt=v=>{flightAt=v;};`).runInContext(ctx);

// ---- THE LOAD-BEARING NEGATIVE: nothing is chosen for you ----
{
  chk("PLANTED CLAIM-GUARD: with nothing stored, the buffer is null -- not 90, not 120",
    ctx.getBuf() === null, String(ctx.getBuf()));
  ctx.setWhenFlight();
  chk("opening the panel does NOT set an arrive-by time",
    ctx.whenValue === "" && ctx.whenMode === "now", `${ctx.whenMode}/${ctx.whenValue}`);
  chk("...and plans nothing", planned === 0, String(planned));
  chk("...but it does seed the FLIGHT time, so there is something to work from",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(els.fltAt.value), els.fltAt.value);
  chk("it asks the question instead of answering it",
    /How early do you want to be/.test(els.fltHint.innerHTML), "");
  chk("it says out loud that nothing is planned until you choose",
    /Nothing is planned until you choose/.test(els.fltHint.innerHTML), "");
  chk("it names what it does not know (check-in / bag drop / security / the walk)",
    /check-in deadline/.test(els.fltHint.innerHTML) && /bag drop/.test(els.fltHint.innerHTML)
    && /security/.test(els.fltHint.innerHTML) && /walk from the platform/.test(els.fltHint.innerHTML), "");
  chk("the booking beats the app, in the un-chosen state too",
    /booking beats/.test(els.fltHint.innerHTML), "");
}

// ---- the arithmetic, once the user HAS spoken ----
{
  chk("bufWords speaks hours and minutes", ctx.bufWords(90) === "1 h 30 min" && ctx.bufWords(120) === "2 h", ctx.bufWords(90));
  chk("arrive-by = flight minus the chosen buffer",
    ctx.flightArriveBy("2026-08-04T18:40", 120) === "2026-08-04T16:40", ctx.flightArriveBy("2026-08-04T18:40", 120));
  chk("a null buffer produces NO time, ever",
    ctx.flightArriveBy("2026-08-04T18:40", null) === "", JSON.stringify(ctx.flightArriveBy("2026-08-04T18:40", null)));
  chk("no flight time produces no time either", ctx.flightArriveBy("", 120) === "", "");
  chk("a garbage flight time is not turned into a confident answer",
    ctx.flightArriveBy("not-a-date", 120) === "", ctx.flightArriveBy("not-a-date", 120));
  chk("an early flight rolls the arrival back to the PREVIOUS day",
    ctx.flightArriveBy("2026-08-04T01:30", 180) === "2026-08-03T22:30", ctx.flightArriveBy("2026-08-04T01:30", 180));
}

// ---- choosing: now it plans, and the caveat SURVIVES the choice ----
{
  planned = 0;
  ctx.setAt("2026-08-04T18:40");
  ctx.setFlightBuf(120);
  chk("choosing a buffer sets arrive-by and plans",
    ctx.whenMode === "arr" && ctx.whenValue === "2026-08-04T16:40" && planned === 1,
    `${ctx.whenMode}/${ctx.whenValue}/${planned}`);
  chk("the arrive-by field is revealed with the derived time",
    els.whenAt.hidden === false && els.whenAt.value === "2026-08-04T16:40", els.whenAt.value);
  chk("the sum is shown, not just its result",
    /Flight <b>18:40<\/b>/.test(els.fltHint.innerHTML) && /at the airport by <b>16:40<\/b>/.test(els.fltHint.innerHTML),
    els.fltHint.innerHTML.slice(0, 160));
  chk("PLANTED CLAIM-GUARD: the caveat is PERMANENT -- still there after choosing",
    /is your number, not your airline/.test(els.fltHint.innerHTML), "");
  chk("...and still refuses to model the platform-to-desk walk",
    /walk from the platform/.test(els.fltHint.innerHTML), "");
  chk("the choice is remembered", stored["rail.flightbuf"] === 120, JSON.stringify(stored));
  chk("no un-choose: re-tapping the same chip keeps it chosen (no orphan arrive-by)",
    (ctx.setFlightBuf(120), ctx.getBuf() === 120 && ctx.whenValue === "2026-08-04T16:40"),
    String(ctx.getBuf()));
  chk("the chosen chip is the marked one, and only it",
    (els.fltHint.innerHTML.match(/chip fltbuf on/g) || []).length === 1,
    String((els.fltHint.innerHTML.match(/chip fltbuf on/g) || []).length));
}

// ---- a day-crossing plan says so on screen ----
{
  ctx.setAt("2026-08-04T01:30");
  ctx.setFlightBuf(180);
  chk("a previous-day departure is called out, not silently rendered as a time",
    /the day before/.test(els.fltHint.innerHTML), els.fltHint.innerHTML.slice(0, 200));
}

// ---- the destination check ----
{
  chk("airport station names are recognised in three languages",
    ctx.looksLikeAirport("Z\u00fcrich Flughafen") && ctx.looksLikeAirport("Gen\u00e8ve-A\u00e9roport")
    && ctx.looksLikeAirport("Milano Aeroporto") && ctx.looksLikeAirport("London Airport"), "");
  chk("...and an ordinary station is not", !ctx.looksLikeAirport("Aarau"), "");
  ctx.toName = "Z\u00fcrich Flughafen"; ctx.renderFlight();
  chk("no warning when the destination IS an airport station", !/does not look like an airport/.test(els.fltHint.innerHTML), "");
  ctx.toName = "Basel SBB"; ctx.renderFlight();
  chk("PLANTED CLAIM-GUARD: a non-airport destination is warned about, not assumed",
    /does not look like an airport/.test(els.fltHint.innerHTML) && /wrong place/.test(els.fltHint.innerHTML), "");
  ctx.toName = 'Basel<img src=x onerror=alert(1)>'; ctx.renderFlight();
  chk("a hostile station name stays inert in the warning", !/<img/.test(els.fltHint.innerHTML), "");
  ctx.toName = "Z\u00fcrich Flughafen";
}

// ---- the flight link does not outlive its reason ----
{
  ctx.renderFlight();
  els.fltPanel.hidden = false; els.segFlt.classList.add("on");
  ctx.flightOff();
  chk("leaving flight mode closes the panel and un-marks the segment",
    els.fltPanel.hidden === true && !els.segFlt.classList.contains("on"), "");
  chk("setWhen() drops the flight link when another when-mode is picked",
    /flightOff\(\);/.test(src.slice(src.indexOf("function setWhen(mode)"), src.indexOf("function onWhenChange"))), "");
  chk("hand-editing the arrive-by time also drops it (the time is no longer derived)",
    /sunTarget=null;.*\n\s*flightOff\(\);/.test(src.slice(src.indexOf("function onWhenChange"))), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
