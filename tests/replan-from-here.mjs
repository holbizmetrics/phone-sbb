// Replan-from-here (UNSOLVED-GAPS 2.1 -- the cross-vendor round's #1 demand:
// ~35-43% of foreign passengers live in the moment the plan died). Runs the
// REAL stopsHTML + replanFromStop. The corpus is built around the ways the
// feature can fail its passenger: offering a replan to where they are already
// going (null query), freezing a stop name at render time (planFromBoard
// lesson), replanning to a scheduled time instead of NOW (a dead plan's time
// is exactly what must be discarded), and shipping green but unwired.
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

// ---- stopsHTML: the affordance and its two silences ----
const mkStops = (conns) => new Function(`
  const ISO_LOCAL=/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}:\\d{2})/;
  ${grab("esc")}
  ${grab("hhmm")}
  const verbundHTML=()=> "";
  const jrnConns=${JSON.stringify(conns)};
  ${grab("stopsHTML")}
  return stopsHTML;
`)();
const rows = [
  { station: { name: "Luzern" },   departure: "2026-07-28T18:04:00+0200" },
  { station: { name: "Arth-Goldau" }, arrival: "2026-07-28T18:34:00+0200", platform: "3" },
  { station: { name: "Bellinzona" }, arrival: "2026-07-28T20:12:00+0200" },
];
const conns = [{ to: { station: { name: "Bellinzona" } } }];

{
  const html = mkStops(conns)(rows, 0, 1);
  chk("intermediate stops carry the replan button", (html.match(/class="srp"/g) || []).length === 2, html);
  chk("the journey's own destination gets NO button -- replan-to-here is a null query",
    !/Bellinzona[\s\S]*?srp/.test(html.split("Arth-Goldau")[1] || ""), html);
  chk("the tap carries live indices, not a station name",
    html.includes("replanFromStop(event,0,1,0)") && html.includes("replanFromStop(event,0,1,1)"),
    "a name baked at render time points at whatever later takes the slot");
  chk("the button says what it does, leaving NOW",
    /aria-label="Replan from Arth-Goldau, leaving now"/.test(html), html);
}
{
  const noCi = mkStops(conns)(rows);
  chk("no connection index -> no buttons (verbund reuse stays untouched)", !noCi.includes("srp"), noCi);
  chk("...but the stop list itself still renders", noCi.includes("Arth-Goldau"));
  chk("a non-stop leg offers nothing to replan from",
    !mkStops(conns)(rows.slice(0, 2), 0, 0).includes("srp"));
  chk("an unavailable stop list stays the honest 'unavailable', no buttons",
    !mkStops(conns)(null, 0, 0).includes("srp"));
  const evil = [{ station: { name: '"><img src=x>' }, departure: "2026-07-28T18:04:00+0200" },
    rows[1], rows[2]];
  chk("a hostile station name is escaped in the label",
    !mkStops(conns)(evil, 0, 1).includes('"><img'), mkStops(conns)(evil, 0, 1));
}

// ---- replanFromStop: read at tap time, leave NOW, refuse the null query ----
const mkReplan = (liveRows, toNameVal) => {
  const calls = { when: null, from: null, scrolled: false, fieldSet: null };
  const fn = new Function("calls", `
    const legStops=()=>${JSON.stringify(liveRows)};
    let fromName="", toName=${JSON.stringify(toNameVal)};
    const $=(id)=>({ get value(){return "";}, set value(v){ if(id==="iFrom") calls.fieldSet=v; },
                     classList:{ add:()=>{} } });
    const setWhen=(m)=>{ calls.when=m; calls.from=fromName; };
    const scrollTo=()=>{ calls.scrolled=true; };
    ${grab("replanFromStop")}
    return replanFromStop;
  `)(calls);
  const ev = { stopPropagation: () => {} };
  return { fire: (k) => fn(ev, 0, 0, k), calls };
};
{
  const { fire, calls } = mkReplan(rows, "Bellinzona");
  fire(1);
  chk("the tapped stop becomes the origin", calls.from === "Arth-Goldau", JSON.stringify(calls));
  chk("the replan leaves NOW -- the dead plan's schedule is discarded", calls.when === "now");
  chk("the visible origin field follows the state", calls.fieldSet === "Arth-Goldau");
  chk("and the view returns to the results", calls.scrolled === true);
}
{
  const { fire, calls } = mkReplan(rows, "Bellinzona");
  fire(2);
  chk("tapping the destination replans NOTHING (belt to the render-time brace)",
    calls.when === null && calls.from === null, JSON.stringify(calls));
  fire(99);
  chk("a vanished row (stale index after refresh) is a no-op, never a crash",
    calls.when === null);
}
{
  const { fire, calls } = mkReplan(rows, "");
  fire(1);
  chk("no destination in the form -> no replan (nowhere to go TO)", calls.when === null);
}

// ---- wiring: a feature that ships green but never runs is the named defect class ----
chk("toggleLeg hands stopsHTML its connection identity",
  /stopsHTML\(legStops\(ci,si\),ci,si\)/.test(src),
  "without ci,si the buttons silently never render -- feature dead, tests green");
chk("replanFromStop reads the stop off legStops AT TAP TIME",
  /function replanFromStop[\s\S]*?legStops\(ci,si\)/.test(grab("replanFromStop")),
  "planFromBoard lesson: values frozen at render point at whatever later takes the slot");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the button is styled", css.includes(".stops .srp"), "unstyled = invisible = unshipped");
chk("...and quiet by design (borrows the dim palette, no accent shout)",
  /\.stops \.srp\{[^}]*var\(--dim\)/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
