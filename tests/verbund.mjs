// Runs the REAL Verbund lookup out of index.html. No browser, no network.
//
// The load-bearing cases here are the NEGATIVE ones. A coverage table that
// always answers is worse than no table: this feature's whole job is telling
// you which zone-ticket area a stop is in, so a confident wrong answer is the
// one that gets you fined. Every positive below is paired with a station that
// must come back null -- and those nulls are real places (Valais has no
// Tarifverbund at all), not invented inputs.
//
// Ground truth for the positives was checked against reality, not against the
// generator: Bern is Libero, Zurich is ZVV, Basel is TNW, Geneva is BOTH
// unireso and Leman Pass. If a future data refresh breaks one of these, that
// is a real regression and not a stale fixture.
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
const between = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0) throw new Error("HARNESS FAILED -- markers not found: " + a);
  return src.slice(i, j + b.length);
};
const iife = () => {
  const m = src.match(/const VERBUND_BY_ID=\(\(\)=>\{[\s\S]*?\}\)\(\);/);
  if (!m) throw new Error("HARNESS FAILED -- VERBUND_BY_ID not found");
  return m[0];
};

const app = new Function(`
  ${between("/* VERBUND-DATA-START", "/* VERBUND-DATA-END */")}
  ${iife()}
  ${grab("verbundOf")}
  ${grab("verbundSpan")}
  return { verbundOf, verbundSpan, VERBUND_BY_ID, VERBUND_NAMES };
`)();

let pass = 0, fail = 0;
const chk = (n, c, d = "") => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + " :: " + d); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- harness controls: prove the data was really extracted, not stubbed ----
// Without these, every "returns null" case below would pass against an empty
// table -- the corpus would be green and measuring nothing.
chk("control: the packed table decoded to thousands of stations",
    app.VERBUND_BY_ID.size > 2500, "size=" + app.VERBUND_BY_ID.size);
chk("control: the Verbund name list came through",
    app.VERBUND_NAMES.length >= 15 && app.VERBUND_NAMES.includes("ZVV"),
    JSON.stringify(app.VERBUND_NAMES));

// ---- positives: real stations, ground truth from reality ----
chk("Bern is Libero", eq(app.verbundOf(8507000), ["Libero"]),
    JSON.stringify(app.verbundOf(8507000)));
chk("Zurich HB is ZVV", eq(app.verbundOf(8503000), ["ZVV"]),
    JSON.stringify(app.verbundOf(8503000)));
chk("Basel SBB is TNW", eq(app.verbundOf(8500010), ["TNW"]),
    JSON.stringify(app.verbundOf(8500010)));
chk("Luzern is Passepartout", eq(app.verbundOf(8505000), ["Passepartout"]),
    JSON.stringify(app.verbundOf(8505000)));
chk("St. Moritz is engadin mobil", eq(app.verbundOf(8509253), ["engadin mobil"]),
    JSON.stringify(app.verbundOf(8509253)));

// A station in TWO Verbunde must return both. 315 stations are, and collapsing
// them to one would silently under-report where a ticket is valid.
chk("Geneva returns BOTH of its Verbunde",
    (app.verbundOf(8501008) || []).length === 2
      && (app.verbundOf(8501008) || []).includes("unireso"),
    JSON.stringify(app.verbundOf(8501008)));

// ---- negatives: must be null, and these are real ----
// Valais genuinely has no Tarifverbund in the SBB dataset, so these are not
// gaps in the table -- they are the correct answer, and the UI must be able to
// say "not in a zone-ticket area" rather than guess a neighbour.
chk("Zermatt is in NO Verbund (Valais has none)", app.verbundOf(8501689) === null,
    JSON.stringify(app.verbundOf(8501689)));
chk("Brig is in NO Verbund", app.verbundOf(8501609) === null,
    JSON.stringify(app.verbundOf(8501609)));
chk("Sion is in NO Verbund", app.verbundOf(8501506) === null,
    JSON.stringify(app.verbundOf(8501506)));

// ---- negatives: malformed / absent input must not resolve to anything ----
chk("an unknown id is null", app.verbundOf(99999999) === null);
chk("undefined is null", app.verbundOf(undefined) === null);
chk("null is null", app.verbundOf(null) === null);
chk("a non-numeric id is null", app.verbundOf("Gotthard-Basistunnel") === null);
chk("an empty string is null", app.verbundOf("") === null);

// A string that happens to be numeric SHOULD resolve -- the API has returned
// ids as strings before, and refusing them would blank the feature silently.
chk("a numeric STRING id still resolves", eq(app.verbundOf("8507000"), ["Libero"]),
    JSON.stringify(app.verbundOf("8507000")));

// ---- verbundSpan: order, de-duplication, and honest unknown accounting ----
const leg = (...ids) => ids.map((id) => ({ station: { id } }));

let s = app.verbundSpan(leg(8500010, 8503000, 8505000));
chk("span lists each Verbund once, in travel order",
    eq(s.zones, ["TNW", "ZVV", "Passepartout"]), JSON.stringify(s));
chk("span reports no unknowns when every stop resolved", s.unknown === 0, JSON.stringify(s));

s = app.verbundSpan(leg(8503000, 8503000, 8503000));
chk("span de-duplicates a leg inside one Verbund", eq(s.zones, ["ZVV"]), JSON.stringify(s));

// Added after a mutation check: collapsing a two-Verbund stop to its first zone
// survived the whole corpus, because verbundOf() was the only thing tested with
// a multi-Verbund station. Under-reporting where a ticket is valid is exactly
// the failure this feature exists to prevent, so it gets its own span case.
s = app.verbundSpan(leg(8501008));
chk("span keeps BOTH Verbunde of a two-Verbund stop",
    s.zones.length === 2 && s.zones.includes("unireso"), JSON.stringify(s));

// The load-bearing one: unresolvable stops are COUNTED, never dropped. "1 zone"
// and "1 zone + 2 unknown" must not render as the same fact.
s = app.verbundSpan(leg(8503000, 8501689, 99999999));
chk("span counts unresolvable stops instead of dropping them",
    eq(s.zones, ["ZVV"]) && s.unknown === 2, JSON.stringify(s));

s = app.verbundSpan(leg(8501689, 8501609));
chk("a leg entirely outside any Verbund yields no zones and all unknown",
    eq(s.zones, []) && s.unknown === 2, JSON.stringify(s));

// Routing markers ("Gotthard-Basistunnel") carry no usable id. They are already
// filtered by legStops(), but the span must not fall over if one reaches it.
s = app.verbundSpan([{ station: { name: "Gotthard-Basistunnel" } }, ...leg(8505300)]);
chk("a marker without an id counts as unknown, not as a zone",
    eq(s.zones, ["Arcobaleno"]) && s.unknown === 1, JSON.stringify(s));

// Degenerate inputs must not throw -- this runs while a panel is rendering.
chk("empty leg is empty, not an error",
    eq(app.verbundSpan([]), { zones: [], unknown: 0 }));
chk("null leg is empty, not an error",
    eq(app.verbundSpan(null), { zones: [], unknown: 0 }));
chk("a stop with no station object counts as unknown",
    app.verbundSpan([{}]).unknown === 1);

// ---- the wiring, not just the function ----
// A unit that works but is never called is the failure mode this repo has hit
// four times. These run the REAL stopsHTML, so they fail if the ribbon is
// dropped from the render path even while verbundSpan stays perfect.
const ui = new Function(`
  ${between("/* VERBUND-DATA-START", "/* VERBUND-DATA-END */")}
  ${iife()}
  ${grab("verbundOf")}
  ${grab("verbundSpan")}
  ${src.match(/const ISO_LOCAL=.*;/)[0]}
  ${grab("esc")}
  ${grab("hhmm")}
  ${grab("verbundHTML")}
  ${grab("stopsHTML")}
  return { stopsHTML, verbundHTML };
`)();

const stop = (id, name, t) => ({ station: { id, name }, departure: t, arrival: t });
const realLeg = [
  stop(8500010, "Basel SBB", "2026-07-27T09:00:00+0200"),
  stop(8502113, "Olten", "2026-07-27T09:30:00+0200"),
  stop(8503000, "Zurich HB", "2026-07-27T10:00:00+0200"),
];
const html = ui.stopsHTML(realLeg);
chk("the zone ribbon actually reaches the rendered stop list",
    html.includes('class="svb"') && html.includes("TNW") && html.includes("ZVV"),
    html.slice(0, 160));
chk("the ribbon is rendered BEFORE the stop rows",
    html.indexOf('class="svb"') < html.indexOf('class="sline'), "");
chk("the stop rows still render (the ribbon did not replace them)",
    (html.match(/class="sline/g) || []).length === 3,
    String((html.match(/class="sline/g) || []).length));

// NULL control for the ribbon: a leg with no resolvable zone must not emit an
// empty chip strip, and must never imply a zone it does not know.
const valais = [stop(8501689, "Zermatt", "2026-07-27T09:00:00+0200"),
                stop(8501609, "Brig", "2026-07-27T10:00:00+0200"),
                stop(8501506, "Sion", "2026-07-27T11:00:00+0200")];
const vh = ui.stopsHTML(valais);
chk("a leg with no zone says so plainly and shows no chips",
    vh.includes("No zone-ticket area") && !vh.includes('class="vbz"'), vh.slice(0, 160));

// The ribbon must never assert validity -- that claim is not ours to make.
chk("the ribbon never claims a ticket is valid",
    !/valid|g&uuml;ltig/i.test(html + vh), "");

// A non-stop leg keeps its old message, unchanged by this feature.
chk("a non-stop leg is untouched by the ribbon",
    ui.stopsHTML(realLeg.slice(0, 2)).includes("Non-stop"), "");

console.log(`\nverbund: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
