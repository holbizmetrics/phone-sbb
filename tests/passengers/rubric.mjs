// Scores one generated scenario: which stated constraints were silently
// dropped, and at which step. No oracle needed -- the ground truth lives in
// axes.mjs adjudications, and the rubric only aggregates it per scenario.
// Coarse by design: the verdict for a scenario is its WORST axis value,
// because a traveller is as served as their least-served need.
import { AXES, adjudicate } from "./axes.mjs";

// BARELY = served-but-barely, Vreni's column: the passenger gets there, but
// the app rots while tests stay green (pt.3 rule 4). The rubric must be ABLE
// to emit it even before any adjudication uses it.
const RANK = { SERVED: 0, BARELY: 1, REFUSED: 2, UNADJUDICATED: 3, PARTIAL: 4, LEFT_BEHIND: 5 };

export function scoreScenario(s) {
  const findings = [];
  for (const axis of Object.keys(AXES)) {
    const a = adjudicate(axis, s[axis]);
    findings.push({ axis, value: s[axis], ...a });
  }
  findings.sort((x, y) => RANK[y.status] - RANK[x.status]);
  const worst = findings[0];
  return { verdict: worst.status, failsAt: worst.step, worst: `${worst.axis}/${worst.value}`, findings };
}

// Shrinking (pt.5 rule a, the PBT parent's gift): minimize a failing passenger
// to the smallest passenger that still fails the same way. Dropped axes score
// UNADJUDICATED (unknown, rank 3), so shrinking is only defined for verdicts
// above that -- PARTIAL and LEFT_BEHIND. The minimal passenger IS the cluster
// finding: "the failure needs only these fields; the biography was noise."
export function shrink(s) {
  const target = scoreScenario(s);
  if (RANK[target.verdict] <= RANK.UNADJUDICATED) return null;
  const minimal = { ...s };
  const dropped = [];
  for (const axis of Object.keys(AXES)) {
    const t = { ...minimal };
    delete t[axis];
    const r = scoreScenario(t);
    if (r.verdict === target.verdict && r.worst === target.worst && r.failsAt === target.failsAt) {
      delete minimal[axis];
      dropped.push(axis);
    }
  }
  return { minimal, dropped, verdict: target.verdict, worst: target.worst };
}

// Reduction check (pt.5 rule d): before a finding may be called a NEW gap, it
// must fail to reduce to a known parent -- a decided refusal, a ledger row, or
// an existing adjudication. Depth-of-search is not originality; this is the
// same seam PCLA's reduction gate guards on claims.
export function reduceFinding(key, { refusals, ledger }) {
  for (const r of refusals?.refusals || [])
    if (r.covers.includes(key)) return `refusal '${r.id}' (decided ${r.decided})`;
  const d = ledger?.dispositions?.[key];
  if (d) return `ledger row (${d.state})`;
  const a = adjudicate(...key.split("/"));
  if (a.status !== "UNADJUDICATED") return `adjudicated ${a.status}: ${a.evidence}`;
  return null;
}

// Cluster a scored population: per axis value, how many scenarios carry it and
// what its status is. "N% of the population fails at timezone input" is the
// output shape that prioritises -- a register row never carried the N.
export function cluster(scored, population) {
  const by = {};
  population.forEach((s, i) => {
    for (const f of scored[i].findings) {
      const k = `${f.axis}/${f.value}`;
      by[k] ??= { status: f.status, step: f.step, n: 0, worstFor: 0 };
      by[k].n++;
      if (scored[i].worst === k) by[k].worstFor++;
    }
  });
  return by;
}
