#!/usr/bin/env python3
# Mutation battery for tests/workflow-parity.mjs.
# Scored on EXIT CODE, unpiped -- a crashed suite prints no tally and would
# otherwise score as a pass.
import subprocess, pathlib, sys

REPO = pathlib.Path.home() / "phone-sbb"
SUITE = "tests/workflow-parity.mjs"

MUTS = [
    ("M1_deploy_skips_one_more", ".github/workflows/deploy.yml",
     '[ "$t" = "tests/smoke.mjs" ] && continue',
     '[ "$t" = "tests/smoke.mjs" ] && continue\n            [ "$t" = "tests/pager.mjs" ] && continue'),
    ("M2_ci_pipes_the_suite", ".github/workflows/ci.yml",
     'node "$t" || fail=1',
     'node "$t" | tail -1 || fail=1'),
    ("M3_deploy_gate_removed", ".github/workflows/deploy.yml",
     "needs: test", "if: always()"),
    ("M4_deploy_hand_lists_a_suite", ".github/workflows/deploy.yml",
     "- name: Smoke test\n        run: node tests/smoke.mjs",
     "- name: Smoke test\n        run: node tests/smoke.mjs\n      - name: extra\n        run: node tests/via.mjs"),
    ("M5_ci_drops_the_exit", ".github/workflows/ci.yml",
     "exit $fail", "exit 0"),
    ("M6_deploy_glob_to_list", ".github/workflows/deploy.yml",
     "for t in tests/*.mjs; do", "for t in tests/via.mjs tests/pager.mjs; do"),
]

caught = survived = 0
for name, rel, old, new in MUTS:
    p = REPO / rel
    orig = p.read_text()
    assert orig.count(old) == 1, f"{name}: anchor not unique ({orig.count(old)}) in {rel}"
    p.write_text(orig.replace(old, new))
    try:
        r = subprocess.run(["node", SUITE], cwd=REPO, capture_output=True, text=True)
        if r.returncode != 0:
            caught += 1
            print(f"  CAUGHT   {name}")
        else:
            survived += 1
            print(f"  SURVIVED {name}  <-- SUITE GAP")
    finally:
        p.write_text(orig)

# Prove the tree really is back, or every number above is unreadable.
clean = subprocess.run(["git", "diff", "--quiet", "--", ".github/workflows"],
                       cwd=REPO).returncode == 0
print(f"\n{caught} caught, {survived} survived")
print("RESTORED CLEAN" if clean else "!! WORKFLOWS LEFT DIRTY -- inspect git diff")
sys.exit(0 if survived == 0 and clean else 1)
