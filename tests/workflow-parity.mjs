// The two workflows must run the SAME tests.
//
// ci.yml gates every branch; deploy.yml gates what goes live. Their test steps
// are copy-pasted twins, and deploy.yml's own comment already names the hazard:
// "A deploy that runs fewer tests than CI is the worst version of this bug."
// That was a comment asking for care. This is the check.
//
// Two failure shapes are guarded, both of which stay GREEN while broken:
//   - DRIFT: a suite added to ci.yml's step and not deploy.yml's (or an
//     exclusion added to deploy.yml only) means the live site is gated by a
//     smaller test set than the branch it came from.
//   - A SWALLOWED EXIT CODE: `node "$t" | tail -1` reports the status of tail,
//     which is always 0. The suite runs, prints FAIL, and the step passes.
//     (Imported class: a green signal is only worth its denominator.)
import fs from "fs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const read = f => {
  const p = new URL("../.github/workflows/" + f, import.meta.url).pathname;
  try { return fs.readFileSync(p, "utf8"); }
  catch { throw new Error("HARNESS FAILED -- workflow not readable: " + p); }
};
const CI = read("ci.yml"), DEPLOY = read("deploy.yml");
console.log("reading .github/workflows/{ci,deploy}.yml");

// A step is its `- name:` line through to the next list item at the same indent.
// Anchored on the NAME, never on a line inside the script -- a mutation to the
// script must produce a verdict here, not a harness throw.
const stepOf = (yml, nameRe) => {
  const lines = yml.split("\n");
  const i = lines.findIndex(l => /^\s*- name:/.test(l) && nameRe.test(l));
  if (i < 0) return null;
  const indent = lines[i].match(/^\s*/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(lines[j].trim() && lines[j].match(/^\s*/)[0].length <= indent && /^\s*-\s/.test(lines[j]))) j++;
  return lines.slice(i, j).join("\n");
};
const norm = s => s.replace(/^\s*- name:.*$/m, "").replace(/\s+/g, " ").trim();

const ciSuite = stepOf(CI, /Offline unit tests/), dpSuite = stepOf(DEPLOY, /Offline unit tests/);
if (!ciSuite || !dpSuite) throw new Error("HARNESS FAILED -- 'Offline unit tests' step not found in both workflows");

chk("control: the extracted steps really are the suite runners",
  /tests\/\*\.mjs/.test(ciSuite) && /tests\/\*\.mjs/.test(dpSuite), "");

// ================= the two must be the same script =================
{
  chk("PLANTED: deploy.yml runs the IDENTICAL suite script as ci.yml -- the live gate is not the smaller one",
    norm(ciSuite) === norm(dpSuite),
    "ci: " + norm(ciSuite).slice(0, 90) + " || deploy: " + norm(dpSuite).slice(0, 90));

  // Same denominator, stated independently of the byte-compare above: if the
  // two ever legitimately diverge in shape, the SKIP SETS must still match.
  const skips = s => (s.match(/tests\/[A-Za-z0-9_-]+\.mjs/g) || []).sort().join(",");
  chk("...and they skip exactly the same files", skips(ciSuite) === skips(dpSuite),
    "ci: " + skips(ciSuite) + " || deploy: " + skips(dpSuite));
  chk("smoke.mjs is the ONLY suite either one skips -- a quiet second exclusion shows up here",
    skips(ciSuite) === "tests/smoke.mjs", skips(ciSuite));
}

// ================= discovery is a glob, not a list =================
{
  // The list version orphaned four suites once (chip-storm, journey-race, touch,
  // wander) and CI stayed green because it never ran them.
  for (const [n, s] of [["ci.yml", ciSuite], ["deploy.yml", dpSuite]]) {
    chk(`${n} discovers suites by glob`, /for t in tests\/\*\.mjs/.test(s), "");
  }
  // The whole-file view: only the two suites named on purpose may appear as
  // literals anywhere. A third means someone started hand-listing again.
  const lits = y => [...new Set((y.match(/tests\/[A-Za-z0-9_-]+\.mjs/g) || []))].sort();
  for (const [n, y] of [["ci.yml", CI], ["deploy.yml", DEPLOY]]) {
    chk(`${n} names no suite literally except syntax-check and smoke`,
      lits(y).join(",") === "tests/smoke.mjs,tests/syntax-check.mjs", lits(y).join(","));
  }
  // Control: the glob's denominator is the real one -- every suite lives where
  // the glob looks, so "all of tests/*.mjs" is genuinely all of them.
  const dir = new URL("../tests/", import.meta.url).pathname;
  const onDisk = fs.readdirSync(dir).filter(f => f.endsWith(".mjs"));
  chk("control: there are suites on disk for the glob to find", onDisk.length >= 20, String(onDisk.length));
  chk("this suite is itself inside the glob's reach", onDisk.includes("workflow-parity.mjs"), "");
}

// ================= the exit code survives =================
{
  for (const [n, s] of [["ci.yml", ciSuite], ["deploy.yml", dpSuite]]) {
    chk(`${n} records a failing suite`, /node "\$t" \|\| fail=1/.test(s),
      "the loop body does not capture a nonzero status");
    chk(`${n} exits on it -- a recorded failure that is never returned is not a gate`,
      /exit \$fail/.test(s), "");
  }
  // PLANTED: the trap itself. Any pipe on a node invocation hands the step
  // tail/head/grep's status instead, which is 0 whatever the suite said.
  // `||` is the guard we WANT; a single `|` is the trap. Blank the doubles out
  // first -- a lookahead cannot express this, as the greedy prefix just walks
  // past the first bar and matches the second (it did, on the first run).
  for (const [n, y] of [["ci.yml", CI], ["deploy.yml", DEPLOY]]) {
    const piped = y.split("\n").filter(l => /\bnode\b/.test(l) && /\|/.test(l.replace(/\|\|/g, "")));
    chk(`PLANTED: ${n} pipes no node invocation -- a pipe would report the pipe's status, not the suite's`,
      piped.length === 0, piped.join(" ;; "));
  }
}

// ================= the gate is wired at all =================
{
  chk("both workflows syntax-check before running anything else",
    /- name: Syntax-check[\s\S]*?- name: Offline unit tests/.test(CI)
    && /- name: Syntax-check[\s\S]*?- name: Offline unit tests/.test(DEPLOY), "");
  chk("both run the browser smoke test",
    /node tests\/smoke\.mjs/.test(CI) && /node tests\/smoke\.mjs/.test(DEPLOY), "");
  chk("PLANTED: the deploy job is gated on the test job -- without needs:, a red suite still ships",
    /^\s*needs:\s*test\b/m.test(DEPLOY), "");
  chk("ci.yml ignores master, so master is gated by deploy.yml and not by nothing",
    /branches-ignore:\s*\[master\]/.test(CI), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
