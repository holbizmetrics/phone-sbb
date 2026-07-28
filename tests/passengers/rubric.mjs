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
