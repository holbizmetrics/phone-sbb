// Offline export: one self-contained .html that works with no signal.
//
// The corpus is built around the ways a saved route can betray you, all of them
// worse than not saving at all because you only find out in the tunnel:
//
//   * it disagrees with the screen you saved it from (scheduled vs prognosis),
//   * it looks live, so a cancelled train reads as fine,
//   * it references something over the network, which is the one thing that
//     cannot work in the situation it was saved for,
//   * a station name with a quote in it breaks out of an attribute,
//   * it ships green but is not wired to any button.
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

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// --- stubs: the three helpers the export borrows, kept dumb on purpose -------
const DEPS = `
  function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function hhmm(iso){ return iso ? String(iso).slice(11,16) : ""; }
  function parseDur(s){ return s || ""; }
  function catColor(){ return "#456"; }
`;
// stripLiveMarkers is injected FOR REAL, not stubbed: it is the thing under test
// in the sketch checks below, and a stub would let the live marker through.
const mkRows = () => new Function(
  `${DEPS} ${grab("stripLiveMarkers")} ${grab("offlineRows")} return offlineRows;`)();
const mkDoc  = () => new Function(`${DEPS} ${grab("offlineDoc")} return offlineDoc;`)();

// A connection whose REAL times differ from its scheduled ones. This is the
// whole point: the card shows 14:13 (+11), so the file must too.
const DELAYED = {
  duration: "00d00:47:00", transfers: 1,
  from: { station: { name: "Zürich HB" }, departure: "2026-09-05T14:02:00+0200", platform: "31",
          prognosis: { departure: "2026-09-05T14:13:00+0200", platform: "12" } },
  to:   { station: { name: "Bern" }, arrival: "2026-09-05T14:49:00+0200",
          prognosis: { arrival: "2026-09-05T15:00:00+0200" } },
  sections: [{ journey: { category: "IC", number: "8" },
               departure: { station: { name: "Zürich HB" }, departure: "2026-09-05T14:02:00+0200",
                            prognosis: { departure: "2026-09-05T14:13:00+0200" } },
               arrival:   { station: { name: "Bern" }, arrival: "2026-09-05T14:49:00+0200" } }],
  _chg: [{ stn: "Olten", b: 4, missed: false }],
};

// ---- offlineRows: prognosis first, exactly as connCard does -----------------
{
  const rows = mkRows()([DELAYED], () => "<svg id='sk'></svg>");
  const r = rows[0];
  chk("departure is the PROGNOSIS, not the schedule -- else the file disagrees with the card you saved it from",
    r.dep === "2026-09-05T14:13:00+0200", r.dep);
  chk("arrival is the prognosis too", r.arr === "2026-09-05T15:00:00+0200", r.arr);
  chk("the delay is carried, not silently folded into the time", r.depDelay === 11 && r.arrDelay === 11,
    r.depDelay + "/" + r.arrDelay);
  chk("platform is the prognosis platform -- a re-platforming is exactly when the schedule misleads",
    r.platformDep === "12", r.platformDep);
  chk("changes come from _chg when the app computed buffers", r.changes === 1, String(r.changes));
  chk("the sketch is carried through", r.sketch === "<svg id='sk'></svg>", r.sketch);
  chk("leg label is category + number", r.legs[0].label === "IC 8", r.legs[0].label);
}
// Negative control: with no prognosis at all it must fall back, not go blank.
{
  const plain = JSON.parse(JSON.stringify(DELAYED));
  delete plain.from.prognosis; delete plain.to.prognosis;
  const r = mkRows()([plain], () => "")[0];
  chk("no prognosis -> falls back to the schedule rather than emitting nothing",
    r.dep === "2026-09-05T14:02:00+0200" && r.depDelay === 0, r.dep + " d=" + r.depDelay);
}
// A sketch producer is optional; absence must not throw.
{
  const r = mkRows()([DELAYED], null)[0];
  chk("no sketch producer -> empty sketch, no crash", r.sketch === "", JSON.stringify(r.sketch));
  chk("empty input is an empty list, not a throw", mkRows()(null, null).length === 0);
}

// ---- offlineDoc: the document must be honest and self-contained ------------
const doc = mkDoc()(mkRows()([DELAYED], () => "<svg class='x'></svg>"),
                    { from: "Zürich HB", to: "Bern", savedAt: "05.09.2026, 14:00", tz: "Europe/Zurich" });
{
  chk("it is a complete document", /^<!doctype html>/i.test(doc) && /<\/html>\s*$/.test(doc));
  chk("it says it is a SNAPSHOT -- a saved route that looks live is a lying artifact",
    /snapshot, not a live timetable/i.test(doc));
  chk("it says the times do not update", /do not update/i.test(doc));
  chk("it stamps when it was saved", doc.includes("05.09.2026, 14:00"));
  chk("it names the timezone that stamp is in", doc.includes("Europe/Zurich"));
  chk("the real time is in the document", doc.includes("14:13"));
  chk("the delay is shown", /\+11/.test(doc));
  chk("the sketch is inlined", doc.includes("<svg class='x'></svg>"));

  /* The sketch is lifted out of the live page and brings two problems with it,
     both found by the operator opening a real export (2026-09-05). */
  {
    const live = mkDoc()(mkRows()([DELAYED], () => '<svg><circle class="sktrain-halo" r="9"/>'
      + '<circle class="sktrain" cx="1" cy="2" r="5"/><circle class="stop" r="3"/></svg>'), { from: "a", to: "b" });
    chk("the LIVE train-position marker is stripped -- a pulsing dot pinned to where the train was at save time is the exact lie the banner denies",
      !/sktrain/.test(live), live.slice(live.indexOf("sktrain") - 40, live.indexOf("sktrain") + 40));
    chk("...but the rest of the sketch survives -- the stops and lines are facts about the plan",
      /class="stop"/.test(live));
    chk("the sketch's custom properties are DEFINED in the export -- an undefined var() makes the declaration invalid and the shape falls back to black",
      /--txt:/.test(live) && /--card:/.test(live) && /--dim:/.test(live), "");
    chk("...and the label class actually uses them, so carrying them is not decoration",
      /\.sklbl\{fill:var\(--txt\)/.test(live));
  }

  // The load-bearing one. Anything fetched at open time is exactly what will
  // not be there in a tunnel.
  const remote = doc.match(/(?:src|href)\s*=\s*["'](?!#)[^"']+["']/gi) || [];
  chk("NOTHING is referenced over the network -- no src=, no href=, no @import, no url()",
    remote.length === 0 && !/@import/i.test(doc) && !/url\(\s*["']?https?:/i.test(doc),
    JSON.stringify(remote.slice(0, 3)));
  chk("and no fetch/XHR was smuggled in", !/fetch\(|XMLHttpRequest|<script/i.test(doc));
}
// Escaping: a station name is attacker-adjacent data (it comes off the wire).
{
  const nasty = JSON.parse(JSON.stringify(DELAYED));
  nasty.from.station.name = 'Bad" <script>alert(1)</script>';
  const d = mkDoc()(mkRows()([nasty], () => "")[0] ? mkRows()([nasty], () => "") : [], { from: "a", to: "b" });
  chk("a station name cannot inject markup", !/<script>alert/.test(d), d.slice(d.indexOf("Bad"), 80));
  chk("...and its quote is escaped", d.includes("&quot;") || !d.includes('Bad"'));
}
// Empty state must say so rather than render an empty shell that looks complete.
{
  const d = mkDoc()([], { from: "A", to: "B" });
  chk("no connections -> the document says so", /No connections were on screen/i.test(d));
}

// ---- wiring: the button exists and calls the function ----------------------
{
  chk("a Save-offline button is in the share bar", /onclick="saveOffline\(event\)"/.test(src));
  chk("saveOffline is defined", /function saveOffline\(/.test(src));
  chk("it downloads a .html file", /a\.download\s*=\s*name/.test(src) && /\.html"/.test(src));
  chk("failure to save is REPORTED, not swallowed -- a silent no-op is indistinguishable from an unwired button",
    /Could not save/.test(src));
  chk("nothing-to-save is its own message", /Nothing to save yet/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
