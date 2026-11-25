// Runs the REAL toilet functions out of the assembled app. No browser needed.
// Defended: the label says only what OSM tags say (no "free"/"accessible" by
// default), the Overpass query asks for the right thing, and the expander is
// wired into the three places that have a coordinate.
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  const start = src.slice(Math.max(0, i - 6), i) === "async " ? i - 6 : i;
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(start, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const captured = [];
const T = new Function("overpassQuery", `
  const CP=c=>String.fromCodePoint(c);
  ${grab("esc")}
  ${grab("toiletMeta")}
  ${grab("toiletName")}
  ${grab("overpassToilets")}
  ${grab("toiletsExpanderHTML")}
  return { toiletMeta, toiletName, overpassToilets, toiletsExpanderHTML };
`)((key, q) => { captured.push({ key, q }); return Promise.resolve([]); });

// control: an empty tag set yields an EMPTY line, so a positive below cannot be a default
chk("control: no tags -> no label", T.toiletMeta({}) === "" && T.toiletMeta(undefined) === "");

chk("fee=yes -> 'fee'", T.toiletMeta({ fee: "yes" }) === "fee");
chk("fee=yes with charge -> the amount", T.toiletMeta({ fee: "yes", charge: "1 CHF" }) === "fee 1 CHF");
chk("fee=no -> 'free'", T.toiletMeta({ fee: "no" }) === "free");
chk("wheelchair=yes -> tick", T.toiletMeta({ wheelchair: "yes" }).includes("wheelchair ✓"));
chk("wheelchair=limited -> says limited", T.toiletMeta({ wheelchair: "limited" }) === "wheelchair limited");
chk("wheelchair=no -> says no access", T.toiletMeta({ wheelchair: "no" }) === "no wheelchair access");
chk("access=customers -> flagged", T.toiletMeta({ access: "customers" }) === "customers only");
chk("opening hours pass through", T.toiletMeta({ opening_hours: "05:00-24:00" }) === "05:00-24:00");
chk("several tags join with a middle dot in a fixed order",
  T.toiletMeta({ opening_hours: "24/7", wheelchair: "yes", fee: "no" }) === "free · wheelchair ✓ · 24/7");

chk("name wins", T.toiletName({ name: "WC Gleis 4", operator: "SBB" }) === "WC Gleis 4");
chk("operator fallback", T.toiletName({ operator: "SBB" }) === "SBB toilets");
chk("anonymous fallback", T.toiletName({}) === "Public toilets");

// the query
T.overpassToilets(46.949, 7.439);
chk("query asks for amenity=toilets, nodes and ways, within 500 m", captured.length === 1 && /node\(around:500,46\.949,7\.439\)\[amenity=toilets\]/.test(captured[0].q) && /way\(around:500/.test(captured[0].q), captured[0]?.q);
chk("query cache key is namespaced so it cannot collide with the wonders lookup at the same spot", captured[0].key.startsWith("wc:"));

// the expander
chk("no coordinate -> no expander", T.toiletsExpanderHTML(null) === "" && T.toiletsExpanderHTML({ name: "Bern" }) === "");
const html = T.toiletsExpanderHTML({ name: "Bern <b>", coordinate: { x: 46.949, y: 7.439 } });
chk("expander names the place, escaped, and wires loadToilets with lat,lon", html.includes("Toilets near Bern &lt;b&gt;") && html.includes("loadToilets(this,46.949,7.439)"), html);

// wiring: the three places that have a coordinate
chk("board render carries the expander", grab("loadBoard").includes("toiletsExpanderHTML(d.station)"));
chk("plain plan carries the expander", grab("plainPlan").includes("toiletsExpanderHTML("));
chk("smart settled render carries the expander", grab("renderSmart").includes("toiletsExpanderHTML("));
chk("OSM failure un-loads BOTH panels so 'tap again' can work", grab("loadToilets").includes('wrap.dataset.loaded=""') && grab("loadWonders").includes('wrap.dataset.loaded=""'));
chk("help sheet explains the new control", /Toilets near/.test(src.slice(0, src.indexOf("<script>"))), "no help row for a new visible control");
chk("every OSM feature goes through the one shared client", (src.match(/overpassQuery\(/g) || []).length === 5, "expected 1 definition + 4 callers (wonders, en-route, layover step-out, toilets)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
