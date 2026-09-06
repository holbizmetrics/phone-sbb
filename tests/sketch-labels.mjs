// Which dots on the route sketch get a label, and what it says.
//
// The defect this pins showed up on the operator's own exported route (2026-09-05):
// "Kloten, Zum Wilden Mann" -> bus -> "Kloten, Bahnhof" rendered TWO labels reading
// "Kloten" on two different dots. The origin was deduped against the other labels
// by its FULL name and shortened afterwards, so both passed the collision check.
// sketchMarks() was pulled out of sketchSVG so this can run without a DOM.
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  let i = src.indexOf("function " + n + "(");
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

const fns = new Function(`${grab("shortStop")} ${grab("shortStopLong")} ${grab("sketchMarks")}
  return { shortStop, shortStopLong, sketchMarks };`)();

const pt = (name, x = 0, y = 0) => ({ name, x, y });
const leg = (...names) => ({ pts: names.map((n, i) => pt(n, i, i)), col: "#000" });

// ---- the operator's route, exactly ----
{
  const legs = [
    leg("Kloten, Zum Wilden Mann", "Kloten, Bahnhof"),      // bus 732
    leg("Kloten", "Zürich Hardbrücke"),                      // S7
    leg("Zürich Hardbrücke, Bahnhof", "Zürich, Hardplatz"), // bus 83
  ];
  const labels = fns.sketchMarks(legs).map(m => m.t);
  chk("no two dots carry the same label", new Set(labels).size === labels.length, JSON.stringify(labels));
  chk("the origin is labelled 'Kloten'", labels[0] === "Kloten", labels[0]);
  chk("the change at Kloten Bahnhof keeps a label that says WHICH Kloten -- it was two identical 'Kloten' before",
    labels.includes("Kloten Bahnhof"), JSON.stringify(labels));
  chk("the change is flagged as a change, the terminus is not",
    fns.sketchMarks(legs)[1].change === true && fns.sketchMarks(legs).at(-1).change === false, "");
}

// ---- two legs that genuinely end at the same stop: ONE label, not a fake second ----
{
  const legs = [leg("Bern", "Olten"), leg("Olten", "Olten")];
  const labels = fns.sketchMarks(legs).map(m => m.t);
  chk("a genuine repeat of the same stop is NOT relabelled into a phantom second station",
    labels.filter(l => l === "Olten").length === 1 && !labels.includes("Olten Olten"), JSON.stringify(labels));
}

// ---- the fallback form itself ----
{
  chk("shortStopLong joins the first two fields", fns.shortStopLong("Kloten, Bahnhof") === "Kloten Bahnhof", fns.shortStopLong("Kloten, Bahnhof"));
  chk("...and clamps like shortStop does",
    fns.shortStopLong("DTC Dynamic Test Center AG, Vauffelin, Route Principale 127").length <= 20, "");
  chk("...and a one-field name has no longer form", fns.shortStopLong("Bern") === "Bern", "");
  chk("CONTROL -- unrelated names are untouched by any of this",
    JSON.stringify(fns.sketchMarks([leg("Bern", "Olten"), leg("Olten", "Zürich HB")]).map(m => m.t)) === '["Bern","Olten","Zürich HB"]', "");
}

// ---- the sketch still calls it (the extraction is wired, not orphaned) ----
{
  chk("sketchSVG builds its labels through sketchMarks", /const marks=sketchMarks\(legs\)/.test(grab("sketchSVG")), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
