#!/usr/bin/env python3
"""Heritage-catalogue mutation battery (tests/heritage.mjs). Scored on exit code + a printed tally.
Each mutant is a way the calendar could quietly lie; the suite must go RED on every one."""
import os, subprocess, sys

ROOT = os.path.expanduser("~/phone-sbb")
OUT = os.path.expanduser("~/tmp/mut-heritage-out")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)

CLEAN = {f: open(f, encoding="utf-8").read() for f in ("app.js", "app.css", "index.html")}


def run(label):
    p = subprocess.run(["node", "tests/heritage.mjs"], capture_output=True, text=True)
    log = p.stdout + p.stderr
    open(os.path.join(OUT, label + ".log"), "w", encoding="utf-8").write(log)
    tally = [l for l in log.splitlines() if " passed, " in l]
    if not tally:
        v = "CRASHED -- not scored"
    elif label == "BASELINE":
        v = "CLEAN" if p.returncode == 0 else "BASELINE BROKEN"
    elif p.returncode != 0:
        v = "CAUGHT"
    else:
        v = "SURVIVED  <-- suite gap"
    print(f"{label:34s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {v}")
    return v


def mutate(f, old, new):
    s = CLEAN[f]
    assert s.count(old) == 1, f"anchor not unique in {f}: {old[:60]!r} ({s.count(old)})"
    open(f, "w", encoding="utf-8").write(s.replace(old, new))


def restore():
    for f, s in CLEAN.items():
        open(f, "w", encoding="utf-8").write(s)


run("BASELINE")

MUTS = [
    ("M1_closed_range_ignored", "app.js",
     "  for(const c of p.cl||[]) if(c&&c.f<=day&&(!c.t||day<=c.t)) return false;",
     "  for(const c of []) if(c&&c.f<=day&&(!c.t||day<=c.t)) return false;"),
    ("M2_weekday_pattern_ignored", "app.js",
     '    if(s.d==="daily"||(Array.isArray(s.d)&&s.d.includes(dow))) return true;',
     '    if(s.d==="daily"||Array.isArray(s.d)) return true;'),
    ("M3_date_list_treated_as_range", "app.js",
     "    if(Array.isArray(s.dates)){ if(s.dates.includes(day)) return true; continue; }",
     "    if(Array.isArray(s.dates)){ return true; }"),
    ("M4_name_fallback_removed", "app.js",
     "(nm&&heritageNorm(x.n)===nm))));",
     "false)));"),
    ("M5_third_party_tag_dropped", "app.js",
     '    const ev = p.ev==="operator" ? ',
     '    const ev = true ? '),
    ("M6_catalogue_dark_on_outage", "app.js",
     "    const cat = specialCatalogueHTML(heritageSplit(HERITAGE_CATALOGUE, null, name, days), days, catN, catChecked);\n    box.innerHTML=specialWrap(name,",
     "    const cat = \"\";\n    box.innerHTML=specialWrap(name,"),
    ("M7_sunday_index_regression", "app.js",
     ".map(i=>i===0?7:i).sort((a,b)=>a-b);",
     ".sort((a,b)=>a-b);"),
    ("M8_shipped_constant_drifts", "app.js",
     '"n":"Glacier Express"',
     '"n":"Glacier Expres"'),
]
res = {}
for label, f, old, new in MUTS:
    try:
        mutate(f, old, new)
        res[label] = run(label)
    finally:
        restore()
caught = sum(1 for v in res.values() if v == "CAUGHT")
print(f"RECORD: mutants={len(MUTS)} caught={caught} survived={len(MUTS)-caught}")
sys.exit(0 if caught == len(MUTS) else 1)
