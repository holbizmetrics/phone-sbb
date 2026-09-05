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
//   3. Fixing (1) made "no match" common: 9 of those 28 queries have no station
//      rows AT ALL, only addresses. The fallback offers the stations of the town
//      named in those addresses -- a guess, and measurably a wrong one for 1 of
//      the 7 it can make ("Jet d'Eau" -> Vuadens, 200 km off). It is defensible
//      only because the heading PRINTS the town, so a wrong guess is visible.
//      M6 in the mutation battery is what holds that line.
//   4. Caught while writing (3): adding message rows to the dropdown broke
//      acEnter, which selected every `div`. The message became row 0 with no
//      data-n, so Enter did nothing where it used to search the typed text.
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
// specimens below from answering each other's queries. locations() is a thin
// read of locRows(), so both come out of the source together.
const mkPair = (payload) => new Function("api", "locCache",
  `${grab("locRows")}\n${grab("locations")} return { locRows, locations };`)(payload, new Map());
const mkLoc = (payload) => mkPair(payload).locations;
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
    `${grab("locRows").replace("all.filter(x=>x.id)", "all")}\n${grab("locations")} return locations;`)(
      async () => ({ stations: [{ id: null, name: "A dentist" }] }), new Map());
  chk("PLANTED: the pre-fix filter (name only) really does let a non-station through",
    (await planted("zh hb")).length === 1,
    "the planted defect did not reproduce -- this control is not testing the filter");

  // The discarded rows are not merely discarded -- the fallback reads a town off them.
  const pair = mkPair(async () => ({ stations: [
    { id: null, name: "SRG SSR, Bern, Giacomettistr. 1" },
    { id: "8507000", name: "Bern" },
  ]}));
  const r = await pair.locRows("Bundeshaus");
  chk("locRows keeps the thrown-away rows separately, it does not just delete them",
    r.stations.length === 1 && r.dropped.length === 1, JSON.stringify(r));
}

// ---- townOf(): the guess, and the shapes it must REFUSE to guess from ----
{
  const townOf = new Function(`${grab("townOf")} return townOf;`)();
  chk("the town is read off an address row -- 'NAME, TOWN, STREET NR'",
    townOf([{ name: "SRG SSR, Bern, Giacomettistr. 1" }]) === "Bern",
    String(townOf([{ name: "SRG SSR, Bern, Giacomettistr. 1" }])));
  chk("a row that is not an address yields no town, rather than a wrong one",
    townOf([{ name: "Zürich, Hauptbahnhof " }]) === null,
    String(townOf([{ name: "Zürich, Hauptbahnhof " }])));
  chk("...and neither does nothing at all", townOf([]) === null && townOf(null) === null, "townOf invented a town from an empty list");
  chk("the first ADDRESS row wins even when a non-address row precedes it",
    townOf([{ name: "Zürich, Hauptbahnhof " }, { name: "Nails, Zürich, Zollstr. 59" }]) === "Zürich",
    String(townOf([{ name: "Zürich, Hauptbahnhof " }, { name: "Nails, Zürich, Zollstr. 59" }])));
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
// `rowsImpl` is the whole API surface wireAC needs: a query in, {stations,dropped}
// out. locations() is derived from it here exactly as app.js derives it, so a
// test can never disagree with the shipped file about what "a station" means.
async function typeInto(query, rowsImpl) {
  const inp = fakeEl("i"), ac = fakeEl("ac"), field = fakeEl("f");
  const els = { i: inp, ac: ac, f: field };
  const doc = { addEventListener: () => {} };
  // Memoised the way app.js memoises: one fetch per distinct query. Without this
  // the harness would report two lookups for a single keystroke (wireAC asks
  // locations() then locRows()) and no call-count check could mean anything.
  const cache = new Map();
  const locRows = async (q) => { if (!cache.has(q)) cache.set(q, await rowsImpl(q)); return cache.get(q); };
  const locations = async (q) => (await locRows(q)).stations;
  const fn = new Function("$", "debounce", "locations", "locRows", "townOf", "esc", "document", "nearMsg",
    "placeFromDropped", "placeTapped",
    `${grab("wireAC")} return wireAC;`)(
      (id) => els[id], (f) => f, locations, locRows,
      new Function(`${grab("townOf")} return townOf;`)(),
      new Function(`${grab("esc")} return esc;`)(),
      doc, new Function(`${grab("nearMsg")} return nearMsg;`)(),
      new Function(`${grab("placeFromDropped")} return placeFromDropped;`)(),
      // A SPY, not the real thing. Typing must never reach the geocoder --
      // Nominatim forbids autocomplete outright -- and this counter is the
      // behavioural half of that guard (place-to-stops.mjs holds the structural
      // half). If a future edit moves the lookup into the debounced handler,
      // this count stops being zero and the suite goes red.
      (...a) => { TAPPED.push(a); });
  fn("i", "ac", "f", () => {});
  inp.value = query;
  await inp.handlers.input();
  return ac;
}
const TAPPED = [];   // every placeTapped call the harness saw -- must stay empty while typing

// the common case: real stations, nothing discarded
const only = (stations) => async () => ({ stations, dropped: [] });

{
  const rows = await typeInto("Zürich", only([{ id: "8503000", name: "Zürich HB" }]));
  chk("a real match still renders a tappable row", /data-n="Zürich HB"/.test(rows.innerHTML), rows.innerHTML);
  chk("...and says nothing extra when it found something", !/nearmsg/.test(rows.innerHTML), rows.innerHTML);

  const none = await typeInto("qxzvwqbbzz", only([]));
  chk("nothing matched -> the app SAYS so instead of hiding the box",
    /nearmsg/.test(none.innerHTML) && /No station matches/i.test(none.innerHTML), none.innerHTML);
  chk("...and the dropdown is actually on screen to be read",
    none.classes.has("show"), [...none.classes].join(","));
  chk("...and it quotes what you typed back at you",
    /qxzvwqbbzz/.test(none.innerHTML), none.innerHTML);
  chk("...and the query is escaped, not injected",
    !/<b>/.test((await typeInto("<b>x</b>", only([]))).innerHTML), "raw HTML from the input box reached the DOM");

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

// ---- the town fallback: a guess the passenger can see ----
// Modelled on the real 2026-07-31 measurement: "Bundeshaus" has no station rows
// at all, only addresses, and the top one is in Bern.
{
  const bundeshaus = async (q) => q.toLowerCase() === "bundeshaus"
    ? { stations: [], dropped: [{ name: "SRG SSR, Bern, Giacomettistr. 1" }] }
    : { stations: [{ id: "8507000", name: "Bern" }, { id: "8576646", name: "Bern, Bahnhof" }], dropped: [] };

  const fb = await typeInto("Bundeshaus", bundeshaus);
  chk("no station, but an address in a town -> that town's stations are offered",
    /data-n="Bern"/.test(fb.innerHTML) && /data-n="Bern, Bahnhof"/.test(fb.innerHTML), fb.innerHTML);
  chk("...and the guess NAMES the town, so a wrong one can be rejected on sight",
    /closest address match is in Bern/i.test(fb.innerHTML), fb.innerHTML);
  chk("...and still says plainly that the thing you typed is not a station",
    /No station called .{0,8}Bundeshaus/i.test(fb.innerHTML), fb.innerHTML);
  chk("...and the heading is a message row, not a tappable station",
    /class="nearmsg"/.test(fb.innerHTML) && fb.children.every(c => !/address match/.test(c.dataset.n)), fb.innerHTML);
  /* NEW 2026-09-05. The dropped row carries a street address, and until now the
     only thing read out of it was the town -- so a shop name got you the town's
     FAMOUS stations, which may be nowhere near the door. The address is now
     offered as its own tappable row. It is deliberately NOT a `data-n` station
     row: tapping it does not pick a destination, it starts a lookup. */
  chk("...and the ADDRESS itself is offered as its own row, not just the town",
    /class="placerow"/.test(fb.innerHTML) && /Giacomettistr\. 1/.test(fb.innerHTML), fb.innerHTML);
  chk("...which says what tapping it will do, since it is the one row that reaches a third-party map",
    /find the stops near this address/.test(fb.innerHTML), fb.innerHTML);
  chk("...and it is NOT a selectable station row -- tapping it looks up, it does not choose",
    fb.children.every(c => !(c.dataset.n && /Giacomettistr/.test(c.dataset.n))), fb.innerHTML);
  chk("TYPING NEVER GEOCODES -- Nominatim forbids autocomplete, and this is the behavioural guard",
    TAPPED.length === 0, `placeTapped was called ${TAPPED.length} time(s) during typing`);

  // NEGATIVE TWIN: with no address to read a town off there is nothing to offer,
  // and the app must go back to saying so rather than inventing a town.
  let ntCalls = 0;
  const noTown = await typeInto("qxzvwqbbzz", async () => {
    ntCalls++; return { stations: [], dropped: [{ name: "Zürich, Hauptbahnhof " }] };
  });
  chk("an unparseable dropped row produces the honest no-match, not a fallback",
    /No station matches/i.test(noTown.innerHTML) && !/data-n=/.test(noTown.innerHTML), noTown.innerHTML);
  chk("...and a town that could not be read is never itself looked up",
    ntCalls === 1, `issued ${ntCalls} lookups, so a null town reached the API`);

  // The fallback must not re-ask a question it just got the answer to. Counting
  // lookups is the only way to see this: the second call returns the same empty
  // list either way, so the OUTPUT is identical and only the traffic differs.
  let calls = 0;
  const selfTown = await typeInto("Bern", async () => {
    calls++; return { stations: [], dropped: [{ name: "Something, Bern, Gasse 1" }] };
  });
  chk("a town identical to the query is not looked up a second time",
    calls === 1, `issued ${calls} lookups for the same string`);
  /* CONTRACT CHANGED 2026-09-05, deliberately. This case used to end at "No
     station matches" because the town lookup came back empty and there was
     nothing else to say. There is now something else to say: the dropped row
     carries "Something, Bern, Gasse 1", and that address is offerable even when
     the town has no stations to list. What must NOT change is that no station
     row is invented -- so the `data-n` assertion stands unaltered. */
  chk("...still invents no station row when the town lookup came back empty",
    !/data-n=/.test(selfTown.innerHTML), selfTown.innerHTML);
  chk("...and says plainly that what you typed is not a station",
    /No station called/i.test(selfTown.innerHTML), selfTown.innerHTML);
  chk("...but now offers the address instead of dead-ending",
    /class="placerow"/.test(selfTown.innerHTML) && /Gasse 1/.test(selfTown.innerHTML), selfTown.innerHTML);

  // ...but a town differing only in CASE is a different question, and is asked.
  const cased = await typeInto("bern", async (q) => q === "bern"
    ? { stations: [], dropped: [{ name: "Something, Bern, Gasse 1" }] }
    : { stations: [{ id: "8507000", name: "Bern" }], dropped: [] });
  chk("a town differing only in case IS looked up -- that is a rescue, not a repeat",
    /data-n="Bern"/.test(cased.innerHTML), cased.innerHTML);
}

// ---- acEnter: message rows are not selectable ----
// Regression shipped 2026-07-31 with the no-match message and caught the same
// day: acEnter matched every `div`, so the message became row 0, its dataset.n
// was undefined, and Enter did NOTHING. Before the message existed the box was
// hidden, so Enter fell through to searching the literal typed text -- which is
// what must still happen.
function pressEnter(html, typed) {
  const ac = fakeEl("ac"), inp = fakeEl("i");
  ac.innerHTML = html; ac.dataset.q = typed; ac.classes.add("show");
  inp.value = typed; inp.blur = () => {};
  const cls = () => ({ contains: () => false, add: () => {}, remove: () => {} });
  // Honour the real selector: `div` matches the message too, `div[data-n]` does
  // not. If this harness ignored the selector it would hide the very defect.
  const msgs = [...html.matchAll(/<div class="nearmsg"/g)].map(() => ({ dataset: {}, classList: cls() }));
  const rows = ac.children.map(c => ({ dataset: c.dataset, classList: cls() }));
  ac.querySelectorAll = (sel) => sel === "div[data-n]" ? rows : [...msgs, ...rows];
  let picked = null;
  const els = { i: inp, ac };
  new Function("$", `${grab("acEnter")} return acEnter;`)((id) => els[id])("i", "ac", (n) => { picked = n; });
  inp.handlers.keydown({ key: "Enter", preventDefault: () => {} });
  return picked;
}
{
  chk("Enter on a no-match message searches what you typed, instead of doing nothing",
    pressEnter(`<div class="nearmsg">No station matches Bundeshaus.</div>`, "Bundeshaus") === "Bundeshaus",
    String(pressEnter(`<div class="nearmsg">x</div>`, "Bundeshaus")));
  chk("control: Enter on a REAL row still takes the row, not the typed text",
    pressEnter(`<div data-n="Zürich HB"></div>`, "Zürich") === "Zürich HB",
    String(pressEnter(`<div data-n="Zürich HB"></div>`, "Zürich")));
  chk("...and a fallback heading above real rows does not steal the Enter",
    pressEnter(`<div class="nearmsg">in Bern</div><div data-n="Bern"></div>`, "Bundeshaus") === "Bern",
    String(pressEnter(`<div class="nearmsg">in Bern</div><div data-n="Bern"></div>`, "Bundeshaus")));

  // PLANTED: with the pre-fix selector the message IS row 0 and Enter dies.
  const planted = grab("acEnter").replace('"div[data-n]"', '"div"');
  const run = (html, typed) => {
    const ac = fakeEl("ac"), inp = fakeEl("i");
    ac.innerHTML = html; ac.dataset.q = typed; ac.classes.add("show");
    inp.value = typed; inp.blur = () => {};
    const cls = () => ({ contains: () => false, add: () => {}, remove: () => {} });
    ac.querySelectorAll = () => [{ dataset: {}, classList: cls() }];
    let picked = null; const els = { i: inp, ac };
    new Function("$", `${planted} return acEnter;`)((id) => els[id])("i", "ac", (n) => { picked = n; });
    inp.handlers.keydown({ key: "Enter", preventDefault: () => {} });
    return picked;
  };
  chk("PLANTED: the pre-fix selector really does swallow the Enter",
    run(`<div class="nearmsg">No station matches.</div>`, "Bundeshaus") === null,
    "the planted regression did not reproduce -- the check above proves nothing");
}

// ---- wiring: the fix has to be in the shipped file, not only in this harness ----
{
  chk("the shipped locRows() splits on id, so locations() cannot return a non-station",
    /const all = \(d\.stations\|\|\[\]\)\.filter\(x=>x\.name\);/.test(src)
    && /stations: all\.filter\(x=>x\.id\)/.test(src), "locRows() is not id-split in app.js");
  const wa = grab("wireAC");
  chk("control: extracted wireAC, not an empty slice", wa.length > 400 && wa.includes("locations("), `len=${wa.length}`);
  chk("wireAC no longer has a branch that only hides the box and says nothing",
    !/if\(!s\.length\)\{ ac\.classList\.remove\("show"\); return; \}/.test(wa), wa);
  chk("the shipped acEnter selects only rows that carry a station name",
    /querySelectorAll\("div\[data-n\]"\)/.test(grab("acEnter")), "acEnter still matches every div");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
