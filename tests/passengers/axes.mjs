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
  "constraints/foreign-tz-time":      { status: "LEFT_BEHIND", step: "input",  evidence: "harold-1: card echoes TZ on output, input assumes local" },
  "constraints/future-origin-not-here": { status: "LEFT_BEHIND", step: "input", evidence: "harold-2: 'from work on Thursday' is neither here-now nor a stored place" },
  "constraints/relative-date-phrase": { status: "LEFT_BEHIND", step: "input",  evidence: "harold-5: 'this Thursday' not parsed" },
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
  "phrasing/exact-station-names":     { status: "SERVED",      step: "input",  evidence: "feature: the baseline the whole suite exercises" },
  "conditions/normal":                { status: "SERVED",      step: "plan",   evidence: "feature: the baseline the whole suite exercises" },
};

export function adjudicate(axis, value) {
  return ADJUDICATIONS[`${axis}/${value}`]
      || { status: "UNADJUDICATED", step: null, evidence: null };
}
