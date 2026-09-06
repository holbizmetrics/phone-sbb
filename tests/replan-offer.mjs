// P3: unprompted replan offer (UNSOLVED-GAPS 2.1 residual). replanFromStop
// serves the passenger who NOTICED; this layer notices FOR them. The traps the
// residual names each get a planted case: the LIVE read supersedes the rotted
// pin-time buffer only for the change it measured, a dead or empty board is
// "unknown" and never "on time", the volunteer API is throttled and
// horizon-bounded, and the offer is a real one-tap replan -- origin = the
// change stop, destination = the pin, leaving now -- not a prose suggestion.
import fs from "fs";
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- static: the wiring the vm blocks cannot see ----
{
  chk("the bar owns an offer slot of its own -- unprompted means visible unopened",
    /<div class="oboffer"><\/div>/.test(src), "");
  chk("every paint tick re-renders the offer", /obOfferHTML\(onboard,\s*nx\)/.test(src), "");
  chk("every paint tick arms the live re-check (throttled inside)",
    /obRecheck\(Date\.now\(\)\)/.test(src), "");
  chk("the live read asks the ARRIVAL board -- the incoming train is what rots",
    /type=arrival/.test(src), "");
  chk("the one-line bar shows the freshest buffer it has",
    /obEffective\(nx\)\s*\|\|\s*nx\.x/.test(src), "");
  chk("the sheet carries the live status line", /class="oblive"/.test(src), "");
}

// ---- extract the pure buffer maths (core/plan block) ----
const pa = src.indexOf("function obLiveBuffer");
const pb = Math.min(...["async function wanReturns", "</script>"].map(p => src.indexOf(p, pa)).filter(i => i >= 0));
if (pa < 0 || !Number.isFinite(pb)) throw new Error("HARNESS FAILED -- obLiveBuffer markers not found");
const bufSrc = src.slice(pa, pb);
chk("control: extracted block is the live-buffer maths", bufSrc.includes("prognosis"), bufSrc.slice(0, 60));

// ---- extract the offer layer (onboard block) ----
const oa = src.indexOf("let obLive=null");
const ob = Math.min(...["function onboardPin", "</script>"].map(p => src.indexOf(p, oa)).filter(i => i >= 0));
if (oa < 0 || !Number.isFinite(ob)) throw new Error("HARNESS FAILED -- offer-layer markers not found");
const offSrc = src.slice(oa, ob);
chk("control: extracted block is the offer layer",
  offSrc.includes("function obOfferHTML") && offSrc.includes("async function obRecheck") && offSrc.includes("function onboardReplan"),
  offSrc.slice(0, 60));

// ---- obLiveBuffer: prognosis beats schedule; no match is UNKNOWN ----
const mkBuf = () => {
  const ctx = { Math, Date };
  vm.createContext(ctx);
  new vm.Script(bufSrc + "\nthis.obLiveBuffer=obLiveBuffer;").runInContext(ctx);
  return ctx;
};
const AT = "2026-11-15T10:00:00+0100", DT = "2026-11-15T10:12:00+0100";  // pin-time buffer 12'
const X = { stn: "Olten", at: AT, dt: DT, b: 12, missed: false };
{
  const p = mkBuf();
  const row = pr => ({ stop: { arrival: AT, ...pr } });
  chk("a prognosis instant beats the schedule: +7' arrival -> 5' buffer",
    (r => r && r.b === 5 && r.dly === 7)(p.obLiveBuffer(X, [row({ prognosis: { arrival: "2026-11-15T10:07:00+0100" } })])),
    JSON.stringify(p.obLiveBuffer(X, [row({ prognosis: { arrival: "2026-11-15T10:07:00+0100" } })])));
  chk("no prognosis instant: the delay field stands in (+4' -> 8' buffer)",
    (r => r && r.b === 8 && r.dly === 4)(p.obLiveBuffer(X, [row({ delay: 4 })])), "");
  chk("matched with neither = a CONFIRMED schedule, dly 0",
    (r => r && r.b === 12 && r.dly === 0)(p.obLiveBuffer(X, [row({})])), "");
  chk("a big slip goes NEGATIVE -- the missed state, computed not prosed",
    (r => r && r.b === -3)(p.obLiveBuffer(X, [row({ prognosis: { arrival: "2026-11-15T10:15:00+0100" } })])), "");
  chk("planted negative: train not on the board -> null, never a verdict",
    p.obLiveBuffer(X, [{ stop: { arrival: "2026-11-15T10:30:00+0100" } }]) === null, "");
  chk("planted negative: empty board -> null", p.obLiveBuffer(X, []) === null, "");
  chk("planted negative: no board at all -> null", p.obLiveBuffer(X, null) === null, "");
  chk("planted negative: a pin row missing its times -> null",
    p.obLiveBuffer({ stn: "Olten" }, [{ stop: { arrival: AT } }]) === null, "");
  chk("rows with unparseable arrivals are skipped, not matched",
    (r => r && r.dly === 7)(p.obLiveBuffer(X, [{ stop: { arrival: "garbage" } },
      { stop: { arrival: AT, prognosis: { arrival: "2026-11-15T10:07:00+0100" } } }])), "");
}

// ---- the offer layer: live supersedes pin-time, keyed to its change ----
const FIXED = Date.parse("2026-11-15T09:30:00+0100");
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mkOff = ({ board = [], apiFail = false, pin } = {}) => {
  const calls = [], ui = [];
  class FDate extends Date { constructor(...a) { a.length ? super(...a) : super(FIXED); } }
  const ctx = {
    Math, Object, Date: FDate, esc, encodeURIComponent, TIGHT: 5,
    onboard: pin !== undefined ? pin : { to: "Chur", arr: "2026-11-15T11:30:00+0100",
      chg: [{ stn: "Olten", at: AT, dt: DT, b: 12, missed: false }] },
    onboardNext(o, now){ // real shape, pin-anchored: first change whose dt is ahead
      for (let k = 0; k < (o.chg || []).length; k++)
        if (new Date(o.chg[k].dt).getTime() > now) return { phase: "change", k, x: o.chg[k], left: 0 };
      return { phase: "arrived", k: -1, x: null, left: 0 };
    },
    obLiveBuffer: (x, rows) => { const r = rows.find(j => j.stop && j.stop.arrival === x.at);
      return r && typeof r.stop.delay === "number" ? { b: x.b - r.stop.delay, dly: r.stop.delay } : null; },
    api: url => { calls.push(url); return apiFail ? Promise.reject(new Error("dead")) : Promise.resolve({ stationboard: board }); },
    paintOnboard: () => {},
    _set_fromName: v => ui.push("from:" + v), _set_toName: v => ui.push("to:" + v),
    setTab: t => ui.push("tab:" + t), setWhen: m => ui.push("when:" + m),
    $: () => null, scrollTo: () => {},
  };
  vm.createContext(ctx);
  // origin/destination land the same observable way on either assembly of the
  // app: through the journey setters, or by assigning the shared globals.
  Object.defineProperty(ctx, "fromName", { set: v => ui.push("from:" + v) });
  Object.defineProperty(ctx, "toName", { set: v => ui.push("to:" + v) });
  new vm.Script(offSrc
    + "\nthis.obEffective=obEffective; this.obOfferHTML=obOfferHTML; this.obRecheck=obRecheck;"
    + "\nthis.onboardReplan=onboardReplan; this.getLive=()=>obLive; this.setLive=v=>{obLive=v};"
    + "\nthis.getNote=()=>obLiveNote; this.getCheckAt=()=>obCheckAt; this.OBH=OB_HORIZON_MIN;").runInContext(ctx);
  return { ctx, calls, ui };
};
{
  const t = mkOff();
  const nx = t.ctx.onboardNext(t.ctx.onboard, FIXED);
  chk("planted negative: a roomy pin-time buffer mints NO offer",
    t.ctx.obOfferHTML(t.ctx.onboard, nx) === "", t.ctx.obOfferHTML(t.ctx.onboard, nx));
  t.ctx.setLive({ k: 0, b: 2, dly: 10 });
  const html = t.ctx.obOfferHTML(t.ctx.onboard, nx);
  chk("THE feature: live 2' supersedes pin-time 12' and the offer appears",
    /replan from Olten/.test(html) && /2&#8242;/.test(html), html);
  chk("the offer is a BUTTON wired to the replan, not prose",
    /<button[^>]*onclick="onboardReplan\(event\)"/.test(html), html);
  chk("the effective row carries the live buffer", t.ctx.obEffective(nx).b === 2, "");
  t.ctx.setLive({ k: 3, b: 2, dly: 10 });
  chk("a live read keyed to ANOTHER change does not colour this one",
    t.ctx.obEffective(nx).b === 12 && t.ctx.obOfferHTML(t.ctx.onboard, nx) === "", "");
  t.ctx.setLive({ k: 0, b: -4, dly: 16 });
  chk("live-missed names the loss and still offers the way out",
    /gone/.test(t.ctx.obOfferHTML(t.ctx.onboard, nx)), "");
}
{
  const t = mkOff({ pin: { to: "Chur", arr: "2026-11-15T11:30:00+0100",
    chg: [{ stn: "Chur", at: AT, dt: DT, b: 2, missed: false }] } });
  const nx = t.ctx.onboardNext(t.ctx.onboard, FIXED);
  chk("planted negative: change stop == destination -> no offer (nothing to replan)",
    t.ctx.obOfferHTML(t.ctx.onboard, nx) === "", "");
}
{
  const t = mkOff({ pin: { to: "Chur", arr: "2026-11-15T09:00:00+0100", chg: [] } });
  chk("planted negative: past the last change -> effective is null, no offer",
    t.ctx.obEffective({ phase: "arrived", k: -1, x: null }) === null, "");
}

// ---- obRecheck: one throttled arrival-board request, honest on failure ----
{
  const t = mkOff({ board: [{ stop: { arrival: AT, delay: 10 } }] });
  await t.ctx.obRecheck(FIXED);
  chk("the request names the change stop on the arrival board",
    t.calls.length === 1 && /station=Olten/.test(t.calls[0]) && /type=arrival/.test(t.calls[0]), t.calls.join(","));
  chk("a matched row lands as the live read, keyed to its change",
    (l => l && l.k === 0 && l.b === 2 && l.dly === 10)(t.ctx.getLive()), JSON.stringify(t.ctx.getLive()));
  chk("...and the note is clean", t.ctx.getNote() === "", t.ctx.getNote());
  await t.ctx.obRecheck(FIXED + 60000);
  chk("PLANTED THROTTLE: a second tick inside the window sends NOTHING", t.calls.length === 1, String(t.calls.length));
}
{
  const t = mkOff({ apiFail: true });
  await t.ctx.obRecheck(FIXED);
  chk("PLANTED HONESTY: a dead request keeps its reason and mints no verdict",
    t.ctx.getLive() === null && /did not answer/.test(t.ctx.getNote()), t.ctx.getNote());
}
{
  const t = mkOff({ board: [{ stop: { arrival: "2026-11-15T10:30:00+0100" } }] });
  await t.ctx.obRecheck(FIXED);
  chk("PLANTED HONESTY: train missing from the board = 'no verdict', never 'on time'",
    t.ctx.getLive() === null && /no verdict/.test(t.ctx.getNote()), t.ctx.getNote());
}
{
  const t = mkOff();
  await t.ctx.obRecheck(FIXED - t.ctx.OBH * 60000 - 60000);   // change now far beyond the horizon
  chk("a change beyond the horizon burns no request", t.calls.length === 0, String(t.calls.length));
}
{
  const t = mkOff({ pin: { to: "Chur", arr: "2026-11-15T09:00:00+0100", chg: [] } });
  await t.ctx.obRecheck(FIXED);
  chk("no upcoming change -> no request", t.calls.length === 0, "");
}
{
  const t = mkOff({ pin: null });
  await t.ctx.obRecheck(FIXED);
  chk("no pin -> no request", t.calls.length === 0, "");
}

// ---- onboardReplan: origin = change stop, destination = pin, leaving NOW ----
{
  const t = mkOff();
  t.ctx.onboardReplan(null);
  chk("one tap replans: from the change stop, to the pin, journey tab, leaving now",
    t.ui.join(",") === "from:Olten,to:Chur,tab:jrn,when:now", t.ui.join(","));
}
{
  const t = mkOff({ pin: { to: "Chur", arr: "2026-11-15T11:30:00+0100",
    chg: [{ stn: "Chur", at: AT, dt: DT, b: 2, missed: false }] } });
  t.ctx.onboardReplan(null);
  chk("planted negative: change stop == destination -> the tap is a no-op", t.ui.length === 0, t.ui.join(","));
}
{
  const t = mkOff({ pin: null });
  t.ctx.onboardReplan(null);
  chk("planted negative: no pin -> the tap is a no-op", t.ui.length === 0, "");
}

// ---- shipped, not just green: the offer and live line are styled ----
{
  const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
  chk("the offer button is styled", css.includes(".obrp"), "unstyled = invisible = unshipped");
  chk("an empty offer slot collapses", css.includes(".oboffer:empty"), "");
  chk("the live status line is styled", css.includes(".oblive"), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
