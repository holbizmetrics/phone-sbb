#!/usr/bin/env python3
"""Via mutation battery. Scored on exit code + a printed tally."""
import os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/phone-sbb")
OUT = os.path.expanduser("~/tmp/mut-via-out")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)

CLEAN = {f: open(f).read() for f in ("app.js", "index.html")}


def run(label):
    p = subprocess.run(["node", "tests/via.mjs"], capture_output=True, text=True)
    log = p.stdout + p.stderr
    open(os.path.join(OUT, label + ".log"), "w").write(log)
    tally = [l for l in log.splitlines() if " passed, " in l]
    if not tally:
        v = "CRASHED -- not scored"
    elif label == "BASELINE":
        v = "CLEAN" if p.returncode == 0 else "BASELINE BROKEN"
    elif p.returncode != 0:
        v = "CAUGHT"
    else:
        v = "SURVIVED  <-- suite gap"
    print(f"{label:36s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {v}")


def mutate(f, old, new):
    s = CLEAN[f]
    assert s.count(old) == 1, f"anchor not unique in {f}: {old[:60]!r} ({s.count(old)})"
    open(f, "w").write(s.replace(old, new))


def restore():
    for f, s in CLEAN.items():
        open(f, "w").write(s)


run("BASELINE")

MUTS = [
    # the feature silently does nothing: the box takes a name, the query ignores it
    ("M1_via_never_applied", "app.js",
     'function viaQS(){ return viaName ? `&via[]=${encodeURIComponent(viaName)}` : ""; }',
     'function viaQS(){ return ""; }'),
    # the sweep keeps offering other hubs, so the list mixes honoured and ignored vias
    ("M2_sweep_ignores_via", "app.js",
     "const hubList = viaName ? [] : [...HUBS,",
     "const hubList = [...HUBS,"),
    # the wide query goes around the via -- half the results quietly unconstrained
    ("M3_wide_query_bypasses_via", "app.js",
     "const wideP = tryConns(`from=${f}&to=${t}${viaQS()}&limit=16",
     "const wideP = tryConns(`from=${f}&to=${t}&limit=16"),
    # the invisible constraint: remembered across loads
    ("M4_via_persisted", "app.js",
     'let viaName = "";', 'let viaName = load(LS.via, "");'),
    # the note reads the box instead of the applied value: claims a filter that is not on
    ("M5_note_reads_the_box", "app.js",
     'return `<div class="vianote">&#8631; via <b>${esc(viaName)}</b>`',
     'return `<div class="vianote">&#8631; via <b>${esc($("iVia").value)}</b>`'),
    # an empty result under a via reported as no route at all
    ("M6_empty_reads_as_no_route", "app.js",
     "Nothing links the three in that order &#8212; which is not the same as no route at all. ",
     "No connections found. "),
    # the shared link drops the via, so the receiver plans a different journey
    ("M7_share_drops_via", "app.js",
     '  if(viaName) u.searchParams.set("via", viaName);   // a via left behind means the receiver plans a DIFFERENT journey\n', ""),
    # a received via applied without revealing the field
    ("M8_received_via_stays_hidden", "app.js",
     'if(v){ viaName=v; $("iVia").value=v; $("fVia").hidden=false;',
     'if(v){ viaName=v; $("iVia").value=v; $("fVia").hidden=true;'),
    # typed-but-unapplied text no longer marked
    ("M9_pending_mark_dropped", "app.js",
     '$("fVia").classList.toggle("pending", i.value.trim() !== viaName);',
     '$("fVia").classList.toggle("pending", false);'),
    # clearing an idle via fires a pointless search
    ("M10_idle_clear_replans", "app.js",
     "if(had && fromName && toName) planJourney();",
     "if(fromName && toName) planJourney();"),
]

for label, f, old, new in MUTS:
    mutate(f, old, new)
    run(label)
    restore()

ok = all(open(f).read() == s for f, s in CLEAN.items())
print("RESTORED CLEAN" if ok else "!! RESTORE FAILED")
sys.exit(0 if ok else 1)
