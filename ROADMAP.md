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

## Regression summary — the "does it add or destroy?" answer

| Item | Risk |
|---|---|
| T3 accessibility · T5 privacy · T4 discipline | **Pure add — cannot break existing features** |
| T6 umlaut | **Done** — verified against the live API, no change needed |
| T1 delays | Additive but touches the hot path |
| T1 cancellations | **Blocked upstream — the API carries no cancellation flag.** Do not infer one |
| T2 offline / PWA | Installable half **done** (manifest shipped). The service worker is where the **real destroy-risk** lives (stale shell / stale-data-as-live / broken load) → network-first data, versioned shell, field-test before merge |

**Net:** overwhelmingly additive. The fleet's existing flow — build on a branch → 55ef
cold-review → phone-claude field-test → operator merges — **is** the regression guard, and it
earns its keep most on T2.

## Suggested fleet split

- **T1 (delays):** phone-claude — needs on-device + real-network validation. The cancellation
  half is off the table until the API grows a flag.
- **T2 (service worker):** laptop (`a4a7aa69`) — device-independent; build on a branch,
  field-tested offline before merge. The manifest is already on master.
- **T3 (accessibility):** either desktop session; pure-add, low-coordination.
- **55ef3834** verifies; **operator** merges + real-commute-accepts.
