#!/usr/bin/env python3
"""Mutation score for place-to-stops (2026-09-05).

M1 is the reason this file exists. Nominatim's usage policy forbids autocomplete
outright -- "you must not implement such a service" -- and wireAC's dropdown runs
on every debounced keystroke, computing the very dropped row the geocoder wants.
So the banned implementation is also the OBVIOUS one, and the only thing standing
between this app and a ban is a guard that must be shown to work. M1 plants
exactly the edit a well-meaning future session would make ("why make them tap?").

The rest are the ordinary ways this feature rots:

  M2  a failed REQUEST returns null instead of throwing, so an outage renders as
      "the map does not know this address" -- absence-of-data as data, the defect
      this codebase has fixed more times than any other.
  M3  a two-field row counts as an address, so a row with no street is offered
      and dies at tap time instead of never being offered.
  M4  the cache is dropped, so one tap becomes many requests against a service
      that rate-limits at 1/s.
  M5  the privacy disclosure keeps saying "four services" while the code talks to
      five -- the user-facing sentence becomes a lie.

Scored on EXIT CODES of the suites that should notice, unpiped. Anchors asserted
unique before use; app.js and index.html restored in a `finally`.
"""
import pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / "app.js"
HTML = ROOT / "index.html"

SUITES = ["tests/place-to-stops.mjs", "tests/station-lookup.mjs", "tests/privacy.mjs"]

MUTANTS = [
    ("M1 the geocode moved into the keystroke path (the FORBIDDEN implementation)",
     APP,
     "        pendingPlace = placeFromDropped(droppedRows);",
     "        pendingPlace = placeFromDropped(droppedRows);\n"
     "        if(pendingPlace) await geocodePlace(pendingPlace.query);"),

    ("M2 a failed request returns null instead of throwing",
     APP,
     '  if(!res.ok) throw new Error("HTTP " + res.status);          // caller distinguishes this',
     '  if(!res.ok) return null;'),

    ("M3 a two-field row accepted as an address",
     APP,
     "    if(parts.length>=3) seen.push(parts);",
     "    if(parts.length>=1) seen.push(parts);"),

    # Added after the operator opened a real export and asked why an address query
    # named a stranger's business. Removing the bare-address branch is the state
    # this feature actually shipped in for one commit.
    ("M7 the bare-address row no longer wins over the businesses at that address",
     APP,
     "    if(parts.length===2 && /\\d/.test(parts[1]))",
     "    if(false)"),

    # Added after the live run: the unit tests stubbed fetch and were perfectly
    # happy geocoding the row as it arrived, while the real service returned
    # nothing for it (measured on two specimens, both directions). The suite now
    # pins the reordering, so this mutant puts the ships-green-never-runs bug back.
    ("M6 the row geocoded as it arrived, business name and all (live-verified defect)",
     APP,
     '    return { query: addr + ", " + town, label: parts[0], town, addr };',
     '    return { query: r.name, label: parts[0], town, addr };'),

    ("M4 the geocode cache dropped -- one tap becomes many requests",
     APP,
     "  if(placeCache.has(q)) return placeCache.get(q);",
     "  /* no cache */"),

    ("M5 the privacy disclosure still claims four services",
     HTML,
     "        exactly five services, each with only what the question needs",
     "        exactly four services, each with only what the question needs"),
]


def suites_red():
    """True if ANY suite that should notice goes red. Exit codes, never a pipe."""
    for suite in SUITES:
        if subprocess.run(["node", suite], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
            return True
    return False


def main():
    originals = {APP: APP.read_bytes().decode("utf-8"), HTML: HTML.read_bytes().decode("utf-8")}

    # Control. A red suite before any mutation makes every result below meaningless.
    if suites_red():
        print("CONTROL FAILED -- a suite is already red on unmutated source. "
              "A mutation score measured against that proves nothing.")
        return 1
    print("control: all %d suites GREEN on unmutated source\n" % len(SUITES))

    caught = 0
    try:
        for name, path, find, replace in MUTANTS:
            base = originals[path]
            n = base.count(find)
            if n != 1:
                print(f"  ANCHOR  {name}: appears {n} times, expected 1 -- cannot place unambiguously")
                continue
            path.write_bytes(base.replace(find, replace, 1).encode("utf-8"))
            if suites_red():
                caught += 1
                print(f"  caught  {name}")
            else:
                print(f"  SURVIVED {name}  <- nothing covers this")
            path.write_bytes(base.encode("utf-8"))
    finally:
        for path, text in originals.items():
            path.write_bytes(text.encode("utf-8"))

    print(f"\nmutation score: {caught}/{len(MUTANTS)} caught")
    if any(p.read_bytes().decode("utf-8") != t for p, t in originals.items()):
        print("RESTORE FAILED -- the tree is not back to its original content")
        return 1
    print("tree restored; suites green again" if not suites_red() else "RESTORE LEFT A SUITE RED")
    return 0 if caught == len(MUTANTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
