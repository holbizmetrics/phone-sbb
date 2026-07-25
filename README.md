# Rail — live Swiss departures & smart journey planner

A fast, single-file departure board and journey planner for the Swiss rail
network. No build step, no dependencies, no API key — one HTML file you can
open anywhere.

**Live:** https://holbizmetrics.github.io/phone-sbb/

---

## What it's actually for

Five things normally live in five different apps: the timetable, the weather
where you're going, a map of where the train goes, the terrain it crosses, and
what the place you're passing even is. Standing on a platform with a train
about to leave is the worst possible moment to switch between them.

This puts them on one screen.

## The Smart change-finder

The reason this exists. The official app shows you *one* default list of
connections — and it quietly buries better routes that you'd only find by
searching manually ("what if I change at Zürich instead?"), while hiding a
nerve-wracking tight transfer inside its top pick.

Smart mode (on by default, toggle on the **Journey** tab) does that manual
search for you, every time:

- **Widens the scan** to 16 results instead of the handful you normally see.
- **Sweeps the interchange hubs** — it re-runs the search *via* Zürich HB,
  Bern, Basel SBB, Luzern, Olten, Arth-Goldau, Lausanne, Biel/Bienne, Zürich
  Flughafen and Winterthur, in parallel, to surface routes the default list
  never led with.
- **Reads the real transfer buffer** at every change (the actual minutes
  between one train arriving and the next leaving) and flags **tight**
  changes under 5 minutes so a 4-minute platform sprint never surprises you.
  A change you *cannot* make — where the delay lands you after the onward
  train has gone — is kept and labelled **missed by N′** rather than dropped,
  because a hidden impossible change makes the journey you'll miss look like
  the cleanest one on the list.
- **Badges the smart picks** — the options that arrive earlier or give you a
  roomier, calmer transfer than the default did.

Turn the toggle off any time for the plain, single-list view.

## On the platform

- **Live departures board** — any station, real-time countdowns, `+N′` delay
  chips, platform-change warnings in amber, auto-refresh every 30 seconds.
  The board **stops polling when the tab is hidden** and catches up when you
  come back; a forgotten background tab used to cost the free API ~2,900
  requests a day for nobody.
- **Real times, not scheduled ones.** Cards and board read the same live
  prognosis, so the same train can't show `14:02` in one place and
  `14:02 +11′` in the other.
- **Platform detail** — `Pl. 7` is where you leave from; `7→5` on a change
  means you arrive at 7 and depart from 5, so you know to cross the station.
- **One-tap favourites** — star your regular stations.
- **Tap a row** to see where that train actually goes, every stop with times —
  then **tap the destination to plan a journey on _that_ train**, not a
  generic search starting now.

## Planning

- **From / to with autocomplete**, swap, per-leg coloured lines. **Enter**
  searches from either field; arrow keys pick from the dropdown.
- **Now · Leave at · Arrive by** — "Arrive by" works backwards from when you
  have to be there.
- **Sunset** — a fourth way to say when. It looks up sunset *at the destination*
  on the day you are travelling and works backwards from that, because "get me
  there before dark" is a real reason to catch an earlier train and not a sum
  anyone should be doing on a platform. Tap it after dark and it plans for
  tomorrow. The forecast reaches two days out; past that it says so rather than
  quietly answering about today.
- **Scenic** floats panoramic routes (via Zweisimmen, Andermatt, Chur, Brig)
  to the top when one exists.
- **Weather** at your departure hour *and* your arrival hour — the two that
  actually matter, not "today".
- **Route sketch** of the whole journey with a pulsing dot for roughly where
  the train is now (interpolated from the timetable — it is explicitly *not*
  GPS, and says so).
- **Elevation strip** under the sketch, so a valley run and a mountain climb
  are one glance apart. Climb and descent are counted separately: a journey
  down off a summit *descends*, and saying "climbs" there was worse than
  saying nothing.
- **Natural wonders near your destination** — peaks, glaciers, waterfalls,
  caves and viewpoints from OpenStreetMap, with a Wikipedia summary where a
  confident match exists.

## Telling you what it doesn't know

Every derived number says where it came from, because a confident wrong
answer is worse than an absent one:

- The elevation strip is **ground height at each stop, joined by straight
  lines** — terrain, not railway data, and nothing about the track's own
  gradient. Routes with **fewer than four stops** get no strip at all rather
  than a made-up diagonal through country nobody measured.
- The moving train dot is interpolated, not tracked.
- A missing forecast reads as missing, never as `0°`.
- If your phone isn't on Swiss time, a note says so — every time below is
  Swiss local, and the clock at the top is yours.

## Also

- **Installable** — "Add to Home Screen" for an app-like, full-screen feel.
- **Dark and light** — dark is the default for everyone and it stays where
  you put it.

## What it deliberately isn't

No tickets, no fares, no reservations, no disruption bulletins, no step-free
or accessibility routing, no offline timetable. The official SBB app owns all
of that and this doesn't try to replace it — it's the thing you reach for in
the ninety seconds before a train leaves.

## Run it locally

It's a single static file — just open it, or serve the folder:

```bash
python3 -m http.server 8090
# then open http://localhost:8090/
```

Works identically on desktop and phone.

## How it's built

- **One file.** Vanilla HTML/CSS/JS, no framework, no bundler, no build step.
- **Data:**

  | Source | Used for |
  | --- | --- |
  | [transport.opendata.ch](https://transport.opendata.ch/) | departures, journeys, every intermediate stop, platforms, live prognosis |
  | [Open-Meteo](https://open-meteo.com/) forecast | weather at the departure and arrival hour |
  | Open-Meteo elevation | terrain height along the route |
  | [Overpass](https://overpass-api.de/) / OpenStreetMap | peaks, glaciers, waterfalls, caves, viewpoints |
  | Wikipedia REST + geosearch | what that place is |

- **Endpoints:** `/stationboard`, `/connections` (with multi-`via[]` hub
  sweeps) and `/locations` on transport.opendata.ch; `/v1/forecast` and
  `/v1/elevation` on Open-Meteo.
- **Politeness:** transport.opendata.ch is a volunteer service. Hub sweeps are
  batched, results are cached, and polling stops the moment the tab is hidden.

## Tests

```bash
node tests/syntax-check.mjs     # parses the inline script — runs anywhere
node tests/boot-wiring.mjs      # remembered state is actually drawn on load
node tests/keyboard.mjs         # Enter/arrow handling — runs anywhere, no browser
node tests/mode-filter.mjs      # transport-mode filter — runs anywhere, no browser
node tests/route-history.mjs    # route chips — runs anywhere, no browser
node tests/golden-hour.mjs      # arrive-before-sunset — runs anywhere, no browser
node tests/smoke.mjs            # Playwright end-to-end — CI only
```

Everything but the last one lifts the real functions straight out of `index.html` and runs
them in Node against a stub DOM (and, where it matters, a frozen clock), so the
logic stays testable on a phone where
Playwright can't be installed. Each one carries a control that fails if the
harness itself stopped working — a check that silently doesn't run reads as a
pass, which is worse than no check at all.

CI runs the full smoke suite on every branch and pull request; `master`
deploys only on green. The suite covers the change-buffer maths, prognosis
rendering, elevation profiles, escaping of API text, and the timezone note in
both a Swiss and a non-Swiss device timezone — CI runs in UTC and a phone
doesn't, and that gap has broken assertions more than once.

## Credits

Timetable data by [transport.opendata.ch](https://transport.opendata.ch/),
built on the [opentransportdata.swiss](https://opentransportdata.swiss/)
open dataset. Elevation and forecast by [Open-Meteo](https://open-meteo.com/).
Places from [OpenStreetMap](https://www.openstreetmap.org/) contributors and
Wikipedia. Not affiliated with SBB.
