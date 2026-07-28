// The passenger instrument's own acceptance suite: hand-built specimens with
// KNOWN correct answers, plus the invariants that keep the instrument honest.
// The generated population is the net; these specimens prove the net has no
// holes where we already know the fish are.
import fs from "fs";
import { scoreScenario } from "./passengers/rubric.mjs";
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
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
