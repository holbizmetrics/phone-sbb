# phone-sbb — Roadmap (pain-point triage)

**Source:** research brief `sbb-app-pain-points.md` (Swiss press, SBB community forum,
consumer-protection bodies, app-store aggregators). Triaged against what phone-sbb actually
is: a **client-side single-file web app** on the free `transport.opendata.ch` API — no
ticketing, no accounts, no ads, no tracking.

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
- **API check needed:** does opendata.ch expose a cancellation flag cleanly? (Delays: yes.)
- *Regression:* additive, but edits the hot path (`depRow` / `loadBoard` / `connCard`). One real
  destroy-mode → **false cancellation flags**; gate on real-data validation before merge.

**T2. Offline / PWA (§4)** — *"dead in tunnels, no meaningful offline mode."*
- Service worker + web manifest → installable + cached last board + a "stale as of HH:MM" marker.
- Device-independent (buildable off-phone).
- *Regression:* **this is the one item with real destroy-risk.** A careless service worker can
  (a) trap users on a stale cached app version so updates never reach them, (b) serve old
  departure times as if live, (c) break app load. Guard: **network-first for API data**,
  cache-first only for a **versioned shell**, explicit stale markers, `skipWaiting` /
  `clients.claim` update flow. Build on a branch; field-test in a real tunnel / airplane-mode
  before it touches master.

### Tier 2 — cheap, differentiating, near-zero risk (pure add)

**T3. Accessibility-by-default (§7)** — aria-labels on the icon buttons (refresh / star / clear
are currently unlabeled), semantic departure rows, and `prefers-reduced-motion` (which also
answers §1's "animation clutter, no opt-out" complaint for free). SBB shunts blind users to a
*separate* app; we can just be usable. *Regression:* **pure add** — attributes + a CSS media
query, no behavior change.

**T4. Stay the tidy utility (§1)** — we already *are* the scannable, no-animated-characters
utility the press asked for. Only actionable lesson: heed one-handed / moving-train use (careful
with swipe gestures, thumb-reachable targets). *Regression:* design discipline, no code churn.

**T5. Privacy, stated (§8)** — already true by architecture (no ads, no tracking, favourites in
localStorage only). Worth stating once; it is the trust SBB lost. *Regression:* text only.

### Tier 3 — small correctness notes

**T6. Umlaut / accent handling (§6)** — verify Zürich / Genève / Biel/Bienne resolve in station
search. A test, not a change.

**T7. One-shot geolocation (§3 lesson)** — *if* near-me / leave-now ever lands, use one-shot
`getCurrentPosition`, never background tracking — that is EasyRide's whole battery / permission
burden, avoided by design.

## Regression summary — the "does it add or destroy?" answer

| Item | Risk |
|---|---|
| T3 accessibility · T5 privacy · T4 discipline · T6 umlaut-verify | **Pure add — cannot break existing features** |
| T1 delay / cancellation | Additive but touches the hot path; one destroy-mode (false cancellation flags) → validate on real data |
| T2 offline / PWA | **Real destroy-risk in the caching layer** (stale shell / stale-data-as-live / broken load) → network-first data, versioned shell, field-test before merge |

**Net:** overwhelmingly additive. The fleet's existing flow — build on a branch → 55ef
cold-review → phone-claude field-test → operator merges — **is** the regression guard, and it
earns its keep most on T2.

## Suggested fleet split

- **T1 (delay / cancellation):** phone-claude — needs on-device + real-network validation (does a
  genuinely cancelled train flag correctly, with zero false positives?).
- **T2 (offline / PWA):** laptop (`a4a7aa69`) — device-independent; build the SW + manifest on a
  branch, field-tested offline before merge.
- **T3 (accessibility):** either desktop session; pure-add, low-coordination.
- **55ef3834** verifies; **operator** merges + real-commute-accepts.
