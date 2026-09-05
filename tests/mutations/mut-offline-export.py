#!/usr/bin/env python3
"""Mutation score for the offline export (2026-09-05).

Asks the only question worth asking about a new suite: if someone puts the
defect back, does the suite go red?

The five mutants are the five ways a saved route betrays you, and every one of
them is silent at save time -- you find out in the tunnel, which is the one
place you cannot re-check:

  M1  read the SCHEDULED time instead of the prognosis. The file then disagrees
      with the card it was saved from. This is connCard's own recorded defect
      ("14:02" here, "14:02 +11" there) re-applied to the export.
  M2  drop the "this is a snapshot" warning. The document then looks live, and a
      train cancelled after saving reads as fine.
  M3  reference a stylesheet over the network. Renders perfectly on the couch
      and unstyled in the tunnel -- the exact situation the file exists for.
  M4  stop escaping a station name. Names come off the wire.
  M5  swallow the save error. A download that silently does nothing is
      indistinguishable from a button that was never wired -- the shape this
      repo keeps catching.

Scored on the suite's EXIT CODE, unpiped. Every anchor is asserted to appear
exactly once before it is touched, and the file is restored in a `finally`
whatever happens.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / "app.js"
SUITE = "tests/offline-export.mjs"

MUTANTS = [
    ("M1 scheduled time instead of prognosis",
     'var dep = (c.from && c.from.prognosis && c.from.prognosis.departure) || (c.from && c.from.departure);',
     'var dep = (c.from && c.from.departure);'),

    ("M2 the snapshot warning removed",
     '<b>This is a snapshot, not a live timetable.</b>',
     '<b>Your route</b>'),

    ("M3 a stylesheet fetched over the network",
     "+ '<style>\\n'",
     "+ '<link rel=\"stylesheet\" href=\"https://example.com/x.css\"><style>\\n'"),

    ("M4 a station name no longer escaped",
     "+ '<div class=\"ep\">'+esc(r.from)+' \\u2192 '+esc(r.to)+'</div>'",
     "+ '<div class=\"ep\">'+r.from+' \\u2192 '+r.to+'</div>'"),

    ("M5 the save error swallowed",
     'say("Could not save: "+((e && e.message) || "unknown"));',
     '/* swallowed */;'),
]


def run_suite():
    """Exit code IS the verdict. Not piped -- a pipeline would report the pipe."""
    return subprocess.run([sys.executable and "node", SUITE], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def main():
    original = APP.read_bytes().decode("utf-8")

    # Control first: the suite must be GREEN before any mutant, or a red result
    # below proves nothing about the mutant.
    if run_suite() != 0:
        print("CONTROL FAILED -- the suite is already red on unmutated source; "
              "a mutation score would be meaningless. Fix that first.")
        return 1

    print("control: suite GREEN on unmutated source\n")
    caught = 0
    try:
        for name, find, replace in MUTANTS:
            n = original.count(find)
            if n != 1:
                print(f"  ANCHOR  {name}: appears {n} times, expected exactly 1 -- "
                      f"the mutant cannot be placed unambiguously")
                continue
            APP.write_bytes(original.replace(find, replace, 1).encode("utf-8"))
            rc = run_suite()
            if rc != 0:
                caught += 1
                print(f"  caught  {name}")
            else:
                print(f"  SURVIVED {name}  <- the suite does not cover this")
    finally:
        APP.write_bytes(original.encode("utf-8"))

    print(f"\nmutation score: {caught}/{len(MUTANTS)} caught")
    # Restoration is itself checked: a mutation run that leaves the tree dirty
    # is worse than one that never ran.
    if APP.read_bytes().decode("utf-8") != original:
        print("RESTORE FAILED -- app.js is not back to its original content")
        return 1
    print("app.js restored, suite green again" if run_suite() == 0 else "RESTORE LEFT THE SUITE RED")
    return 0 if caught == len(MUTANTS) else 1


if __name__ == "__main__":
    sys.exit(main())
