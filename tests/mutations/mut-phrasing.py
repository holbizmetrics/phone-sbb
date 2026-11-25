#!/usr/bin/env python3
"""Mutation score for the 2026-07-31 phrasing-axis work.

Scored on the suite's EXIT CODE, unpiped. Every mutation asserts its anchor
matches exactly once before it is applied, and the file is restored in a
`finally` block whatever happens.

M4 is the one that matters. The control it targets previously named a REAL
unadjudicated row as its example of "genuinely unchecked", so it went red the
hour that row was adjudicated -- a control that dies when you do the work is
measuring the work, not the property. It now names a synthetic key, and M4
proves the replacement can still fail: make the synthetic key real and the
guard must notice. Without M4 the new guard is indistinguishable from
`chk(true)`.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path.home() / "phone-sbb"
AXES = ROOT / "tests" / "passengers" / "axes.mjs"
DISP = ROOT / "tests" / "passengers" / "dispositions.json"
SUITE = "tests/passenger-sweep.mjs"

MUTS = [
    ("M1 a LEFT_BEHIND row loses its ledger column (absence-is-rot)", DISP,
     '    "phrasing/abbreviation":             { "state": "undecided" },\n', ""),

    ("M2 a ledger row points at a finding that does not exist", DISP,
     '"phrasing/zip-code":                 { "state": "undecided" }',
     '"phrasing/zip-code":                 { "state": "undecided" },\n'
     '    "phrasing/no-such-value":            { "state": "undecided" }'),

    ("M3 a ruling cites a suite that is not in the repo", AXES,
     'tests/near-me.mjs 21 checks', 'tests/no-such-suite.mjs 21 checks'),

    ("M4 the synthetic control key becomes a REAL adjudicated row", AXES,
     '  "phrasing/zip-code":                { status: "LEFT_BEHIND"',
     '  "phrasing/__never-adjudicated-control": { status: "LEFT_BEHIND", step: "input", evidence: "synthetic mutation" },\n'
     '  "phrasing/zip-code":                { status: "LEFT_BEHIND"'),
]


def run():
    return subprocess.run(["node", SUITE], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


rc = run()
print(f"baseline exit={rc}")
if rc != 0:
    sys.exit("ABORT -- baseline is not green, mutation scores would be meaningless")

caught = survived = 0
for label, path, old, new in MUTS:
    orig = path.read_text()
    n = orig.count(old)
    if n != 1:
        sys.exit(f"ABORT -- {label!r} anchor matches {n} times in {path.name}, expected exactly 1")
    try:
        path.write_text(orig.replace(old, new))
        rc = run()
        if rc != 0:
            caught += 1;   print(f"  CAUGHT   {label}")
        else:
            survived += 1; print(f"  SURVIVED {label}   <-- SUITE GAP")
    finally:
        path.write_text(orig)

print(f"\n{caught} caught, {survived} survived")
r = subprocess.run(["git", "diff", "--quiet", "--", "tests/"], cwd=ROOT)
print("restore proof: git diff vs HEAD over tests/ is",
      "CLEAN" if r.returncode == 0 else "DIRTY (expected if this run carries uncommitted edits)")
sys.exit(1 if survived else 0)
