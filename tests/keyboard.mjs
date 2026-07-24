// Runs the REAL acEnter out of index.html against a minimal fake DOM, so the
// keyboard path gets covered on a box where Playwright cannot run.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);            // say which file the verdict is about
const src = fs.readFileSync(APP, "utf8");
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

const mkClassList = (set) => ({
  add: (c) => set.add(c), remove: (c) => set.delete(c),
  contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
});
function mkEl() {
  const set = new Set();
  return { _cls: set, classList: mkClassList(set), dataset: {}, value: "",
           _h: {}, addEventListener(k, f) { (this._h[k] ||= []).push(f); },
           blur() { this._blurred = true; } };
}
function mkAc() {
  const el = mkEl();
  el._rows = [];
  el.querySelectorAll = () => el._rows;
  return el;
}
// rows the dropdown is currently showing, and which query they answer
function serve(ac, q, names) {
  ac._rows = names.map((n) => { const r = mkEl(); r.dataset.n = n; return r; });
  ac.dataset.q = q;
  ac.classList.add("show");
}

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// fresh module per case so listeners never accumulate
function build() {
  const inp = mkEl(), ac = mkAc();
  let picked = null;
  const mod = new Function("inp", "ac", "record", `
    const $ = (id) => (id === "IN" ? inp : ac);
    ${grab("acEnter")}
    acEnter("IN", "AC", record);
    return { fire: (key) => { let d = false;
      for (const f of (inp._h.keydown || [])) f({ key, preventDefault: () => { d = true; } });
      return d; } };
  `)(inp, ac, (n) => { picked = n; });
  chk._ = null;
  return { inp, ac, fire: mod.fire, got: () => picked };
}

// control: the harness really does deliver keydown to the real handler
{
  const t = build();
  t.inp.value = "Bern";
  serve(t.ac, "Bern", ["Bern", "Bern Wankdorf"]);
  const prevented = t.fire("Enter");
  chk("control: keydown reaches the real handler", prevented === true, "preventDefault never called");
  chk("fresh list -> takes the top suggestion", t.got() === "Bern", String(t.got()));
}

// THE BUG THIS GUARDS: dropdown is 300ms behind the keyboard
{
  const t = build();
  serve(t.ac, "Zur", ["Zurich Altstetten", "Zurich Enge"]);   // rows answer the OLD prefix
  t.inp.value = "Zurich HB";                                  // what the user actually typed
  t.fire("Enter");
  chk("stale list -> searches the typed text, not row 0", t.got() === "Zurich HB", String(t.got()));
  chk("control: row 0 really was the wrong station", t.ac._rows[0].dataset.n === "Zurich Altstetten");
}

// an explicitly arrow-picked row is honoured even against a stale list
{
  const t = build();
  serve(t.ac, "Zur", ["Zurich Altstetten", "Zurich Enge"]);
  t.inp.value = "Zurich HB";
  t.fire("ArrowDown"); t.fire("ArrowDown");                    // 0 -> 1
  chk("arrow moves the selection", t.ac._rows[1]._cls.has("sel"), "sel on: " + t.ac._rows.map(r => r._cls.has("sel")).join(","));
  t.fire("Enter");
  chk("arrow-picked row wins over the typed text", t.got() === "Zurich Enge", String(t.got()));
}

// closed dropdown -> literal text (this is the case that used to do NOTHING)
{
  const t = build();
  t.inp.value = "Lauterbrunnen";
  t.ac._rows = []; t.ac.classList.remove("show");
  t.fire("Enter");
  chk("closed dropdown -> searches what was typed", t.got() === "Lauterbrunnen", String(t.got()));
  chk("field is closed and blurred after Enter", !t.ac._cls.has("show") && t.inp._blurred);
}

// empty box must not fire a search
{
  const t = build();
  t.inp.value = "   ";
  t.fire("Enter");
  chk("empty box does not search", t.got() === null, String(t.got()));
}

// arrows must not hijack the key when there is nothing to pick
{
  const t = build();
  t.inp.value = "Be";
  t.ac._rows = []; t.ac.classList.remove("show");
  chk("ArrowDown with no list does not preventDefault", t.fire("ArrowDown") === false);
}

// ArrowUp stops at the top rather than going negative
{
  const t = build();
  serve(t.ac, "Bern", ["Bern", "Bern Wankdorf"]);
  t.inp.value = "Bern";
  t.fire("ArrowUp");
  chk("ArrowUp from nothing selects the first row", t.ac._rows[0]._cls.has("sel"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
