// The 30-second departures refresh, run for real against a tiny DOM.
//
// Why it exists: the first no-flicker fix patched rows in place ONLY when the
// board came back as the identical set in the identical order, and fell back to
// a full innerHTML rewrite otherwise. A departure board changes -- a train
// leaves and every index shifts -- so the fallback was the NORMAL case and the
// rewrite replayed the row animation on all twelve rows. The flicker was worst
// exactly when the board was busiest, which is when you are standing on the
// platform looking at it.
//
// The reconciler is keyed, so this suite's real job is to prove two things a
// screenshot cannot: surviving rows keep their NODE (no re-animation), and the
// index each row carries is corrected when trains leave -- because the row index
// is what "plan a journey on THIS train" indexes back into.
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

/* A DOM just real enough for the reconciler: children, ordering via after(),
   removal, querySelector over a flat row list, and a per-node identity so the
   suite can tell a REUSED node from a recreated one. */
let uid = 0;
function mkNode(cls, key) {
  return {
    uid: ++uid, cls, dataset: { key, i: undefined }, style: {}, children: [],
    _html: "", classList: { toggle() { }, add() { }, remove() { } },
    set innerHTML(v) { this._html = v; this.children = v ? [mkRowFromHTML(v)] : []; },
    get innerHTML() { return this._html; },
    get firstElementChild() { return this.children[0] || null; },
    querySelector() { return { dataset: {}, innerHTML: "", classList: { toggle() { } } }; },
  };
}
function mkRowFromHTML(html) {
  const k = /data-key="([^"]*)"/.exec(html);
  return mkNode("dep", k ? k[1] : "");
}
function mkBox(keys) {
  const rows = keys.map(k => mkNode("dep", k));
  const head = mkNode("boardhead", undefined);
  const box = {
    order: [head, ...rows],
    querySelector: (s) => s === ".boardhead" ? head : null,
    querySelectorAll: () => box.order.filter(n => n.cls === "dep"),
  };
  const link = (n) => {
    n.after = (other) => {
      box.order = box.order.filter(x => x !== other);
      box.order.splice(box.order.indexOf(n) + 1, 0, other);
      link(other);
    };
    Object.defineProperty(n, "nextElementSibling", {
      configurable: true, get: () => box.order[box.order.indexOf(n) + 1] || null,
    });
    n.remove = () => { box.order = box.order.filter(x => x !== n); };
  };
  box.order.forEach(link);
  return box;
}

const mkTrain = (name, dep) => ({ name, to: "Zug", category: "IR", number: "1", stop: { departure: dep, prognosis: {} } });

// Run the real loadBoard's quiet path over a starting board and an incoming one.
function refresh(startKeys, incoming) {
  const box = mkBox(startKeys);
  const restored = { n: 0 };
  const env = new Function("BOX", "INCOMING", "RESTORED", "TRACE", `
    let lastBoard = [];
    const $ = (id) => id === "depOut" ? BOX : { classList:{ add(){}, remove(){} } };
    const document = { createElement: () => TRACE.mkNode("div", undefined) };
    const api = async () => ({ stationboard: INCOMING, station:{name:"Test"} });
    ${grab("depKey")}
    const patchRow = (row,j) => { TRACE.patched.push(row.uid); };
    const depRow = (j,i) => '<div class="dep" data-key="'+depKey(j)+'" data-i="'+i+'"></div>';
    const boardHeadHTML = () => "<head>";
    const wireBoardHead = () => {};
    const restoreOpenDep = () => { RESTORED.n++; };
    const esc = s => s;
    ${grab("loadBoard")}
    return loadBoard("Test", true).then(()=>({ lastBoard }));
  `);
  const TRACE = { patched: [], mkNode };
  return env(box, incoming, restored, TRACE).then(() => ({
    box, restored, patched: TRACE.patched,
    keys: box.order.filter(n => n.cls === "dep").map(n => n.dataset.key),
    uids: box.order.filter(n => n.cls === "dep").map(n => n.uid),
    idx: box.order.filter(n => n.cls === "dep").map(n => n.dataset.i),
  }));
}

const A = mkTrain("IR1", "2026-07-25T14:00:00+02:00");
const B = mkTrain("IR2", "2026-07-25T14:10:00+02:00");
const C = mkTrain("IR3", "2026-07-25T14:20:00+02:00");
const kA = "IR1|2026-07-25T14:00:00+02:00", kB = "IR2|2026-07-25T14:10:00+02:00",
  kC = "IR3|2026-07-25T14:20:00+02:00";

// CONTROL: the harness's own key derivation must agree with the app's, or every
// "node was reused" result below is meaningless.
const keyOf = new Function(`${grab("depKey")}; return depKey;`)();
chk("control: harness keys match the app's depKey", keyOf(A) === kA, keyOf(A));

const r1 = await refresh([kA, kB, kC], [A, B, C]);
chk("an unchanged board keeps every node", r1.uids.length === 3 && r1.patched.length === 3, JSON.stringify(r1.patched));
chk("an unchanged board patches, never rebuilds", r1.keys.join(",") === [kA, kB, kC].join(","), r1.keys.join(","));

// THE REGRESSION: the front train leaves. Old code rewrote all rows here.
const before = mkBox([kA, kB, kC]).order.filter(n => n.cls === "dep").map(n => n.uid);
const r2 = await refresh([kA, kB, kC], [B, C]);
chk("a departed train is removed", r2.keys.join(",") === [kB, kC].join(","), r2.keys.join(","));
chk("the survivors keep their nodes when indices shift", r2.patched.length === 2, JSON.stringify(r2.patched));
chk("survivors are re-indexed after a departure", r2.idx.join(",") === "0,1", r2.idx.join(","));

// A new train appears at the bottom: only it may be new.
const r3 = await refresh([kA, kB], [A, B, C]);
chk("a new departure is appended", r3.keys.join(",") === [kA, kB, kC].join(","), r3.keys.join(","));
chk("only the new departure is created", r3.patched.length === 2, "patched " + r3.patched.length + ", expected the 2 survivors");

// Both at once -- the ordinary 30s delta on a busy station.
const r4 = await refresh([kA, kB], [B, C]);
chk("one leaves and one arrives in the same refresh", r4.keys.join(",") === [kB, kC].join(","), r4.keys.join(","));
chk("the survivor of a mixed delta is not recreated", r4.patched.length === 1, JSON.stringify(r4.patched));
chk("mixed delta re-indexes from zero", r4.idx.join(",") === "0,1", r4.idx.join(","));

// Reordering must move nodes, not rebuild them (a delay can reorder the board).
const r5 = await refresh([kA, kB, kC], [C, A, B]);
chk("a reordered board is reordered, not rebuilt", r5.keys.join(",") === [kC, kA, kB].join(","), r5.keys.join(","));
chk("reordering keeps all three nodes", r5.patched.length === 3, JSON.stringify(r5.patched));
chk("reordering fixes every index", r5.idx.join(",") === "0,1,2", r5.idx.join(","));

// The open onward-stops panel has to be re-pointed after any reshuffle.
chk("the expanded row is restored after a refresh", r2.restored.n === 1, String(r2.restored.n));

// An empty board must not leave a bare header: that path falls back to a rebuild
// so the "no departures" message actually renders.
const r6 = await refresh([kA, kB], []);
chk("an empty board does not silently strand the header", r6.patched.length === 0, JSON.stringify(r6.patched));

// SOURCE-LEVEL: the wrong-train trap. Rows are reused now, so an index frozen
// into the handler at render time would point at whichever train later took
// that slot -- and you would not find out until the platform.
chk("the row index is not baked into the tap handler", !/planFromBoard\(event,\s*\$\{i\}\)/.test(src),
  "planFromBoard still receives a render-time index -- a reused row would plan the wrong train");
chk("planFromBoard reads the index off the row at tap time",
  /function planFromBoard\(ev\)\{[\s\S]{0,300}?closest\(["'`]\.dep\[data-i\]/.test(src),
  "planFromBoard does not resolve the row itself");
chk("the reconciler keeps each row's index current", /row\.dataset\.i\s*=\s*i;/.test(src),
  "rows are reused but never re-indexed -- the wrong-train bug, one step later");

// A new row must not inherit the entry stagger, or a single arrival crawls in.
chk("an arriving row does not wait on the stagger", /animationDelay\s*=\s*["']0ms["']/.test(src));

/* Clearing the station box used to empty only the TEXT. The board for the old
   station stayed on screen under an empty field -- so it read as departures for
   whatever you typed next -- and its 30-second poller kept hitting a volunteer
   API for a station you had visibly removed. */
{
  const t = new Function(`
    const els = {};
    const el = () => ({ value:"", innerHTML:"", focus(){}, classList:{ add(){}, remove(){} } });
    const $ = (id) => els[id] || (els[id] = el());
    let current = "Luzern", lastBoard = [1,2,3], openDep = "abc";
    const saved = {};
    const LS = { last:"last" };
    const save = (k,v) => { saved[k] = v; };
    let stopped = 0;
    const stopBoardTimers = () => { stopped++; };
    ${grab("clearField")}
    clearField("dep");
    return { stopped, current, lastBoard, openDep, saved, out: $("depOut").innerHTML, box: $("iDep").value };
  `)();
  chk("clearing the station stops the poller", t.stopped === 1, String(t.stopped));
  chk("clearing the station forgets which station it was", t.current === "", t.current);
  chk("clearing the station drops the cached board", t.lastBoard.length === 0, JSON.stringify(t.lastBoard));
  chk("clearing the station collapses any open row", t.openDep === "", t.openDep);
  chk("clearing the station does not reappear on reload", t.saved.last === "", JSON.stringify(t.saved));
  chk("clearing the station replaces the board with the prompt", /Search a station/.test(t.out), t.out);

  const other = new Function(`
    const els = {};
    const el = () => ({ value:"x", innerHTML:"", focus(){}, classList:{ add(){}, remove(){} } });
    const $ = (id) => els[id] || (els[id] = el());
    let current = "Luzern", lastBoard = [1], openDep = "abc";
    const LS = { last:"last" }; const save = () => {};
    let stopped = 0; const stopBoardTimers = () => { stopped++; };
    ${grab("clearField")}
    clearField("from");
    return { stopped, current };
  `)();
  chk("clearing a JOURNEY field leaves the departure board alone",
    other.stopped === 0 && other.current === "Luzern",
    "clearing From/To tore down the board -- they are different screens");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
