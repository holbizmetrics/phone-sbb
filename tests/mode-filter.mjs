// Runs the REAL mode-filter functions out of index.html. No browser needed.
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
const constOf = (n) => {
  const m = src.match(new RegExp("const " + n + "\\s*=[\\s\\S]*?\\];"));
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + n);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const mk = (sel) => new Function("SEL", `
  let modeSel = SEL;
  ${constOf("MODES")}
  ${grab("esc")}
  ${grab("modeQS")}
  ${grab("modeWhyEmpty")}
  return { modeQS, modeWhyEmpty, MODES };
`)(sel);

// control: MODES really was extracted, not an empty stub
chk("control: MODES has the five chips", mk([]).MODES.length === 5, JSON.stringify(mk([]).MODES.map(m => m.k)));

// no selection == every mode, exactly as before the feature existed
chk("empty selection adds nothing to the query", mk([]).modeQS() === "", JSON.stringify(mk([]).modeQS()));
chk("empty selection explains nothing on an empty result", mk([]).modeWhyEmpty() === "");

// the query the API actually honours
chk("one mode -> one transportations[]", mk(["ship"]).modeQS() === "&transportations[]=ship", mk(["ship"]).modeQS());
chk("two modes -> two params", mk(["ship", "train"]).modeQS() === "&transportations[]=ship&transportations[]=train", mk(["ship", "train"]).modeQS());

// THE TRAP: a filter set weeks ago must explain an empty result, not look like a typo
const w1 = mk(["ship"]).modeWhyEmpty();
chk("stale filter names itself on an empty result", w1.includes("only showing journeys by boat"), w1);
chk("empty result offers the way out", w1.includes("clearModes()"), w1);
const w3 = mk(["ship", "bus", "tram"]).modeWhyEmpty();
chk("three modes read as a sentence, not a list dump", w3.includes("boat, bus or tram"), w3);
// tapped cableway first, but the sentence follows the fixed chip order -- the
// wording must not depend on which chip you happened to press first
const w2 = mk(["cableway", "train"]).modeWhyEmpty();
chk("two modes join with 'or'", w2.includes("train or cable car"), w2);
chk("wording is tap-order independent",
  mk(["train", "cableway"]).modeWhyEmpty() === w2);

// boot wiring for renderModes() is asserted in tests/boot-wiring.mjs

// every mode key must be one the API knows; a typo here silently returns nothing
const OK = new Set(["train", "ship", "cableway", "bus", "tram", "metro", "funicular"]);
chk("no unknown mode keys", mk([]).MODES.every(m => OK.has(m.k)),
  mk([]).MODES.map(m => m.k).filter(k => !OK.has(k)).join(","));

// the help sheet must mention the new control -- an unexplained chip row is a puzzle
chk("help sheet explains the mode chips", /mode chips/.test(src), "no help row for a new visible control");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
