#!/usr/bin/env python3
"""Evidence for the `phrasing` axis. Writes tests/passengers/phrasing-evidence.json.

Why this exists as a script rather than a paragraph: the app does NO fuzzy
matching of its own. `wireAC` (app.js) hands the raw box text to
/locations?type=station&query= and renders the top 7 as tappable rows. So for
this axis the API's answer IS the app's answer, and every status in axes.mjs
would otherwise rest on my memory of a lookup I did once.

The measured property is NOT "did it return something" -- everything returns
something, which is the trap. It is: **is the row a place a train stops?**
Real stops carry an `id`; businesses, hotels and street addresses come back
`id: null`. app.js already knows this -- `nearbyStops` filters `x.id && x.name`
with a comment saying exactly that -- but `locations()`, the typed path, filters
only `x.name`.

SERIAL with a delay on purpose: this API rate-limits with HTTP 429 (measured
2026-07-30: 40 parallel -> 23 refused). A burst would poison the result and
degrade the live app at the same time.
"""
import json, os, time, urllib.parse, urllib.request

BASE = "https://transport.opendata.ch/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "phrasing-evidence.json")

SPECIMENS = {
    "hb-airport-conflation": ["Zurich Airport", "Zürich Flughafen", "Zürich"],
    "misspelled-station":    ["Zuerich HB", "Luzren", "Genve", "Basel SBB "],
    "colloquial-place":      ["Hauptbahnhof", "Bern Bahnhof", "Zürich Hauptbahnhof"],
    "landmark-not-station":  ["Matterhorn", "Rheinfall", "Bundeshaus", "Jet d'Eau"],
    "foreign-language":      ["Zurigo", "Geneva", "Lucerne", "Bâle"],
    "abbreviation":          ["ZH HB", "ZRH", "SG", "BS"],
    "zip-code":              ["8001", "6003", "3000"],
    "ambiguous-city":        ["Basel", "Baden", "Neuchâtel"],
    # control: nothing can match this, so it exercises the branch where the
    # dropdown is simply hidden with no word said (app.js wireAC, `if(!s.length)`)
    "_control-no-match":     ["qxzvwqbbzz"],
}


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.load(r)


def rows(q):
    d = get("/locations?type=station&query=" + urllib.parse.quote(q))
    # This probe measures the API, not the app -- so both the pre-fix and the
    # post-fix view are computable from one call, and re-running after the fix
    # reproduces the pre-fix numbers rather than overwriting them.
    kept = [s for s in (d.get("stations") or []) if s.get("name")]      # old locations(): name only
    shown = kept[:7]                                                    # what wireAC rendered
    real = [s for s in kept if s.get("id")]                             # new locations(): id && name
    return {
        "kept": len(kept),
        "shown": [{"name": s["name"], "id": s.get("id")} for s in shown],
        "shown_nonstation": sum(1 for s in shown if not s.get("id")),
        "top_is_station": bool(shown and shown[0].get("id")),
        # post-fix: what the passenger is offered now. 0 means the query now
        # gets "No station matches" -- still LEFT_BEHIND, but honestly so.
        "stations_available": len(real),
        "shown_after_fix": [s["name"] for s in real[:7]],
    }


ev = {"_measured": time.strftime("%Y-%m-%d"), "axes": {}}
for axis, queries in SPECIMENS.items():
    ev["axes"][axis] = {}
    for q in queries:
        try:
            ev["axes"][axis][q] = rows(q)
        except Exception as e:
            ev["axes"][axis][q] = {"error": f"{type(e).__name__}: {e}"}
        r = ev["axes"][axis][q]
        print(f"  {axis:24s} {q!r:24s} kept={r.get('kept')} "
              f"non-station-in-top-7={r.get('shown_nonstation')} "
              f"top-is-station={r.get('top_is_station')} "
              f"| after-fix={r.get('shown_after_fix')}", flush=True)
        time.sleep(1.2)

# What the app does DOWNSTREAM with a name that is not a stop: the autocomplete
# row is tappable, so this text can reach /connections as a real query.
ev["downstream"] = {}
for name in ["Bundeshaus", "SRG SSR Bundeshaus, Bern, Bundesgasse 8-12"]:
    try:
        d = get("/connections?limit=1&from=" + urllib.parse.quote(name) + "&to=Bern")
        ev["downstream"][name] = {
            "connections": len(d.get("connections") or []),
            "from_resolved_to": ((d.get("connections") or [{}])[0].get("from", {})
                                 .get("station", {}).get("name") if d.get("connections") else None),
        }
    except Exception as e:
        ev["downstream"][name] = {"error": f"{type(e).__name__}: {e}"}
    print(f"  downstream {name!r:46s} -> {ev['downstream'][name]}", flush=True)
    time.sleep(1.2)

json.dump(ev, open(OUT, "w"), ensure_ascii=False, indent=1)
print("\nwritten", OUT)
