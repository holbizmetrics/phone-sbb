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
