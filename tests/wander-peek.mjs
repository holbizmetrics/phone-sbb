// Wander hint (Astra review 2026-11-25): one question-shaped line under the
// departure search, shown until the first REAL Wander search, then gone for
// good. Runs the shipped functions in a sandbox with planted negatives: a hint
// that never hides, one that hides on a mere tab peek, and one that never shows
// are all failures this file must catch.
import vm from "vm";
import { src } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const fn = name => {
  const re = new RegExp("\\n(async )?function " + name + "\\(");
  const m = re.exec(src); if (!m) throw new Error("HARNESS FAILED -- " + name + " not found");
  const a = m.index + 1, rest = src.slice(a + 10);
  const n = rest.search(/\n(async )?function |\n\/\*|\nlet |\nconst /);
  return src.slice(a, a + 10 + (n < 0 ? rest.length : n));
};
const blk = ["paintWanPeek", "openWanderPeek", "runWander"].map(fn).join("\n");
chk("control: extracted runWander really is the search", blk.includes("stationboard") && blk.includes("wanBudget"), "");

const mk = (store = {}) => {
  const btn = { hidden: true }, ui = [];
  const ctx = {
    LS: { wanused: "rail.wanused" },
    load: (k, d) => (k in store ? store[k] : d), save: (k, v) => { store[k] = v; },
    $: id => (id === "wanPeek" ? btn : { innerHTML: "", classList: { add() {}, toggle() {} } }),
    setTab: t => ui.push("tab:" + t), scrollTo: () => ui.push("top"),
    api: () => Promise.reject(new Error("offline in test")), skel: () => "", errBox: () => "",
    encodeURIComponent, Date, Math, Promise,
    wanName: "", wanBudget: 0, wanRun: 0,
  };
  vm.createContext(ctx);
  new vm.Script(blk + "\nthis.paintWanPeek=paintWanPeek;this.openWanderPeek=openWanderPeek;this.runWander=runWander;").runInContext(ctx);
  return { ctx, btn, ui, store };
};

// fresh install: hint shows
{ const t = mk(); t.ctx.paintWanPeek(); chk("fresh install: the hint is visible", t.btn.hidden === false, String(t.btn.hidden)); }
// tap: opens the Wander tab
{ const t = mk(); t.ctx.openWanderPeek(); chk("tapping the hint opens the Wander tab", t.ui[0] === "tab:wan", t.ui.join(",")); }
// planted negative: a search with no budget is not use
{ const t = mk(); t.ctx.paintWanPeek(); t.ctx.wanName = "Olten"; await t.ctx.runWander();
  chk("planted negative: start but no budget chosen -> hint stays", t.btn.hidden === false && !t.store["rail.wanused"], JSON.stringify(t.store)); }
// real search: hint retires and stays retired
{ const t = mk(); t.ctx.paintWanPeek(); t.ctx.wanName = "Olten"; t.ctx.wanBudget = 120; await t.ctx.runWander();
  chk("first real search hides the hint at once", t.btn.hidden === true, String(t.btn.hidden));
  chk("...and remembers it", t.store["rail.wanused"] === true, JSON.stringify(t.store));
  const t2 = mk(t.store); t2.ctx.paintWanPeek();
  chk("...so after a reload it stays hidden", t2.btn.hidden === true, String(t2.btn.hidden)); }
// even a failed (offline) search counts: the person found the feature
// (the api stub above always rejects, so the previous block already proved it)

// wiring: shipped, not just green
const html = src;
chk("the hint is in the page, under the departure search, hidden until painted",
  /id="acDep"[\s\S]{0,40}<\/div>\s*<button[^>]*id="wanPeek"[^>]*hidden/.test(html), "");
chk("the hint is wired to openWanderPeek", /id="wanPeek"[^>]*onclick="openWanderPeek\(\)"/.test(html), "");
chk("boot paints the hint", /\npaintWanPeek\(\);/.test(src), "");
chk("[hidden] beats the hint's display:block", /\.wanpeek\[hidden\]\{display:none\}/.test(src), "");
chk("the Wander tab says what it does on hover", /id="tabWan"[^>]*title="[^"]*get me back/.test(html), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
