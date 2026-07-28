// Runs the REAL train-sub-category filter out of index.html. No browser needed.
//
// This filter is the first one in the app that can DELETE a connection the API
// actually returned, so the corpus is built around the two ways that goes wrong:
// dropping something it should have kept (rule 1, unknown categories pass), and
// keeping something it should have dropped (a filter that only ever says yes has
// been shown to run, not to work). Both directions are planted below.
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

const mk = (sel, modes = []) => new Function("SEL", "MODES_SEL", `
  let catSel = SEL, modeSel = MODES_SEL;
  ${constOf("TRAIN_CLASSES")}
  ${grab("esc")}
  ${grab("trainClassOf")}
  ${grab("connTrainOK")}
  ${grab("catFilter")}
  ${grab("catNames")}
  ${grab("catsRelevant")}
  ${grab("catFilterNote")}
  ${grab("catWhyEmpty")}
  return { trainClassOf, connTrainOK, catFilter, catNames, catsRelevant, catFilterNote, catWhyEmpty, TRAIN_CLASSES };
`)(sel, modes);

// a connection is just its legs' categories; null == a walk (no journey object)
const conn = (...cats) => ({ sections: cats.map(c => c === null ? { walk: {} } : { journey: { category: c } }) });

// ---- harness controls: prove the real code was extracted, not an empty stub ----
const A = mk([]);
chk("control: TRAIN_CLASSES has the five sub-category chips", A.TRAIN_CLASSES.length === 5,
  JSON.stringify(A.TRAIN_CLASSES.map(t => t.k)));
chk("control: the classifier discriminates (IC and S are not the same class)",
  A.trainClassOf("IC") !== A.trainClassOf("S"), A.trainClassOf("IC") + " vs " + A.trainClassOf("S"));

// ---- no selection == the feature is not there at all ----
chk("empty selection keeps every connection", A.catFilter([conn("IC"), conn("S"), conn("B")]).length === 3);
chk("empty selection judges nothing", A.connTrainOK(conn("S")) === true);
chk("empty selection prints no filter note", A.catFilterNote(2, 9) === "");
chk("empty selection explains nothing on an empty result", A.catWhyEmpty() === "");

// ---- the classifier, over categories the LIVE API actually returned ----
// (probed 2026-07-27 across a dozen routes: IC IR S TGV RE TER B R EC BAT EV PE ICE NJ T)
const want = { IC: "ic", EC: "ic", ICE: "fast", TGV: "fast", NJ: "fast",
               IR: "ir", PE: "ir", RE: "re", TER: "re", S: "local", R: "local" };
for (const [cat, cls] of Object.entries(want))
  chk(`classifies ${cat} as ${cls}`, A.trainClassOf(cat) === cls, String(A.trainClassOf(cat)));

// ---- NULL CONTROLS: things that are NOT a train we judge ----
// These all came back from the live API as real categories. If any of them ever
// classified, the filter would start deleting boats and replacement buses.
for (const cat of ["B", "BAT", "EV", "T", "PB", "GB", "CC", "FUN", "FAE"])
  chk(`${cat} is not a judged train type`, A.trainClassOf(cat) === null, String(A.trainClassOf(cat)));
chk("an empty category is not a judged train type", A.trainClassOf("") === null);
chk("a missing category is not a judged train type", A.trainClassOf(undefined) === null);
chk("an UNKNOWN category is not judged (rule 1)", A.trainClassOf("ZZZ") === null, String(A.trainClassOf("ZZZ")));
// EXT is the one category that IS a train and still must not be judged. Measured
// live on the Bauma board (DVZO steam, 2026-09-06) it means heritage runs, football
// shuttles and replacement services in one bucket -- it was briefly filed under RE,
// which would have let an "RE off" filter silently delete a steam special.
chk("EXT is a train but not a judged class", A.trainClassOf("EXT") === null, String(A.trainClassOf("EXT")));
chk("an EXT leg never drops a journey", mk(["ic"]).connTrainOK(conn("IC", "EXT")) === true);
chk("category matching is case- and space-insensitive", A.trainClassOf("  ic  ") === "ic");

// ---- the filter must be able to come back NEGATIVE ----
const IC = mk(["ic"]);
chk("IC-only KEEPS a pure IC journey", IC.connTrainOK(conn("IC")) === true);
chk("IC-only DROPS a pure S journey", IC.connTrainOK(conn("S")) === false);
chk("IC-only DROPS an IC journey with one regional leg", IC.connTrainOK(conn("IC", "S")) === false);
chk("IC-only DROPS it wherever the unwanted leg sits", IC.connTrainOK(conn("S", "IC")) === false);
chk("IC-only keeps a two-leg all-IC journey", IC.connTrainOK(conn("IC", "EC")) === true);
chk("IC-only filter really removes rows",
  IC.catFilter([conn("IC"), conn("S"), conn("IC", "RE"), conn("EC")]).length === 2);

// ---- what the filter must NEVER touch ----
chk("a walk leg never drops a journey", IC.connTrainOK(conn("IC", null)) === true);
chk("a bus leg never drops a journey", IC.connTrainOK(conn("IC", "B")) === true);
chk("a boat leg never drops a journey", IC.connTrainOK(conn("IC", "BAT")) === true);
chk("a replacement-bus leg never drops a journey", IC.connTrainOK(conn("IC", "EV")) === true);
chk("an UNKNOWN train type never drops a journey (rule 1)", IC.connTrainOK(conn("IC", "ZZZ")) === true);
chk("a journey of only unknown types survives any filter", IC.connTrainOK(conn("ZZZ", "QQQ")) === true);
chk("a journey with no sections at all survives", IC.connTrainOK({ sections: [] }) === true);
chk("a malformed connection survives rather than vanishing", IC.connTrainOK({}) === true);

// ---- selecting more than one class widens, never narrows ----
const ICRE = mk(["ic", "re"]);
chk("IC+RE keeps the mixed journey that IC-only dropped", ICRE.connTrainOK(conn("IC", "RE")) === true);
chk("IC+RE still drops an S leg", ICRE.connTrainOK(conn("IC", "S")) === false);
chk("adding a class can only keep more rows",
  ICRE.catFilter([conn("IC"), conn("S"), conn("IC", "RE"), conn("EC")]).length >= IC.catFilter([conn("IC"), conn("S"), conn("IC", "RE"), conn("EC")]).length);

// ---- rule 2: filtering is said out loud, and only when it happened ----
chk("the note counts what was HIDDEN, not what was kept", IC.catFilterNote(2, 9).includes("<b>7</b>"),
  IC.catFilterNote(2, 9));
chk("the note names the window it filtered", IC.catFilterNote(2, 9).includes("<b>9</b>"));
chk("the note names the filter, not the timetable", IC.catFilterNote(2, 9).includes("not a thin timetable"));
chk("the note prints the way back out", IC.catFilterNote(2, 9).includes("clearCats()"));
chk("the note is SILENT when nothing was dropped", IC.catFilterNote(6, 6) === "", IC.catFilterNote(6, 6));
chk("the note is SILENT when everything was dropped (that is the empty branch)", IC.catFilterNote(0, 9) === "");
chk("singular reads correctly", IC.catFilterNote(1, 2).includes("<b>1</b> of the next <b>2</b> options is hidden"),
  IC.catFilterNote(1, 2));
// The bug this assertion exists for: on Luzern-Vitznau an EC/IC filter KEEPS eight
// boat and replacement-bus options, because rule 1 never judges them. Any wording
// of the form "N options use EC/IC" is a false claim about those eight.
chk("the note never claims the kept options use the selected type",
  !IC.catFilterNote(8, 10).includes("EC/IC") && !/options? use[^a]/.test(IC.catFilterNote(8, 10)),
  IC.catFilterNote(8, 10));

// ---- the empty-result explanation ----
chk("an active filter explains an empty result", IC.catWhyEmpty().includes("EC/IC"));
chk("the explanation prints the way out", IC.catWhyEmpty().includes("clearCats()"));
chk("two classes are listed readably", ICRE.catNames() === "EC/IC or RE", ICRE.catNames());
chk("three classes keep the comma-and-or shape", mk(["ic", "re", "local"]).catNames() === "EC/IC, RE or S/R",
  mk(["ic", "re", "local"]).catNames());

// ---- the sub-row only applies where trains are possible ----
chk("sub-row applies when no mode filter is set", mk([], []).catsRelevant() === true);
chk("sub-row applies when trains are selected", mk([], ["train", "bus"]).catsRelevant() === true);
chk("sub-row hides when trains are filtered out", mk([], ["bus"]).catsRelevant() === false);
chk("a hidden selection is a harmless no-op (no train legs to judge)",
  mk(["ic"], ["bus"]).connTrainOK(conn("B", "T")) === true);

// ---- structural invariants of the table itself ----
const seen = new Map();
let dup = null;
for (const t of A.TRAIN_CLASSES) for (const c of t.cats) {
  if (seen.has(c)) dup = c + " in " + seen.get(c) + " and " + t.k;
  seen.set(c, t.k);
}
chk("no category belongs to two classes", dup === null, String(dup));
chk("every listed category is uppercase (trainClassOf uppercases before matching)",
  A.TRAIN_CLASSES.every(t => t.cats.every(c => c === c.toUpperCase())));
chk("every class has a label and an icon", A.TRAIN_CLASSES.every(t => t.k && t.label && t.ic));

// The row lives inside .favs, a flex container, so anything in there that CAN
// shrink will shrink on a narrow screen. The "Train type" caption is a bare span
// and got neither guard, so on a real 360px phone it collapsed to a two-line
// "Train / type" while every .chip beside it stayed on one line. A unit test
// cannot see a wrap, so the CSS contract is asserted instead of the pixels.
{
  const rule = (src.match(/\.catlabel\{[^}]*\}/) || [""])[0].replace(/\s+/g, " ");
  chk("the row caption cannot shrink", /flex:0 0 auto/.test(rule), rule || "no .catlabel rule");
  chk("the row caption cannot wrap", /white-space:nowrap/.test(rule), rule || "no .catlabel rule");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
