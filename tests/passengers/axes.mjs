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
  "constraints/relative-date-phrase": { status: "LEFT_BEHIND", step: "input",  evidence: "harold-5: 'this Thursday' not parsed -- still literally true; but see the note above: the NEED is now served by the date picker and the summit day strip, and which of the two this row means is unruled" },
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
};

export function adjudicate(axis, value) {
  return ADJUDICATIONS[`${axis}/${value}`]
      || { status: "UNADJUDICATED", step: null, evidence: null };
}
