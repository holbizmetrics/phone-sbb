# Rail — live Swiss departures & smart journey planner

A fast, static departure board and journey planner for the Swiss rail
network. No build step, no dependencies, no API key — three plain files
(`index.html` + `app.css` + `app.js`) you can open anywhere, straight from disk.

**Live:** https://holbizmetrics.github.io/phone-sbb/

---

## What it's actually for

Five things normally live in five different apps: the timetable, the weather
where you're going, a map of where the train goes, the terrain it crosses, and
what the place you're passing even is. Standing on a platform with a train
about to leave is the worst possible moment to switch between them.

This puts them on one screen.

## The four tabs

Everything below hangs off one of these. The last two answer a question the
timetable is not shaped for — *you know when you are free, not where you want
to go* — and they are easy to miss if you only read the planning sections.

- **Departures** — the live board for one station. Real-time delays, platform
  changes, and what each train does *after* you get off it.
- **Journey** — A to B. The Smart change-finder (below) runs here by default.
- **Wander** — no destination. You pick how much time you have (1–6 h) and it
  finds where a train leaving soon can take you, showing only places it can
  *prove* you get home from in time — the last way back is printed on every card.
- **Touch** — planning without typing. The stations the app already knows about
  (your stars, recent routes, last board) become tiles; you drag a line from one
  to another and that line is the journey.

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
  requests a day for nobody. Refreshes **reconcile by train, not by position** —
  a departure that is still listed keeps its row when the one above it leaves,
  so only genuinely new departures animate in and a busy board stops flickering.
  Clearing the station also clears the board and its poller: a list under an
  empty box would read as departures for whatever you type next.
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
- **Sunset · Sunrise** — two more ways to say when, both of them arrive-by
  questions you shouldn't have to do arithmetic for. Each looks the time up *at
  the destination* on the day you are travelling and works backwards from it,
  because "get me there before dark" and "have me up there before first light"
  are real reasons to catch a particular train. Tap Sunset after dark, or
  Sunrise at any hour after dawn, and it plans for the next day rather than
  asking for an arrival that has already been and gone. The forecast reaches two
  days out; past that it says so rather than quietly answering about today.
  Sunrise fails more often than Sunset does, and says why: the first train of
  the day frequently cannot get you anywhere before the sun, and **"nothing runs
  that early" is printed as exactly that** — not as an empty result that looks
  like you misspelled the station.
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
- **Toilets near here** — under the departure board and under a planned journey:
  public toilets within 500 m from OpenStreetMap, nearest first, with fee,
  wheelchair access and opening hours when the map knows them. An absent tag stays
  absent; "the map lists none" is said as that, not as "there are none".
- **Natural wonders near your destination** — peaks, glaciers, waterfalls,
  caves and viewpoints from OpenStreetMap, with a Wikipedia summary where a
  confident match exists.
- **Is it worth going up today?** — when a leg is a cable car, gondola, cog
  railway or funicular you are on an excursion, and the question stops being
  "when do I arrive" and becomes "will there be a view". It shows the summit
  height, the forecast for the hour you actually get there, and a plain verdict:
  *fog at the top — expect no view* is the whole feature. City funiculars are
  excluded by altitude; a ride to a university terrace is not an excursion.
- **Worth stopping for, on the way** — every other rail app answers "how do I
  get from A to B". This one also answers *"I am crossing the country, where
  should I get off?"*. The stop list already carries coordinates and times, so
  one query over the whole corridor finds what is near the line, and pins each
  find to a stop the train genuinely calls at, with the time it arrives. The
  anchoring is the whole point: a peak thirty kilometres away is scenery, but a
  waterfall a short walk from a stop is a plan. First and last stations are
  excluded — you are already going there.
- **The last way back.** Open the route sketch and it tells you the last
  service home *counted from the moment you arrive* — and how long that leaves
  you there. The counting-from-your-arrival part is the whole feature: an
  evening timetable is full of departures you cannot reach, and one of those
  would say "you have four hours" to someone who has none. The window closes at
  **03:00 the next morning, not midnight**, because the last two boats back from
  Vitznau land at 00:01 and 00:24 and a midnight cutoff would hurry you off the
  lake an hour early. When there really is no way back — arrive at Jungfraujoch
  at 19:00 and there isn't one — it says so in as many words.
- **"Your train is a bus today."** Ersatzverkehr is the single most annoying
  thing a timetable can hide from you: the leg still looks like a train in the
  results, but it leaves from a kerb, takes longer, and isn't where you expect
  it. A replaced leg now carries a red rib naming exactly which stretch is the
  bus — *Luzern, Bahnhof → Küssnacht am Rigi* — because "there's a bus somewhere
  on this journey" is not something you can act on. A scheduled PostBus is
  **not** flagged: it isn't a surprise, and a warning that fires on half the
  network stops being a warning.
- **What you'll actually board**, when it isn't a train — boat, ferry, cable
  car, gondola, cog railway, funicular. `BAT 1` on a badge means nothing; *boat*
  tells you to look for a pier.
- **Which fare zones the leg crosses.** Open the stop list and a ribbon names
  the Tarifverbunde it passes through, in travel order — *TNW → ZVV* tells you
  a day pass for one city does not reach the other end. It names zones and
  stops there: it never says a ticket is valid, because whether yours covers
  this ride depends on tariff rules this app does not model, and a wrong yes
  there is a fine. Stops it cannot place are **counted, not dropped** ("2 stops
  outside any zone"), and a leg through Valais — which has no Tarifverbund at
  all — says so plainly rather than guessing a neighbour.

## Telling you what it doesn't know

Every derived number says where it came from, because a confident wrong
answer is worse than an absent one:

- The elevation strip is **ground height at each stop, joined by straight
  lines** — terrain, not railway data, and nothing about the track's own
  gradient. Routes with **fewer than four stops** get no strip at all rather
  than a made-up diagonal through country nobody measured.
- The moving train dot is interpolated, not tracked.
- A missing forecast reads as missing, never as `0°`.
- **"We could not reach OpenStreetMap" is never rendered as "there is nothing
  here."** Both the wonders list and the en-route finder tell you which one
  happened, and a failed lookup is not cached, so the next tap really retries.
- **Same rule on the journey search.** A refused, rate-limited or offline
  timetable request used to arrive at the screen as "No connections found —
  check the station names", sending you hunting for a typo in a name that was
  perfectly correct. An unreachable timetable now says so, and says explicitly
  that it is **not a "no"**. A hub sweep that times out stays silent, because a
  slow interchange has never meant the journey doesn't exist.
- If your phone isn't on Swiss time, a note says so — every time below is
  Swiss local, and the clock at the top is yours.
- **A phone with no free space says so and keeps working.** `localStorage` throws
  when the device can't write, and that used to take the whole app down with it —
  no journeys, no board, and a reload fixed nothing, because the disk was still
  full. Now only the *remembering* fails, and the app tells you which parts
  aren't being remembered rather than letting a star look like it stuck.
- **Recent routes record journeys that exist, not searches that were tried** — a
  mistyped station never becomes a permanent chip.

## Also

- **It tells you which build you are looking at** — at the foot of the help
  sheet (the **●**). "I retested and it still fails" and "I retested the old
  file" look identical from the outside, and that ambiguity cost a whole
  debugging round. The commit and time are stamped into the page at deploy
  time, and **the deploy fails if the stamp doesn't apply** — a version marker
  that quietly stopped updating would be worse than none, because it would be
  believed. A copy you opened yourself says `dev`, which is the truth.
- **Type a place, not a station.** The timetable's own lookup answers with shops,
  hotels and street addresses as well as stops; they arrive without an id and are
  dropped, correctly — a nail salon offered with a station glyph was a real defect.
  But the dropped row reads `NAME, TOWN, STREET NR`, and until now the only thing
  taken from it was the *town*. So typing a shop name got you that town's **famous**
  stations: for a Zürich address, Zürich HB and Oerlikon and Stadelhofen, when the
  stop you want may be 300 m from the door and on none of those lists. Right town,
  wrong stations.
  Now the address is offered as its own row. Tap it and the address is geocoded
  (Nominatim/OSM), then the timetable is asked which stops are near *those*
  coordinates — `nearbyStops()`, which has existed since **near me**. Distances are
  printed rather than sorted-and-chosen: the nearest stop is not always the best
  served, and comparing "307 m" against "412 m on a line that actually runs" is a
  judgement no sort order can make for you.
  **It fires on the tap and never while you type, and that is not politeness.**
  Nominatim's usage policy forbids autocomplete outright — *"you must not implement
  such a service"* — and the dropdown that would host it runs on every debounced
  keystroke, so the forbidden implementation is also the obvious one. Two tests hold
  that line: a structural one (the dropdown's code must never reach the geocoder)
  and a behavioural one (a spy that must record zero calls while typing). A mutation
  that moves the lookup into the keystroke path is planted, and both go red.
- **Save offline** — next to *Share this route*. Writes the connections currently
  on screen to a single self-contained `.html` file: inline styles, the route
  sketch inlined as SVG, and **zero network references**, which is asserted by a
  test rather than hoped for. The case is not battery, it is **no signal** —
  Swiss rail is tunnels, and the app is otherwise dead without a connection. The
  file opens in any browser with the radio off.
  It stamps when it was saved and says, at the top, that it is **a snapshot and
  does not update**. That line is load-bearing: a saved route rendered like the
  live app would let a train cancelled after saving still read as fine, and a
  file that lies is worse than no file. Times are taken **prognosis-first**, the
  same rule the journey card uses, so the file cannot disagree with the screen
  it was saved from.
- **Installable** — "Add to Home Screen" for an app-like, full-screen feel.
- **Dark and light** — dark is the default for everyone and it stays where
  you put it.

## What it deliberately isn't

No tickets, no prices, no reservations, no disruption bulletins, no step-free
or accessibility routing, no offline timetable. The official SBB app owns all
of that and this doesn't try to replace it — it's the thing you reach for in
the ninety seconds before a train leaves. The zone ribbon is not an exception:
naming the areas you cross is geography, and it stops one step short of the
tariff question on purpose.

**"No offline timetable" still holds, and *Save offline* is not an exception to
it.** A saved file is one plan, frozen: the connections you had on screen, at the
moment you pressed the button. You cannot look a *new* train up in it, it knows
nothing that happened afterwards, and it will not answer a question you did not
already ask. An offline timetable would be a copy of the network you can query
without signal — that is a different artifact, it is not here, and this button is
not a step toward it.

## Run it locally

It's a single static file — just open it, or serve the folder:

```bash
python3 -m http.server 8090
# then open http://localhost:8090/
```

Works identically on desktop and phone.

## How it's built

- **Three plain files.** `index.html` (markup), `app.css`, `app.js` — vanilla,
  no framework, no bundler, no build step. It began as one file and was split
  2026-07-28 when that file passed 3000 lines; `app.js` is a plain script
  (not a module), so opening `index.html` straight from disk still works.
- **Data:**

  | Source | Used for |
  | --- | --- |
  | [transport.opendata.ch](https://transport.opendata.ch/) | departures, journeys, every intermediate stop, platforms, live prognosis |
  | [Open-Meteo](https://open-meteo.com/) forecast | weather at the departure and arrival hour |
  | Open-Meteo elevation | terrain height along the route |
  | [Overpass](https://overpass-api.de/) / OpenStreetMap | peaks, glaciers, waterfalls, caves, viewpoints, public toilets |
  | Wikipedia REST + geosearch | what that place is |
  | [data.sbb.ch](https://data.sbb.ch/) tarifverbundkarte + haltestelle-haltekante | which Tarifverbund each stop sits in (precomputed offline, shipped inline) |

- **The one precomputed table.** Fare-zone membership is the only thing the app
  does not fetch live: the zone polygons are 4.4 MB, so `tools/build-verbund.py`
  runs the point-in-polygon offline and pastes 17 KB of answers into
  `index.html`. A maintainer reruns it when Verbund boundaries move
  (`--check` fails if the file is stale). Users still get one HTML file.

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
node tests/enroute.mjs          # where to get off — runs anywhere, no browser
node tests/toilets.mjs          # toilets near here — runs anywhere, no browser
node tests/offline-export.mjs   # the saved .html is honest and self-contained — 28 checks
node tests/place-to-stops.mjs   # address → coordinates → nearest stops, tap-only — 25 checks
node tests/summit.mjs           # is it worth going up — runs anywhere, no browser
node tests/storage-full.mjs     # a full phone must not kill the app — runs anywhere
node tests/board-refresh.mjs    # the 30s refresh keeps its rows — runs anywhere
node tests/outage-not-verdict.mjs # an outage is not "no such journey" — runs anywhere
node tests/verbund.mjs          # fare-zone lookup — the negatives are the point
node tests/vehicle.mjs          # boat / cog / replacement-bus signals — runs anywhere
node tests/last-home.mjs        # the last way back — and an outage is not "no way back"
node tests/smoke.mjs            # Playwright end-to-end — CI only
```

Everything but the last one lifts the real functions straight out of the app
(`tests/_src.mjs` assembles `index.html` with `app.css` and `app.js` inlined,
the way the browser sees the page) and runs
them in Node against a stub DOM (and, where it matters, a frozen clock), so the
logic stays testable on a phone where
Playwright can't be installed. Each one carries a control that fails if the
harness itself stopped working — a check that silently doesn't run reads as a
pass, which is worse than no check at all.

### Preview on the phone without deploying

```sh
cd ~/phone-sbb && python -m http.server 8080
```

then open `http://localhost:8080` in the phone's browser — the same device the
app is for, with uncommitted changes visible instantly. The push → CI → Pages →
reload loop (~2 min) is only needed for the final verify; every visual defect so
far (the wrapping caption, the chopped fade) was found by looking, not by tests,
so shortening this loop is worth more than another assertion.

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
