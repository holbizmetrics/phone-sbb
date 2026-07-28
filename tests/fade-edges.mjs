// A faded edge on a chip row is a CLAIM: "there are more chips this way."
//
// So the thing worth testing is not that the fade appears -- it is that it
// STAYS AWAY when the claim would be false. A mask applied statically in CSS
// would have passed any "does it fade" test while lying on every row that fits,
// which is the same defect class as a filter note that names options it never
// looked at. Both directions are planted below.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);
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

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const fadeEdges = new Function(grab("fadeEdges") + "\nreturn fadeEdges;")();

// a chip row: how wide its content is, how wide the box is, where it is scrolled
const row = (scrollWidth, clientWidth, scrollLeft) => {
  const set = new Set();
  return {
    scrollWidth, clientWidth, scrollLeft,
    classList: { toggle: (c, on) => { on ? set.add(c) : set.delete(c); }, has: c => set.has(c) },
    get L(){ return set.has("fadeL"); }, get R(){ return set.has("fadeR"); },
  };
};
const at = (sw, cw, x) => { const e = row(sw, cw, x); fadeEdges(e); return e; };

// ---- control: the function has to be able to say BOTH things ----
chk("control: it can fade", at(600, 328, 0).R === true);
chk("control: it can decline to fade", at(300, 328, 0).R === false);

// ---- THE HONESTY CASE: a row that fits claims nothing ----
const fits = at(300, 328, 0);
chk("a row narrower than its box has no right fade", fits.R === false);
chk("a row narrower than its box has no left fade", fits.L === false);
const exact = at(328, 328, 0);
chk("a row exactly as wide as its box has no fade", exact.R === false && exact.L === false);
// Sub-pixel content widths are routine after a zoom or an odd font metric; 0.4px
// of "overflow" is not something you can scroll to, and a fade there is a lie
// that never goes away because the row cannot be scrolled to clear it.
const hair = at(328.4, 328, 0);
chk("sub-pixel overflow is not treated as scrollable", hair.R === false && hair.L === false,
  "L=" + hair.L + " R=" + hair.R);

// ---- an overflowing row, at each of the three positions ----
// 640 of chips in a 328 box == 312 of scroll room; the real train-type row at
// 360px is about this shape (roughly 410 of chips, 328 of box).
const start = at(640, 328, 0);
chk("at the left edge it points RIGHT", start.R === true);
chk("at the left edge it does NOT point left", start.L === false,
  "nothing has scrolled past yet -- a left fade would invent hidden chips");

const mid = at(640, 328, 150);
chk("mid-scroll it points both ways", mid.L === true && mid.R === true);

const end = at(640, 328, 312);
chk("scrolled to the end it stops pointing right", end.R === false,
  "the fade would keep promising chips that are not there");
chk("scrolled to the end it still points back left", end.L === true);

// The end position is the one a real browser rounds: scrollLeft comes back as
// 311.5 or 312.3 rather than exactly 312, and an equality test would leave the
// right-hand fade stuck on at the end of every row.
chk("a near-end scroll position still counts as the end", at(640, 328, 311.6).R === false,
  "exact-equality end detection would strand the fade on");
chk("a near-start scroll position still counts as the start", at(640, 328, 0.4).L === false);

// ---- it must not throw on the things that are not rendered elements ----
let threw = null;
try { fadeEdges(null); fadeEdges(undefined); fadeEdges({}); fadeEdges({ scrollWidth: 9 }); }
catch (e) { threw = e.message; }
chk("a missing or unmounted element is survived, not crashed", threw === null, String(threw));

// ---- WIRING: none of the above matters if nothing measures the rows ----
const bootStart = src.lastIndexOf("\nrenderFavs();");
const boot = src.slice(bootStart, src.indexOf("</script>", bootStart));
chk("wireFades() runs at boot", /\bwireFades\(\)/.test(boot),
  "the fades are computed once, at boot -- unwired, every row renders unmasked");
chk("wireFades is defined", src.includes("function wireFades("));
chk("it listens for scroll", /addEventListener\("scroll"/.test(grab("wireFades")));
chk("it re-measures when the chips change", /MutationObserver/.test(grab("wireFades")),
  "a repainted row keeps the previous row's fade state");
chk("it re-measures when the box resizes", /ResizeObserver/.test(grab("wireFades")));

// ---- the CSS the classes refer to has to exist, in BOTH vendor forms ----
for (const c of ["fadeL", "fadeR"]) {
  chk(`.favs.${c} has a rule`, new RegExp("\\.favs\\." + c + "\\{").test(src.replace(/\s+/g, "")) ||
    new RegExp("\\.favs\\." + c + "[\\{,]").test(src), "class toggled but never styled");
}
chk("the both-edges case has its own rule, not two conflicting ones",
  /\.favs\.fadeL\.fadeR\{/.test(src.replace(/\n\s*/g, "")),
  "two single-edge mask-image rules cannot combine -- the later one simply wins");
chk("the mask is prefixed for webkit (this ships to mobile Safari)",
  (src.match(/-webkit-mask-image/g) || []).length >= 3);
// A background gradient would sit BEHIND the opaque chips and fade nothing.
chk("the fade is a mask, not a background gradient",
  !/\.favs\.fade[LR][^}]*background/.test(src.replace(/\n\s*/g, "")));

// Every assertion above this line ALSO passed on the version a real phone reported
// as "it just looks chopped" -- they check that a mask exists, not that it reads as
// a dissolve. This is the one structural fact that separates the two: a ramp shorter
// than a chip only nicks the trailing chip's edge, leaving the rest at full opacity
// against a hard vertical cut. A chip is ~64px at 360px, so the ramp must reach full
// opacity no sooner than that. (Strength itself is a judgement a unit test cannot
// make -- this pins the measurable half.)
{
  const L = (src.match(/\.favs\.fadeL\{[^}]*\}/) || [""])[0];
  const end = (L.match(/#000 (\d+)px/) || [])[1];
  chk("the ramp is at least one chip wide", Number(end) >= 64, "ramp ends at " + end + "px");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
