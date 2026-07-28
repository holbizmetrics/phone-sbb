// The sweep report: who is left behind, in clusters, plus the adjudication
// worklist. Report-only (exit 0) -- the failing checks live in
// tests/passenger-sweep.mjs, which pins the specimens and the instrument's own
// invariants. Run:  node tests/passengers/sweep.mjs
import fs from "fs";
import { scoreScenario, cluster } from "./rubric.mjs";
import { generate } from "./generate.mjs";

const path = new URL("./population.json", import.meta.url).pathname;
const pop = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : generate();
const scored = pop.scenarios.map(scoreScenario);

const tally = {};
for (const s of scored) tally[s.verdict] = (tally[s.verdict] || 0) + 1;
console.log(`population: ${pop.n} scenarios, seed ${pop.seed}`);
for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  console.log(`  ${v.padEnd(14)} ${n}  (${(100 * n / pop.n).toFixed(1)}%)`);

const by = cluster(scored, pop.scenarios);
console.log("\nleft-behind clusters (axis value -> % of population it dooms):");
for (const [k, c] of Object.entries(by).filter(([, c]) => c.status === "LEFT_BEHIND" || c.status === "PARTIAL")
    .sort((a, b) => b[1].worstFor - a[1].worstFor))
  console.log(`  ${c.status.padEnd(12)} at ${String(c.step).padEnd(6)} ${k.padEnd(38)} carried by ${c.n}, verdict-setting for ${(100 * c.worstFor / pop.n).toFixed(1)}%`);

// The funnel (pt.3 rule 4): each step drains population; the biggest drain is
// the top of the roadmap ARITHMETICALLY, no ranking meeting.
const drain = {};
for (const s of scored) if (s.verdict === "LEFT_BEHIND" || s.verdict === "PARTIAL")
  drain[s.failsAt] = (drain[s.failsAt] || 0) + 1;
console.log("\nfunnel drain (which step loses the most passengers):");
for (const [step, n] of Object.entries(drain).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(step).padEnd(8)} drains ${n}  (${(100 * n / pop.n).toFixed(1)}%)`);

const unadj = Object.entries(by).filter(([, c]) => c.status === "UNADJUDICATED");
console.log(`\nadjudication worklist: ${unadj.length} axis values nobody has checked`);
for (const [k, c] of unadj.sort((a, b) => b[1].n - a[1].n).slice(0, 10))
  console.log(`  ${k.padEnd(38)} carried by ${c.n} scenarios`);
if (unadj.length > 10) console.log(`  ...and ${unadj.length - 10} more`);
