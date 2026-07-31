// The TYPED station lookup -- the path everybody actually uses, and the one
// that had no suite at all until 2026-07-31.
//
// Two defects are pinned here, both of the same family: the app knowing
// something on one path and not on the path the user is on.
//
//   1. `locations()` kept API rows with `id: null` -- businesses, hotels, street
//      addresses, city quarters -- and rendered them as tappable suggestions with
//      the station glyph. `nearbyStops()`, in the same file, has always dropped
//      exactly those. Measured across 28 specimens in
//      tests/passengers/probe-phrasing.py: 9 of them showed seven non-stations
//      and nothing else.
//   2. Both the empty case and the THROWN case hid the dropdown and said nothing.
//      Those are different facts and must not render the same, or a dead request
//      reads as "no such station" -- the 429 bug of the night before, one screen
//      over.
//
// Every positive check below has a negative twin: a check that only ever comes
// back "yes" has been shown to run, not to work.
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

// ---- locations(): only rows that are somewhere a train stops ----
// locCache is a module-level Map in app.js; a fresh one per extraction keeps the
// specimens below from answering each other's queries.
const mkLoc = (payload) => new Function("api", "locCache", `${grab("locations")} return locations;`)(payload, new Map());
{
  const loc = mkLoc(async () => ({ stations: [
    { id: null,       name: "Orell Füssli Zürich Hauptbahnhof, Zürich, Bahnhofplatz 1" },
    { id: null,       name: "Zürich, Hauptbahnhof " },   // reads like a stop, carries no id
    { id: "8503000",  name: "Zürich HB" },
    { id: null,       name: "My Nice Nails" },
    { id: "8503006",  name: "Zürich Oerlikon" },
    { id: "8503020",  name: null },                       // no name: dropped by the old rule too
  ]}));
  const s = await loc("Zürich Hauptbahnhof");
  chk("businesses and id-less look-alikes are dropped -- a bookshop is not a station",
    s.every(x => x.id && x.name), JSON.stringify(s.map(x => x.name)));
  chk("...and the real stations survive the filter",
    s.map(x => x.name).join("|") === "Zürich HB|Zürich Oerlikon", JSON.stringify(s.map(x => x.name)));

  // NEGATIVE TWIN: the same corpus with ids attached must NOT be filtered, or the
  // check above would pass on a function that simply returns nothing.
  const loose = mkLoc(async () => ({ stations: [
    { id: "1", name: "A" }, { id: "2", name: "B" },
  ]}));
  chk("control: rows that ARE stations are not thrown away too",
    (await loose("x")).length === 2, "the filter is eating real stops");

  // PLANTED: the exact shape of the defect that shipped -- id:null present and kept.
  const planted = new Function("api", "locCache",
    `${grab("locations").replace("x.id&&x.name", "x.name")} return locations;`)(
      async () => ({ stations: [{ id: null, name: "A dentist" }] }), new Map());
  chk("PLANTED: the pre-fix filter (name only) really does let a non-station through",
    (await planted("zh hb")).length === 1,
    "the planted defect did not reproduce -- this control is not testing the filter");
}

// ---- wireAC: silence is not an answer ----
function fakeEl(id) {
  const o = { id, value: "", classes: new Set(), children: [], _html: "" };
  o.classList = {
    add: c => o.classes.add(c), remove: c => o.classes.delete(c), contains: c => o.classes.has(c),
    toggle: (c, on) => (on ? o.classes.add(c) : o.classes.delete(c)),
  };
  o.contains = () => false;
  o.dataset = {};
  o.handlers = {};
  o.addEventListener = (ev, fn) => { o.handlers[ev] = fn; };
  Object.defineProperty(o, "innerHTML", {
    get: () => o._html,
    set: (v) => { o._html = v; o.children = [...v.matchAll(/data-n="([^"]*)"/g)].map(m => ({ dataset: { n: m[1] }, onclick: null })); },
  });
  return o;
}

// debounce is stubbed to fire immediately: the 300 ms wait is not what is under
// test here and would only make the suite slow. Everything else -- wireAC,
// nearMsg, esc -- is the real source.
async function typeInto(query, locImpl) {
  const inp = fakeEl("i"), ac = fakeEl("ac"), field = fakeEl("f");
  const els = { i: inp, ac: ac, f: field };
  const doc = { addEventListener: () => {} };
  const fn = new Function("$", "debounce", "locations", "esc", "document", "nearMsg",
    `${grab("wireAC")} return wireAC;`)(
      (id) => els[id], (f) => f, locImpl, new Function(`${grab("esc")} return esc;`)(),
      doc, new Function(`${grab("nearMsg")} return nearMsg;`)());
  fn("i", "ac", "f", () => {});
  inp.value = query;
  await inp.handlers.input();
  return ac;
}

{
  const rows = await typeInto("Zürich", async () => [{ id: "8503000", name: "Zürich HB" }]);
  chk("a real match still renders a tappable row", /data-n="Zürich HB"/.test(rows.innerHTML), rows.innerHTML);
  chk("...and says nothing extra when it found something", !/nearmsg/.test(rows.innerHTML), rows.innerHTML);

  const none = await typeInto("qxzvwqbbzz", async () => []);
  chk("nothing matched -> the app SAYS so instead of hiding the box",
    /nearmsg/.test(none.innerHTML) && /No station matches/i.test(none.innerHTML), none.innerHTML);
  chk("...and the dropdown is actually on screen to be read",
    none.classes.has("show"), [...none.classes].join(","));
  chk("...and it quotes what you typed back at you",
    /qxzvwqbbzz/.test(none.innerHTML), none.innerHTML);
  chk("...and the query is escaped, not injected",
    !/<b>/.test((await typeInto("<b>x</b>", async () => [])).innerHTML), "raw HTML from the input box reached the DOM");

  const dead = await typeInto("Bern", async () => { throw new Error("network down"); });
  chk("a lookup that THREW does not claim there is no such station",
    !/No station matches/i.test(dead.innerHTML), dead.innerHTML);
  chk("...it says the lookup failed, and says it out loud",
    /nearmsg/.test(dead.innerHTML) && /lookup failed/i.test(dead.innerHTML), dead.innerHTML);
  chk("...and calls it explicitly not a no-match, because that is the confusable one",
    /not a .{0,12}no match/i.test(dead.innerHTML), dead.innerHTML);

  const limited = await typeInto("Bern", async () => { throw new Error("HTTP 429"); });
  chk("a rate limit is named as a rate limit, not as a broken lookup",
    /too many searches/i.test(limited.innerHTML), limited.innerHTML);
  chk("...and a rate limit is not reported as 'no station matches' either",
    !/No station matches/i.test(limited.innerHTML), limited.innerHTML);

  const short = await typeInto("Z", async () => { throw new Error("must not be called"); });
  chk("one character says nothing at all -- a message on every keystroke is noise",
    short.innerHTML === "" && !short.classes.has("show"), short.innerHTML);
}

// ---- wiring: the fix has to be in the shipped file, not only in this harness ----
{
  chk("the shipped locations() filters on id, not on name alone",
    /\(d\.stations\|\|\[\]\)\.filter\(x=>x\.id&&x\.name\)/.test(src),
    "locations() is not id-filtered in app.js");
  const wa = grab("wireAC");
  chk("control: extracted wireAC, not an empty slice", wa.length > 400 && wa.includes("locations("), `len=${wa.length}`);
  chk("wireAC no longer has a branch that only hides the box and says nothing",
    !/if\(!s\.length\)\{ ac\.classList\.remove\("show"\); return; \}/.test(wa), wa);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
