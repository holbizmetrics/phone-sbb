#!/usr/bin/env python3
"""Row-361 freshness mutation battery (tests/onboard-fresh.mjs). Each mutant is one way the bar
could go back to asserting from frozen data."""
import os, subprocess, sys
ROOT = os.path.expanduser("~/phone-sbb"); OUT = os.path.expanduser("~/tmp/mut-onboard-fresh-out")
os.makedirs(OUT, exist_ok=True); os.chdir(ROOT)
CLEAN = {f: open(f, encoding="utf-8").read() for f in ("app.js",)}
def run(label):
    p = subprocess.run(["node", "tests/onboard-fresh.mjs"], capture_output=True, text=True)
    log = p.stdout + p.stderr; open(os.path.join(OUT, label + ".log"), "w", encoding="utf-8").write(log)
    tally = [l for l in log.splitlines() if " passed, " in l]
    v = ("CRASHED -- not scored" if not tally else "CLEAN" if label == "BASELINE" and p.returncode == 0
         else "BASELINE BROKEN" if label == "BASELINE" else "CAUGHT" if p.returncode != 0 else "SURVIVED  <-- suite gap")
    print(f"{label:34s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {v}"); return v
def mutate(f, old, new):
    s = CLEAN[f]; assert s.count(old) == 1, f"anchor not unique: {old[:60]!r} ({s.count(old)})"
    open(f, "w", encoding="utf-8").write(s.replace(old, new))
def restore():
    for f, s in CLEAN.items(): open(f, "w", encoding="utf-8").write(s)
run("BASELINE")
MUTS = [
    ("M1_stale_never_happens", "app.js", 'return age<=OB_STALE_MIN ? {state:"live", age} : {state:"stale", age};\n    }\n    if(obLiveNote)', 'return {state:"live", age};\n    }\n    if(obLiveNote)'),
    ("M2_stale_still_asserts_verdict", "app.js", '  if(f && f.state==="stale")\n    return', '  if(false)\n    return'),
    ("M3_bar_tag_dropped", "app.js", "function obFreshTag(f){\n  if(!f) return \"\";", "function obFreshTag(f){\n  if(true) return \"\";"),
    ("M4_arriving_never_rechecked", "app.js", 'else if(nx.phase==="arriving"){ stn=onboard.to; at=onboard.arr; }', 'else if(false){ stn=onboard.to; at=onboard.arr; }'),
    ("M5_arrival_read_ignores_pin_key", "app.js", "if(obArr && ob && obArr.key===ob.arr){", "if(obArr && ob){"),
    ("M6_no_row_read_as_on_time", "app.js", 'else { obArr=null; obArrNote="your train is not on the destination&#39;s arrival board &#8212; no live arrival"; }', 'else { obArr={key:onboard.arr, at:at, dly:0}; obArrNote=""; }'),
]
res = {}
for label, f, old, new in MUTS:
    try: mutate(f, old, new); res[label] = run(label)
    finally: restore()
caught = sum(1 for v in res.values() if v == "CAUGHT")
print(f"RECORD: mutants={len(MUTS)} caught={caught} survived={len(MUTS)-caught}")
sys.exit(0 if caught == len(MUTS) else 1)
