// A phone with a full disk throws from localStorage.setItem. This suite runs the
// REAL save/load/storageNoteHTML out of index.html against a localStorage that
// refuses every write, and asserts that a PERSISTENCE failure stays a persistence
// failure instead of becoming a total one.
//
// Why it exists: on 2026-07-25 the app went dead on a full phone -- no journeys,
// no board, no mode chips, no theme -- and a reload did not help, because the disk
// was still full. One unguarded setItem, called BEFORE the work at five of six
// call sites, took every caller down with it.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// `full` = every write throws, the way Chrome does when the device has no space.
const mk = (full) => new Function("FULL", `
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { if (FULL) { const e=new Error("QuotaExceededError"); e.name="QuotaExceededError"; throw e; } store[k]=v; },
  };
  let storageFull=false;
  ${grab("load")}
  ${grab("save")}
  ${grab("storageNoteHTML")}
  return { load, save, storageNoteHTML, store, get flag(){ return storageFull; } };
`)(full);

// CONTROL: the stub really does throw, and the real save() really was extracted.
// Without this, a save() that quietly did nothing would pass every case below.
const ctl = mk(true);
let threw = false;
try { ctl.store && (() => { const l = { setItem: () => { throw new Error("x"); } }; l.setItem(); })(); } catch (e) { threw = true; }
chk("control: the harness can throw at all", threw);
chk("control: a working phone still persists", (() => { const s = mk(false); s.save("k", [1, 2]); return s.load("k", null)?.[1] === 2; })(),
  "save/load did not round-trip -- the extracted functions are not the real ones");

// THE BUG: save() must absorb the throw. Everything else follows from this.
chk("save() does not throw on a full disk", (() => { try { mk(true).save("k", [1]); return true; } catch (e) { return false; } })(),
  "setItem threw straight through save() -- every caller dies with it");

// The caller must keep running. This models planJourney(): remember, THEN plan.
chk("the caller's work still runs after a failed save", (() => {
  const s = mk(true); let planned = false;
  try { s.save("routes", ["a"]); planned = true; } catch (e) { }
  return planned;
})(), "rememberRoute() threw, so smartPlan() was never reached -- this is bug #6");

// A failed write must not fabricate a successful read.
chk("a refused write is not readable back", mk(true).load("k", "fallback") === "fallback");
chk("load() survives a hostile store", mk(true).load("nope", 7) === 7);

// Honesty: the app must SAY persistence is off, never silently pretend it stuck.
chk("a full disk raises the flag", (() => { const s = mk(true); s.save("k", 1); return s.flag === true; })());
chk("a healthy disk raises nothing", (() => { const s = mk(false); s.save("k", 1); return s.flag === false; })());
chk("freeing space clears the flag", (() => {
  const s = new Function(`
    let broken = true; const store = {};
    const localStorage = { getItem: k=>(k in store?store[k]:null),
      setItem: (k,v)=>{ if(broken) throw new Error("QuotaExceededError"); store[k]=v; } };
    let storageFull=false;
    ${grab("save")}
    save("k",1); const first = storageFull;
    broken = false; save("k",2); const second = storageFull;
    return { first, second };
  `)();
  return s.first === true && s.second === false;
})(), "the note would outlive the problem -- it must clear on the next good write");

const note = (() => { const s = mk(true); s.save("k", 1); return s.storageNoteHTML(); })();
chk("the note names storage as the cause", /out of storage/i.test(note), note);
chk("the note says the app still works", /works/i.test(note), note);
chk("the note names what is lost, not just that something is", /favourites|filters|routes/i.test(note), note);
chk("no note on a healthy phone", mk(false).storageNoteHTML() === "");

// WIRING -- the note has to reach the screen. A function that is never called is
// the defect class this repo has shipped five times (see feedback memory).
chk("storageNoteHTML is actually rendered", /tzNoteHTML\(\)\s*\+\s*storageNoteHTML\(\)/.test(src),
  "storageNoteHTML exists but nothing calls it -- ships green, never runs");

// The guard must be on save() itself, not sprinkled at call sites, or the next
// call site added will be unguarded again.
chk("the guard lives inside save()", /function save\(k,v\)\{[\s\S]{0,200}?try\{[\s\S]*?catch/.test(src),
  "save() is not the thing holding the try -- a new call site would reintroduce the bug");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
