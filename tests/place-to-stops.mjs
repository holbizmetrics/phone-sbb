// A place is not a station, but it has an address.
//
// The corpus is built around the four ways this feature betrays you:
//
//  * it fires on every keystroke, which is the use Nominatim EXPLICITLY forbids
//    ("you must not implement such a service") and gets the app banned. This is
//    the load-bearing test, and it is structural: wireAC's body must never call
//    the geocoder, because the dropped row it reads is computed right there and
//    putting the call at that spot is the obvious implementation.
//  * "the map knew nothing" and "the request failed" collapse into one message,
//    which is absence-of-data rendered as data -- this file's oldest defect.
//  * a row with no street address is offered and then fails at tap time.
//  * it re-requests what it already asked.
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  let i = src.indexOf("async function " + n + "(");
  if (i < 0) i = src.indexOf("function " + n + "(");
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

// ---- THE POLICY GUARD ------------------------------------------------------
// Nominatim forbids autocomplete. wireAC runs on every debounced keystroke.
// So the geocoder must be unreachable from wireAC's own body.
{
  // Comments are stripped first. The block comment above this feature NAMES
  // Nominatim on purpose -- documenting the policy is not calling the geocoder,
  // and a scan that cannot tell those apart would punish the documentation.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, " ");
  const wire = strip(grab("wireAC"));
  chk("wireAC NEVER calls the geocoder -- autocomplete geocoding is forbidden by the usage policy and would get the app banned",
    !/geocodePlace\s*\(/.test(wire), "wireAC references geocodePlace directly");
  chk("wireAC does not fetch Nominatim by any other spelling",
    !/nominatim/i.test(wire) && !/NOMINATIM/.test(wire));
  chk("the geocode lives behind the tap handler instead",
    /geocodePlace\s*\(/.test(grab("placeTapped")));
  chk("...and wireAC reaches it only through that handler",
    /placeTapped\s*\(/.test(wire));
  chk("the tap handler is bound to a click, not to input",
    /prow\.onclick\s*=/.test(wire) && !/addEventListener\(\s*["']input["']\s*,\s*[^)]*placeTapped/.test(wire));
  // The control: this scan can see calls that ARE there, so a green above is not
  // a green because the regex is broken.
  chk("CONTROL -- the same scan does find the calls wireAC really makes",
    /locRows\s*\(/.test(wire) && /placeFromDropped\s*\(/.test(wire));
}

// ---- placeFromDropped: only rows that actually carry an address ------------
{
  const pick = new Function(`${grab("placeFromDropped")} return placeFromDropped;`)();
  const p = pick([
    { name: "Bundeshaus" },                                   // 1 field: no address
    { name: "Promusig AG, Zürich, Sihlfeldstr. 138" },        // 3 fields: usable
  ]);
  chk("a row with a street address is chosen", p && p.label === "Promusig AG", JSON.stringify(p));
  chk("its town is the second-to-last field", p.town === "Zürich", p.town);
  chk("its address is the last field", p.addr === "Sihlfeldstr. 138", p.addr);
  /* This assertion was BACKWARDS on its first writing, and only running the real
     chain caught it. The stubbed fetch was happy to "geocode" the full row; live
     Nominatim returns nothing for it. Measured on two specimens, both directions
     -- see the comment in placeFromDropped. */
  chk("the geocoded string is street-then-town, NOT the row as it arrived -- the business name in front defeats the parser",
    p.query === "Sihlfeldstr. 138, Zürich", p.query);
  chk("...and the label is still the human name, so the row reads as the place you typed",
    p.label === "Promusig AG", p.label);
  chk("a bare name is NOT offered -- offering it would fail at tap time instead of now",
    pick([{ name: "Bundeshaus" }]) === null);
  chk("two fields is still not an address", pick([{ name: "Foo, Bern" }]) === null);
  chk("no rows -> null, not a throw", pick([]) === null && pick(null) === null);
}

// ---- geocodePlace: nothing-found and request-failed are DIFFERENT ----------
// The endpoint constant is lifted from the SOURCE, not restated here. A test
// that carries its own copy of the URL asserts against itself, and would stay
// green if the shipped app were repointed at another host tomorrow.
const NOMINATIM_LINE = (src.match(/^const NOMINATIM\s*=.*$/m) || [])[0];
if (!NOMINATIM_LINE) throw new Error("HARNESS FAILED -- the NOMINATIM constant is gone from app.js");
const mkGeo = (fetchStub) => new Function("fetch",
  `${NOMINATIM_LINE} const placeCache = new Map(); ${grab("geocodePlace")} return geocodePlace;`)(fetchStub);
{
  const urls = [];
  const geo = mkGeo(async (u) => { urls.push(u); return { ok: true, json: async () => [{ lat: "47.3790894", lon: "8.5162093" }] }; });
  const hit = await geo("Promusig AG, Zürich, Sihlfeldstr. 138");
  chk("coordinates come back as numbers", hit.lat === 47.3790894 && hit.lon === 8.5162093, JSON.stringify(hit));
  chk("the request goes to Nominatim with limit=1", /nominatim\.openstreetmap\.org/.test(urls[0]) && /limit=1/.test(urls[0]), urls[0]);
  chk("the query is URL-encoded", /q=Promusig\+AG%2C|q=Promusig%20AG%2C/.test(urls[0]), urls[0]);
  await geo("Promusig AG, Zürich, Sihlfeldstr. 138");
  chk("a repeat is served from cache -- one tap, one request", urls.length === 1, String(urls.length));
}
{
  const geo = mkGeo(async () => ({ ok: true, json: async () => [] }));
  chk("geocoder answered and knew nothing -> null (a fact, not an error)", (await geo("nowhere at all")) === null);
}
{
  let threw = null;
  const geo = mkGeo(async () => ({ ok: false, status: 429, json: async () => [] }));
  try { await geo("rate limited"); } catch (e) { threw = e.message; }
  chk("a FAILED request throws instead of returning null -- collapsing them would render an outage as 'address unknown'",
    threw === "HTTP 429", String(threw));
}
{
  const geo = mkGeo(async () => ({ ok: true, json: async () => [{ lat: "not-a-number", lon: "8.5" }] }));
  chk("a non-numeric coordinate is not a hit", (await geo("garbage")) === null);
}

// ---- the two failure messages must not be the same wording -----------------
{
  const tap = grab("placeTapped");
  chk("the outage message says it is NOT 'address unknown'", /not &#8220;address unknown&#8221;|not .address unknown./.test(tap));
  chk("the not-found message names the address the map lacked", /does not know \$\{esc\(place\.addr\)\}/.test(tap));
  chk("a failed STOP lookup is its own message, distinct from both",
    /stop lookup failed/i.test(tap));
  chk("distance is printed rather than decided on -- nearest is not always best served",
    /pdist/.test(tap) && /x\.distance/.test(tap));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
