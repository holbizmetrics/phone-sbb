#!/usr/bin/env python3
"""Pager (earlier/later) mutation battery. Scored on exit code + a printed tally."""
import os, subprocess, sys

ROOT = os.path.expanduser("~/phone-sbb")
OUT = os.path.expanduser("~/tmp/mut-pager-out")
os.makedirs(OUT, exist_ok=True)
os.chdir(ROOT)

CLEAN = {f: open(f).read() for f in ("app.js", "app.css", "index.html")}


def run(label):
    p = subprocess.run(["node", "tests/pager.mjs"], capture_output=True, text=True)
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
    print(f"{label:34s} exit={p.returncode} {tally[0] if tally else '(no tally)':22s} {v}")


def mutate(f, old, new):
    s = CLEAN[f]
    assert s.count(old) == 1, f"anchor not unique in {f}: {old[:60]!r} ({s.count(old)})"
    open(f, "w").write(s.replace(old, new))


def restore():
    for f, s in CLEAN.items():
        open(f, "w").write(s)


run("BASELINE")

MUTS = [
    # the whole point: a step that re-slices instead of asking again
    ("M1_step_does_not_replan", "app.js",
     "  pgApply(whenMode === \"arr\" ? \"arr\" : \"dep\", pgLocal(anchor));",
     "  whenValue = pgLocal(anchor);"),
    # the window walks but the control still says "now" -- an invisible anchor
    ("M2_anchor_stays_hidden", "app.js",
     '  if(at){ at.value = value; at.hidden = (mode === "now"); }',
     '  if(at){ at.hidden = true; }'),
    # the segment does not follow, so "Now" sits over a walked window
    ("M3_segment_not_synced", "app.js",
     '    const b=$("seg"+m[0].toUpperCase()+m.slice(1)); if(b) b.classList.toggle("on", m===mode);',
     '    const b=$("seg"+m[0].toUpperCase()+m.slice(1)); if(b) b.classList.toggle("on", false);'),
    # the same trains handed back a second time, rendered as a fresh page
    ("M4_exhausted_not_detected", "app.js",
     '  pgStuck = (dir === "later" ? ts[ts.length-1] > pgWas : ts[0] < pgWas) ? "" : dir;',
     '  pgStuck = "";'),
    # "nothing earlier" becomes a permanent state of the app
    ("M5_stuck_never_clears", "app.js",
     '  if(!dir){ pgStuck = ""; return; }',
     '  if(!dir){ return; }'),
    # an empty page reported as exhaustion-free, so no way back is offered
    ("M6_empty_page_not_exhausted", "app.js",
     '  if(!ts.length){ pgStuck = dir; return; }',
     '  if(!ts.length){ return; }'),
    # the exhausted direction stays tappable into the same non-answer
    ("M7_disabled_dropped", "app.js",
     '    + (pgStuck===d ? " disabled" : "") + `>${glyph}</button>`;',
     '    + `>${glyph}</button>`;'),
    # a one-result list steps zero minutes and sits still forever
    ("M8_zero_width_step", "app.js",
     "  const span = Math.max(ts[ts.length-1] - ts[0], PG_MIN*60000);",
     "  const span = ts[ts.length-1] - ts[0];"),
    # the backward step lands ON the first train, so it returns the same list
    ("M9_earlier_does_not_step_back", "app.js",
     '  const anchor = dir === "later" ? ts[ts.length-1] + 60000 : ts[0] - span;',
     '  const anchor = dir === "later" ? ts[ts.length-1] + 60000 : ts[0];'),
    # arrive-by silently becomes a departure question
    ("M10_arriveby_becomes_departure", "app.js",
     'function pgOf(c){ return whenMode === "arr" ? pgArr(c) : pgDep(c); }',
     'function pgOf(c){ return pgDep(c); }'),
    # anchoring on the live time steps past a train still listed at its booked minute
    ("M11_anchors_on_prognosis", "app.js",
     "function pgDep(c){ return c && c.from && c.from.departure ? new Date(c.from.departure).getTime() : 0; }",
     "function pgDep(c){ const d = c && c.from && ((c.from.prognosis&&c.from.prognosis.departure)||c.from.departure); return d ? new Date(d).getTime() : 0; }"),
    # the way back forgotten: a step onto nothing strands you
    ("M12_no_way_back", "app.js",
     '  pgPrev  = { mode: whenMode, value: whenValue };', "  pgPrev = null;"),
    # the smart planner judges the step on the partial list mid-sweep
    ("M13_observes_partial_list", "app.js",
     "  if(!searching) pgObserve(top);", "  pgObserve(top);"),
    # the pager stops riding the share bar
    ("M14_not_on_the_share_bar", "app.js",
     '  return `<div class="sharebar">${pgBarHTML()}<button type="button" class="shr"',
     '  return `<div class="sharebar"><button type="button" class="shr"'),
    # "Check the station names" printed when the names are fine and you paged off the end
    ("M15_wrong_advice_on_paged_empty", "app.js",
     '${sunWhyEmpty()||((viaName||pgStuck)?"":"<br>Check the station names.")}',
     '${sunWhyEmpty()||(viaName?"":"<br>Check the station names.")}'),
    # the bar re-justifies instead of floating the pager left
    ("M16_pager_not_left", "app.css",
     "  .sharebar .pager{display:flex; gap:6px; margin-right:auto}",
     "  .sharebar .pager{display:flex; gap:6px}"),
    # a bare glyph with nothing spoken
    ("M17_no_aria_label", "app.js",
     '    `<button type="button" class="pg" onclick="pgStep(\'${d}\')" aria-label="${lbl}"`',
     '    `<button type="button" class="pg" onclick="pgStep(\'${d}\')"`'),
]

for label, f, old, new in MUTS:
    mutate(f, old, new)
    run(label)
    restore()

ok = all(open(f).read() == s for f, s in CLEAN.items())
print("RESTORED CLEAN" if ok else "!! RESTORE FAILED")
sys.exit(0 if ok else 1)
