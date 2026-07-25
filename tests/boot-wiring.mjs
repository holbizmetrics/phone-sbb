// Guards one specific recurring failure: a feature that reads remembered state,
// draws correctly, passes CI -- and is never called on load, so it is invisible
// in the actual app. It happened five times on this file. renderModes and
// renderRoutes both arrived wired ONLY into toggleFav(), so their chips appeared
// solely as a side effect of starring a station. Nothing threw; nothing was red.
//
// The rule: if a function paints state restored from localStorage, the boot
// block has to call it. This asserts exactly that, and nothing else.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);
const src = fs.readFileSync(APP, "utf8");

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// The boot block is the run of top-level statements after the last function
// definition -- everything from the final bare renderFavs() to </script>.
const bootStart = src.lastIndexOf("\nrenderFavs();");
if (bootStart < 0) throw new Error("HARNESS FAILED -- boot block not found; did the init section move?");
const boot = src.slice(bootStart, src.indexOf("</script>", bootStart));
chk("control: that really is the boot block", boot.includes("tickClock()") && boot.includes("visibilitychange"),
  boot.slice(0, 120));

// Every painter of restored state. Adding a feature that remembers something
// means adding it here too -- that is the point of the list.
const PAINTERS = ["renderFavs", "renderModes", "renderRoutes", "renderBuild"];
for (const fn of PAINTERS) {
  chk(`${fn} is defined`, src.includes(`function ${fn}(`), "no such function -- stale list?");
  chk(`${fn}() runs at boot`, new RegExp(`\\b${fn}\\(\\)`).test(boot),
    "defined but never called on load -> the feature is invisible until something else happens to call it");
}

// Each painter must survive being called with nothing stored, because that is
// what a first-ever launch looks like. A crash here white-screens a new user.
const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};
const el = () => ({ innerHTML: "" });
for (const [fn, state] of [["renderFavs", "let favs=[];"], ["renderModes", "let modeSel=[];"],
  ["renderRoutes", "let routeHist=[];"], ["renderBuild", 'const BUILD="dev";']]) {
  let threw = null;
  try {
    new Function("EL", `
      const $ = () => EL();
      ${state}
      ${src.match(/const MODES=[\s\S]*?\];/) ? src.match(/const MODES=[\s\S]*?\];/)[0] : ""}
      ${grab("esc")}
      ${grab("shortStop")}
      ${grab(fn)}
      ${fn}();
    `)(el);
  } catch (e) { threw = e.message; }
  chk(`${fn}() survives an empty first launch`, threw === null, String(threw));
}

/* The build stamp spans two files: a line in index.html and a sed in deploy.yml
   that rewrites it. Nothing inside either file notices when they drift apart --
   the sed just matches nothing, the deploy stays green, and the live page keeps
   reporting whatever it last said. That is the "ships green but never runs"
   shape again, on the one surface whose entire job is to be believed. So the
   join is asserted here, in the file that already owns wiring. */
{
  const STAMP = 'const BUILD = "dev";  // BUILD-STAMP';
  const hits = src.split("\n").filter(l => l === STAMP).length;
  chk("index.html carries exactly one BUILD-STAMP line", hits === 1, "found " + hits);

  const ymlPath = new URL("../.github/workflows/deploy.yml", import.meta.url).pathname;
  const yml = fs.readFileSync(ymlPath, "utf8");
  // The workflow is YAML-in-shell-in-double-quotes; drop the escaping to compare.
  const bare = yml.replace(/\\(.)/g, "$1");
  chk("deploy.yml's sed targets that exact line", bare.includes("^" + STAMP + "$"),
    "the sed pattern and the source line have drifted -- the stamp would silently never update");
  chk("deploy.yml verifies the stamp applied", /grep -q[\s\S]{0,200}?exit 1/.test(yml),
    "a sed that matches nothing exits 0 -- without a verify the deploy ships an unstamped page, green");
  chk("the stamp is rendered where it can be read", /id="buildStamp"/.test(src),
    "no element for renderBuild to paint into");
  chk("renderBuild reads the constant, not a literal", /BUILD===?"dev"/.test(grab("renderBuild")),
    "renderBuild does not consult BUILD -- it would report the same thing forever");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
