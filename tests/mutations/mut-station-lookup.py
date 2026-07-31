#!/usr/bin/env python3
"""Mutation score for the 2026-07-31 typed-station-lookup fix.

The fix is two lines of app.js. This asks the only question worth asking about
a new suite: if someone puts the defect back, does the suite go red? M1 and M2
are the two shipped defects verbatim -- the id-less filter and the branch that
hid the dropdown and said nothing.

M3-M5 attack the part that is easy to get wrong in the OTHER direction: the
error path. A lookup that threw must not be reported with the no-match wording,
a 429 must be named as a rate limit, and the query must be escaped on the way
back to the DOM. Each of those checks is a positive assertion elsewhere; here it
has to be shown it can fail.

Scored on the suite's EXIT CODE, unpiped. Anchors are asserted to match exactly
once (the id-filter appears twice in app.js -- locations() and nearbyStops() --
so M1's anchor carries the following line to stay on the right one). Restored in
a `finally` whatever happens.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path.home() / "phone-sbb"
APP = ROOT / "app.js"
SUITE = "tests/station-lookup.mjs"

MUTS = [
    ("M1 locations() goes back to filtering on name alone (the shipped defect)",
     "  const s = (d.stations||[]).filter(x=>x.id&&x.name);\n  locCache.set(q,s);",
     "  const s = (d.stations||[]).filter(x=>x.name);\n  locCache.set(q,s);"),

    ("M2 the empty case goes back to hiding the box and saying nothing",
     'if(!s.length){ nearMsg(ac, `No station matches &#8220;${esc(q)}&#8221;.`); return; }',
     'if(!s.length){ ac.classList.remove("show"); return; }'),

    ("M3 a thrown lookup is reported with the no-match wording (the 429 bug again)",
     '`Station lookup failed &#8212; this is not a &#8220;no match&#8221;, try again in a moment.`',
     '`No station matches &#8220;${esc(q)}&#8221;.`'),

    ("M4 the rate limit stops being named as a rate limit",
     '? "Too many searches for now &#8212; wait a moment and type again."',
     '? `Station lookup failed &#8212; this is not a &#8220;no match&#8221;, try again in a moment.`'),

    ("M5 the query reaches the DOM unescaped",
     'nearMsg(ac, `No station matches &#8220;${esc(q)}&#8221;.`)',
     'nearMsg(ac, `No station matches &#8220;${q}&#8221;.`)'),
]


def run():
    return subprocess.run(["node", SUITE], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


rc = run()
print(f"baseline exit={rc}")
if rc != 0:
    sys.exit("ABORT -- baseline is not green, mutation scores would be meaningless")

caught = survived = 0
for label, old, new in MUTS:
    orig = APP.read_text()
    n = orig.count(old)
    if n != 1:
        sys.exit(f"ABORT -- {label!r} anchor matches {n} times in app.js, expected exactly 1")
    try:
        APP.write_text(orig.replace(old, new))
        rc = run()
        if rc != 0:
            caught += 1;   print(f"  CAUGHT   {label}")
        else:
            survived += 1; print(f"  SURVIVED {label}   <-- SUITE GAP")
    finally:
        APP.write_text(orig)

print(f"\n{caught} caught, {survived} survived")
r = subprocess.run(["git", "diff", "--quiet", "--", "app.js"], cwd=ROOT)
print("restore proof: git diff vs HEAD over app.js is",
      "CLEAN" if r.returncode == 0 else "DIRTY (expected if this run carries uncommitted edits)")
sys.exit(1 if survived else 0)
