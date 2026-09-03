// The passenger instrument's own acceptance suite: hand-built specimens with
// KNOWN correct answers, plus the invariants that keep the instrument honest.
// The generated population is the net; these specimens prove the net has no
// holes where we already know the fish are.
import fs from "fs";
import { fileURLToPath } from "url";   // .pathname is "/D:/..." on Windows; fs cannot open it
import { scoreScenario, shrink, reduceFinding } from "./passengers/rubric.mjs";
import { ADJUDICATIONS, AXES, adjudicate } from "./passengers/axes.mjs";
import { generate } from "./passengers/generate.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// An axis value the table has NOT ruled on, resolved AT RUN TIME.
//
// This was hard-coded as "arrive-by-time" until the operator adjudicated that
// value SERVED (2026-07-30). The three checks below did not go red -- they went
// VACUOUS: an unrelated field (who/commuter) happens to be unadjudicated too, so
// each one carried on passing while no longer testing the thing it is named
// after. Nothing in the suite could see that, because green is green.
// So the specimen is now discovered, and every check that depends on it asserts
// its own premise instead of assuming it.
const UNADJ = (() => {
  for (const axis of Object.keys(AXES))
    for (const value of AXES[axis])
      if (!ADJUDICATIONS[`${axis}/${value}`]) return { axis, value };
  return null;
})();
chk("control: the table still has an unruled value to test UNADJUDICATED with",
  !!UNADJ, "every axis value is now adjudicated -- these checks need a new specimen");
chk("control: ...and it really is unruled", UNADJ && adjudicate(UNADJ.axis, UNADJ.value).status === "UNADJUDICATED",
  UNADJ ? JSON.stringify(adjudicate(UNADJ.axis, UNADJ.value)) : "no specimen");

// ---- specimen #1: Harold (bus msg 87102361, adjudicated by hand vs 1625cbe) ----
const harold = { who: "business-traveller", purpose: "meet-flight",
                 constraints: "foreign-tz-time", conditions: "normal", phrasing: "exact-station-names" };
// Harold MOVED, 2026-07-30, and the way he moved is worth more than the rows.
//
// These checks used to read "Harold is LEFT_BEHIND ... on the timezone axis".
// Shipping the swissLocal fix turned all three red in one run. That is the
// specimen doing its job: it asserted a FALSIFIABLE claim about the app, so
// when the app changed underneath it, it said so out loud -- where the
// adjudication rows next to it rot in silence for days.
//
// Which is the freshness contract, already built, sitting one file away from
// the rows that lack it: (a) what was observed, (b) what would falsify it,
// (c) a mechanical re-check. Note the DIRECTION too: an adjudication cites an
// absence, so shipping can only ever make it stale PESSIMISTIC. A specimen
// asserts a failure, so shipping makes it stale OPTIMISTIC -- it goes on
// claiming the app is worse than it is. Same decay, opposite sign, and only
// this one is loud.
{
  const r = scoreScenario(harold);
  chk("Harold is no longer LEFT_BEHIND -- the timezone half of his trip was fixed",
    r.verdict === "PARTIAL", JSON.stringify(r));
  chk("...and what is left of him fails at DECIDE, not at input",
    r.failsAt === "decide", r.failsAt);
  chk("...on the meet-flight axis now, not the timezone one",
    r.worst === "purpose/meet-flight", r.worst);
  const tz = r.findings.find(f => f.axis === "constraints");
  chk("...and his timezone finding is PARTIAL with the residual named, not SERVED",
    tz.status === "PARTIAL" && /residual/.test(tz.evidence), JSON.stringify(tz));
  const partial = r.findings.find(f => f.axis === "purpose");
  chk("landing!=meeting is PARTIAL at decide, not silently SERVED",
    partial.status === "PARTIAL" && partial.step === "decide", JSON.stringify(partial));
}
// His other two input variants did NOT move together, and that is the finding:
// 'future-origin-not-here' had rotted (stored places exist now), while
// 'relative-date-phrase' is untouched as written. One specimen, two rows, two
// different fates -- which is why they are asserted separately rather than
// swept into one loop with a shared verdict.
chk("Harold-variant 'future-origin-not-here' has moved off LEFT_BEHIND -- route history filled it",
  scoreScenario({ ...harold, constraints: "future-origin-not-here" }).verdict === "PARTIAL", "");
chk("Harold-variant 'relative-date-phrase' is still LEFT_BEHIND at input -- nothing parses the phrase",
  scoreScenario({ ...harold, constraints: "relative-date-phrase" }).verdict === "LEFT_BEHIND"
    && scoreScenario({ ...harold, constraints: "relative-date-phrase" }).failsAt === "input", "");

// ---- specimen: parent with pram -- MUST score REFUSED, never LEFT_BEHIND ----
{
  const pram = { who: "parent-pram", purpose: "last-train-home",
                 constraints: "step-free", conditions: "api-outage", phrasing: "exact-station-names" };
  const r = scoreScenario(pram);
  chk("pram scores REFUSED-ON-PURPOSE, not a rediscovered defect", r.verdict === "REFUSED", JSON.stringify(r));
}

// ---- specimen: the served baseline (null control -- the rubric CAN say yes) ----
{
  const ok = { who: "commuter", purpose: "last-train-home",
               constraints: "needs-food-en-route", conditions: "normal", phrasing: "exact-station-names" };
  const r = scoreScenario(ok);
  chk("a servable traveller is not doomsaid: worst is PARTIAL, not LEFT_BEHIND", r.verdict === "PARTIAL", r.verdict);
  // Attributable on purpose: assert the UNADJUDICATED status on the axis that
  // carries the unruled value, not on the whole-scenario verdict. The verdict is
  // reachable through any unruled field, which is exactly how this check went
  // vacuous once before.
  const s = { ...ok, [UNADJ.axis]: UNADJ.value };
  const sf = scoreScenario(s).findings.find(f => f.axis === UNADJ.axis);
  chk(`an unchecked value (${UNADJ.axis}/${UNADJ.value}) reports UNADJUDICATED on its OWN axis, never a guessed verdict`,
    sf && sf.status === "UNADJUDICATED", JSON.stringify(sf));
}

// ---- instrument invariants ----
const refusals = JSON.parse(fs.readFileSync(new URL("./passengers/refusals.json", import.meta.url), "utf8"));
const covered = new Set(refusals.refusals.flatMap(r => r.covers));
for (const k of covered)
  chk(`refusal '${k}' adjudicates REFUSED (never rediscovered as a defect)`,
    ADJUDICATIONS[k]?.status === "REFUSED", JSON.stringify(ADJUDICATIONS[k]));
for (const [k, a] of Object.entries(ADJUDICATIONS).filter(([, a]) => a.status === "REFUSED"))
  chk(`REFUSED '${k}' is backed by a refusals.json row`, covered.has(k), k);
chk("every adjudication key names a real axis value",
  Object.keys(ADJUDICATIONS).every(k => { const [a, v] = k.split("/"); return AXES[a]?.includes(v); }),
  Object.keys(ADJUDICATIONS).filter(k => { const [a, v] = k.split("/"); return !AXES[a]?.includes(v); }).join(","));
chk("every adjudication carries evidence -- ground truth is never bare",
  Object.values(ADJUDICATIONS).every(a => a.evidence && a.evidence.length > 10));

// ---- pt.5 rule b: a refusal may not outlive its policy ----
// The xfail parent's known rot: reasons pointing at documents that no longer
// exist. Every refusal must carry a policy_ref whose file exists in-repo AND
// whose section heading is still present in that file.
for (const r of refusals.refusals) {
  chk(`refusal '${r.id}' carries a policy_ref`, !!(r.policy_ref?.file && r.policy_ref?.section), JSON.stringify(r.policy_ref));
  if (r.policy_ref?.file) {
    const p = fileURLToPath(new URL("../" + r.policy_ref.file, import.meta.url));
    const exists = fs.existsSync(p);
    chk(`refusal '${r.id}' policy file exists: ${r.policy_ref.file}`, exists, p);
    if (exists)
      chk(`refusal '${r.id}' policy section still present: '${r.policy_ref.section}'`,
        fs.readFileSync(p, "utf8").includes(r.policy_ref.section),
        "heading renamed or removed -- refusal is orphaned");
  }
}

// ---- the mirror of the rule above: an adjudication may not outlive the ABSENCE it cites ----
// The refusal rot-check asks "does the cited policy still exist?". This asks the
// question nobody was asking: a row whose evidence reads "no replan-from-here"
// is a CLAIM ABOUT THE APP -- that the feature is absent. Ship the feature and
// the row goes on failing a passenger the app now serves, green the whole time.
// The instrument understating the app is still the instrument being wrong.
//
// Cited absences are matched as hyphenated feature names, because that is what a
// suite is called in this repo -- so "no replan-from-here" resolves against
// tests/replan-from-here.mjs, while "no data source" (prose) matches nothing.
{
  const suites = fs.readdirSync(fileURLToPath(new URL("./", import.meta.url))).filter(f => f.endsWith(".mjs"));
  const staleCites = ev => [...ev.matchAll(/\bno ([a-z]+(?:-[a-z]+)+)\b/g)]
    .map(m => m[1]).filter(f => suites.includes(f + ".mjs"));

  for (const [k, a] of Object.entries(ADJUDICATIONS)) {
    const stale = staleCites(a.evidence);
    chk(`'${k}' cites no absence that the repo has since filled`, stale.length === 0,
      stale.map(f => `tests/${f}.mjs IS in the repo -- re-adjudicate this row`).join("; "));
  }

  // The same rule in the third direction, which is what a SERVED row needs: an
  // adjudication may not outlive the PRESENCE it cites either. "feature: ...
  // (pager.mjs)" is a claim that the evidence is still there to be re-read; delete
  // or rename that suite and the row becomes an assertion backed by nothing, green.
  const citedSuites = ev => [...ev.matchAll(/\b([a-z0-9-]+\.mjs)\b/g)].map(m => m[1]);
  for (const [k, a] of Object.entries(ADJUDICATIONS))
    for (const f of citedSuites(a.evidence))
      chk(`'${k}' cites ${f} as evidence, and that suite is still in the repo`, suites.includes(f),
        `tests/${f} is gone -- this row's evidence can no longer be re-read, so the row is unbacked`);

  // The rule's own negative case, synthetic on purpose. A count-based control
  // ("at least one row cites an absence") passed only while a stale row existed
  // -- so fixing the defect broke the proof that the check works. The corpus is
  // allowed to be clean; the rule still has to be demonstrably able to fire.
  chk("SELF-TEST: the rot-check FIRES on an absence the repo has filled",
    staleCites("register-2.1: no replan-from-here").length === 1, "");
  chk("SELF-TEST: ...and stays silent on an absence that is still real",
    staleCites("no such-feature-as-this exists").length === 0, "");
  chk("SELF-TEST: ...and does not read ordinary prose as a feature name",
    staleCites("policy-w30: no data source the app can verify").length === 0, "");
  chk("SELF-TEST: the presence-check FINDS a cited suite that is really there",
    citedSuites("feature: ... (pager.mjs)").join() === "pager.mjs", "");
  chk("SELF-TEST: ...and would flag one that is not",
    !suites.includes(citedSuites("feature: ... (no-such-suite.mjs)")[0]), "");
  chk("SELF-TEST: ...and reads BOTH files when a row cites two",
    citedSuites("feature: (outage-not-verdict.mjs, journey-anchor.mjs)").length === 2, "");
}

// ---- the disposition ledger: ABSENT is the only red (pt.3 rule 1) ----
const ledger = JSON.parse(fs.readFileSync(new URL("./passengers/dispositions.json", import.meta.url), "utf8"));
const LEGAL = ["built", "refused", "parked-with-reason", "undecided"];
for (const [k, a] of Object.entries(ADJUDICATIONS).filter(([, a]) => a.status === "PARTIAL" || a.status === "LEFT_BEHIND"))
  chk(`finding '${k}' has a ledger column (undecided is legal; absent is rot)`,
    LEGAL.includes(ledger.dispositions[k]?.state), JSON.stringify(ledger.dispositions[k]));
for (const [k, d] of Object.entries(ledger.dispositions)) {
  chk(`ledger row '${k}' points at a real adjudicated finding`, !!ADJUDICATIONS[k], k);
  if (d.state === "parked-with-reason")
    chk(`parked '${k}' actually carries its reason`, !!(d.reason && d.reason.length > 10), JSON.stringify(d));
}

// ---- BARELY: the rubric can emit Vreni's column before anyone occupies it ----
{
  ADJUDICATIONS["who/teen"] = { status: "BARELY", step: "decide", evidence: "synthetic: test-only injection, removed below" };
  const r = scoreScenario({ who: "teen", purpose: "last-train-home",
    constraints: "needs-food-en-route", conditions: "normal", phrasing: "exact-station-names" });
  delete ADJUDICATIONS["who/teen"];
  chk("served-but-barely outranks SERVED but loses to PARTIAL (the rot-while-green column exists)",
    r.verdict === "PARTIAL" && r.findings.some(f => f.status === "BARELY"), JSON.stringify(r.findings));
  const r2 = scoreScenario({ who: "commuter", purpose: "last-train-home",
    constraints: "arrive-by-time", conditions: "normal", phrasing: "exact-station-names" });
  chk("...and BARELY is absent when nothing emits it", !r2.findings.some(f => f.status === "BARELY"));
}

// ---- pt.5 rule a: shrinking -- the minimal failing passenger ----
{
  const harold = { who: "business-traveller", purpose: "meet-flight",
                   constraints: "foreign-tz-time", conditions: "normal", phrasing: "exact-station-names" };
  // The claim is that shrinking KEEPS THE VERDICT while dropping everything
  // that did not earn its place -- so that is what is asserted. Naming the
  // surviving field ("...and it is constraints/foreign-tz-time") was the same
  // mistake as the vacuous verdict checks: it hard-codes one adjudication into
  // an assertion about a different property, and it went red the moment that
  // row was re-adjudicated -- correct behaviour, wrong reason, and it would
  // have gone GREEN-but-meaningless just as easily had the two rows swapped
  // ranks instead. Read the surviving field off the full scoring instead.
  const full = scoreScenario(harold);
  const s = shrink(harold);
  chk("Harold shrinks to ONE field -- the biography was noise",
    s && Object.keys(s.minimal).length === 1, JSON.stringify(s));
  chk("...and the shrunk passenger fails identically -- same verdict, same worst axis",
    s.verdict === full.verdict && s.worst === full.worst, `${s.verdict}/${s.worst} vs ${full.verdict}/${full.worst}`);
  chk("...and what survived IS the axis that decided the verdict, not some other field",
    s.worst.startsWith(Object.keys(s.minimal)[0] + "/"), `${JSON.stringify(s.minimal)} vs ${s.worst}`);
  const partial = shrink({ who: "commuter", purpose: "last-train-home",
    constraints: "needs-food-en-route", conditions: "normal", phrasing: "exact-station-names" });
  chk("a PARTIAL passenger shrinks too (to its one load-bearing constraint)",
    partial && Object.keys(partial.minimal).length === 1 && partial.minimal.constraints === "needs-food-en-route",
    JSON.stringify(partial));
  // An otherwise fully-SERVED passenger carrying exactly one unruled value. The
  // unknown is the DISCOVERED one, not a hard-coded value that can quietly become
  // SERVED and leave this check resting on some unrelated field.
  const unknown = { who: "commuter", purpose: "last-train-home", constraints: "arrive-by-time",
                    conditions: "normal", phrasing: "exact-station-names", [UNADJ.axis]: UNADJ.value };
  chk("shrink refuses below PARTIAL -- unknown is not a failure to minimize",
    shrink(unknown) === null, "an unruled passenger was minimized as if the gap were understood");
}

// ---- pt.5 rule d: reduction check -- no gap may be called new unadjudicated ----
{
  const ctx = { refusals, ledger };
  chk("a refusal-covered key reduces (never a 'new gap')",
    /refusal 'step-free'/.test(reduceFinding("constraints/step-free", ctx) || ""),
    reduceFinding("constraints/step-free", ctx));
  chk("a ledger-parked key reduces to its ledger row",
    /ledger row \(parked-with-reason\)/.test(reduceFinding("constraints/needs-food-en-route", ctx) || ""));
  /* This control used to name a REAL unadjudicated row (phrasing/zip-code) as
     its example of "genuinely unchecked". It went red the hour that row was
     adjudicated -- not because the reducer regressed, but because the control
     was reading the live corpus for its fixture, so it could only survive while
     the worklist stayed unfinished. A control that dies when you do the work is
     measuring the work, not the property. The key below cannot ever be
     adjudicated, and the guard proves it is still absent from all three sources
     rather than assuming it. */
  const SYNTHETIC = "phrasing/__never-adjudicated-control";
  /* `refusals.refusals` is an ARRAY of rows whose `covers` lists the keys, not a
     map keyed by them -- so the first draft of this guard indexed an array with a
     string, got undefined, and passed no matter what. `covered` is the Set the
     rest of the file already reduces it to. */
  chk("control-of-the-control: the synthetic key really is unknown to all three sources",
    !ADJUDICATIONS[SYNTHETIC] && !covered.has(SYNTHETIC) && !ledger.dispositions[SYNTHETIC],
    SYNTHETIC);
  chk("a genuinely unchecked key does NOT reduce -- NEW-CANDIDATE stays reachable",
    reduceFinding(SYNTHETIC, ctx) === null, String(reduceFinding(SYNTHETIC, ctx)));
}

// ---- generator determinism + committed population freshness ----
{
  const a = JSON.stringify(generate(20260728, 50)), b = JSON.stringify(generate(20260728, 50));
  chk("same seed, same population (reproducible)", a === b);
  chk("different seed, different population", JSON.stringify(generate(7, 50)) !== a);
  const popPath = fileURLToPath(new URL("./passengers/population.json", import.meta.url));
  chk("population.json is committed", fs.existsSync(popPath));
  if (fs.existsSync(popPath)) {
    const onDisk = JSON.parse(fs.readFileSync(popPath, "utf8"));
    chk("committed population matches the generator (a diff means AXES changed, not dice)",
      JSON.stringify(onDisk) === JSON.stringify(generate(onDisk.seed, onDisk.n)),
      "regenerate with: node test./passengers/generate.mjs");
    // pt.5 rule c (golden-file parent's known rot): the population may NEVER be
    // re-rolled to green. The seed is PINNED here; a red passenger gets a
    // disposition, not new dice. Changing this pin requires editing this test
    // -- which is the visible, reviewable act the rule wants.
    chk("population seed is pinned at 20260728/n=1000 (no re-roll to dodge a red passenger)",
      onDisk.seed === 20260728 && onDisk.n === 1000, `seed=${onDisk.seed} n=${onDisk.n}`);
  }
}

/* Open questions: the third staleness shape, made durable.
   The first two shapes decay by SHIPPING -- an adjudication cites an absence the
   app later fills (stale pessimistic, silent), a specimen asserts a failure the
   app later fixes (stale optimistic, loud). This one decays by NOBODY DECIDING.
   A row whose axis makes its subject ambiguous can be read as rotted or as fresh
   at will, and the reading nobody writes down is the reading that wins later.
   Asked 2026-07-30, the operator's answer was "I do not know right now" -- an
   honest state with nowhere to live except a comment, and comments rot silently.
   So it is data now, and these checks keep it loud until it is actually decided. */
{
  const open = Object.entries(ADJUDICATIONS).filter(([, a]) => a.openQuestion);
  chk("control: the open-question checks have something to check",
    open.length > 0, "no row carries openQuestion -- if the last one was decided, delete these checks deliberately");
  for (const [key, a] of open) {
    const q = a.openQuestion;
    chk(`open question on ${key} names what it was raised against`,
      typeof q.raisedAgainst === "string" && typeof q.question === "string" && typeof q.asked === "string",
      JSON.stringify(q));
    /* The load-bearing one. Ruling the row while leaving the question behind
       would leave a decided row still advertising itself as undecided -- and the
       reverse, silently flipping the status, is exactly the drift this whole
       file exists to catch. Retiring the question and changing the status must
       be the SAME edit. */
    chk(`${key} has not been ruled without retiring its open question`,
      a.status === q.raisedAgainst,
      `status is ${a.status} but the question was raised against ${q.raisedAgainst} -- if you decided this, delete openQuestion in the same edit`);
    console.log(`  OPEN  ${key} (asked ${q.asked}, still ${a.status}): ${q.question}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
