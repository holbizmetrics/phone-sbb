// The passenger instrument's own acceptance suite: hand-built specimens with
// KNOWN correct answers, plus the invariants that keep the instrument honest.
// The generated population is the net; these specimens prove the net has no
// holes where we already know the fish are.
import fs from "fs";
import { scoreScenario, shrink, reduceFinding } from "./passengers/rubric.mjs";
import { ADJUDICATIONS, AXES, adjudicate } from "./passengers/axes.mjs";
import { generate } from "./passengers/generate.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- specimen #1: Harold (bus msg 87102361, adjudicated by hand vs 1625cbe) ----
const harold = { who: "business-traveller", purpose: "meet-flight",
                 constraints: "foreign-tz-time", conditions: "normal", phrasing: "exact-station-names" };
{
  const r = scoreScenario(harold);
  chk("Harold is LEFT_BEHIND", r.verdict === "LEFT_BEHIND", JSON.stringify(r));
  chk("...and falls off at INPUT (the '6 PM EST' finding)", r.failsAt === "input", r.failsAt);
  chk("...on the timezone axis", r.worst === "constraints/foreign-tz-time", r.worst);
  const partial = r.findings.find(f => f.axis === "purpose");
  chk("landing!=meeting is PARTIAL at decide, not silently SERVED",
    partial.status === "PARTIAL" && partial.step === "decide", JSON.stringify(partial));
}
// Harold's other two input findings carry the same verdict:
for (const c of ["future-origin-not-here", "relative-date-phrase"])
  chk(`Harold-variant '${c}' also LEFT_BEHIND at input`,
    scoreScenario({ ...harold, constraints: c }).verdict === "LEFT_BEHIND"
      && scoreScenario({ ...harold, constraints: c }).failsAt === "input");

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
  const s = { ...ok, constraints: "arrive-by-time" };
  chk("an unchecked value reports UNADJUDICATED, never a guessed verdict",
    scoreScenario(s).verdict === "UNADJUDICATED", scoreScenario(s).verdict);
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
    const p = new URL("../" + r.policy_ref.file, import.meta.url).pathname;
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
  const suites = fs.readdirSync(new URL("./", import.meta.url).pathname).filter(f => f.endsWith(".mjs"));
  const staleCites = ev => [...ev.matchAll(/\bno ([a-z]+(?:-[a-z]+)+)\b/g)]
    .map(m => m[1]).filter(f => suites.includes(f + ".mjs"));

  for (const [k, a] of Object.entries(ADJUDICATIONS)) {
    const stale = staleCites(a.evidence);
    chk(`'${k}' cites no absence that the repo has since filled`, stale.length === 0,
      stale.map(f => `tests/${f}.mjs IS in the repo -- re-adjudicate this row`).join("; "));
  }

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
  const s = shrink(harold);
  chk("Harold shrinks to ONE field -- the biography was noise",
    s && Object.keys(s.minimal).length === 1 && s.minimal.constraints === "foreign-tz-time", JSON.stringify(s));
  chk("...and the shrunk passenger fails identically", s.verdict === "LEFT_BEHIND" && s.worst === "constraints/foreign-tz-time");
  const partial = shrink({ who: "commuter", purpose: "last-train-home",
    constraints: "needs-food-en-route", conditions: "normal", phrasing: "exact-station-names" });
  chk("a PARTIAL passenger shrinks too (to its one load-bearing constraint)",
    partial && Object.keys(partial.minimal).length === 1 && partial.minimal.constraints === "needs-food-en-route",
    JSON.stringify(partial));
  chk("shrink refuses below PARTIAL -- unknown is not a failure to minimize",
    shrink({ who: "commuter", purpose: "last-train-home", constraints: "arrive-by-time",
             conditions: "normal", phrasing: "exact-station-names" }) === null);
}

// ---- pt.5 rule d: reduction check -- no gap may be called new unadjudicated ----
{
  const ctx = { refusals, ledger };
  chk("a refusal-covered key reduces (never a 'new gap')",
    /refusal 'step-free'/.test(reduceFinding("constraints/step-free", ctx) || ""),
    reduceFinding("constraints/step-free", ctx));
  chk("a ledger-parked key reduces to its ledger row",
    /ledger row \(parked-with-reason\)/.test(reduceFinding("constraints/needs-food-en-route", ctx) || ""));
  chk("a genuinely unchecked key does NOT reduce -- NEW-CANDIDATE stays reachable",
    reduceFinding("phrasing/zip-code", ctx) === null, String(reduceFinding("phrasing/zip-code", ctx)));
}

// ---- generator determinism + committed population freshness ----
{
  const a = JSON.stringify(generate(20260728, 50)), b = JSON.stringify(generate(20260728, 50));
  chk("same seed, same population (reproducible)", a === b);
  chk("different seed, different population", JSON.stringify(generate(7, 50)) !== a);
  const popPath = new URL("./passengers/population.json", import.meta.url).pathname;
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
