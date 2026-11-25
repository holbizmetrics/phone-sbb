// Wander tab: the candidate filter is the safety rule. A stop qualifies only
// when the budget still holds the ride out, a real dwell, AND the same ride
// back -- drop that last term and the feature strands people, which is the
// exact failure it was built to prevent. So the filter runs here against a
// synthetic board, with planted negatives on every clause: a check that can
// only say yes has been shown to run, not to work.
import fs from "fs";
import vm from "vm";

import { src, APP } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// -- extract the pure filter (and only it) from the inline script --
const a = src.indexOf("function wanCandidates");
const b = src.indexOf("/* Return legs", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- wanCandidates markers not found; did the wander section move?");
const fnSrc = src.slice(a, b);
chk("control: extracted block really is the filter",
  fnSrc.includes("passList") && fnSrc.includes("WAN_MIN_DWELL"), fnSrc.slice(0, 80));

const ctx = {
  wanName: "Origin",
  WAN_MIN_RIDE: 10, WAN_MIN_DWELL: 15, WAN_MAX_CAND: 5,
  isScenic: cat => /^PE/.test((cat || "").toUpperCase()),
};
vm.createContext(ctx);
new vm.Script(fnSrc + "\nthis.wanCandidates = wanCandidates;").runInContext(ctx);

// -- synthetic board: NOW is fixed, budget is 120 min --
const NOW = Date.parse("2026-07-26T10:00:00");
const DEADLINE = NOW + 120 * 60000;
const iso = min => new Date(NOW + min * 60000).toISOString();
const train = (cat, depMin, stops) => ({
  category: cat, number: "1", stop: { departure: iso(depMin) },
  passList: [{ station: { name: "Origin" } },
    ...stops.map(([name, arrMin]) => ({ station: { name }, arrival: iso(arrMin) }))],
});

const board = [
  train("S", 5, [
    ["TramHop", 12],      // ride 7'  -> BELOW WAN_MIN_RIDE, must drop
    ["GoodStop", 35],     // ride 30', 35+15+30=80 <= 120 -> must keep
    ["FarStop", 70],      // ride 65', 70+15+65=150 > 120 -> must drop (no room to get back)
  ]),
  train("PE", 10, [["ScenicStop", 40]]),   // ride 30' -> keep, and sort FIRST (scenic)
  train("S", -30, [["GhostStop", 20]]),    // departed half an hour ago -> whole train dropped
];

const got = ctx.wanCandidates(board, NOW, DEADLINE);
const names = got.map(c => c.name);

chk("keeps the stop that fits out+dwell+back", names.includes("GoodStop"), names.join(","));
chk("planted negative: tram-hop ride dropped", !names.includes("TramHop"), names.join(","));
chk("planted negative: no-room-to-return dropped", !names.includes("FarStop"), names.join(","));
chk("planted negative: already-departed train dropped", !names.includes("GhostStop"), names.join(","));
chk("scenic outbound sorts first", names[0] === "ScenicStop", names.join(","));

// cap: 7 valid stops in, at most WAN_MAX_CAND out
const many = [train("S", 5, Array.from({ length: 7 }, (_, i) => ["Stop" + i, 30 + i]))];
chk("candidate cap holds (volunteer API)", ctx.wanCandidates(many, NOW, DEADLINE).length === 5);

// the UI half: the tab, the pane, and the 3-way switch actually exist
chk("tab button exists", src.includes('id="tabWan"'));
chk("pane exists", src.includes('id="vWan"'));
chk("setTab knows all three panes", /wan:\["tabWan","vWan"\]/.test(src));
chk("boot prefills the wander station", /iWan"\)\.value=last/.test(src));

/* The board's failure branch. It had its own hardcoded "check your connection"
   sentence -- the third copy in the app, and the only one no suite had ever
   looked at. Copies drift: errBox learned about HTTP 429 and these copies did
   not, so on 2026-07-30 the operator was told to check a connection that was
   demonstrably fine while the service returned 429 on 23 of 40 requests. The
   fix is that there is no copy left to drift, and these checks are what make
   that a property rather than a coincidence. */
const wanStart = src.indexOf("async function runWander");
const wanErr = wanStart < 0 ? "" : src.slice(wanStart, src.indexOf("\nfunction ", wanStart));
/* This control is not decoration. The first draft sliced BACKWARDS -- runWander
   sits after wanCandidates, not before it -- and produced "". The delegation
   check then failed honestly, but the "no hardcoded sentence" check PASSED, on
   an empty string, because absence of a slice looks exactly like absence of the
   defect. A negative assertion over an unbounded region is vacuous unless
   something proves the region exists. */
chk("control: extracted the wander runner, not an empty slice",
  wanErr.includes("stationboard") && wanErr.length > 200, `len=${wanErr.length}`);
chk("the board failure delegates to errBox", /out\.innerHTML=errBox\(e,/.test(wanErr), wanErr.slice(-200));
chk("...and keeps no hardcoded failure sentence of its own",
  wanErr.length > 200 && !/could not reach the timetable/i.test(wanErr), wanErr.slice(-200));

// behaviour, not just wiring: the same three failures, worded for THIS screen
const ebSrc = src.slice(src.indexOf("function errBox"), src.indexOf("function planJourney"));
const ebCtx = {}; vm.createContext(ebCtx);
new vm.Script(ebSrc + "\nthis.errBox = errBox;").runInContext(ebCtx);
const boardErr = e => ebCtx.errBox(e, "what leaves from here", "try again");
chk("a rate limit on the board names the limit, not the connection",
  /rate-limiting/i.test(boardErr(new Error("HTTP 429"))) &&
  !/check your connection/i.test(boardErr(new Error("HTTP 429"))), boardErr(new Error("HTTP 429")));
chk("PLANTED: a dead network on the board still says check your connection",
  /check your connection/i.test(boardErr(new Error("boom"))), boardErr(new Error("boom")));
chk("...and says what is unknown in THIS screen's words, not the journey's",
  /what leaves from here/.test(boardErr(new Error("boom"))) &&
  !/whether this journey runs/.test(boardErr(new Error("boom"))), boardErr(new Error("boom")));
chk("PLANTED: the default wording is still the journey's, so the parameter is real",
  /whether this journey runs/.test(ebCtx.errBox(new Error("boom"))), ebCtx.errBox(new Error("boom")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
