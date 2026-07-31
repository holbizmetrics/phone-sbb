# phone-sbb — Roadmap (pain-point triage)

**Source:** research brief `sbb-app-pain-points.md` (Swiss press, SBB community forum,
consumer-protection bodies, app-store aggregators). Triaged against what phone-sbb actually
is: a **client-side static web app** (one HTML + CSS + JS, no build step) on the free `transport.opendata.ch` API — no
ticketing, no accounts, no ads, no tracking.

**Reconciled against `master` on 2026-07-25 at merge.** Three items moved: the manifest and most
of the accessibility work are already shipped, the accent handling verified clean, and the
cancellation question was put to the live API and came back **no such field**. A roadmap that
describes an older version of the app quietly sends someone to build what is already there.

## Organizing thesis

Nearly every SBB Mobile pain point traces to one root: **it is a legal/commercial instrument**
— tickets, accounts, ads, OS-permission dependencies — so every failure costs the user a
fine, a lockout, or their privacy. phone-sbb is the opposite: **pure information, nothing at
stake.** We do not compete on ticketing (we can't, and that is where all the risk lives). We
win the **information layer**: know fast, offline-capable, delay-truthful, ad-free, accessible.
The smart-changefinder already embodies this.

## Out of scope (skip — operator's call + structural)

- §2 ticketing / purchase / refund — no booking backend, and it is where the fines live.
- §3 EasyRide check-in/out, billing, saver-fare application — ticketing / money.
- §6 / §8 accounts, login, SwissPass, ads — no accounts by design (a feature, not a gap).

## Backlog (prioritized)

### Tier 1 — information-layer wins (build)

**T1. Delay & cancellation honesty (§5)** — *the single most-checked feature, and SBB's most
confidence-damaging bug ("3-min delay shown as none; a cancelled tram listed as normal").*
- **Audit 2026-07-29: the delay half is ALREADY SHIPPED** (predates the file split, `66bcb78`):
  board rows are prognosis-first with a `+N` late chip and platform-change ⚠ (`depRow`), journey
  cards carry `+N′` on both ends (`connCard`), and the change-buffer maths reads prognosis times.
  Only the cancellation half remains — and it stays blocked upstream (no API field). This entry
  sat open because the roadmap was reconciled before the audit, not because the work was missing.
- Make delays first-class on the board; **show cancellations as cancelled, never as a normal row.**
- We already have real-time `prognosis` from the changefinder — extend it.
- **API check DONE (2026-07-25, live query — the answer is no):** `stop.prognosis` carries
  `{platform, arrival, departure, capacity1st, capacity2nd}` and nothing else; neither the
  stationboard entry, the connection nor the section object has a cancellation field. **Delays
  are available, cancellations are not.** So this item splits: the delay half is buildable now;
  the cancellation half **cannot be built honestly on this API** and must not be faked by
  inferring cancellation from a missing or absurd prognosis — a wrong "cancelled" chip is worse
  than the silence, and this app's whole line is that it says what it does not know.
- *Regression:* the delay half is additive but edits the hot path (`depRow` / `loadBoard` /
  `connCard`). The cancellation half is blocked upstream, not by us.

**T2. Offline / PWA (§4)** — *"dead in tunnels, no meaningful offline mode."*
- **Half of this already shipped:** `manifest.webmanifest` + `icons/` are on master, so the app
  is installable today. What is missing is the **service worker** — offline load, a cached last
  board, and a "stale as of HH:MM" marker.
- Device-independent (buildable off-phone).
- *Regression:* **this is the one item with real destroy-risk.** A careless service worker can
  (a) trap users on a stale cached app version so updates never reach them, (b) serve old
  departure times as if live, (c) break app load. Guard: **network-first for API data**,
  cache-first only for a **versioned shell**, explicit stale markers, `skipWaiting` /
  `clients.claim` update flow. Build on a branch; field-test in a real tunnel / airplane-mode
  before it touches master.

### Tier 2 — cheap, differentiating, near-zero risk (pure add)

**T3. Accessibility-by-default (§7)** — **mostly already true on master, checked 2026-07-25.**
Refresh, favourite (with `aria-pressed`), swap, the clear buttons, the when-mode group and both
SVGs already carry labels — 18 `aria-label`s in all — and `prefers-reduced-motion: reduce` is
honoured app-wide. SBB shunts blind users to a *separate* app; we can just be usable. **What was
genuinely left — SHIPPED 2026-07-29:** the board is now `role="list"` with each row a
`listitem` carrying one spoken sentence (`depAria`: who, where, scheduled time *plus N minutes*,
platform *changed*, how soon), kept fresh through the quiet-refresh `patchRow` path; tap-to-expand
exposes `aria-expanded`. The no-shouting half is a single polite `#annc` live region that speaks
ONLY on two material transitions — a platform change or a delay newly appearing — and stays
silent on the every-30s countdown churn (a mutation test proves each announce path can go red,
including the announce-every-refresh regression). Tests: `tests/board-a11y.mjs` (20 checks).
*As predicted:* pure add — attributes and one hidden div, no behavior change.

**T4. Stay the tidy utility (§1)** — we already *are* the scannable, no-animated-characters
utility the press asked for. Only actionable lesson: heed one-handed / moving-train use (careful
with swipe gestures, thumb-reachable targets). *Regression:* design discipline, no code churn.

**T5. Privacy, stated (§8)** — already true by architecture (no ads, no tracking, favourites in
localStorage only). Worth stating once; it is the trust SBB lost. *Regression:* text only.

### Tier 3 — small correctness notes

**T6. Umlaut / accent handling (§6)** — **verified 2026-07-25, nothing to do.** `Genève` returns
Genève / Genève Bel-Air / Genève Cornavin, and the bare-ASCII `Zurich` returns Zürich HB —
opendata.ch folds accents on its side, so a user who cannot type an umlaut still finds the
station. Worth a regression test if the search path is ever rewritten.

**T7. One-shot geolocation (§3 lesson)** — *if* near-me / leave-now ever lands, use one-shot
`getCurrentPosition`, never background tracking — that is EasyRide's whole battery / permission
burden, avoided by design.

## Benchmark — what SBB Mobile's *Erweiterte Suche* offers (photographed 2026-07-27)

The official app's advanced-search panel is the fairest yardstick for our own mode filter, because
it is what a user is comparing us against. It offers: a master **Verkehrsmittel** switch, **Zug**
with six sub-categories (ICE/TGV/RJX · EC/IC · IR/PE · RE · S/SN/R · Autoreise/Extrazug), then
**Bus**, **Schiff**, **Seilbahn/Zahnradbahn**, **Tram/Metro**, plus two standalone toggles: **Velo**
(Velomitnahme Schweiz) and **Barrierefreie Verbindung**.

Our five chips (train · boat · cable car · bus · tram) already cover their five top-level groups.
The gap is the sub-categories and the two toggles — and **two of those three cannot be built
honestly on this API.** All three were checked against a live `/v1/connections` response on
2026-07-27 rather than assumed.

**T8. Train sub-categories (ICE/TGV · EC/IC · IR/PE · RE · S/R) — SHIPPED 2026-07-27.**
A second chip row under the mode chips, `tests/train-class.mjs` (68 checks, mutation-checked), CI-wired.
- **Correction to this entry's own first draft:** it claimed sections carry `categoryCode` and
  `subcategory`. Those keys exist but came back **null on every section** across a dozen probed
  routes — only `journey.category` is real, and that is what the filter keys off. Keying off an
  always-null field is how you ship a filter that silently matches nothing.
- The API's `transportations[]` has no sub-train granularity, so this is a **post-filter**, not a
  query change. Two rules keep it honest, both learned from the live data:
  1. **Unrecognised categories pass.** The failure directions are not symmetric — letting an unknown
     train through shows one row too many and you can see what it is; judging it would vanish a real
     journey and blame the timetable. Walk / bus / boat / tram legs are never judged either: this
     filter says which *train* you sit on, it does not re-decide the mode chips.
  2. **The count printed is what was HIDDEN, never what was kept.** The natural wording — "3 of the
     next 10 use EC/IC" — is false the moment something survives for a reason other than matching:
     on Luzern–Vitznau an EC/IC filter keeps eight *boat and replacement-bus* options under rule 1,
     and none of them is an IC. Caught by running the filter over live payloads, not by the unit tests.
- *Regression, as predicted:* it **can** empty the result list — Genève→Brig returns 0 under *EC/IC*
  and 9 under *EC/IC + IR/PE* — so it ships with its own why-empty sentence and clear-button. It also
  interacts with `limit`, so a filtered search **widens the window to 16** rather than thinning a page
  of six. The why-empty only blames the filter when the unfiltered response was non-empty; if the API
  returned nothing at all, the filter provably was not the cause and does not take the credit.
- **Second correction, 2026-07-27, from a peer session's live Bauma board:** the shipped table filed
  `EXT` under **RE** — a guess about what "Extrazug" means, never probed, and absent from the fifteen
  categories the original sweep returned. `EXT` is really heritage steam (DVZO), football shuttles and
  Ersatzzüge in one bucket, so *turning RE off silently deleted a steam special* — precisely the
  invisible failure direction rule 1 exists to prevent. Fixed by **removing** it rather than giving it
  a class: unlisted means unjudged, so it is never dropped. No chip can be honestly labelled `EXT`,
  because it is not a train type — it is the absence of one.

**T9. Velomitnahme (bike carriage) — NOT BUILDABLE. Do not fake it.** *Verified 2026-07-27:* the
whole connection payload was scanned for `bike` / `velo` / `bicycle` — **zero hits**. Connection
keys are `capacity1st, capacity2nd, duration, from, products, sections, service, to, transfers`;
nothing carries bike capacity or a bike-permitted flag. Inferring it from category ("an IC always
takes bikes") is a **claim about a reservation-bearing service** and would strand someone on a
platform holding a bicycle. Same rule as T1's cancellations: the silence is the honest answer.

**T10. Barrierefreie Verbindung (step-free) — NOT in this API; the OSM route is a liability.**
*Verified 2026-07-27:* `wheelchair` / `accessib` / `barrier` / `boarding` all return **zero hits**;
the station object carries only `coordinate, distance, id, name, score`. This is the same item the
courier queue held as "accessibility from OSM wheelchair tags", and it is deliberately **not**
promoted: OSM tags describe a *station building*, not whether a given train at a given platform has
step-free boarding today. **A wrong "step-free" strands a wheelchair user mid-journey** — the worst
failure this app could ship, and strictly worse than not answering. If it is ever attempted it can
only be phrased as "OSM says this station is tagged step-free; we do not know about your train",
which is a different feature from the toggle in the photo.
- Note the asymmetry with **T3**: making *our own UI* usable by a screen reader is a pure add we
  should finish. Making *routing claims about the physical world* is not the same act.

## Carried in from the courier queue (spec'd, unbuilt)

These lived only in the PCLA courier ledger, which made them invisible to anyone reading this repo.
Moved here 2026-07-27 so the backlog has one home. Two of the five already had a roadmap entry and
are folded rather than duplicated.

**T11. Live webcams at the destination — DISCHARGED AS LINKS, 2026-07-29 (`7636ffa`).** The
summit card now ends with a "check for yourself" row: 📷 webcams (Windy, coordinate-addressed)
+ a second forecast (meteoblue), `target="_blank" rel="noopener"`, caveat "their pictures, their
forecast, not ours". Deliberately links-not-embeds: we cannot vouch for a frozen webcam any more
than a wrong forecast, so the third-party-image-fetch trap named below never arises — the user
walks through the door, we never repaint what's behind it. The row renders even when our own
outlook is unreachable (that is when it is most valuable). Tests: `tests/summit-days.mjs`.
An *embedded* webcam thumbnail remains possible future work and would need the three-outcome
discipline; not currently planned.

**T12. Meet-in-the-middle** — two people, two origins, find the station that is fair to both.
*Regression:* pure add, but **N×M queries** against a volunteer API — must be bounded and fired on
explicit request only, never on render.
**SHIPPED 2026-07-29.** The N×M trap is dodged by construction: the two *direct* connections
(A→B and B→A) already call at every candidate worth naming, and each shared stop carries both
clock times for free — base cost **2 requests**. Only when the two directions never share a stop
does a capped fallback fire (≤4 mid-route per-candidate lookups). Hard ceiling 6 requests,
button-tap only. Fairness = closest ride times both leaving now; top 3 rendered with "my leg /
their leg" replan taps. `tests/meet.mjs` (27 checks) pins the bound with 9 candidates on offer,
the never-on-render rule, superseded-tap abort, and outage≠no-route; 3/3 planted mutations caught.

**T13. Airport / flight mode** — "be at the gate by HH:MM", working backwards through check-in and
security. *Regression:* the check-in buffer is a **CLAIM**, not timetable data. A fixed "be there 2h
before" is us inventing an airline's policy; it must be user-set or plainly labelled a rule of thumb,
or this becomes the one feature that makes someone miss a flight.
**SHIPPED 2026-07-29.** Both, not either: the buffer is **user-set AND permanently labelled**.
`flightBuf` loads as `null` and *stays* null until the user taps a number — until then no arrive-by
is set and nothing is planned, so the app never once states a check-in time it does not know. The
caveat (no access to check-in deadlines, bag drop, security queues, or the platform-to-desk walk;
"the time on your booking wins") sits under the chips in **both** states, not once at first use. No
un-choose, deliberately: a revoked buffer would strand a derived arrive-by on screen, which is the
same defect as an invented one. A destination not matching `flughafen|aéroport|aeroporto|airport`
is warned about rather than assumed. Found + fixed in build: `new Date("not-a-date:00")` parsed to
1999-12-31, so the flight time is shape-checked before parsing. `tests/flight.mjs` (36 checks);
4/4 planted mutations caught — including the roadmap's exact trap, a smuggled 120-minute default.

**T14. ~~One-shot GPS on the sketch~~** — folded into **T7**; same discipline (one-shot
`getCurrentPosition`, never background tracking).

**T15. ~~Accessibility from OSM wheelchair tags~~** — folded into **T10**, where the live-API check
and the reason not to ship it now sit together.

**T16. Route via a stop the passenger names — SHIPPED 2026-07-29.** The API has taken `via[]` all
along (the change-finder has used it for hubs since the day it was written); the only missing piece
was the passenger being able to say *where*. Two honesty rules carry the feature, and both are
planted-negative tested: **(1) a set via is always VISIBLE and never persisted** — a remembered
constraint you cannot see silently changes tomorrow's searches, so it starts empty every load and a
shared link that carries one *reveals* the field rather than applying it behind a hidden input;
**(2) a named via stands the hub sweep DOWN** — otherwise the list mixes routes that honour the via
with routes that ignore it, and nothing on a card tells them apart. Both smart queries carry it, so
the wide one is not a back door around the constraint. Text typed but not applied marks the field
`.pending`, and every rendered claim reads `viaName`, never the input box. An empty result under a
via says *"nothing links the three in that order — which is not the same as no route at all"* with
one tap to search without it; the smart planner drops *"Check the station names"* while a via is
set, because that advice is wrong then. The API takes **one** `via[]` here and a second is not "more
thorough", it is a different journey. `tests/via.mjs` (44 checks); **10/10 planted mutations
caught**, including a silently-ignored via, a persisted one, a note read from the box instead of the
applied value, and an empty result reported as "no route".

**T17. Earlier / later connections (SBB's up-and-down control)** — *not previously on this list; the
gap was found 2026-07-29 by grepping for it and finding nothing.* **SHIPPED 2026-07-29.** Every
result set until now was one
fixed window: whatever the API returned around the departure time asked for. SBB lets you walk the
timetable backwards and forwards from there, and we have no equivalent — if the four shown
connections are all too early, the only move is to retype the time. Proposed placement (operator):
an **up/down control at the far left of the share bar**, where the row already lives, rather than a
new panel. *Regressions to design against, all of them the same class — a paged list must never
imply data it does not have:* pressing **later** must fetch the next window from the API (`&time=`
past the last departure shown), never re-slice what is already on screen and call it new; pressing
**earlier** past the first service of the day must say *there is nothing earlier*, not return the
same list silently; and the delay/cancellation honesty of T1 applies to every appended row, so a
page fetched five minutes ago must not sit above a fresh one wearing the same "live" styling. A via
(T16) or a category filter (T8) is part of the query, so paging must carry it — a "later" that
quietly drops the via is the invisible-constraint defect in a new costume.
**How each of those was answered.** The step moves the *existing* when-anchor and calls `planJourney()`
— it builds no query of its own, which is why the via, the category filter and the mode filter ride
along for free and cannot be dropped (a null control asserts the block contains no query fragment at
all). The list **replaces** rather than appends, so two vintages of prognosis can never sit in one
list wearing the same live styling. The anchor stays **visible**: stepping writes the time into the
when-field, reveals it, and flips the segment to "Leave at" — a window that walked itself while the
control still read "Now" would be the same invisible-constraint defect as a hidden via. Both ends of
the day are **detected, not assumed**: the API answers "nothing earlier" by handing back the same
trains, so the step records what it stepped away from and compares — unmoved means the direction is
marked exhausted, the button disables, and it is *said* rather than re-rendered as a fresh page. A
step that lands on nothing offers the exact way back (the anchor it left, to the minute), because a
step must not strand you with no list to step from. Two details found in build: anchoring must use
**scheduled** times, not prognosis (the API's `time=` filter is scheduled, so a delayed train would
be stepped past while still listed at its booked minute), and the backward step is the width of the
list with a 30-minute floor, or a single-result list would step zero minutes and sit still forever.
Arrive-by is walked on its own axis — "arrive by 09:00" steps to "arrive by 08:20", it does not
silently become a departure question. `tests/pager.mjs` (45 checks); **17/17 planted mutations
caught** — one of which, an arrive-by step silently becoming a departure step, **survived the first
run** because the assertion said "earlier than 09:00" when both axes satisfy that; it is now exact.
Caught by CI and worth keeping: the first version of that suite hard-coded `+02:00` into its
fixtures, so it passed on the phone and failed in UTC — a test pinned to one timezone is a test that
makes a claim about the machine, not about the code. The fixtures now build their offsets from the
runner's own clock, and the suite is verified green in five zones including a half-hour one.

### Harness work, 2026-07-29 — two gates that were comments asking for care

Both guard the same shape from opposite ends: **a check that is green over the wrong denominator.**
Neither is a feature; no app asset changed, so there is deliberately no `?v=` bump.

**`tests/workflow-parity.mjs` (20 checks) — the deploy gate may not be the smaller gate.** `ci.yml`
gates every branch, `deploy.yml` gates what goes live, and their test steps are copy-pasted twins.
`deploy.yml`'s own comment already named the hazard — *"a deploy that runs fewer tests than CI is the
worst version of this bug"* — and then left it to care. The suite asserts the two suite-runner scripts
are **identical**, that discovery stays a glob (the hand-written list once orphaned four suites while
CI stayed green), that `smoke.mjs` is the *only* thing either skips, that the deploy job still carries
`needs: test`, and that **no `node` invocation is piped** — `node "$t" | tail -1` reports tail's
status, which is 0 whatever the suite said, so the suite runs, prints FAIL, and the step passes. That
last check is imported: the same trap has bitten the sibling PCLA sessions four times. **6/6 planted
mutations caught** (extra exclusion in deploy only · a pipe on the loop body · gate removed · a
hand-listed suite · `exit $fail` dropped · glob replaced by a list).

**The passenger sweep had rot in the one direction it never checked.** It already enforces that *a
refusal may not outlive its policy* — every refusal names a file and a section, and both must still
exist. The mirror was missing: an adjudication whose evidence reads *"no replan-from-here"* is a
**claim about the app** — that the feature is absent. `replanFromStop` shipped,
`tests/replan-from-here.mjs` sits in the same directory 20/20 green, and the row went on scoring a
delayed passenger `LEFT_BEHIND`. The instrument understating the app is still the instrument being
wrong. The new block resolves every cited absence against the suites on disk, and went red on exactly
that row on its first run — no mutation needed, it caught a live defect.
`conditions/delay-50min` is re-adjudicated **`LEFT_BEHIND` → `PARTIAL`** — deliberately not `SERVED`:
`replanFromStop` and the missed-change obverdict serve the recover half, but the app never offers the
replan unprompted, so the passenger has to notice first, and half a rescue is not a rescue. Its
ledger row moves to `parked-with-reason` naming that residual as the open question.

One thing learned while writing it: the first control was a count — *"at least one row cites an
absence"* — which passed **only while the stale row existed.** Fixing the defect broke the proof that
the check worked. The corpus is allowed to be clean, so the rule's negative case is now three
synthetic self-tests (fires on a filled absence · stays silent on one that is still real · does not
read ordinary prose like *"no data source"* as a feature name). Sweep: **82 checks green**, and the
full suite is green under `TZ=UTC` as well as local.

**`constraints/arrive-by-time` → `SERVED` (operator ruling, 2026-07-30).** Evidence: `segArr` plus
`&isArrivalTime=1` on the query, and the earlier/later pager walks arrivals on their own axis rather
than silently becoming a departure question. This is the *opposite* staleness from the rot above — not
a rotted row but a **missing** one: a value the app plainly serves that the table had never ruled on,
so every passenger carrying it scored `UNADJUDICATED`.

Adding it exposed a third instance of tonight's class, and the worst-behaved one. Three checks used
`arrive-by-time` as their hard-coded stand-in for "an unadjudicated value". Ruling it `SERVED` did not
turn them red — it turned them **vacuous**. An unrelated field (`who/commuter`) happens to be
unadjudicated too, so each check went on passing while no longer testing the thing it is named after.
Green before, green after, and *nothing in the suite could see it*, because green is green. That is
strictly nastier than the `LEFT_BEHIND` rot, which at least had a wrong answer sitting in a file
somebody might read.

Fixed by making the premise discovered and asserted rather than assumed: `UNADJ` resolves an unruled
axis value at run time, two controls assert it exists *and* is genuinely unruled, and the
UNADJUDICATED check now asserts the status **on that value's own axis** instead of on the
whole-scenario verdict — a verdict is reachable through any unruled field, which is exactly how the
check went vacuous. It now prints its own specimen (`who/commuter`) so a future reader can see what
it actually tested.

And the symmetry got closed while the row was being added. The absence rule had a third direction
missing: **an adjudication may not outlive the PRESENCE it cites either.** `"feature: … (pager.mjs)"`
is a claim that the evidence is still there to be re-read; rename or delete that suite and the row
becomes an assertion backed by nothing, green. Five rows cite suites; all five are now checked.
Sweep: **93 checks green**, in local, `TZ=UTC` and `TZ=Asia/Kolkata`. **4/4 mutations caught** —
absence-rot restored · no unruled specimen available · the attributable check reverted to its old
vacuous verdict-form · a cited evidence suite deleted.

### 2026-07-30 — a field report, and the three rows I said would rot next

Two shipped fixes, and the rot argument tested against itself.

**The via was ignoring you.** Field report: *Zürich HB → Luzern via Buchrain* returned ordinary
direct trains. The API is innocent — `via[]=Buchrain` returns real routes (IR75, change, then the
S1 through Buchrain), and `tests/via.mjs` already covered the query string, the hub stand-down and
the not-lying. The gap was the *moment of applying it*: `iVia` had a keydown handler and two
`input` handlers and **no blur**, so the via only took effect on Enter or on tapping a suggestion.
Type it and tap away — which is the only thing you do on a phone — and the search ran unconstrained
behind a field that read "Buchrain", with a dashed amber border as the entire warning. The suite
even *asserted* that state ("text typed but never applied MARKS the field"); marking it had been
judged remedy enough. Leaving the box now applies it, deferred one frame so a suggestion tap still
wins the race.

**Every time field was in the wrong timezone.** Chasing `constraints/foreign-tz-time` — one of the
three rows the part-2 bus report named as most likely stale — found it real and worse than written.
Three writers seeded the **device** wall clock into a `datetime-local` field whose value `whenQS()`
ships as **Swiss** wall time: the planner seed, the flight seed and the pager's anchor. Measured
across five zones before the fix: Mumbai asks for a train 3h30 off, Auckland asks for the **wrong
day**, and Zurich agrees with itself — which is why it survived this long. `swissLocal()` is now
the single datetime-local boundary. One look-alike deliberately **kept**: `flightArriveBy`'s offset
dance is wall-clock arithmetic on a string you typed, correctly zone-neutral, and a careless sweep
of `getTimezoneOffset` through the file would break it — so the suite asserts its neutrality and
counts the survivors.

`tests/tz-input.mjs` (42 checks, six zones, both DST offsets) · `tests/via.mjs` +7 ·
**9/9 mutations caught** after fixing three survivors of the first battery. Two of those three were
weak mutations of *mine*; the third was real — a wiring check a **commented-out line still
satisfied**, since a source-text regex cannot see a comment. All four wiring regexes in that file
had it. **App assets changed, so `?v=` bumped to `20260730a`.** Whole suite **1002 checks green**
in `TZ=UTC`, `Asia/Kolkata` and `Europe/Zurich`.

**And the rot argument met its own mirror.** Fixing the timezone bug turned the *specimen* checks
red: "Harold is LEFT_BEHIND … on the timezone axis" was no longer true. That is the specimen doing
its job — it asserts a **falsifiable** claim, so it said so out loud, where the adjudication rows
beside it rot silently for days. So the freshness contract the part-2 report proposed already
exists in a second place, one file away from the rows that lack it. And it decays with the
**opposite sign**: an adjudication cites an absence, so shipping makes it stale *pessimistic*; a
specimen asserts a failure, so shipping makes it stale *optimistic* — it goes on claiming the app
is worse than it is. Same decay, opposite direction, and only one of the two is loud.

Of the three flagged rows: `foreign-tz-time` → **PARTIAL** (fixed; residual = the sunset
roll-to-tomorrow still reads the device clock, asserted in the suite so it cannot be forgotten, and
the field carries no zone label of its own). `future-origin-not-here` → **PARTIAL**: it had
genuinely **rotted** — it cited "nor a stored place" and route history stores six, one tap filling
both fields and re-planning. Caught by hand, *not* by the absence-rot check, because it is a prose
absence — exactly the boundary the bus report declared, confirmed within a day of declaring it.
`relative-date-phrase` **left unruled on purpose**: read as phrasing it is untouched (nothing parses
"this Thursday"), read as the underlying need it has moved twice (date picker, summit day strip) —
and the row sits on the `constraints` axis while its evidence is a sentence about parsing. A row
whose axis makes its subject ambiguous can be read as rotted or fresh at will. That is a third
staleness shape, and ruling it is the operator's call, not mine.

### 2026-07-30 (later) — the app blamed the passenger's connection for the server's refusal

Second field report the same evening: the operator's phone showed **"We could not reach the
timetable — check your connection"** while his connection was demonstrably fine. I first blamed an
airplane-mode glyph in his status bar; he corrected me — my own requests were going out over that
same connection at that same moment — and he was right.

Measured instead of guessed: **40 requests to transport.opendata.ch, 17 returned 200 and 23 returned
HTTP 429**, `Rate limit error from timetable.search.ch: Too many requests this minute`. (I had been
bursting curl against that API from the same IP while he field-tested, so I was plausibly the cause
of his 429 — worth recording, because a diagnostic that competes with the thing being diagnosed is
its own hazard.)

The bug this exposed is not the wording. `errBox()` **already handled 429 correctly**, with a comment
naming this exact reasoning — and never ran on the screen that mattered. Smart mode routes through
`tryConns`, whose `catch(e){ note.failed=true; return []; }` recorded *that* a request died and threw
away *why*; `renderSmart` then printed its own hardcoded sentence. Three copies of that sentence
existed. One knew about rate limits; the copies did not; copies drift.

- **`tryConns` keeps the error** (`note.err=e`). The comment above it already described fixing this
  class once — for the empty-array case — while still discarding the reason one line down.
- **`renderSmart` takes `reqErr`, not `reqFailed`**, and delegates to `errBox`. A boolean can only
  ever produce one sentence, and the sentence it produced was false.
- **`errBox(e, unknown, again)`** — the per-screen words are now parameters, so the departures board
  (the third copy, which **no suite had ever looked at**) delegates instead of duplicating.
- Suites: `outage-not-verdict.mjs` 23 → 36, `wander.mjs` 12 → 18. **1019 checks green** across four
  timezones. **6 of 6 mutations caught** (`tests/mutations/mut-errbox.py`).

Two method notes, both self-inflicted and both worth keeping. The existing wiring checks asserted the
*guard* (`direct.failed && !direct.ok`) and not the *payload*, so reverting a call site to the bare
boolean — the original defect, in full — left them green; caught only by mutation, now asserted
directly. And my first `wander.mjs` slice ran backwards and produced `""`, on which the
delegation check failed honestly but the "no hardcoded sentence" check **passed vacuously** — a
negative assertion over a region is worthless unless something proves the region exists.

### 2026-07-30 (later still) — "I do not know right now" is a state the table could not hold

Asked the operator to rule `constraints/relative-date-phrase`; his answer was that he does not know
yet. That is a legitimate state, and the ground-truth table had nowhere to put it — the ambiguity
lived only in a source comment, which is precisely the thing that rots.

So the not-knowing is data now. `openQuestion` records the question, the date it was asked, and
**the status it was raised against**. The sweep prints every open row as an `OPEN` line so it cannot
go quiet, and fails if the row is ruled while the question is still attached: retiring the question
and changing the status must be the same edit. The row can be *decided*; it can no longer *drift*.

Null-tested in both directions, because a gate that has only ever said yes has been shown to run and
not to work — ruling the row without retiring the question goes red, and deleting the last open
question goes red on the control rather than silently making the section vacuous.

This is the third staleness shape named on 2026-07-30, and the only one that decays through nobody
deciding rather than through shipping. The other two decay by shipping in opposite directions: an
adjudication cites an absence the app later fills (stale **pessimistic**, and silent); a specimen
asserts a failure the app later fixes (stale **optimistic**, and loud, because it asserts something
falsifiable).

### 2026-07-31 — the mutation scores lived on one phone, and one of them only worked abroad

Closeout scan: every mutation-score claim in this file cited `~/tmp/mut-*.py` — a path on the
operator's phone that no reviewer can open. Seven batteries had accumulated there. The strongest
evidence in the document rested on an instrument outside the repo, which is the artifact-locus
failure, not a filing preference. They now live in `tests/mutations/` and the citations point there.

Moving them was not bookkeeping — **two of the seven did not survive the move**, and both rots are
worth more than the tidying:

- **`mut-via-tz.py` scored 9/9 abroad and 8/1 here.** Its fixture mutation re-points the pager
  fixture to *the runner's* zone; on a machine already set to `Europe/Zurich` that substitutes
  Zurich for Zurich — a literal no-op, which reads on the console as a suite gap. Under UTC,
  Kolkata or New York it bites and the script reads 9/9. **A timezone mutation run inside the
  timezone it is about measures nothing, and the machine guaranteed to be in that timezone is the
  one this app is built on.** The zone is pinned per-mutation now, so the score means the same
  thing wherever it runs. The earlier "9 of 9" was environment-dependent and never said so.
- **`mut-t2.py` crashed with a bare `FileNotFoundError`** because `sw.js` only exists on the
  unmerged `t2-service-worker` branch. It now exits non-zero with the reason and the command to
  run it on the right branch. An instrument that cannot run must say *why* — "broken script" and
  "you are on the wrong branch" are different facts, and only one of them is actionable.

Same shape as the rate-limit bug fixed the night before, one level up: a correct instrument that
silently reports the wrong thing because nobody checked the context it was running in.

---

### 2026-07-31 — the `phrasing` axis, all nine rows, and the dentists in the dropdown

The sweep went **19/50 → 28/50 adjudicated**; `phrasing` is now the only axis with no unruled value.
Measured rather than reasoned: `tests/passengers/probe-phrasing.py` → `phrasing-evidence.json`,
28 specimens plus a no-match control, run **serially with a 1.2 s delay** because this is the API
that rate-limited us the night before and a burst would have both poisoned the result and degraded
the live app.

**The app does no fuzzy matching of its own.** `wireAC` hands the raw box text to
`/locations?type=station&query=` and renders the top 7, so on this axis the API's answer *is* the
app's answer. Which makes the measured property easy to get wrong: it is not *"did it return
something"* — everything returns something, and that is the trap. It is **is the row a place a train
stops?** Real stops carry an `id`; businesses, hotels, street addresses and city quarters come back
`id: null`.

`locations()` filters on `x.name` alone, so those rows render as tappable suggestions **with the
station glyph next to them**. In 9 of 28 specimens *all seven visible rows* are non-stations:

| you type | you are offered |
|---|---|
| `Zürich Hauptbahnhof` | a bookshop, a nail salon, a shopping centre — 0 stations |
| `Bundeshaus` | an SRG office and six other companies |
| `ZRH` | seven firms in Kloten |
| `8001` | Zürich city *quarters*, none of them a stop |
| `Zurich Airport` | seven hotels |

And it does not fail loudly downstream: `/connections?from=Bundeshaus` returns a journey starting at
*"SRG SSR, Bern, Giacomettistr. 1"*. The app silently plans you from a company office.

**The same file already knows better.** `nearbyStops`, the GPS path, filters `x.id && x.name` under a
comment reading *"a street address is not somewhere a train stops."* The typed path — the default,
the one everybody uses — never got the lesson. That is the third session running that this shape has
turned up: **a correct rule, present in the file, absent from the path the user is on.**

Second shared residual: when *nothing* matches (control `qxzvwqbbzz`, 0 rows) `wireAC` just hides the
dropdown. No word is said. So the two ways this axis fails a passenger are a list of dentists, and
silence.

Rulings: `foreign-language` and `gps-here` **SERVED** (exonyms come free from the API; `nearMe` is the
one value the app answers itself and the one that is properly built — id-filtered, distances, four
distinct failure messages each naming the fallback). `ambiguous-city`, `misspelled-station`,
`hb-airport-conflation`, `colloquial-place`, `landmark-not-station` **PARTIAL**. `abbreviation` and
`zip-code` **LEFT_BEHIND** — and both of those had a tempting false positive: `SG`/`BS` do return
stations, but as accidental substring matches on the canton suffix (`Wil SG`, `Crêt-Bs`), and `3000`
resolves only because Bern's station is literally called *Bern*. Scoring those as working would be
reading a coincidence as a capability. All seven non-SERVED rows are `undecided` in the disposition
ledger, which is the truth: they were measured the same hour and nobody has ruled on what to do.

**The sweep caught its own control rotting — the 2026-07-30 repair missed one.** That night, three
checks were found using a live unadjudicated row as their hard-coded stand-in, and were fixed by
discovering the premise at run time. A fourth of the same shape survived: the reduction control named
`phrasing/zip-code` as its example of "a genuinely unchecked key", so it went red the hour that row
was adjudicated — not because the reducer regressed, but because **a control that dies when you do
the work is measuring the work, not the property.** It now names a synthetic key that can never be
adjudicated, plus a guard that the key really is absent from all three sources rather than assuming
it. The first draft of *that* guard indexed `refusals.refusals` — an array — with a string key, so it
was vacuously true; caught by checking, and it now uses the `covered` Set.

`tests/mutations/mut-phrasing.py`, **4 of 4 caught**, M4 being the one that proves the replacement
control can still come back negative. Suite total **1047 green**.

### …and then the fix, same session

Ruled by the operator: *filter the non-stations, and say when nothing matches.* Both are one line.
`locations()` now filters `x.id && x.name` — the rule `nearbyStops()` had all along — and the empty
branch calls `nearMsg` instead of closing the box in silence.

The third line was not asked for and is the one that matters most. `wireAC`'s `catch` used to be
covered by the same silence, so a **dead request rendered exactly like a real "no such station"**.
It now says something different on purpose, and names a 429 as a rate limit rather than as a broken
lookup. That is last night's bug one screen over: an absence of data presented as data.

**The fix shipped green without being run.** Right after the edit the suite still read **1047 —
the same number as before**, which is this session's own defect class pointed at itself: nothing in
1047 checks touched the changed code. Hence `tests/station-lookup.mjs`, **19 checks**, every positive
paired with a negative twin, including a PLANTED control that rebuilds the pre-fix name-only filter
and confirms it really does let a dentist through. Total now **1066**.
`tests/mutations/mut-station-lookup.py`, **5 of 5 caught**: both shipped defects put back, plus the
three ways the error path can quietly go wrong again (thrown-as-no-match, 429 unnamed, query
unescaped).

## Regression summary — the "does it add or destroy?" answer

| Item | Risk |
|---|---|
| T3 accessibility · T5 privacy · T4 discipline | **Pure add — cannot break existing features** |
| T6 umlaut | **Done** — verified against the live API, no change needed |
| T1 delays | Additive but touches the hot path |
| T1 cancellations | **Blocked upstream — the API carries no cancellation flag.** Do not infer one |
| T2 offline / PWA | Installable half **done** (manifest shipped). The service worker is where the **real destroy-risk** lives (stale shell / stale-data-as-live / broken load) → network-first data, versioned shell, field-test before merge |
| T11 webcams · T12 meet-in-the-middle | **Pure add**, but each carries one named trap: an unreachable camera must not render as bad weather; N×M queries must be bounded and on-request |
| T8 train sub-categories | **Shipped 2026-07-27.** Additive post-filter; it *can* empty the result list (Genève→Brig under *EC/IC*), so it ships a why-empty sentence, widens the fetch to 16, and counts what it HID rather than claiming what it kept |
| T13 airport mode | Additive, but the check-in buffer is a **CLAIM** — user-set or labelled, never invented |
| T16 via a named stop | **Shipped 2026-07-29.** Additive, but it *narrows* results by design, so it ships two negatives: the via is never persisted (invisible constraints are the destroy-risk) and it stands the hub sweep down (a mixed list is worse than a short one) |
| T17 earlier / later | **Shipped 2026-07-29.** Each step is a real fetch through the existing anchor (so filters ride along and cannot be dropped), the list replaces rather than appends (so no two vintages of prognosis share a screen), and both ends of the day are detected and said rather than re-rendered |
| T9 bike carriage | **Blocked upstream — no bike field anywhere in the payload.** Do not infer from category |
| T10 step-free routing | **Blocked upstream, and the OSM substitute is worse than silence** — a wrong "step-free" strands a wheelchair user |

**Net:** overwhelmingly additive. The fleet's existing flow — build on a branch → 55ef
cold-review → phone-claude field-test → operator merges — **is** the regression guard, and it
earns its keep most on T2.

## Suggested fleet split

- **T1 (delays):** phone-claude — needs on-device + real-network validation. The cancellation
  half is off the table until the API grows a flag.
- **T2 (service worker):** laptop (`a4a7aa69`) — device-independent; build on a branch,
  field-tested offline before merge. The manifest is already on master.
- **T3 (accessibility):** either desktop session; pure-add, low-coordination.
- **T8 (train sub-categories):** ~~either desktop session~~ **done** — built on the phone
  2026-07-27. The prediction held: the filter itself was the easy half, the honest wording was not.
  **Field-tested 2026-07-27 22:53 on the operator's phone — and it corrected me twice.** Before the
  screenshot I had estimated, by arithmetic over the CSS, that the five chips would run ~410px against
  a 328px box and therefore scroll. **Wrong: all five fit on one line at 360px.** The estimate was too
  generous on character advance widths, and the train-type chips are genuinely tighter than the mode
  chips (11px/6-9px padding vs 12px/7-11px). The row that actually overflows is the **mode row above
  it** — *Tram* is clipped mid-chip — so the scroll-edge fade added in `86f1355` earns its place on
  that row and the favourites row, not on the one it was proposed for.
  The screenshot also showed a defect the arithmetic could not have found: **the "Train type" caption
  had collapsed to a two-line "Train / type"**. A bare `<span>` in a flex row is a shrinkable item, and
  it was the one element in `.favs` with neither `flex:0 0 auto` nor `white-space:nowrap`. Fixed, with
  the CSS contract asserted in `train-class.mjs` (70 checks) — a unit test cannot see a wrap, but it
  can hold the two properties that prevent one.
  The open question I left after that — whether the fade is *visible enough in dark mode* — came back
  **answered, and answered against the first attempt: "it just looks chopped."** The ramp was 24px,
  which is roughly the last third of one ~64px chip, so most of the trailing chip stayed at full
  opacity and the eye still landed on the hard vertical cut at the container edge. Widened to 64px
  and front-loaded (a linear ramp spends most of its length near full opacity, which is the part that
  reads as solid). Dark-on-dark has little luminance to work with, so the dissolve has to be long and
  start early or it is not a dissolve at all.
  Worth naming: **all 24 fade checks passed on the version that was reported as chopped.** They assert
  a mask exists and is derived from a measured scroll position — not that it reads as a dissolve.
  `fade-edges.mjs` now carries a 25th that pins the measurable half (the ramp must be at least one
  chip wide), verified to go red at 24px and green at 64px. Whether it *looks* right is still a look,
  not a test; the test only stops that specific failure from recurring silently.
- **T11–T13:** unassigned, and deliberately below T1/T2 — each is a new panel, not a fix to a
  feature people already rely on.
- **55ef3834** verifies; **operator** merges + real-commute-accepts.
