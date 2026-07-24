# Rail — live Swiss departures & smart journey planner

A fast, single-file departure board and journey planner for the Swiss rail
network. No build step, no dependencies, no API key — one HTML file you can
open anywhere.

**Live:** https://holbizmetrics.github.io/phone-sbb/

---

## The Smart change-finder

The reason this exists. The official app shows you *one* default list of
connections — and it quietly buries better routes that you'd only find by
searching manually ("what if I change at Zürich instead?"), while hiding a
nerve-wracking tight transfer inside its top pick.

Smart mode (on by default, toggle on the **Journey** tab) does that manual
search for you, every time:

- **Widens the scan** to 16 results instead of the handful you normally see.
- **Sweeps the interchange hubs** — it re-runs the search *via* Zürich HB,
  Bern, Basel SBB, Luzern, Olten, Arth-Goldau, Lausanne, Biel, Zürich
  Flughafen and Winterthur, in parallel, to surface routes the default list
  never led with.
- **Reads the real transfer buffer** at every change (the actual minutes
  between one train arriving and the next leaving) and flags **tight**
  changes under 5 minutes so a 4-minute platform sprint never surprises you.
- **Badges the smart picks** — the options that arrive earlier or give you a
  roomier, calmer transfer than the default did.

Turn the toggle off any time for the plain, single-list view.

## Also

- **Live departures board** — search any station, real-time countdowns,
  delay (`+N`) and platform-change warnings, auto-refresh.
- **One-tap favourites** — star your regular stations.
- **Journey planner** — from/to with autocomplete, swap, per-leg lines.
- **Installable** — "Add to Home Screen" for an app-like, full-screen feel.
- **Dark, tactile UI** built for the phone first.

## Run it locally

It's a single static file — just open it, or serve the folder:

```bash
python3 -m http.server 8090
# then open http://localhost:8090/
```

Works identically on desktop and phone.

## How it's built

- **One file.** Vanilla HTML/CSS/JS, no framework, no bundler.
- **Data:** the free [Swiss public-transport API](https://transport.opendata.ch/)
  (`transport.opendata.ch`) — open data, CORS-enabled, no key required.
- **Endpoints used:** `/stationboard` (departures), `/connections`
  (journeys, with multi-`via[]` hub sweeps), `/locations` (autocomplete).

## Credits

Timetable data by [transport.opendata.ch](https://transport.opendata.ch/),
built on the [opentransportdata.swiss](https://opentransportdata.swiss/)
open dataset. Not affiliated with SBB.
