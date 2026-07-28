<!-- Authored by web-claude-phonesbb (claude.ai web session), delivered by bus broadcast
     2026-07-27; committed verbatim by the termux session 2026-07-28 because this file's own
     paragraph 5 names the defect of living only in a bus message. -->

# Unsolved gaps — what no Swiss rail app answers well

**Scope.** `ROADMAP.md` triages *SBB Mobile's known defects* and asks whether phone-sbb
should fix them. This file is the other half: **questions travellers have that neither
SBB Mobile nor phone-sbb answers**, plus the honest reasons some of them stay unanswered.

Compiled 2026-07-27. Supersedes nothing; sits alongside `ROADMAP.md`.

**Evidence labels** — applied per claim, because several beliefs in this project have
turned out to be inherited rather than tested:

- `MEASURED` — observed in a live API response or in the code, this session, with the probe recorded.
- `OBSERVED` — seen in a vendor UI or documentation.
- `INFERRED` — reasoned from architecture; not tested.
- `UNASSESSED` — nobody has looked. Named so it stops reading as coverage.

---

## 0. Coverage of this document

| Product | Assessed? |
|---|---|
| SBB Mobile | yes — `ROADMAP.md` §Benchmark, photographed 2026-07-27 |
| phone-sbb | yes — this file |
| ZVV app | `UNASSESSED` |
| BLS / PostAuto / RhB / regional apps | `UNASSESSED` |
| search.ch / Google Maps transit | `UNASSESSED` |

ZVV is the most conspicuous hole: it is the densest network in the country and the app
most Zürich commuters actually open. It appears in this codebase only as a
`VERBUND_NAMES` entry. Anything below about "no app does X" is therefore a claim about
SBB Mobile and phone-sbb, not about the field.

---

## 1. Questions with no destination yet

The structural gap. Both apps answer *A → B at time T*. Neither answers *where should I
go*. `Wander` is the one exception in either product and it is phone-sbb's.

**1.1 "Where can I get above the fog today?"** — `INFERRED`

The most Swiss rail question there is, unanswered from October to February by anything.
Needs three inputs that no single vendor holds: reachability, elevation, and cloud-base
height. phone-sbb already has the first two wired.

The missing quantity is *not* elevation — it is the **fog top**. Point weather at the
destination returns "overcast" both under and above an inversion, so it cannot
distinguish the two cases. Derive it instead from Open-Meteo pressure levels: relative
humidity collapsing between two levels marks the top, a temperature *inversion* across
the same gap corroborates it independently, and `geopotential_height_*` converts the
level to metres. Gate the whole computation behind `cloud_cover_low` so it costs nothing
on clear days. Pin the model to MeteoSwiss — high fog is a 1–2 km phenomenon and a
global model will not resolve the valley boundaries.

Not a new tab: a **ranking layer over `Wander`**, which already caps candidates at
`WAN_MAX_CAND = 5`.

Vertical resolution near the ground is a few hundred metres, so the honest output is
three-valued: **above · below · too close to call.** The third state is the one that
stops the app sending someone up an Aussichtsberg into grey soup.

**1.2 "What's running that's special this weekend?"** — partly `MEASURED`

Heritage and scenic operations. Confirmed reachable, with a caveat that kills the naive
version.

`MEASURED` — Bauma, 2026-09-06 (a DVZO steam Sunday): six departures, `category: EXT`,
`operator: DVZO`, to Hinwil, 09:30–15:35. So this is a category + operator filter over
stationboards. No GTFS archive needed, no scraping.

But `EXT` alone is **not** "heritage" — it also covers football shuttles, carnival
extras and engineering-work replacements. Pair it with an operator allowlist;
`business-organisation-directory.prod.app.sbb.ch` is the official transport-company
registry if that list should be sourced properly rather than hand-written.

`OBSERVED` — and the harder finding: **most special products are invisible in timetable
data.** RhB's own navigation classifies five categories (Panoramazüge, Genussreisen,
Ausflüge, Partnerangebote, Nostalgiefahrten) plus Charterfahrten. Of these, only some
carry a distinguishing category or operator. *Landwasser Express*, *Offene
Aussichtswagen*, *Erlebniszug Bernina Glaciers* are regular trains with a product
attribute attached — nothing a filter can grip. Charterfahrten are not public transport
and never appear at all.

So an algorithmic answer covers perhaps a third. The rest needs a small curated
catalogue per operator — product, route, season — which changes yearly, not hourly.
Same shape as the `tarifverbundkarte` decision: **build-time JSON, not a runtime fetch.**

**On "special" being subjective:** it is, and that resolves it rather than blocking it.
`category`, `operator`, gauge, altitude gain are *facts*; "worth it" is a judgement.
Label the fact, let the user filter. `Wander` already does this correctly — it ranks by
reachability and dwell time, never by beauty.

**1.3 "Where can I get to in 90 minutes?"** — **SOLVED, in phone-sbb only**

`Wander`. Station + time budget, candidates derived free from stationboard `passList`s,
and — the part SBB has no equivalent of — **only destinations with a verified return
inside the budget**, last way home printed on every card. Getting there is a fact from
the board; getting back is a claim, and an unverified one strands people.

Not in `README.md`. See §5.

---

## 2. The live journey

**2.1 "I'm on the train, my connection is dying, replan from here"** — `OBSERVED`

phone-sbb knows everything at *search* time and nothing after. It flags impossible
changes when you search — but at that moment they were still possible. The expensive
moment is minute 40, when a 3-minute delay becomes 9.

SBB Mobile is genuinely better here: push notifications on saved journeys report delays
and cancellations and offer alternatives, and the *Reisen* tab accompanies door to door.

What remains open even there: it is **reactive notification on a saved journey**, not
"recompute from where I physically am now." And it costs an account, a saved trip and
push permission — the three things phone-sbb deliberately does not have.

For phone-sbb the notification half is out of reach (web push needs a server). The
**replan half is not** — it is a foreground action, one tap, reusing the existing hub
sweep from the current position. This is the single largest capability gap in the app.

---

## 3. Information that arrives after the decision

Not missing features — features anchored to the wrong moment. Cheapest fix in this file.

**`MEASURED` (code):** in the Journey tab, the last way back sits inside the collapsible
route sketch. But "is there a way home?" is not a detail *of* the chosen connection — it
is a criterion for choosing one. Whoever is stranded at 19:00 picked their train long
before the app mentions it.

Same pattern: the Tarifverbund ribbon lives in the stop list though it is a
pre-purchase question; "worth stopping for" presupposes the chosen route although it is
a reason to pick a *different* one; the elevation strip likewise.

**The rule:** anything that influences a choice belongs on the results list; anything
that accompanies a chosen journey belongs in the detail view.

`Wander` already gets this right — the last way home is on every card, at decision
time. The pattern simply never migrated to Journey.

---

## 4. Honesty gaps — where an absence reads as an assurance

**4.1 Occupancy — "will I get a seat?"** — `MEASURED`

`capacity1st` / `capacity2nd` are `null` — not `-1`, `null` — in every object of a full
Aarau stationboard: stop level, every `passList` entry, journey level.
`realtimeAvailability` likewise. That includes the **IR 16 to Bern**, i.e. long-distance,
where a forecast does exist.

`OBSERVED` — RhB's own booking flow displays *Sitzplatzverfügbarkeit* as four dots for
the Bernina Express. So the data exists; it lives in **operator sales systems** and
search.ch does not pass it through.

Correct ROADMAP wording: *present in the schema, not populated by this source* — not
"unavailable". And do not infer occupancy from category or time of day.

Note the field name inverts its meaning: `capacity2nd: 3` means *high occupancy*, three
dolls, expect it full. Rendering `3` as "plenty of room" would be a silent 180° error.

**4.2 Fares — the question was never the price** — `OBSERVED` (cross-session)

Fares were left out on the assumption the data was paid. It is not: OJP Fare and OSDM
sit on the free opentransportdata.swiss platform. The real blocker is architectural — a
token cannot be held by a keyless single-file client served from GitHub Pages, and a
proxy would turn every user request into the operator's quota and bill.

But that framing still misses the useful question. From the fleet, 2026-07-26:

> compute **COVERAGE**, not fares — *"is my Abo valid for this?"* — because SBB
> structurally cannot ship that; their incentive is to sell a ticket.

`data.sbb.ch` is keyless, CORS-open, 6000 req/day, and carries `tarifverbundkarte`:
2137 records of place + coordinates + Tarifverbund + zone polygon — the lookup a
coverage feature needs. **Bundle it as static JSON at build time** (~296 KB, changes
yearly); never call it at runtime.

**4.3 Step-free access** — `INFERRED`

Correctly refused so far: the app must not claim a journey is step-free. `data.sbb.ch`
carries an `aufzugzustand` (lift status) dataset, which looks like the honest version —
a fact about a named device rather than a routing claim.

But the portal is **SBB's**, not Switzerland's. At a BLS, RhB, MGB or AVA stop, "no
fault reported" is indistinguishable from "not in the dataset", and the second is the
common case. That is the same trap in new clothing, aimed at the user who can least
afford it. Admissible only with an explicit per-station coverage check — at which point
a coverage list has to be maintained.

---

## 5. Meta: decisions that bind the code and live nowhere

Recurred three times in a single session, costing real work each time.

1. `Wander` and `Touch` ship on master; `README.md` documents neither. Reading only the
   README, a fresh session proposed building an isochrone that already existed
   (`e486011`, field-tested).
2. The Android / GitHub Pages issue was diagnosed in a Claude Code session and recorded
   only there. Root cause: phone at 100% disk → `localStorage.setItem` threw
   `QuotaExceededError` → `save()` unguarded and sequenced *before* the work at 5 of 6
   call sites. Fixed in `cb1c674`. **A reload could not help, because the disk stayed
   full** — which is exactly why it presents as a broken Pages deploy. The README
   documents the fix ("a phone with no free space says so and keeps working") without
   ever saying *Android* or naming the misleading symptom.
3. `sbb-app-pain-points.md`, cited as the ROADMAP's source, is not in the repo.

Two guards are **load-bearing and look cosmetic** — flagged here because a future
tidy-up will otherwise remove them:

- `legStops()`'s `p.station?.name && (p.arrival||p.departure)` filter, and
  `wanCandidates`' `slice(1)`. `MEASURED`: `passList[0]` carries the *origin's*
  departure time and platform but the **terminus's station id**, with `name: null`
  (RE→Wettingen gives `8503505`; IR→Bern gives `8507000`). Remove either guard and the
  app emits the wrong station id.
- **Dormant landmine:** `prognosis.arrival` at an origin stop is garbage — three trains
  departing 15:58 / 16:01 / 16:08 all reported `15:46:27`, a past timestamp, identical
  across trains. Harmless today because the board reads only `prognosis.departure` and
  `prognosis.platform`. It becomes a live bug the moment anyone adds "expected arrival
  at your stop" to the departures board.

---

## Priority

1. **§3 anchoring** — no new capability, highest ratio. Apply the Wander pattern to Journey.
2. **§1.1 fog** — a ranking layer over existing infrastructure; nothing else in the market can compute it.
3. **§2.1 replan-from-here** — largest gap, but needs a running-journey state rather than a search. Real architectural step.
4. **§0 assess ZVV** — cheapest way to find out whether this document describes the field or just two apps.
