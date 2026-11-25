#!/usr/bin/env python3
"""Row-371 hub-sweep mutation battery (tests/hub-sweep.mjs). Each mutant is one way the sweep
could go back to lying: burst again, hammer a 429, lose a timed-out hub, drop the note."""
import os, subprocess, sys

ROOT = os.path.expanduser("~/phone-sbb")
OUT = os.path.expanduser("~/tmp/mut-hub-sweep-out")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)
CLEAN = {f: open(f, encoding="utf-8").read() for f in ("app.js",)}

def run(label):
    p = subprocess.run(["node", "tests/hub-sweep.mjs"], capture_output=True, text=True)
    log = p.stdout + p.stderr
    open(os.path.join(OUT, label + ".log"), "w", encoding="utf-8").write(log)
    tally = [l for l in log.splitlines() if " passed, " in l]
    v = ("CRASHED -- not scored" if not tally else "CLEAN" if label == "BASELINE" and p.returncode == 0
         else "BASELINE BROKEN" if label == "BASELINE" else "CAUGHT" if p.returncode != 0 else "SURVIVED  <-- suite gap")
    print(f"{label:34s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {v}")
    return v

def mutate(f, old, new):
    s = CLEAN[f]; assert s.count(old) == 1, f"anchor not unique: {old[:60]!r} ({s.count(old)})"
    open(f, "w", encoding="utf-8").write(s.replace(old, new))

def restore():
    for f, s in CLEAN.items(): open(f, "w", encoding="utf-8").write(s)

run("BASELINE")
MUTS = [
    ("M1_pool_cap_ignored", "app.js", "Array.from({length:Math.max(1,Math.min(limit,thunks.length))}, worker)", "Array.from({length:thunks.length}, worker)"),
    ("M2_never_retry_a_429", "app.js", "for(let attempt=0; attempt<2; attempt++){", "for(let attempt=0; attempt<1; attempt++){"),
    ("M3_retry_after_cap_ignored", "app.js", "if(attempt>0 || wait>HUB_CAP) return", "if(attempt>0) return"),
    ("M4_timeout_read_as_empty_ok", "app.js", 'if(r===HUB_TIMEOUT) return {hub:h, conns:[], state:"timeout"};', 'if(r===HUB_TIMEOUT) return {hub:h, conns:[], state:"ok"};'),
    ("M5_unswept_list_dropped", "app.js", 'const unswept = hubOut.filter(r=>r.state!=="ok");', 'const unswept = [];'),
    ("M6_note_omits_reason", "app.js", "u.map(x=>`${esc(x.hub)} (${esc(why[x.state]||x.state)})`)", "u.map(x=>`${esc(x.hub)}`)"),
    ("M7_note_never_empty", "app.js", '  if(!u.length) return "";\n  const why=', '  const why='),
]
res = {}
for label, f, old, new in MUTS:
    try:
        mutate(f, old, new); res[label] = run(label)
    finally:
        restore()
caught = sum(1 for v in res.values() if v == "CAUGHT")
print(f"RECORD: mutants={len(MUTS)} caught={caught} survived={len(MUTS)-caught}")
sys.exit(0 if caught == len(MUTS) else 1)
