// T3's remaining half: the departure board as a SCREEN READER hears it.
// The visual row is five fragments (badge, destination, platform, delay,
// countdown) that read as a wall of text with no row boundaries. This suite
// runs the REAL depAria/depRow/patchRow/announce and checks the two promises:
// every row is one coherent sentence that stays true through live patching,
// and the live region speaks ONLY on material transitions (platform change,
// new delay) -- never the every-30s countdown churn, which would shout over
// the user it exists to serve.
import fs from "fs";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

const grab = (n) => {
  let i = src.indexOf("async function " + n + "(");
  if (i < 0) i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};
const grabConst = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- could not extract " + what);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const NOW = new Date("2026-07-25T14:00:00+02:00").getTime();
function build() {
  const annc = { textContent: "" };
  const m = new Function("RealDate", "annc", `
    const NOW=${NOW};
    const Date=function(...a){ return new RealDate(...(a.length?a:[NOW])); };
    Date.now=()=>NOW;
    const $=(id)=> id==="annc" ? annc : null;
    ${grabConst(/const ISO_LOCAL=[^;]+;/, "ISO_LOCAL")}
    ${grab("esc")}
    ${grab("hhmm")}
    ${grab("minsUntil")}
    ${grab("depLabel")}
    ${grab("isScenic")}
    ${grab("catColor")}
    ${grab("badge")}
    ${grab("depKey")}
    ${grab("depAria")}
    ${grab("announce")}
    ${grab("depRow")}
    ${grab("patchRow")}
    return { depAria, depRow, patchRow, announce };
  `)(Date, annc);
  return { ...m, annc };
}
// a stationboard entry the way transport.opendata.ch shapes it
const J = (stop = {}, top = {}) => ({
  category: "IR", number: "36", to: "Basel SBB",
  stop: { departure: "2026-07-25T14:05:00+0200", platform: "7", prognosis: {}, ...stop },
  ...top,
});
// a patched board row, the parts patchRow actually touches
const mkRow = (label) => {
  const attrs = { "aria-label": label };
  const els = {
    ".min": { dataset: {}, innerHTML: "", classList: { toggle() {} } },
    ".at": { innerHTML: "" },
    ".via": { innerHTML: "" },
  };
  return {
    querySelector: (s) => els[s] || null,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = v; },
    attrs,
  };
};

// ---- depAria: one sentence, every fragment in it ----
{
  const t = build();
  const a = t.depAria(J());
  chk("an on-time row reads as one sentence: who, where, when, platform, how soon",
    a === "IR 36 to Basel SBB, 14:05, platform 7, in 5 minutes", a);
  const d = t.depAria(J({ prognosis: { departure: "2026-07-25T14:11:00+0200" } }));
  chk("a delay is spoken beside the scheduled time -- and the countdown follows the prognosis",
    /14:05 plus 6 minutes/.test(d) && /in 11 minutes/.test(d), d);
  const p = t.depAria(J({ prognosis: { platform: "4" } }));
  chk("a platform change says 'changed', and names the NEW platform",
    /platform 4 changed/.test(p) && !/platform 7/.test(p), p);
  const n = t.depAria(J({ platform: undefined }));
  chk("no platform -> the sentence simply has none, not 'platform undefined'",
    !/platform/.test(n), n);
  const now = t.depAria(J({ departure: "2026-07-25T14:00:00+0200" }));
  chk("zero minutes is 'leaving now'", /leaving now/.test(now), now);
  const anon = t.depAria(J({}, { to: undefined }));
  chk("a missing destination is named missing, not blank", /unknown destination/.test(anon), anon);
}

// ---- depRow: the sentence rides the row, escaped ----
{
  const t = build();
  const h = t.depRow(J(), 0);
  chk("the row is a list item with the sentence as its label",
    /role="listitem"/.test(h) && /aria-label="IR 36 to Basel SBB, 14:05, platform 7, in 5 minutes"/.test(h), h);
  const evil = t.depRow(J({}, { to: 'x" onmouseover="alert(1)' }), 0);
  chk("a destination with a quote cannot break out of the label attribute",
    !/onmouseover="alert/.test(evil) && /&quot;/.test(evil), evil);
}

// ---- patchRow: the label follows the row; the live region speaks ONLY on material change ----
{
  const t = build();
  const row = mkRow(t.depAria(J()));
  t.patchRow(row, J({ prognosis: { departure: "2026-07-25T14:11:00+0200" } }));
  chk("a delay appearing updates the row's sentence",
    /plus 6 minutes/.test(row.attrs["aria-label"]), row.attrs["aria-label"]);
  chk("...and is announced, once, with the train's name",
    t.annc.textContent === "IR 36 to Basel SBB is running 6 minutes late", t.annc.textContent);
  t.annc.textContent = "";
  t.patchRow(row, J({ prognosis: { departure: "2026-07-25T14:11:00+0200" } }));
  chk("the SAME delay on the next refresh is not announced again",
    t.annc.textContent === "", t.annc.textContent);
}
{
  const t = build();
  const row = mkRow(t.depAria(J()));
  t.patchRow(row, J({ prognosis: { platform: "4" } }));
  chk("a platform change is announced with the NEW platform",
    t.annc.textContent === "IR 36 to Basel SBB now departs platform 4", t.annc.textContent);
  chk("...and the label says changed", / changed/.test(row.attrs["aria-label"]), row.attrs["aria-label"]);
  t.annc.textContent = "";
  t.patchRow(row, J({ prognosis: { platform: "4" } }));
  chk("the SAME platform change on the next refresh is not announced again",
    t.annc.textContent === "", t.annc.textContent);
}
{
  // THE no-shouting check: countdown churn is the every-30s case, and it must be silent
  const t = build();
  const row = mkRow(t.depAria(J()));
  t.patchRow(row, J());
  chk("an unchanged row on refresh announces NOTHING -- silence is the default",
    t.annc.textContent === "", t.annc.textContent);
}
{
  const t = build();
  t.announce("x"); t.announce("x");
  chk("announce survives repeats (clears before re-setting the same message)", t.annc.textContent === "x", t.annc.textContent);
}

// ---- wiring: the attributes exist in the DOCUMENT, not just in tests ----
chk("the board container is a list", /<div id="depOut" role="list" aria-label="Departures">/.test(src),
  "listitems without a list -- rows float unanchored");
chk("the live region exists, polite, visually hidden",
  /<div id="annc" class="vh" role="status" aria-live="polite">/.test(src),
  "announce() writes into a node that is not there -- green tests, silent feature");
chk("expanding a row is exposed to assistive tech",
  /row\.setAttribute\("aria-expanded", String\(!open\)\)/.test(src),
  "the tap-to-expand state is invisible to a screen reader");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk(".vh really hides (clip + 1px box), not display:none which also silences it",
  /\.vh\{[^}]*clip:rect\(0 0 0 0\)/.test(css) && /\.vh\{[^}]*width:1px/.test(css), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
