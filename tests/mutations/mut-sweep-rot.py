#!/usr/bin/env python3
# Mutation battery for the sweep's two rot rules + the discovered-specimen control.
# Scored on EXIT CODE, unpiped.
import subprocess, pathlib, sys

REPO = pathlib.Path.home() / "phone-sbb"
SUITE = "tests/passenger-sweep.mjs"


def run():
    return subprocess.run(["node", SUITE], cwd=REPO, capture_output=True, text=True).returncode


caught = survived = 0


def score(name, ok):
    global caught, survived
    if ok:
        caught += 1
        print(f"  CAUGHT   {name}")
    else:
        survived += 1
        print(f"  SURVIVED {name}  <-- SUITE GAP")


# --- text mutations ---
TEXT = [
    # the absence-rot rule: restore the stale evidence the operator's app has outgrown
    ("M1_absence_rot_returns", "tests/passengers/axes.mjs",
     'evidence: "register-2.1 half-built: replanFromStop from a named stop (replan-from-here.mjs); residual = never offered unprompted"',
     'evidence: "register-2.1: no replan-from-here; Harold-variant converts to it"'),
    # the discovered-specimen control: pretend every axis value is adjudicated
    ("M2_no_unruled_specimen", SUITE,
     "      if (!ADJUDICATIONS[`${axis}/${value}`]) return { axis, value };",
     "      if (false) return { axis, value };"),
    # the attributable check: revert it to the whole-verdict form that went vacuous
    ("M3_verdict_form_not_attributable", SUITE,
     "  const sf = scoreScenario(s).findings.find(f => f.axis === UNADJ.axis);",
     "  const sf = { status: scoreScenario(s).verdict };"),
]
for name, rel, old, new in TEXT:
    p = REPO / rel
    orig = p.read_text()
    assert orig.count(old) == 1, f"{name}: anchor not unique ({orig.count(old)}) in {rel}"
    p.write_text(orig.replace(old, new))
    try:
        score(name, run() != 0)
    finally:
        p.write_text(orig)

# --- file-rename mutation: the presence-rot rule ---
# arrive-by-time (the operator's new row) cites pager.mjs as its evidence.
src = REPO / "tests/pager.mjs"
dst = REPO / "tests/pager.mjs.mutbak"
src.rename(dst)
try:
    score("M4_cited_evidence_suite_deleted", run() != 0)
finally:
    dst.rename(src)

clean = subprocess.run(["git", "status", "--porcelain", "--", "tests"],
                       cwd=REPO, capture_output=True, text=True).stdout
print(f"\n{caught} caught, {survived} survived")
# M3 is a mutation of the suite itself; only the four tracked files may differ, and
# after restore nothing under tests/ should be dirty beyond what we started with.
print("tests/ dirty lines after restore:")
print(clean or "  (none)")
sys.exit(0 if survived == 0 else 1)
