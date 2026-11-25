#!/usr/bin/env python3
"""T2 mutation battery. Scored on EXIT CODE + a printed tally.

Counting FAIL lines reads a crashed suite as a pass -- that is how the first
pass lied. A mutation only counts as CAUGHT if the suite ran to completion and
reported failures.
"""
import os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/phone-sbb")
OUT = os.path.expanduser("~/tmp/mut-out")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)

# This battery scores the service-worker branch, and sw.js does not exist on
# master -- t2-service-worker is still unmerged pending a tunnel/airplane-mode
# field test. Archived here 2026-07-31 it therefore crashed with a bare
# FileNotFoundError, which is the least useful thing an instrument can do: it
# reads as "broken script" when the truth is "you are on the wrong branch".
# An instrument that cannot run must say WHY, and must not exit 0 while doing it.
if not os.path.exists("sw.js"):
    sys.exit("SKIP -- sw.js is absent, so this battery has nothing to mutate.\n"
             "  It scores the t2-service-worker branch, which is not merged to master.\n"
             "  Run:  git checkout t2-service-worker && python3 tests/mutations/mut-t2.py")

CLEAN = {}
for f in ("sw.js", "app.js"):
    CLEAN[f] = open(f).read()
    shutil.copy(f, os.path.join(OUT, f + ".clean"))


def run(label):
    p = subprocess.run(["node", "tests/offline.mjs"], capture_output=True, text=True)
    log = p.stdout + p.stderr
    open(os.path.join(OUT, label + ".log"), "w").write(log)
    tally = [l for l in log.splitlines() if " passed, " in l]
    crashed = not tally
    if label == "BASELINE":
        verdict = "CLEAN" if (p.returncode == 0 and not crashed) else "BASELINE BROKEN"
    elif crashed:
        verdict = "CRASHED -- not scored"
    elif p.returncode != 0:
        verdict = "CAUGHT"
    else:
        verdict = "SURVIVED  <-- suite gap"
    print(f"{label:34s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {verdict}")


def mutate(f, old, new):
    s = CLEAN[f]
    assert s.count(old) == 1, f"mutation anchor not unique in {f}: {old!r}"
    open(f, "w").write(s.replace(old, new))


def restore():
    for f, s in CLEAN.items():
        open(f, "w").write(s)


run("BASELINE")

MUTS = [
    ("M1_timetable_intercepted", "sw.js",
     "  if (url.origin !== self.location.origin) return;\n", ""),
    ("M2_cache_first_nav", "sw.js",
     "async function navigationFirst(req) {\n  try {",
     "async function navigationFirst(req) {\n  const c0 = await caches.match(req);\n  if (c0) return c0;\n  try {"),
    ("M3_all_or_nothing_precache", "sw.js",
     "await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));",
     "await c.addAll(SHELL);"),
    ("M4_old_caches_kept", "sw.js",
     "    await Promise.all(names.map(n => n === CACHE ? null : caches.delete(n)));\n", ""),
    ("M5_countdown_on_stale", "app.js",
     '    return `<div class="strow"><b>${dep?hhmm(dep):"--:--"}</b>`',
     '    return `<div class="strow"><b>${dep?hhmm(dep):"--:--"}</b>`\n'
     '      + `<span class="stcd">${dep?depLabel(minsUntil(dep)):""}</span>`'),
]

for label, f, old, new in MUTS:
    mutate(f, old, new)
    run(label)
    restore()

ok = all(open(f).read() == s for f, s in CLEAN.items())
print("RESTORED CLEAN" if ok else "!! RESTORE FAILED")
sys.exit(0 if ok else 1)
