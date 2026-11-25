#!/usr/bin/env python3
"""Mutation score for the two changes made 2026-07-30: the via blur-apply and
the Swiss datetime-local boundary.

Scoring is on the suite's EXIT CODE, unpiped -- a crashed suite prints no tally
and would read as a pass under `grep -c FAIL`. Each mutation asserts it matched
exactly once before it is applied, and the file is restored in a finally block.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path.home() / "phone-sbb"
APP  = ROOT / "app.js"
PAGER= ROOT / "tests" / "pager.mjs"

# (label, file, old, new, suite that must go red)
MUTS = [
    ("via: blur handler never wired", APP,
     '$("iVia").addEventListener("blur", viaBlur);',
     '// $("iVia").addEventListener("blur", viaBlur);',
     "tests/via.mjs"),

    ("via: blur applies but never re-plans", APP,
     "    if(t && t!==viaName) viaSet(t);",
     "    if(t && t!==viaName) viaName=t;",
     "tests/via.mjs"),

    ("via: blur fires IMMEDIATELY, losing the suggestion race", APP,
     "  setTimeout(()=>{\n    const now=$(\"iVia\"); if(!now) return;\n    const t=now.value.trim();\n    if(t && t!==viaName) viaSet(t);\n  }, 150);",
     "  viaSet(typed);",
     "tests/via.mjs"),

    # First draft mutated only the OUTER guard (`!typed ||`). It survived, and
    # correctly: `typed` is already trimmed, so a whitespace box gives "" which
    # equals an empty viaName and the function returns anyway. That was a weak
    # mutation of mine, not a suite gap. The INNER guard is the load-bearing one.
    ("via: whitespace in the box becomes a constraint", APP,
     "    if(t && t!==viaName) viaSet(t);",
     "    if(t!==viaName) viaSet(t);",
     "tests/via.mjs"),

    ("tz: the boundary formatter reverts to the device zone", APP,
     'const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Zurich",year:"numeric",month:"2-digit",\n    day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));\n  const g=t=>p.find(x=>x.type===t)?.value||"00";\n  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;',
     'const d=new Date(ms);\n  return new Date(ms - d.getTimezoneOffset()*60000).toISOString().slice(0,16);',
     "tests/tz-input.mjs"),

    ("tz: the planner's seed goes back to the device clock", APP,
     "    const s=swissLocal(Date.now()+30*60000);\n    at.value = s.slice(0,14) + (+s.slice(14)>=30 ? \"30\" : \"00\");",
     "    const d=new Date(Date.now()+30*60000); d.setSeconds(0,0); d.setMinutes(d.getMinutes()>=30?30:0);\n    at.value = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);",
     "tests/tz-input.mjs"),

    ("tz: the pager's anchor goes back to the device clock", APP,
     "function pgLocal(ms){ return swissLocal(ms); }",
     "function pgLocal(ms){ const d=new Date(ms); return new Date(ms - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }",
     "tests/tz-input.mjs"),

    ("tz: flightArriveBy 'fixed' to use the Swiss formatter (the look-alike trap)", APP,
     "  return new Date(d.getTime()-buf*60000-d.getTimezoneOffset()*60000).toISOString().slice(0,16);",
     "  return swissLocal(d.getTime()-buf*60000);",
     "tests/tz-input.mjs"),

    # First draft mutated the OFFSET PROBE (`new Date(stamp+"Z")` -> `new
    # Date(stamp)`). It survived, and correctly: the probe only reads Zurich's
    # offset for that DATE, and both readings land on the same July day, so both
    # give +02:00. Behaviour-preserving away from a DST boundary -- a weak
    # mutation of mine, not a suite gap. Mutate what the fixture MEANS instead.
    ("tz: the pager fixture silently re-points to the runner's zone", PAGER,
     '  return `${stamp}${mm[1]}${mm[2]}:${mm[3]}`;',
     '  const off=-new Date(2026,6,29,h,m).getTimezoneOffset(), ao=Math.abs(off);\n'
     '  return `${stamp}${off<0?"-":"+"}${p2(Math.floor(ao/60))}:${p2(ao%60)}`;',
     "tests/pager.mjs"),
]

"""A mutation is only a test in an environment where it MEANS something.

Found 2026-07-31, archiving this script into the repo: the fixture mutation above
re-points the pager fixture to the RUNNER's zone, so on a machine already set to
Europe/Zurich it substitutes Zurich for Zurich -- a literal no-op. Scored bare on
the operator's phone (which resolves to Europe/Zurich) it reads 8 caught, 1
SURVIVED, and the survivor looks exactly like a suite gap. Under UTC, Kolkata or
New_York the same script reads 9/9.

So the earlier 9/9 was environment-dependent and never said so. A timezone
mutation run in the timezone it is about measures nothing, and the one machine
guaranteed to be in that timezone is the machine this app is built on. The zone
is pinned per-mutation now rather than inherited, so the score means the same
thing wherever it runs."""
FORCE_TZ = {"tz: the pager fixture silently re-points to the runner's zone": "UTC"}

def run(suite, tz=None):
    env = None
    if tz:
        import os
        env = {**os.environ, "TZ": tz}
    return subprocess.run([ "node", suite ], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode

print("baseline (every suite must be GREEN before any mutation is scored)")
for s in sorted({m[4] for m in MUTS}):
    rc = run(s)
    print(f"  {s:28s} exit={rc}")
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
        rc = run(suite, FORCE_TZ.get(label))
        if rc != 0:
            caught += 1;   print(f"  CAUGHT   {label}   ({suite})")
        else:
            survived += 1; print(f"  SURVIVED {label}   ({suite})  <-- SUITE GAP")
    finally:
        path.write_text(orig)

print(f"\n{caught} caught, {survived} survived")
r = subprocess.run(["git", "diff", "--quiet", "--", "app.js", "tests/"], cwd=ROOT)
print("restore proof: git diff vs HEAD is",
      "CLEAN" if r.returncode == 0 else "DIRTY (expected -- these files carry today's real edits)")
sys.exit(1 if survived else 0)
