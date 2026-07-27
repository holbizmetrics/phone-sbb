# phone-sbb — Roadmap (pain-point triage)

**Source:** research brief `sbb-app-pain-points.md` (Swiss press, SBB community forum,
consumer-protection bodies, app-store aggregators). Triaged against what phone-sbb actually
is: a **client-side single-file web app** on the free `transport.opendata.ch` API — no
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
honoured app-wide. SBB shunts blind users to a *separate* app; we can just be usable. **What is
genuinely left:** semantic departure rows (the board is `div`s, so a screen reader reads a wall
of text with no row boundaries), and a check that the live-updating board announces changes
without shouting over the user. *Regression:* **pure add** — attributes and roles, no behavior
change.

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

**T8. Train sub-categories (ICE/IC/IR/RE/S) — buildable, client-side.** *Verified:* every section
carries `journey.category` (`"RE"`) plus `categoryCode` and `subcategory`; the probe returned
`products: ["RE24", "IR 16"]`. The API's `transportations[]` parameter has no sub-train granularity,
so this is **not** a query change — it is a post-filter over results we already parse (the vehicle
ribs read `journey.category` today). Worth it for the commuter case the official app clearly built
it for: "IC only, I am not standing through eight regional stops."
- *Regression:* additive, but it is a **filter that can empty the result list**, so it must ship
  with its `modeWhyEmpty()` sentence the way the existing mode chips did — a bare "no connections"
  after ticking *IC only* would read as a broken search. Post-filtering also interacts with `limit`:
  filtering client-side can leave one result out of a page of six, so the display must be honest
  about having filtered rather than implying the timetable is that thin.

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

**T11. Live webcams at the destination** — the mountain-trip case: before committing to a cable car,
see whether the summit is in cloud. Distinct from a forecast because it is *now* and it is *evidence*.
Source not yet chosen. *Regression:* pure add (one more panel section), but it is a **third-party
image fetch** — it needs the same three-outcome discipline the last-train panel uses, or "we could
not reach the camera" renders as "the weather is bad", which is a verdict we did not earn.

**T12. Meet-in-the-middle** — two people, two origins, find the station that is fair to both.
*Regression:* pure add, but **N×M queries** against a volunteer API — must be bounded and fired on
explicit request only, never on render.

**T13. Airport / flight mode** — "be at the gate by HH:MM", working backwards through check-in and
security. *Regression:* the check-in buffer is a **CLAIM**, not timetable data. A fixed "be there 2h
before" is us inventing an airline's policy; it must be user-set or plainly labelled a rule of thumb,
or this becomes the one feature that makes someone miss a flight.

**T14. ~~One-shot GPS on the sketch~~** — folded into **T7**; same discipline (one-shot
`getCurrentPosition`, never background tracking).

**T15. ~~Accessibility from OSM wheelchair tags~~** — folded into **T10**, where the live-API check
and the reason not to ship it now sit together.

## Regression summary — the "does it add or destroy?" answer

| Item | Risk |
|---|---|
| T3 accessibility · T5 privacy · T4 discipline | **Pure add — cannot break existing features** |
| T6 umlaut | **Done** — verified against the live API, no change needed |
| T1 delays | Additive but touches the hot path |
| T1 cancellations | **Blocked upstream — the API carries no cancellation flag.** Do not infer one |
| T2 offline / PWA | Installable half **done** (manifest shipped). The service worker is where the **real destroy-risk** lives (stale shell / stale-data-as-live / broken load) → network-first data, versioned shell, field-test before merge |
| T11 webcams · T12 meet-in-the-middle | **Pure add**, but each carries one named trap: an unreachable camera must not render as bad weather; N×M queries must be bounded and on-request |
| T8 train sub-categories | Additive post-filter, but it **can empty the result list** — ships with its own why-empty sentence, and must not imply a thin timetable |
| T13 airport mode | Additive, but the check-in buffer is a **CLAIM** — user-set or labelled, never invented |
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
- **T8 (train sub-categories):** either desktop session — it is a post-filter over parsed results,
  no device needed; the why-empty sentence is the part that needs care, not the filter.
- **T11–T13:** unassigned, and deliberately below T1/T2 — each is a new panel, not a fix to a
  feature people already rely on.
- **55ef3834** verifies; **operator** merges + real-commute-accepts.
