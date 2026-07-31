// The five passenger axes and their adjudications. A passenger is a test case
// WITH ground truth; this file IS that ground truth, so the honesty rule is
// strict: a status is only written here with named evidence (a specimen run,
// a shipped feature, or a policy refusal decided on the record). Everything
// else is UNADJUDICATED -- explicitly unknown, never guessed. The sweep's
// first job is to burn that list down, not to look green.
//
// Statuses:
//   SERVED        the app handles the value, evidence named
//   PARTIAL       part of the need is met, the silently-dropped part is named
//   REFUSED       policy: the app deliberately does not claim this (see refusals.json)
//   LEFT_BEHIND   a real traveller with this value is failed, evidence named
//   UNADJUDICATED nobody has checked; the sweep reports it as a worklist item
//
// step: where the traveller falls off -- input | plan | decide | ride

export const AXES = {
  who: ["commuter", "retiree-halbtax", "parent-pram", "tourist-foreign", "teen",
        "wheelchair-user", "night-shift-worker", "hiker", "business-traveller", "student"],
  purpose: ["meet-flight", "work-commute", "day-trip", "scenic-ride", "last-train-home",
            "hospital-appointment", "concert", "international-connection", "shopping", "visiting-friend"],
  constraints: ["arrive-by-time", "foreign-tz-time", "relative-date-phrase", "future-origin-not-here",
                "needs-food-en-route", "needs-toilet-en-route", "heavy-luggage", "bike-carriage",
                "cheapest-fare", "step-free"],
  conditions: ["normal", "delay-50min", "api-outage", "last-service-passed", "midnight-crossing",
               "weekend-schedule", "holiday-schedule", "storm-weather", "replacement-bus", "crowded"],
  phrasing: ["exact-station-names", "hb-airport-conflation", "misspelled-station", "colloquial-place",
             "landmark-not-station", "foreign-language", "abbreviation", "zip-code", "gps-here", "ambiguous-city"],
};

// evidence tags: harold-N = specimen #1 finding N (bus msg 87102361);
// policy-w30 = refusal decided week of 2026-07-27; feature = shipped + tested in repo.
export const ADJUDICATIONS = {
  // Re-adjudicated 2026-07-30. These three were flagged in the part-2 bus report
  // as the rows most likely to be stale next -- oldest absence claims, no
  // freshness contract of any kind, and explicitly unverified. Checked by hand,
  // which is the only way: all three are PROSE absences, and the absence-rot
  // check only resolves the `no <suite-name>` form. Two of the three had moved.
  //
  // (1) The input half was REAL and is now fixed. The planner seed, the flight
  // seed and the pager anchor all wrote the DEVICE wall clock into a field the
  // API reads as Swiss -- 3h30 wrong in Mumbai, the wrong DAY in Auckland,
  // and self-consistent in Zurich, which is why it survived. swissLocal() is
  // now the single datetime-local boundary; tests/tz-input.mjs, 42 checks over
  // six zones and both DST offsets, 5/5 mutations caught. PARTIAL and not
  // SERVED on purpose: the sunset roll-to-tomorrow still compares a Swiss
  // forecast time against the device clock (named residual, asserted in that
  // suite so it cannot be forgotten), and the field carries no zone label of
  // its own -- it leans on tzNoteHTML's sentence elsewhere on screen.
  "constraints/foreign-tz-time":      { status: "PARTIAL",     step: "input",  evidence: "fixed 2026-07-30: swissLocal() is the one datetime-local boundary, all three field writers Swiss (tz-input.mjs); residual = the sunset roll still reads the device clock, and the field has no zone label" },
  // (2) ROTTED, and in the direction the framework predicts: the row cited an
  // absence ("nor a stored place") that the app has since filled. Route history
  // stores six routes, direction-distinct, recorded automatically, and one tap
  // fills BOTH fields and re-plans (route-history.mjs) -- so an origin that is
  // not here-now is a tap, and a future day is the datetime-local picker.
  // PARTIAL, not SERVED: the two halves must still be combined by hand, and a
  // route chip is a PAIR, not a named place -- there is no "work" to say.
  "constraints/future-origin-not-here": { status: "PARTIAL",   step: "input", evidence: "route history: 6 stored routes, one tap fills from+to and re-plans (route-history.mjs), future day via the datetime-local picker; residual = no NAMED place, and the day must be set separately" },
  // (3) NOT re-adjudicated, because ruling it means deciding what the row is
  // ABOUT, and that is the operator's call rather than mine. Read as phrasing,
  // it is untouched: nothing anywhere parses "this Thursday", so LEFT_BEHIND
  // stands. Read as the underlying need -- plan this trip for a named future
  // day -- it has moved twice: the datetime-local picker takes any date, and
  // the summit day strip turns a weekday into one tap (planForDay, app.js).
  // The ambiguity is structural: this row sits on the `constraints` axis while
  // its evidence is a sentence about PARSING, and the table has a `phrasing`
  // axis. A row whose axis makes its subject ambiguous can be read as rotted or
  // as fresh at will, which is a third staleness shape worth naming.
  // Operator asked 2026-07-30, answered "I do not know right now" -- which is a
  // legitimate state and the table had nowhere to put it. A comment was the only
  // record, and a comment is what rots. So the not-knowing is now DATA:
  // `openQuestion` pins the status the question was raised against, and the sweep
  // fails if the row is ruled without the question being retired in the same
  // edit. The row cannot drift to resolved; it can only be decided.
  "constraints/relative-date-phrase": { status: "LEFT_BEHIND", step: "input",  evidence: "harold-5: 'this Thursday' not parsed -- still literally true; but see the note above: the NEED is now served by the date picker and the summit day strip, and which of the two this row means is unruled",
    openQuestion: { raisedAgainst: "LEFT_BEHIND", asked: "2026-07-30",
      question: "Does this row mean the PHRASE (nothing parses 'this Thursday' -- LEFT_BEHIND stands) or the NEED (plan a trip for a named future day -- served twice, by the datetime-local picker and the summit day strip)? The row sits on `constraints` while its evidence is a sentence about parsing, and there is a `phrasing` axis. Deciding it may mean splitting it into two rows, one per axis." } },
  "purpose/meet-flight":              { status: "PARTIAL",     step: "decide", evidence: "harold-3: landing time != meeting time (bags/passport/walk-out unmodelled)" },
  "constraints/needs-food-en-route":  { status: "PARTIAL",     step: "decide", evidence: "harold-4: gap mechanic shows which change has slack; no POI claim" },
  "constraints/needs-toilet-en-route":{ status: "PARTIAL",     step: "decide", evidence: "harold-4: same gap mechanic, same missing POI residual" },
  "constraints/step-free":            { status: "REFUSED",     step: "plan",   evidence: "policy-w30: no data source the app can verify" },
  "constraints/cheapest-fare":        { status: "REFUSED",     step: "decide", evidence: "policy-w30: fares-as-prices refused; zone NAMES are shipped instead" },
  "conditions/crowded":               { status: "REFUSED",     step: "decide", evidence: "policy-w30: occupancy refused" },
  "who/parent-pram":                  { status: "REFUSED",     step: "plan",   evidence: "policy-w30: step-free class; must score REFUSED not FAILED" },
  "who/wheelchair-user":              { status: "REFUSED",     step: "plan",   evidence: "policy-w30: step-free class" },
  "conditions/api-outage":            { status: "SERVED",      step: "plan",   evidence: "feature: three-outcome honesty (outage-not-verdict.mjs, journey-anchor.mjs)" },
  "conditions/last-service-passed":   { status: "SERVED",      step: "decide", evidence: "feature: last-way-home line + stranding rib (journey-anchor.mjs)" },
  "purpose/last-train-home":          { status: "SERVED",      step: "decide", evidence: "feature: jlh top line + per-card rib, 1625cbe" },
  "purpose/scenic-ride":              { status: "SERVED",      step: "plan",   evidence: "feature: scenic prefer-toggle + zone facts" },
  // Re-adjudicated 2026-07-29, forced by the absence-rot check in passenger-sweep:
  // this row cited an absence that had since been filled. replanFromStop plus the
  // missed-change obverdict serve the recover half; the residual is that the app
  // never offers the replan unprompted -- the passenger must notice first. So
  // PARTIAL, deliberately not SERVED: half a rescue is not a rescue.
  "conditions/delay-50min":           { status: "PARTIAL",     step: "ride",   evidence: "register-2.1 half-built: replanFromStop from a named stop (replan-from-here.mjs); residual = never offered unprompted" },
  // Operator-adjudicated 2026-07-30. Surfaced by the absence-rot pass as the
  // opposite kind of staleness: not a rotted row, a MISSING one -- a value the
  // app plainly serves that the table had never ruled on, so every passenger
  // carrying it scored UNADJUDICATED.
  "constraints/arrive-by-time":        { status: "SERVED",      step: "plan",   evidence: "feature: segArr + isArrivalTime=1 on the query, and the earlier/later pager walks arrivals on their own axis rather than silently becoming a departure question (pager.mjs)" },
  "phrasing/exact-station-names":     { status: "SERVED",      step: "input",  evidence: "feature: the baseline the whole suite exercises" },
  "conditions/normal":                { status: "SERVED",      step: "plan",   evidence: "feature: the baseline the whole suite exercises" },

  // ---- phrasing axis, adjudicated 2026-07-31 (9 rows, the whole worklist) ----
  //
  // Measured, not reasoned: `tests/passengers/probe-phrasing.py` ->
  // `phrasing-evidence.json`, 28 specimens + a no-match control, run serially
  // against the live API. The app does NO fuzzy matching of its own -- wireAC
  // hands the raw box text to /locations?type=station&query= and renders the
  // top 7 -- so on this axis the API's answer IS the app's answer.
  //
  // THE MEASUREMENT THAT MATTERS is not "did it return something". Everything
  // returns something; that is the trap. It is **is the row a place a train
  // stops?** Real stops carry an `id`; businesses, hotels, street addresses and
  // city quarters come back `id: null`. `locations()` filters only `x.name`, so
  // those rows are rendered as tappable suggestions WITH THE STATION GLYPH.
  // In 9 of 28 specimens all seven visible rows are non-stations. The same file
  // already knows better: `nearbyStops` filters `x.id && x.name` under a comment
  // saying "a street address is not somewhere a train stops" -- the GPS path
  // learned it, the typed path never did. Downstream it does not even fail
  // loudly: /connections?from=Bundeshaus returns a journey starting at
  // "SRG SSR, Bern, Giacomettistr. 1", so the app silently plans you from a
  // company office. That defect is shared by every PARTIAL and LEFT_BEHIND row
  // below and is the single fix that would move most of them.
  //
  // Second shared residual: when nothing matches at all (control `qxzvwqbbzz`,
  // 0 rows) wireAC just hides the dropdown. No word is said. So the two ways
  // this axis fails a passenger are a list of dentists, and silence.

  // 4 of 4 clean: Zurigo -> Zürich HB, Geneva -> Genève, Lucerne -> Luzern,
  // Bâle -> Basel SBB, each rank 1 with zero non-stations in the visible seven.
  // The API carries the exonyms; the app inherits them for free.
  "phrasing/foreign-language":        { status: "SERVED",      step: "input",  evidence: "probe-phrasing 2026-07-31: Zurigo/Geneva/Lucerne/Bâle all resolve to the right station at rank 1, 0 non-stations in the rendered 7" },

  // gps-here is the one value on this axis the app answers itself rather than
  // delegating, and it is the one that is properly built: nearMe() on all three
  // location fields, nearbyStops() dropping id-less rows, distance in metres per
  // row, and four DISTINCT failure messages (no geolocation API / permission
  // denied / no fix / lookup threw) that each name the fallback instead of
  // leaving an empty box. tests/near-me.mjs, 21 checks green.
  "phrasing/gps-here":                { status: "SERVED",      step: "input",  evidence: "feature: nearMe + nearbyStops (id-filtered, distance shown, 4 distinct failure messages each naming the fallback), tests/near-me.mjs 21 checks" },

  // All three resolve to a real station at rank 1, and for Basel the two
  // candidates sit adjacent in the list (Basel SBB, then Basel Bad Bf). PARTIAL
  // rather than SERVED because the app adds NOTHING to the disambiguation it is
  // handed: nothing says Bad Bf is the German-network station across town, which
  // is the single most expensive station mix-up in the country, and pressing
  // Enter without choosing silently takes row 1 (acEnter). The list disambiguates
  // by spelling; the passenger who does not already know the difference is not
  // helped by it.
  "phrasing/ambiguous-city":          { status: "PARTIAL",     step: "input",  evidence: "probe-phrasing: Basel/Baden/Neuchâtel all rank-1 stations, Basel SBB and Basel Bad Bf adjacent; residual = nothing explains WHICH is which (Bad Bf is the German-network station) and Enter silently takes row 1" },

  // Typo tolerance exists but is shape-dependent. Umlaut transliteration
  // ("Zuerich HB" -> Zürich HB) and letter transposition ("Luzren" -> Luzern)
  // both recover at rank 1. A DROPPED letter does not: "Genve" returns seven
  // rows, all of them businesses, and Genève is not among them -- so the passenger
  // who fat-fingers one character out of a station name gets a shop directory
  // with train glyphs next to it.
  "phrasing/misspelled-station":      { status: "PARTIAL",     step: "input",  evidence: "probe-phrasing: umlaut transliteration (Zuerich HB) and transposition (Luzren) both recover at rank 1; residual = a dropped letter does not -- 'Genve' returns 7 rows, all businesses, no Genève" },

  // Better served than the raw lookup suggests, because the app ships two things
  // of its own here: a quick chip for Zürich HB -> Zürich Flughafen, and
  // looksLikeAirport(), which warns on the flight screen when the destination
  // does not look like an airport station at all. The German name resolves at
  // rank 1 and bare "Zürich" resolves to Zürich HB, which is the defensible
  // default. The residual is the English form: "Zurich Airport" returns seven
  // hotels and zero stations, so the very traveller most likely to type English
  // -- the one catching a flight out of a country they do not live in -- gets a
  // hotel list, and the airport warning never fires because they never reached a
  // station name at all.
  "phrasing/hb-airport-conflation":   { status: "PARTIAL",     step: "input",  evidence: "feature: HB->Flughafen quick chip + looksLikeAirport() warning on the flight screen; probe-phrasing: 'Zürich Flughafen' rank 1, bare 'Zürich' -> Zürich HB; residual = English 'Zurich Airport' returns 7 hotels and 0 stations" },

  // Two of three colloquial forms work: "Bern Bahnhof" -> Bern, Bahnhof, and
  // bare "Hauptbahnhof" returns a clean list of real Hauptbahnhof stops
  // (Winterthur, Solothurn, Bern). The third is the sharp one: "Zürich
  // Hauptbahnhof" -- the full, correct, everyday German name of the largest
  // station in the country -- returns seven rows of which NONE is a station.
  // Two even read as stop names ("Zürich, Hauptbahnhof") but carry id: null;
  // the rest are a bookshop, a nail salon and a shopping centre.
  "phrasing/colloquial-place":        { status: "PARTIAL",     step: "input",  evidence: "probe-phrasing: 'Bern Bahnhof' and bare 'Hauptbahnhof' both resolve to real stops; residual = 'Zürich Hauptbahnhof', the ordinary German name of the country's biggest station, returns 7 rows and not one is a station (two are id-less look-alikes)" },

  // Splits cleanly by KIND of landmark. Landmarks that are themselves transport
  // destinations resolve, because the railway named a stop after them: Matterhorn
  // -> Klein Matterhorn + Zermatt Matterhorn Talstation; Rheinfall -> Neuhausen
  // Rheinfall. Urban landmarks do not, because no stop carries their name and the
  // search falls through to the business register: Bundeshaus -> 7 companies
  // (top hit an SRG office), Jet d'Eau -> 7 companies (a pharmacy, a pizzeria, a
  // boatyard). A tourist asking for the seat of the federal parliament is offered
  // a pharmacy.
  "phrasing/landmark-not-station":    { status: "PARTIAL",     step: "input",  evidence: "probe-phrasing: landmarks the railway named a stop after resolve (Matterhorn -> Klein Matterhorn/Zermatt Talstation, Rheinfall -> Neuhausen Rheinfall); urban landmarks fall through to the business register -- Bundeshaus and Jet d'Eau each return 7 companies, 0 stations" },

  // LEFT_BEHIND, and the two apparent successes are why it needs saying out loud.
  // "ZH HB" returns seven dental practices; "ZRH", the IATA code the whole world
  // uses for that airport, returns seven companies. "SG" and "BS" DO return
  // stations -- but as accidental substring matches on the canton suffix (Wil SG,
  // Rapperswil SG) and on "Crêt-Bs", not because anything understood them as
  // abbreviations. Scoring those two as working would be reading a coincidence as
  // a capability. Nothing in the app or the API expands an abbreviation.
  "phrasing/abbreviation":            { status: "LEFT_BEHIND", step: "input",  evidence: "probe-phrasing: 'ZH HB' -> 7 dental practices, 'ZRH' (the IATA code) -> 7 companies, 0 stations each; 'SG'/'BS' return stations only as accidental canton-suffix substring matches (Wil SG, Crêt-Bs), which is a coincidence and not expansion" },

  // LEFT_BEHIND. "8001" and "6003" return city QUARTERS -- Zürich Altstadt,
  // Luzern Hirschmatt -- which carry id: null and are not stops. "3000" appears
  // to work only because Bern's main station is called "Bern": the postcode was
  // never parsed, the string matched a station name. One accidental hit out of
  // three is not postcode support, and a Swiss postcode is a thing people
  // genuinely type when they know an address but not the nearest stop.
  "phrasing/zip-code":                { status: "LEFT_BEHIND", step: "input",  evidence: "probe-phrasing: '8001'/'6003' return id-less city quarters (Zürich Altstadt, Luzern Hirschmatt), not stops; '3000' resolves only because Bern's station is literally named 'Bern' -- the postcode is never parsed" },
};

export function adjudicate(axis, value) {
  return ADJUDICATIONS[`${axis}/${value}`]
      || { status: "UNADJUDICATED", step: null, evidence: null };
}
