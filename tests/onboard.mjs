// ONBOARD: the pinned "I'm on this one" journey. Runs the REAL changeDetails
// time plumbing, onboardSnap/onboardNext/obVerdictHTML/obLineHTML/obSheetHTML,
// the async obFillPoi painter and paintOnboard's expiry. Built around the
// betrayals: "next change" picked by list order instead of the clock, the
// verdict line disappearing behind the POI toggle, a pin haunting tomorrow's
// commute, an OSM/station name running as markup, and a stale fetch painting
// a sheet the user already closed.
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
const grabConst = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + label);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- changeDetails: the change's own clock times ride along ----
{
  const changeDetails = new Function(`${grab("changeDetails")} return changeDetails;`)();
  const c = changeDetails({ sections: [
    { journey: {}, arrival: { arrival: "2026-07-29T10:00:00+02:00", station: { name: "Prev", coordinate: { x: 1, y: 2 } } } },
    { journey: {}, departure: { departure: "2026-07-29T10:25:00+02:00", station: { name: "Olten", coordinate: { x: 47.35, y: 7.9 } } } },
  ] });
  chk("a change carries its arrival AND onward-departure instants",
    c[0]?.at === "2026-07-29T10:00:00+02:00" && c[0]?.dt === "2026-07-29T10:25:00+02:00", JSON.stringify(c));
}

// ---- the pure core: snap, next-by-clock, verdicts, bar line, sheet ----
const mk = () => {
  const m = new Function(`
    const CP=c=>String.fromCodePoint(c);
    ${grab("esc")}
    ${grab("hhmm")}
    ${grabConst(/const ISO_LOCAL=[^\n]*/, "ISO_LOCAL")}
    const minsUntil = iso => Math.round((new Date(iso)-Date.now())/60000);
    const badge = (cat,num) => ({ label: (cat||"")+(num||""), col: "#888" });
    ${grabConst(/const LAYOVER_MIN=[^\n]*/, "LAYOVER_MIN")}
    let obPoi=false;
    ${grab("onboardSnap")}
    ${grab("onboardNext")}
    ${grab("obVerdictHTML")}
    ${grab("obLineHTML")}
    ${grab("obSheetHTML")}
    return { onboardSnap, onboardNext, obVerdictHTML, obLineHTML, obSheetHTML, setPoi:v=>{obPoi=v;} };
  `)();
  return m;
};
const P = mk();
const CHG = [
  { stn: "Olten",  b: 8,  pa: "7", pd: "12", co: { x: 47.35, y: 7.9 },  at: "2026-07-29T10:00:00+02:00", dt: "2026-07-29T10:08:00+02:00", missed: false },
  { stn: "Zug",    b: 25, pa: "3", pd: "4",  co: { x: 47.17, y: 8.51 }, at: "2026-07-29T11:00:00+02:00", dt: "2026-07-29T11:25:00+02:00", missed: false },
];
const OB = { from: "Bern", to: "Chur", dep: "2026-07-29T09:30:00+02:00", arr: "2026-07-29T12:40:00+02:00", legs: ["IC1", "S3"], chg: CHG };
const T = (s) => new Date(s).getTime();

{
  const c = {
    from: { station: { name: "Bern" }, departure: "2026-07-29T09:30:00+02:00", prognosis: { departure: "2026-07-29T09:33:00+02:00" } },
    to:   { station: { name: "Chur" }, arrival: "2026-07-29T12:40:00+02:00" },
    sections: [{ journey: { category: "IC", number: "1" } }, { journey: { category: "S", number: "3" } }, { walk: {} }],
    _chg: CHG,
  };
  const s = P.onboardSnap(c);
  chk("the snapshot is slim: names, prognosis-first times, leg labels, the change rows",
    s.from === "Bern" && s.to === "Chur" && s.dep === "2026-07-29T09:33:00+02:00" && s.chg === CHG, JSON.stringify(s));
  chk("...and a walk section is not a leg", s.legs.length === 2 && s.legs[0] === "IC1", JSON.stringify(s.legs));
}

// next-by-clock: the anchor is the first onward departure still ahead of NOW
{
  const n1 = P.onboardNext(OB, T("2026-07-29T09:45:00+02:00"));
  chk("before the first change, the first change is next", n1.phase === "change" && n1.x.stn === "Olten" && n1.left === 1, JSON.stringify(n1));
  const n2 = P.onboardNext(OB, T("2026-07-29T10:05:00+02:00"));
  chk("STANDING at Olten (arrived, not yet departed) Olten is STILL next -- its platform is the one you need",
    n2.phase === "change" && n2.x.stn === "Olten", JSON.stringify(n2));
  const n3 = P.onboardNext(OB, T("2026-07-29T10:30:00+02:00"));
  chk("after Olten's departure the anchor moves to Zug", n3.phase === "change" && n3.x.stn === "Zug" && n3.left === 0, JSON.stringify(n3));
  const n4 = P.onboardNext(OB, T("2026-07-29T11:40:00+02:00"));
  chk("past the last change: arriving, not a phantom change", n4.phase === "arriving" && n4.x === null, JSON.stringify(n4));
  const n5 = P.onboardNext(OB, T("2026-07-29T12:50:00+02:00"));
  chk("past the arrival: arrived", n5.phase === "arrived", JSON.stringify(n5));
  const n6 = P.onboardNext({ ...OB, chg: [] }, T("2026-07-29T10:00:00+02:00"));
  chk("a direct journey has no change to anchor to", n6.phase === "arriving", JSON.stringify(n6));
}

// the verdict line: only this app knows the buffer maths behind it
{
  chk("20' is enough to leave the platform (the LAYOVER_MIN boundary itself)",
    /enough to leave the platform/.test(P.obVerdictHTML({ stn: "Zug", b: 20, missed: false })), P.obVerdictHTML({ stn: "Zug", b: 20, missed: false }));
  chk("19' says stay on the platform", /stay on the platform/.test(P.obVerdictHTML({ stn: "Zug", b: 19, missed: false })), "");
  chk("a missed change is a verdict of its own, not a walk suggestion",
    /missed by 4&#8242;/.test(P.obVerdictHTML({ stn: "Zug", b: -4, missed: true })), P.obVerdictHTML({ stn: "Zug", b: -4, missed: true }));
}

// the bar line
{
  const l = P.obLineHTML(OB, P.onboardNext(OB, T("2026-07-29T09:45:00+02:00")));
  chk("the bar names the destination, the next change and its platform",
    l.includes("Chur") && l.includes("Olten") && l.includes("12"), l);
  const evil = { ...OB, to: "<img onerror=x>", chg: [{ ...CHG[0], stn: "<script>a</script>" }] };
  const le = P.obLineHTML(evil, P.onboardNext(evil, T("2026-07-29T09:45:00+02:00")));
  chk("station names never run as markup in the bar", !le.includes("<script>") && !le.includes("<img"), le);
  const la = P.obLineHTML(OB, P.onboardNext(OB, T("2026-07-29T11:40:00+02:00")));
  chk("with no changes left the bar says so", /no more changes/.test(la), la);
}

// the gap sheet
{
  const nx = P.onboardNext(OB, T("2026-07-29T10:30:00+02:00"));   // anchored to Zug, 25'
  P.setPoi(false);
  const off = P.obSheetHTML(OB, nx);
  chk("the verdict line is ALWAYS on -- even with the POI layer off",
    /enough to leave the platform/.test(off), off);
  chk("...but with the layer OFF there is no POI container", !off.includes('class="obpoi"'), off);
  chk("the setting is offered right where its effect would appear",
    /onboardPoiToggle\(this\)/.test(off) && !/ checked/.test(off), off);
  chk("both platforms and both instants are on the sheet",
    /arrive 11:00/.test(off) && /depart 11:25/.test(off) && off.includes("Pl.&#8201;3") && off.includes("Pl.&#8201;4"), off);
  chk("the sheet still says where the journey ends", /arriving Chur <b>12:40<\/b>/.test(off), off);
  chk("unpin is on the sheet", /onboardUnpin\(\)/.test(off), off);
  P.setPoi(true);
  const on = P.obSheetHTML(OB, nx);
  chk("with the layer ON the POI container appears and the toggle shows checked",
    on.includes('class="obpoi"') && / checked/.test(on), on);
  const nxShort = P.onboardNext(OB, T("2026-07-29T09:45:00+02:00"));   // Olten, 8'
  const short = P.obSheetHTML(OB, nxShort);
  chk("an 8' change gets NO POI container even with the layer on -- but keeps its verdict",
    !short.includes('class="obpoi"') && /stay on the platform/.test(short), short);
  const arr = P.obSheetHTML(OB, P.onboardNext(OB, T("2026-07-29T11:40:00+02:00")));
  chk("the arriving sheet rides it out and still offers unpin",
    /ride it out/.test(arr) && /onboardUnpin\(\)/.test(arr), arr);
}

// ---- obFillPoi: the async painter ----
const mkFill = (spotsImpl) => {
  const box = { innerHTML: "", dataset: {} };
  const fn = new Function("SPOTS", `
    const CP=c=>String.fromCodePoint(c);
    ${grab("esc")}
    ${grab("haversineKm")}
    ${grabConst(/const LAYOVER_MIN=[^\n]*/, "LAYOVER_MIN")}
    ${grabConst(/const LAYOVER_KEEP=[^\n]*/, "LAYOVER_KEEP")}
    ${grab("layoverWalkM")}
    ${grab("lpType")}
    ${grab("layoverRows")}
    const layoverSpots=(la,lo,r)=>SPOTS(la,lo,r);
    ${grab("obFillPoi")}
    return obFillPoi;
  `)(spotsImpl);
  return { fire: (x) => fn(box, x), box };
};
const X = { stn: "Zug", b: 25, co: { x: 47.17, y: 8.51 } };
{
  let sawLoading = false;
  const t = mkFill(async () => { sawLoading = /looking around Zug/.test(t.box.innerHTML); return [{ lat: 47.171, lon: 8.51, tags: { name: "Cafe Speck", amenity: "cafe" } }]; });
  await t.fire(X);
  chk("Overpass takes seconds -- a loading line shows while it runs", sawLoading, t.box.innerHTML);
  chk("then the rows land, with a walk time", t.box.innerHTML.includes("Cafe Speck") && /&#8242; walk/.test(t.box.innerHTML), t.box.innerHTML);
}
{
  const t = mkFill(async () => null);
  await t.fire(X);
  chk("a mirror outage is an outage, not a 'no'", /an outage, not a &quot;no&quot;/.test(t.box.innerHTML), t.box.innerHTML);
}
{
  const t = mkFill(async () => []);
  await t.fire(X);
  chk("a genuinely empty radius is a verdict that names the walk it checked",
    /Nothing named within a ~\d+&#8242; walk of Zug/.test(t.box.innerHTML), t.box.innerHTML);
}
{
  let release; const gate = new Promise(r => { release = r; });
  const t = mkFill(async () => { await gate; return [{ lat: 47.171, lon: 8.51, tags: { name: "Late Cafe", amenity: "cafe" } }]; });
  const p = t.fire(X);
  t.box.dataset.q = "someone-else"; t.box.innerHTML = "";   // sheet re-rendered while in flight
  release(); await p;
  chk("a stale fetch never paints a sheet that was re-rendered", t.box.innerHTML === "", t.box.innerHTML);
}

// ---- paintOnboard: expiry and the once-only bar ----
const mkPaint = (ob, nowIso) => {
  const lineEl = { innerHTML: "", setAttribute(){} };
  const sheetEl = { innerHTML: "" };
  let hostHtml = "";
  const host = { querySelector(s){ if(!hostHtml) return null; return s===".obbar"?{querySelector:()=>null}:s===".obline"?lineEl:s===".obsheet"?sheetEl:null; } };
  Object.defineProperty(host, "innerHTML", { get: () => hostHtml, set: v => { hostHtml = v; } });
  const saved = [], body = [];
  const fn = new Function("OB", "HOST", "SAVED", "BODY", "NOW", "RealDate", `
    const CP=c=>String.fromCodePoint(c);
    ${grab("esc")}
    ${grab("hhmm")}
    ${grabConst(/const ISO_LOCAL=[^\n]*/, "ISO_LOCAL")}
    const minsUntil = iso => Math.round((new RealDate(iso)-NOW)/60000);
    const Date=function(...a){ return a.length? new RealDate(...a) : new RealDate(NOW); };
    Date.now=()=>NOW;
    const LS={ onboard:"rail.onboard" };
    const $=()=>HOST;
    const save=(k,v)=>SAVED.push([k,v]);
    const document={ body:{ classList:{ add:c=>BODY.push("+"+c), remove:c=>BODY.push("-"+c) } }, querySelector:()=>null };
    let onboard=OB, obOpen=false, obKey="";
    ${grabConst(/const OB_EXPIRE_MIN[^\n]*/, "OB_EXPIRE_MIN")}
    ${grab("onboardNext")}
    ${grab("obLineHTML")}
    const renderObSheet=()=>{};
    ${grab("paintOnboard")}
    paintOnboard();
    return { onboard };
  `)(ob, host, saved, body, T(nowIso), Date);
  return { ...fn, host, lineEl, saved, body };
};
{
  const t = mkPaint(OB, "2026-07-29T09:45:00+02:00");
  chk("a live pin builds the bar exactly once and marks the body",
    t.host.innerHTML.includes("obbar") && t.body.includes("+hasob"), t.host.innerHTML.slice(0, 80));
  chk("the bar line is painted with the next change", t.lineEl.innerHTML.includes("Olten"), t.lineEl.innerHTML);
}
{
  const t = mkPaint(OB, "2026-07-29T13:20:00+02:00");   // 40' past arrival
  chk("40' after arrival the pin retires itself AND the retirement is persisted",
    t.onboard === null && t.saved.some(([k, v]) => k === "rail.onboard" && v === null), JSON.stringify(t.saved));
  chk("...bar gone, body released", t.host.innerHTML === "" && t.body.includes("-hasob"), t.host.innerHTML);
}
{
  const t = mkPaint(null, "2026-07-29T09:45:00+02:00");
  chk("no pin, no bar", t.host.innerHTML === "" && !t.body.includes("+hasob"), t.host.innerHTML);
}

// ---- wiring: reachable, persisted, styled, explained ----
chk("every connection card offers the pin", src.includes("onboardPin(${i})"), "button built but wired to nothing");
chk("the pin and the setting have localStorage keys",
  src.includes('onboard:"rail.onboard"') && src.includes('obpoi:"rail.obpoi"'), "");
chk("the POI layer defaults OFF until the operator decides otherwise",
  /let obPoi\s*=\s*load\(LS\.obpoi,\s*false\)/.test(src), "default flipped without a decision");
chk("the POI container is gated on toggle + makeable + long-enough + coordinate",
  /obPoi && !x\.missed && x\.b>=LAYOVER_MIN && x\.co/.test(src), "");
chk("paintOnboard runs at load AND on a timer -- a reload must not lose the bar",
  /paintOnboard\(\); setInterval\(paintOnboard,30000\)/.test(src), "pinned journey invisible after reload");
// the app HAS an opt-in near-me finder elsewhere; the pin must not touch it --
// "which train am I on" is something you already know, no permission prompt
{
  const a = src.indexOf(`ONBOARD: the pinned "I'm on this one" journey`), b = src.indexOf("Wikipedia enrichment", a);
  chk("the onboard feature itself never asks for GPS",
    a > 0 && b > a && !/geolocation/i.test(src.slice(a, b)), "the spec says NO permission prompt");
}
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
chk("the bar's host lives OUTSIDE the tab sections", /<\/div>\s*(<!--[\s\S]*?-->\s*)?<div id="ob"><\/div>/.test(html), "bar trapped inside one tab");
chk("the help sheet explains the pin", html.includes("I&#39;m on this one"), "");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("bar, sheet, verdicts, pin and toggle are styled",
  css.includes(".obbar") && css.includes(".obverdict") && css.includes(".obpin") && css.includes(".obtog") && css.includes("body.hasob"),
  "unstyled = invisible = unshipped");
chk("the gap sheet may run long -- it scrolls instead of clipping", /\.obsheet\{[^}]*max-height:[^}]*overflow:auto/.test(css), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
