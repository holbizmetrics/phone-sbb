#!/usr/bin/env python3
"""Mutation score for three 2026-09-06 changes that share one root: state derived
from something that can change underneath it.

  M1  toilets dropped from the layover Overpass query -- the panel goes back to
      offering coffee and never a toilet on a 20-minute change.
  M2  toilets deduped by NAME again -- every unnamed one shares "Public toilets",
      so all but the first Overpass happened to list collapse away.
  M3  the guaranteed toilet slot removed -- six nearer cafés crowd it out.
  M4  the sketch-label collision bug restored -- origin deduped by its FULL name,
      so "Kloten, Zum Wilden Mann" and "Kloten, Bahnhof" both render "Kloten".
  M5  meeting points NOT retracted on replan -- stale cards with live buttons.
  M6  meetLeg reads the LIVE fields instead of the pair the cards were for --
      after "my leg", "their leg" plans from the meeting point.

Scored on suite exit codes, unpiped. Anchors asserted unique; bytes restored.
"""
import pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / "app.js"
SUITES = ["tests/layover-poi.mjs", "tests/sketch-labels.mjs", "tests/meet.mjs"]

MUTANTS = [
    ("M1 toilets dropped from the layover query",
     "    +`node(around:${r},${lat},${lon})[amenity=toilets];`",
     ""),
    ("M2 toilets deduped by shared synthetic name",
     "    const key = wc ? `wc@${(+la).toFixed(5)},${(+lo).toFixed(5)}` : name;",
     "    const key = name;"),
    ("M3 the guaranteed toilet slot removed",
     "  if(nearestWc && !top.includes(nearestWc)) top[top.length-1]=nearestWc;",
     "  /* no slot */"),
    ("M4 sketch labels: origin deduped by FULL name (the Kloten/Kloten bug)",
     "  const marks=[{p:legs[0].pts[0], t:shortStop(legs[0].pts[0].name)}];",
     "  const marks=[{p:legs[0].pts[0], t:legs[0].pts[0].name}];"),
    ("M5 meeting points not retracted on replan",
     "  if(!(opts && opts.keepMeet)) meetInvalidate();",
     "  /* not retracted */"),
    ("M6 meetLeg reads live fields, not the pair",
     "  const f = theirs ? meetFor.to : meetFor.from;",
     "  const f = theirs ? toName : fromName;"),
]


def suites_red():
    for suite in SUITES:
        if subprocess.run(["node", suite], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
            return True
    return False


def main():
    original = APP.read_bytes().decode("utf-8")
    if suites_red():
        print("CONTROL FAILED -- a suite is already red on unmutated source; a score would mean nothing.")
        return 1
    print("control: all %d suites GREEN on unmutated source\n" % len(SUITES))
    caught = 0
    try:
        for name, find, replace in MUTANTS:
            n = original.count(find)
            if n != 1:
                print(f"  ANCHOR  {name}: appears {n} times, expected 1 -- cannot place unambiguously")
                continue
            APP.write_bytes(original.replace(find, replace, 1).encode("utf-8"))
            if suites_red():
                caught += 1; print(f"  caught  {name}")
            else:
                print(f"  SURVIVED {name}  <- nothing covers this")
            APP.write_bytes(original.encode("utf-8"))
    finally:
        APP.write_bytes(original.encode("utf-8"))
    print(f"\nmutation score: {caught}/{len(MUTANTS)} caught")
    if APP.read_bytes().decode("utf-8") != original:
        print("RESTORE FAILED"); return 1
    print("app.js restored; suites green again" if not suites_red() else "RESTORE LEFT A SUITE RED")
    return 0 if caught == len(MUTANTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
