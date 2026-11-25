// Row 361: THE ONBOARD BAR GAVE CONFIDENT ADVICE FROM FROZEN DATA. paintOnboard
// repaints every 30 s, so the bar LOOKED live whatever it knew. The live recheck
// (P3) supersedes the pin-time buffer for the next change; this suite covers what
// that left open: the bar must SAY how old its data is, a live read must stop
// underwriting the go/stay verdict once it ages, and the last leg's arrival --
// never rechecked before -- gets the same treatment. The row's own negative case
// comes first: a pin-time 'enough to leave the platform' whose real prognosis
// has moved must change its verdict or disclaim, or the bar has only been shown
// to render, not to advise.
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };
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
const grabConst = (re, what) => { const m = src.match(re); if (!m) throw new Error("HARNESS FAILED -- const not found: " + what); return m[0]; };
const T = s => new Date(s).getTime();
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- the render layer with settable live state and a frozen clock ----
const mk = (nowIso) => {
  const NOW = T(nowIso);
  const m = new Function("NOW", "RealDate", `
    const CP=c=>String.fromCodePoint(c);
    ${grab("esc")}
    ${grab("hhmm")}
    ${grabConst(/const ISO_LOCAL=[^\n]*/, "ISO_LOCAL")}
    const Date=function(...a){ return a.length? new RealDate(...a) : new RealDate(NOW); }; Date.now=()=>NOW;
    const minsUntil = iso => Math.round((new RealDate(iso)-NOW)/60000);
    ${grabConst(/const LAYOVER_MIN=[^\n]*/, "LAYOVER_MIN")}
    ${grabConst(/const TIGHT[^\n]*/, "TIGHT")}
    ${grabConst(/const OB_HORIZON_MIN[^\n]*/, "OB_HORIZON_MIN")}
    ${grabConst(/const OB_STALE_MIN[^\n]*/, "OB_STALE_MIN")}
    let obPoi=false, obLive=null, obLiveNote="", obLiveAt=0, obArr=null, obArrAt=0, obArrNote="";
    ${grab("onboardNext")}
    ${grab("obEffective")}
    ${grab("obFreshness")}
    ${grab("obFreshTag")}
    ${grab("obVerdictHTML")}
    ${grab("obLineHTML")}
    ${grab("obSheetHTML")}
    return { onboardNext, obFreshness, obVerdictHTML, obLineHTML, obSheetHTML, OB_STALE_MIN, OB_HORIZON_MIN,
      set(s){ if("obLive" in s) obLive=s.obLive; if("obLiveAt" in s) obLiveAt=s.obLiveAt; if("obLiveNote" in s) obLiveNote=s.obLiveNote;
              if("obArr" in s) obArr=s.obArr; if("obArrAt" in s) obArrAt=s.obArrAt; if("obArrNote" in s) obArrNote=s.obArrNote; } };
  `)(NOW, Date);
  return { ...m, NOW };
};
const OB = { from: "Bern", to: "Chur", dep: "2026-07-29T09:30:00+02:00", arr: "2026-07-29T12:40:00+02:00", legs: ["IC1", "S3"],
  chg: [{ stn: "Olten", b: 25, pa: "7", pd: "12", at: "2026-07-29T10:00:00+02:00", dt: "2026-07-29T10:25:00+02:00", missed: false }] };
const min = (iso, k) => new Date(T(iso) + k * 60000).getTime();

// ---- THE ROW'S NEGATIVE CASE ----
{
  const P = mk("2026-07-29T09:45:00+02:00");
  const nx = P.onboardNext(OB, P.NOW);
  const before = P.obSheetHTML(OB, nx);
  chk("pin-time: 25' reads 'enough to leave the platform', labelled pin-time (no live check yet)",
    /enough to leave the platform/.test(before) && /no live check yet/.test(before), before);
  chk("...and the one-line bar carries the pin-time tag, not a bare number", /obfresh pintime">pin-time/.test(P.obLineHTML(OB, nx)), P.obLineHTML(OB, nx));
  P.set({ obLive: { k: 0, b: 4, dly: 21 }, obLiveAt: P.NOW - 60000 });
  const after = P.obSheetHTML(OB, nx);
  chk("THE ROW: the real prognosis moved +21' -> the verdict CHANGES to 'stay on the platform'",
    /stay on the platform/.test(after) && !/enough to leave/.test(after), after);
  chk("...the sheet says the read's age", /read 1&#8242; ago/.test(after), after);
  chk("...and the bar shows the live buffer with a 'live 1'' tag", /<b>4&#8242;<\/b>/.test(P.obLineHTML(OB, nx)) && /obfresh live">live 1&#8242;/.test(P.obLineHTML(OB, nx)), P.obLineHTML(OB, nx));
}
// ---- stale: a read older than OB_STALE_MIN withholds the verdict ----
{
  const P = mk("2026-07-29T09:45:00+02:00");
  const nx = P.onboardNext(OB, P.NOW);
  P.set({ obLive: { k: 0, b: 25, dly: 0 }, obLiveAt: P.NOW - (P.OB_STALE_MIN + 4) * 60000 });
  const f = P.obFreshness(OB, nx, P.NOW);
  chk("a live read 14' old is STALE", f.state === "stale" && f.age === P.OB_STALE_MIN + 4, JSON.stringify(f));
  const sheet = P.obSheetHTML(OB, nx);
  chk("...the go/stay assertion is WITHHELD: 'unverified since', no 'enough to leave'",
    /unverified/.test(sheet) && !/enough to leave the platform/.test(sheet) && !/stay on the platform/.test(sheet), sheet);
  chk("...the bar tag says stale with the age", /obfresh stale">stale 14&#8242;/.test(P.obLineHTML(OB, nx)), P.obLineHTML(OB, nx));
  P.set({ obLiveAt: P.NOW - P.OB_STALE_MIN * 60000 });
  chk("CONTROL: exactly at the bound it is still live (the bound is inclusive)", P.obFreshness(OB, nx, P.NOW).state === "live");
}
// ---- pintime beyond the horizon, and failed ----
{
  const P = mk("2026-07-29T07:00:00+02:00");   // change at 10:00 is 3 h away
  const nx = P.onboardNext(OB, P.NOW);
  const f = P.obFreshness(OB, nx, P.NOW);
  chk("beyond the horizon: pin-time, and the note says WHEN the live check starts", f.state === "pintime" && /within 2&#8201;h of the change/.test(f.note), JSON.stringify(f));
  P.set({ obLiveNote: "live check did not answer &#8212; buffer shown is pin-time" });
  const g = P.obFreshness(OB, nx, P.NOW);
  chk("a failed read is FAILED with its note, and the bar says so", g.state === "failed" && /live check failed/.test(P.obLineHTML(OB, nx)), P.obLineHTML(OB, nx));
  chk("...the sheet still asserts the pin-time verdict (labelled), not a guessed on-time", /enough to leave the platform/.test(P.obSheetHTML(OB, nx)) && /did not answer/.test(P.obSheetHTML(OB, nx)));
}
// ---- the last leg: the arrival is now live too ----
{
  const P = mk("2026-07-29T11:40:00+02:00");   // past Olten; arriving Chur 12:40
  const nx = P.onboardNext(OB, P.NOW);
  chk("arriving phase, no read: bar shows the pin-time arrival with the pin-time tag",
    /12:40/.test(P.obLineHTML(OB, nx)) && /pin-time/.test(P.obLineHTML(OB, nx)), P.obLineHTML(OB, nx));
  P.set({ obArr: { key: OB.arr, at: "2026-07-29T12:47:00+02:00", dly: 7 }, obArrAt: P.NOW - 2 * 60000 });
  const line = P.obLineHTML(OB, nx);
  chk("with a live arrival read: the bar shows 12:47 (+7') and 'live 2''", /12:47/.test(line) && /\(\+7&#8242;\)/.test(line) && /live 2&#8242;/.test(line), line);
  chk("...the sheet's arrival line carries it too", /arriving <b>12:47<\/b> \(\+7&#8242;, live 2&#8242; ago\)/.test(P.obSheetHTML(OB, nx)), P.obSheetHTML(OB, nx));
  chk("...the countdown is to the LIVE arrival, not the pinned one (67', not 60')", /in 67&#8242;/.test(line), line);
  P.set({ obArr: { key: "some-other-pin", at: "2026-07-29T12:47:00+02:00", dly: 7 } });
  chk("a read keyed to ANOTHER pinned journey does not colour this one", /12:40/.test(P.obLineHTML(OB, nx)) && !/12:47/.test(P.obLineHTML(OB, nx)));
  P.set({ obArr: null, obArrNote: "your train is not on the destination&#39;s arrival board &#8212; no live arrival" });
  chk("no matching row: failed, named, pin-time arrival kept", /live check failed/.test(P.obLineHTML(OB, nx)) && /not on the destination/.test(P.obSheetHTML(OB, nx)));
}
// ---- obRecheck's arriving branch, against a fake board ----
{
  const oa = src.indexOf("let obLive=null"), ob = src.indexOf("function onboardPin", oa);
  const offSrc = src.slice(oa, ob);
  const pa = src.indexOf("function obLiveArrival"), pb = src.indexOf("/* Return legs for one candidate", pa);
  const arrSrc = src.slice(pa, pb);
  const run = async ({ board = [], apiFail = false } = {}) => {
    const NOW = T("2026-07-29T11:40:00+02:00"), calls = [];
    class FDate extends Date { constructor(...a) { a.length ? super(...a) : super(NOW); } static now(){ return NOW; } }
    const ctx = { Math, Object, Date: FDate, esc, encodeURIComponent, TIGHT: 5,
      onboard: OB, onboardNext: (o, now) => ({ phase: "arriving", k: -1, x: null, left: 0 }),
      obLiveBuffer: () => null, api: url => { calls.push(url); return apiFail ? Promise.reject(new Error("dead")) : Promise.resolve({ stationboard: board }); },
      paintOnboard: () => {}, $: () => null };
    vm.createContext(ctx);
    new vm.Script(arrSrc + "\n" + offSrc + "\nthis.obRecheck=obRecheck; this.arr=()=>obArr; this.note=()=>obArrNote;").runInContext(ctx);
    await ctx.obRecheck(NOW);
    return { calls, arr: ctx.arr(), note: ctx.note() };
  };
  const ok = await run({ board: [{ stop: { arrival: OB.arr, prognosis: { arrival: "2026-07-29T12:47:00+02:00" } } }] });
  chk("obRecheck asks the DESTINATION's arrival board on the last leg", ok.calls.length === 1 && /station=Chur/.test(ok.calls[0]) && /type=arrival/.test(ok.calls[0]), JSON.stringify(ok.calls));
  chk("...and records the live arrival keyed to the pin (+7')", ok.arr && ok.arr.key === OB.arr && ok.arr.dly === 7, JSON.stringify(ok.arr));
  const none = await run({ board: [{ stop: { arrival: "2026-07-29T12:55:00+02:00" } }] });
  chk("no matching row -> null + the honest note, never a guessed on-time", none.arr === null && /not on the destination/.test(none.note), JSON.stringify(none));
  const dead = await run({ apiFail: true });
  chk("dead request -> null + 'did not answer'", dead.arr === null && /did not answer/.test(dead.note), JSON.stringify(dead));
}
// ---- wiring ----
chk("the verdict takes the freshness argument on the sheet", /obVerdictHTML\(x, f\)/.test(grab("obSheetHTML")));
chk("both renders tag the bar (green-but-unwired is the named defect class)", /obFreshTag\(f\)/.test(grab("obLineHTML")));
chk("the stale bound is minutes, not hours: OB_STALE_MIN <= 15", /const OB_STALE_MIN=(?:[1-9]|1[0-5]);/.test(src));
chk("the classes are styled and the stale/unverified states are amber",
  /\.obfresh\{/.test(src) && /\.obfresh\.stale[^{]*\{[^}]*var\(--amber\)/.test(src) && /\.obverdict\.unverified\{[^}]*var\(--amber\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
