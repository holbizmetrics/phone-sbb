// Seeded, reproducible population sampler: ~1000 of the 100k combinations,
// five axes sampled independently. Run:  node tests/personas/generate.mjs
// Rewrites population.json deterministically (seed in the file header), so a
// diff in that file means the AXES changed, never that the dice rolled again.
import fs from "fs";
import { AXES } from "./axes.mjs";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(seed = 20260728, n = 1000) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = {};
    for (const axis of Object.keys(AXES)) s[axis] = pick(AXES[axis]);
    out.push(s);
  }
  return { seed, n, scenarios: out };
}

if (process.argv[1] && process.argv[1].endsWith("generate.mjs")) {
  const pop = generate();
  const path = new URL("./population.json", import.meta.url).pathname;
  fs.writeFileSync(path, JSON.stringify(pop, null, 1) + "\n");
  console.log(`wrote ${pop.n} scenarios (seed ${pop.seed}) -> ${path}`);
}
