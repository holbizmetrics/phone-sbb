// Pinned-journey bar, live data: the five defects found by the DERIVE->Mirror
// falsifier run (PCLA .prometheus/findings/2026-11-27-dm-run1-pinned-bar/),
// re-run as regressions against the SHIPPED code. Each scenario is the one that
// confirmed the defect; each must now come out fixed. Two controls stay in so a
// broken harness cannot pass for a fixed bar.
import vm from "vm";
import { src } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const byName = n => { const m = new RegExp("\\n(async )?function " + n + "\\(").exec(src); if (!m) throw new Error("HARNESS FAILED -- " + n);
  let i = m.index + 1, d = 0, started = false; for (let k = i; k < src.length; k++) { if (src[k] === "{") { d++; started = true; } else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); } } };
const a = src.indexOf("let onboard = load(LS.onboard"), b = src.indexOf("/* ---- Wikipedia enrichment", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- onboard section markers moved");
const code = src.slice(a, b) + "\n" + ["obLiveBuffer", "obLiveArrival", "changeDetails"].map(byName).join("\n");

let NOW = 0; const RD = Date;
class FD extends RD { constructor(...x) { x.length ? super(...x) : super(NOW); } static now() { return NOW; } }
const el = () => { const o = { innerHTML: "", classList: { add() {}, toggle() {}, remove() {}, contains: () => false }, setAttribute() {} }; o.querySelector = () => el(); return o; };
let calls = [], board = [];
const hosts = {};
const ctx = { Date: FD, Math, Object, JSON, String, isNaN, encodeURIComponent,
  load: (k, d) => d, save() {}, LS: { onboard: "o", obpoi: "p" }, esc: s => String(s ?? ""), CP: () => "P",
  hhmm: t => t ? new RD(t).toISOString().slice(11, 16) : "?", minsUntil: t => Math.round((new RD(t) - NOW) / 60000),
  badge: (c, n) => ({ label: c + n }), TIGHT: 5, LAYOVER_MIN: 20, $: id => hosts[id] || (hosts[id] = el()),
  document: { querySelector: () => null, body: { classList: { add() {}, remove() {} } } },
  api: u => { calls.push(u); return Promise.resolve({ stationboard: board }); }, obFillPoi() {}, jrnConns: [] };
vm.createContext(ctx);
new vm.Script(code + `
this.S={get onboard(){return onboard},set onboard(v){onboard=v},get obLive(){return obLive},set obLive(v){obLive=v},
 set obLiveAt(v){obLiveAt=v},set obCheckAt(v){obCheckAt=v},get obLiveNote(){return obLiveNote},
 set obArr(v){obArr=v},set obArrAt(v){obArrAt=v}};
this.F={onboardNext,obLiveView,obLineHTML,obOfferHTML,obRecheck,onboardPin,paintOnboard,changeDetails,onboardSnap,obFreshness,obResetLive};`).runInContext(ctx);
const { S, F } = ctx;
const T = s => RD.parse("2026-11-27T" + s + ":00Z"), iso = s => "2026-11-27T" + s + ":00Z";
const txt = h => h.replace(/<[^>]+>/g, "").replace(/&#\d+;/g, " ");
const reset = () => { F.obResetLive(); calls = []; board = []; };
const next = () => F.onboardNext(S.onboard, NOW, F.obLiveView());

// 1. a train already late when pinned still gets its live check
{ reset(); const conn = { from: { station: { name: "Basel" } }, to: { station: { name: "Chur" }, arrival: iso("12:00") }, sections: [
    { journey: { category: "IC", number: "1" }, arrival: { arrival: iso("10:20"), prognosis: { arrival: iso("10:24") }, station: { name: "Olten" } } },
    { journey: { category: "IR", number: "2" }, departure: { departure: iso("10:30"), station: { name: "Olten" } } }] };
  conn._chg = F.changeDetails(conn); S.onboard = F.onboardSnap(conn); NOW = T("10:00");
  board = [{ stop: { arrival: iso("10:20"), prognosis: { arrival: iso("10:26") } } }];
  await F.obRecheck(NOW);
  chk("late-at-pin train: the live read matches its scheduled row (buffer 4', delay +6')",
    S.obLive && S.obLive.b === 4 && S.obLive.dly === 6, JSON.stringify(S.obLive) + " " + S.obLiveNote);
  // control: a board without that train still gives no verdict
  reset(); board = [{ stop: { arrival: iso("10:50") } }]; await F.obRecheck(NOW);
  chk("control: a board without the train is still UNKNOWN, never a verdict", S.obLive === null && /not on the arrival board/.test(S.obLiveNote), JSON.stringify(S.obLive));
  // destination arrival, late at pin
  reset(); S.onboard = { ...S.onboard, chg: [], arr: iso("12:04"), arrS: iso("12:00") }; NOW = T("11:00");
  board = [{ stop: { arrival: iso("12:00"), prognosis: { arrival: iso("12:09") } } }]; await F.obRecheck(NOW);
  chk("late-at-pin last leg: the destination read matches too", F.obLiveView().arr === new RD(iso("12:09")).toISOString(), JSON.stringify(F.obLiveView())); }

// 2. a new pin starts clean
{ reset(); S.onboard = { from: "A", to: "Chur", arr: iso("12:00"), chg: [{ stn: "Olten", b: 12, at: iso("10:20"), dt: iso("10:32") }] };
  NOW = T("10:00"); S.obLive = { k: 0, b: -3, dly: 15 }; S.obLiveAt = NOW; S.obCheckAt = NOW + 180000;
  ctx.jrnConns.length = 0; ctx.jrnConns.push({ from: { station: { name: "X" } }, to: { station: { name: "Lugano" }, arrival: iso("13:00") }, sections: [],
    _chg: [{ stn: "Bern", b: 12, at: iso("10:40"), dt: iso("10:52") }] });
  calls = []; F.onboardPin(0); await new Promise(r => setTimeout(r, 0));
  const nx = next(), line = txt(F.obLineHTML(S.onboard, nx)), off = F.obOfferHTML(S.onboard, nx);
  chk("new pin: no 'missed' and no replan offer from the OLD journey", !/missed/.test(line) && off === "", line + " || " + off);
  chk("new pin: its own live read is not throttled by the old one", calls.some(u => /Bern/.test(u)), JSON.stringify(calls)); }

// 3. a failure note belongs to its change
{ reset(); S.onboard = { from: "A", to: "Chur", arr: iso("15:00"), chg: [
    { stn: "Olten", b: 8, at: iso("10:20"), dt: iso("10:28") }, { stn: "Zurich", b: 9, at: iso("13:00"), dt: iso("13:09") }] };
  NOW = T("10:10"); board = []; await F.obRecheck(NOW);
  chk("control: change 1's failed read IS reported on change 1", F.obFreshness(S.onboard, next(), NOW).state === "failed", "");
  NOW = T("10:30"); const f = F.obFreshness(S.onboard, next(), NOW);
  chk("change 2, never checked, says pin-time -- not 'live check failed'", f.state === "pintime", JSON.stringify(f)); }

// 4. a late last leg is not 'arrived', and the pin stays
{ reset(); S.onboard = { from: "A", to: "Chur", arr: iso("10:00"), chg: [] }; S.obArr = { key: iso("10:00"), at: iso("10:40"), dly: 40 };
  NOW = T("10:05"); S.obArrAt = NOW;
  chk("late last leg (live 10:40): not 'arrived' at 10:05", next().phase === "arriving", next().phase);
  NOW = T("10:31"); F.paintOnboard();
  chk("...and the pin survives 10:31", S.onboard !== null, String(S.onboard));
  NOW = T("11:11"); F.paintOnboard();
  chk("...but retires 30' after the LIVE arrival", S.onboard === null, JSON.stringify(S.onboard)); }

// 5. a live-missed change keeps its verdict + offer after its pinned departure
{ reset(); S.onboard = { from: "A", to: "Chur", arr: iso("12:00"), chg: [{ stn: "Olten", b: 5, at: iso("10:20"), dt: iso("10:25") }] };
  NOW = T("10:22"); S.obLive = { k: 0, b: -6, dly: 11 }; S.obLiveAt = NOW;
  NOW = T("10:26"); let nx = next();
  chk("missed change still anchored at 10:26 (pinned dep 10:25, late train reaches Olten 10:31)", nx.phase === "change" && nx.k === 0, JSON.stringify(nx));
  chk("...with its replan offer", /is gone/.test(F.obOfferHTML(S.onboard, nx)), "");
  NOW = T("10:42"); nx = next();
  chk("...and released after the arrival + grace (10:41)", nx.phase !== "change", JSON.stringify(nx));
  reset(); NOW = T("10:26"); nx = next();
  chk("control: with no live 'missed' read the change ends at its pinned departure", nx.phase !== "change", JSON.stringify(nx)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
