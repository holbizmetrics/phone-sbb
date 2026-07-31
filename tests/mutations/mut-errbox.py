#!/usr/bin/env python3
"""Mutation score for the 2026-07-30 rate-limit-honesty fix.

The defect being scored against is not "a wrong string" -- it is a REASON being
discarded. So the mutations put the reason back in the bin at each of the four
places it now travels through: tryConns keeping it, smartPlan passing it,
renderSmart printing it, and the board delegating instead of copying.

Scoring is on the suite's EXIT CODE, unpiped -- a crashed suite prints no tally
and would read as a pass under `grep -c FAIL`. Each mutation asserts it matched
exactly once before it is applied; the file is restored in a finally block.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path.home() / "phone-sbb"
APP  = ROOT / "app.js"

MUTS = [
    # The original defect, exactly as it stood this morning.
    ("tryConns drops the reason on the floor again", APP,
     "catch(e){ if(note){ note.failed=true; note.err=e; } return []; }",
     "catch(e){ if(note){ note.failed=true; } return []; }",
     "tests/outage-not-verdict.mjs"),

    # The reason survives tryConns but never leaves smartPlan: a bare boolean
    # reaches the screen, which is all renderSmart used to get.
    ("smartPlan passes a bare boolean instead of the error (settled render)", APP,
     "renderSmart(base, wide.concat(hubResults), baseline, false, (direct.failed && !direct.ok) ? (direct.err||true) : null,",
     "renderSmart(base, wide.concat(hubResults), baseline, false, direct.failed && !direct.ok,",
     "tests/outage-not-verdict.mjs"),

    # The screen goes back to owning its own sentence -- the copy that drifted.
    ("renderSmart re-hardcodes the connection sentence", APP,
     'errBox(reqErr) + `${modeWhyEmpty()}${nRaw?catWhyEmpty():""}`',
     '`<div class="err">We could not reach the timetable, so we do not know whether this journey runs.<br>'
     'This is not a &quot;no&quot; &#8212; check your connection and tap Search again.</div>'
     '${modeWhyEmpty()}${nRaw?catWhyEmpty():""}`',
     "tests/outage-not-verdict.mjs"),

    # errBox itself stops distinguishing a refusal from a dead network.
    ("errBox forgets that 429 is not a connection problem", APP,
     'if(m&&m[1]==="429") return `<div class="err">The timetable service is rate-limiting us',
     'if(false) return `<div class="err">The timetable service is rate-limiting us',
     "tests/outage-not-verdict.mjs"),

    # The board reverts to its own copy -- the site that had NO suite until today.
    ("the departures board re-copies the sentence instead of delegating", APP,
     'out.innerHTML=errBox(e, "what leaves from here", "try again");',
     'out.innerHTML=`<div class="err">We could not reach the timetable, so we do not know what leaves from here.'
     '<br>This is not a &quot;no&quot; &#8212; check your connection and try again.</div>`;',
     "tests/wander.mjs"),

    # The per-screen wording is ignored, so every screen says the journey line.
    ("errBox ignores the caller's subject and always says 'this journey'", APP,
     'const what  = unknown || "whether this journey runs";',
     'const what  = "whether this journey runs";',
     "tests/wander.mjs"),
]

def run(suite):
    return subprocess.run(["node", suite], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode

print("baseline (every suite must be GREEN before any mutation is scored)")
for s in sorted({m[4] for m in MUTS}):
    rc = run(s)
    print(f"  {s:32s} exit={rc}")
    if rc != 0:
        sys.exit("ABORT -- baseline is not green, mutation scores would be meaningless")

caught = survived = 0
for label, path, old, new, suite in MUTS:
    orig = path.read_text()
    n = orig.count(old)
    if n != 1:
        sys.exit(f"ABORT -- {label!r} matches {n} times in {path.name}, expected exactly 1")
    try:
        path.write_text(orig.replace(old, new))
        rc = run(suite)
        if rc != 0:
            caught += 1;   print(f"  CAUGHT   {label}   ({suite})")
        else:
            survived += 1; print(f"  SURVIVED {label}   ({suite})  <-- SUITE GAP")
    finally:
        path.write_text(orig)

print(f"\n{caught} caught, {survived} survived")
r = subprocess.run(["git", "diff", "--quiet", "--", "app.js"], cwd=ROOT)
print("restore proof: git diff app.js vs HEAD is",
      "CLEAN" if r.returncode == 0 else "DIRTY (expected -- app.js carries today's real edits)")
sys.exit(1 if survived else 0)
