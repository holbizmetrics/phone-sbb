// Runs the REAL journey-anchoring code: the last-way-home line on the results
// list (jlhRowHTML / fillJourneyLastHome), the per-card stranding rib
// (jlhCardRib), and the zone facts (connZoneRib per card, jrnZoneFact route-
// level). No browser needed.
//
// The feature moves facts from the detail view to the DECISION moment
// (UNSOLVED-GAPS.md para 3), so the corpus is built around the ways an
// anchored fact can lie: claiming coverage it did not verify ("all the way"
// over unresolved stops), collapsing an outage into a verdict (an unreachable
// timetable rendered like a genuine one-way trip), and flattening a
// suppressed-by-gate fact into "none". Reviewer contract (web-claude-phonesbb
// 2026-07-28): per-card comparison from ONE query; roomy = silent; failed
// never collapses into none; "verified" wording.
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

// ---- the last-way-home row: three outcomes, none interchangeable ----
const mk = (names) => new Function(`
  const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
  ${grab("esc")}
  ${grab("hhmm")}
  ${names.map(grab).join("\n")}
  return [${names.join(",")}];
`)();
const [jlh, cardRib] = mk(["jlhRowHTML", "jlhCardRib"]);

const ok = jlh({ dep: "2026-07-28T23:37:00+0200", arr: "2026-07-29T00:12:00+0200" }, "Zug");
chk("a found way home prints its departure time", ok.includes("23:37"), ok);
chk("it names the station it leaves from", ok.includes("Zug"));
chk("it speaks the wander dialect: VERIFIED, not THE last", /verified way home/i.test(ok),
  "'verified' asserts a train that exists; 'last' claims completeness the API cannot promise on thin lines");
chk("it does not warn", !ok.includes("&#9888;"));

const none = jlh(null, "Vitznau");
chk("no way home is a WARNING, not a blank", none.includes("&#9888;") && none.includes("Vitznau"), none);
chk("it says what it means: one way", /one way/i.test(none));

const unk = jlh("unreachable", "Vitznau");
chk("an outage is its own outcome", unk.includes("outage"), unk);
chk("an outage never claims one-way", !/one way/i.test(unk) && !unk.includes("&#9888;"),
  "an unreachable timetable rendered as 'no way home' turns an outage into a verdict");
chk("all three outcomes render differently", ok !== none && none !== unk && ok !== unk);
chk("a station name is escaped, not injected", jlh(null, '<img src=x>').includes("&lt;img"),
  jlh(null, '<img src=x>'));

// ---- the per-card stranding rib: same query, local comparison, gated ----
{
  const found = { dep: "2026-07-28T23:21:00+0200", arr: null, slack: 34 };
  const tight = cardRib(found, 6);
  chk("tight slack renders the rib with time + margin", tight.includes("23:21") && tight.includes("34&#8242;"), tight);
  chk("the rib speaks 'verified' too", /verified way home/i.test(tight), tight);
  const roomy = cardRib({ dep: "2026-07-28T23:21:00+0200", arr: null, slack: 200 }, 6);
  chk("roomy + plenty of services: SUPPRESSED (nothing, not 'none')", roomy === "", roomy);
  const few = cardRib({ dep: "2026-07-28T23:21:00+0200", arr: null, slack: 200 }, 3);
  chk("roomy slack but only 3 services left: still shown", few.includes("23:21"), few);
  const noneRib = cardRib(null, 0);
  chk("arrival AFTER the last way home: the none state, with a time for nothing",
    /no later way home verified/i.test(noneRib) && !/\d{2}:\d{2}/.test(noneRib), noneRib);
  chk("suppressed is not the none state", noneRib !== "" && noneRib !== roomy);
  chk("an outage renders NO card rib -- never the none state", cardRib("unreachable", 0) === "" && cardRib(undefined, 0) === "",
    "a failed query flattened into 'no way home' at rib length is the exact lie the top line refuses");
}

// ---- the zone facts ----
// verbundOf is stubbed: station ids 1,2 are ZVV, 3 is Zug, 9 is unresolved.
const zoneCtx = (conns) => new Function("CONNS", `
  let jrnConns = CONNS;
  const verbundOf = id => ({1:["ZVV"],2:["ZVV"],3:["Tarifverbund Zug"]})[id] || null;
  ${grab("esc")}
  ${grab("verbundSpan")}
  ${grab("legStops")}
  ${grab("connZones")}
  ${grab("connZoneRib")}
  ${grab("jrnZoneFact")}
  return { rib: connZoneRib, fact: jrnZoneFact };
`)(conns);

// a leg is its stops: [id, hasTimes] pairs; null id == the measured passList[0]
// defect row (terminus id with name:null) which the filter must remove
const leg = (...stops) => ({ journey: { passList: stops.map(([id, t]) => ({
  station: id === null ? { id: 8503505, name: null } : { id, name: "S" + id },
  ...(t ? { departure: "2026-07-28T10:00:00+0200" } : {}),
})) } });
const conn = (...sections) => ({ sections });

{
  // Single zone is a ROUTE-level ticket fact: once above the list, not a rib on
  // every card (identical-per-card = noise that trains the eye off the rib row).
  const { rib, fact } = zoneCtx([conn(leg([1, true], [2, true]))]);
  chk("one zone, fully resolved: NO per-card rib", rib(0) === "", rib(0));
  chk("one zone, fully resolved: the route-level fact claims it", fact().includes("ZVV all the way"), fact());
}
{
  const { rib, fact } = zoneCtx([conn(leg([1, true], [3, true]))]);
  chk("two zones: the card rib names both", rib(0).includes("ZVV") && rib(0).includes("Tarifverbund Zug"), rib(0));
  chk("two zones: never claims 'all the way'", !rib(0).includes("all the way") && fact() === "", rib(0) + "|" + fact());
}
{
  // The claim-direction plant: one stop did not resolve. "ZVV all the way"
  // would be a rounded-up coverage claim over a stop nobody looked up.
  const { rib, fact } = zoneCtx([conn(leg([1, true], [9, true], [2, true]))]);
  chk("one zone + an unresolved stop: SILENT everywhere, not rounded up", rib(0) === "" && fact() === "", rib(0) + "|" + fact());
}
{
  // Same silence when a whole leg has no stop list at all.
  const { rib, fact } = zoneCtx([conn(leg([1, true]), { journey: {} })]);
  chk("one zone + a leg with no stop list: SILENT", rib(0) === "" && fact() === "", rib(0) + "|" + fact());
}
{
  // But a MULTI-zone journey stays printable with gaps: "touches A and B" is
  // true no matter how many stops are unresolved.
  const { rib } = zoneCtx([conn(leg([1, true], [3, true]), { journey: {} })]);
  chk("two zones survive a missing stop list (touches-fact, not coverage)",
    rib(0).includes("ZVV") && rib(0).includes("Tarifverbund Zug"), rib(0));
}
{
  const { rib, fact } = zoneCtx([conn({ walk: {} })]);
  chk("a walk-only journey has no zone rib and no fact", rib(0) === "" && fact() === "");
  chk("a missing connection has no zone rib", rib(7) === "");
}
{
  // The measured passList[0] defect: terminus id 8503505 with name:null. The
  // name filter kills that row, so it must neither add a zone nor count as
  // unknown -- either would break the claim for every journey on that line.
  const { rib, fact } = zoneCtx([conn(leg([null, true], [1, true], [2, true]))]);
  chk("the terminus-id defect row does not poison the route fact", fact().includes("ZVV all the way"), fact());
  chk("...and still no per-card rib for a single zone", rib(0) === "", rib(0));
}
{
  const { rib, fact } = zoneCtx([conn(leg([9, true]))]);
  chk("only-unresolved stops: silent, not 'no zones'", rib(0) === "" && fact() === "", rib(0));
}
{
  // Two options in DIFFERENT single zones: each card is one zone, but "X all
  // the way" is false for the list as a whole -- the fact must stay silent.
  const { fact } = zoneCtx([conn(leg([1, true], [2, true])), conn(leg([3, true]))]);
  chk("options in different zones: the route fact stays silent", fact() === "", fact());
}

// ---- the honesty boundary the zone claims must never cross ----
chk("the zone code never says 'valid'", !/valid/i.test(grab("connZoneRib") + grab("jrnZoneFact")),
  "naming zones is checkable; ticket validity is not, and a wrong yes costs a fine");

// ---- WIRING: anchored means ON THE RESULTS LIST, painted at the right moment ----
const renderSmart = grab("renderSmart");
chk("the settled render carries the last-way-home slot", renderSmart.includes('id="jlh"'));
chk("the slot + zone fact exist ONLY on the settled render", /searching\?[^:]*:jrnZoneFact\(\)\+`<div id="jlh">/.test(renderSmart),
  "a slot on the searching render would fetch once per phase, or paint into a node about to be replaced");
chk("connCard puts the zone rib on the card", /connZoneRib\(i\)/.test(grab("connCard")));
chk("connCard carries the per-card last-home slot", /class="jlhc" data-ci="\$\{i\}"/.test(grab("connCard")));
chk("smartPlan fires the fill after the settled render", /fillJourneyLastHome\(gen\)/.test(grab("smartPlan")),
  "an unfilled slot is the feature shipping green and never running");
const fill = grab("fillJourneyLastHome");
chk("the fill is barred from painting a superseded search", /gen!==jrnGen/.test(fill),
  "a stale last-way-home for the PREVIOUS route is worse than none");
chk("the fill's request dies with the search that spawned it", /jrnAbort/.test(fill),
  "zombie fetches from superseded sweeps jammed the connection pool once already");
chk("the fill counts the top line from the earliest displayed arrival", /reduce/.test(fill) && /_arr</.test(fill));
chk("the fill paints every per-card slot from the ONE query", /querySelectorAll\(".jlhc"\)/.test(fill) && /jlhCardRib\(/.test(fill),
  "per-card discrimination is the point: one query, local comparison per card");
chk("an outage paints no card slots", /homeConns===null\) return/.test(fill));
chk("a round trip to the same station asks nothing", /back===home/.test(fill));

// ---- the CSS the classes refer to ----
for (const c of ["jlh.ok", "jlh.none", "jlh.unk", "rib.vb", "jzf", "jlhc:empty"])
  chk(`.${c} has a rule`, new RegExp("\\." + c.replace(".", "\\.").replace(":", "\\:") + "\\{").test(src.replace(/\s+/g, "")),
    "class rendered but never styled");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
