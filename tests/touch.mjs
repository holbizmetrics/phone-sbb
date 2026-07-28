// Touch tab: the tile list is derived, never configured -- stars first, then
// recent-route endpoints, then the last board station, deduped, capped at 12.
// Planted negatives on every clause: a duplicate must collapse, an empty
// last-station must NOT become a tile, station 13 must fall off the end.
import fs from "fs";
import vm from "vm";

import { src, APP } from "./_src.mjs";

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// -- extract the pure tile-derivation (and only it) --
const a = src.indexOf("function tchStations");
const b = src.indexOf("/* Grid render */", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- tchStations markers not found; did the touch section move?");
const fnSrc = src.slice(a, b);
chk("control: extracted block really is the derivation",
  fnSrc.includes("routeHist") && fnSrc.includes("LS.last"), fnSrc.slice(0, 80));

const mk = (favs, routes, last) => {
  const ctx = {
    favs, routeHist: routes,
    LS: { last: "rail.last" },
    load: (k, d) => (k === "rail.last" ? last : d),
  };
  vm.createContext(ctx);
  new vm.Script(fnSrc + "\nthis.tchStations = tchStations;").runInContext(ctx);
  return ctx.tchStations();
};

// favs first, then route endpoints, then last -- and the duplicate collapses
const got = mk(["Zug", "Luzern"], [{ f: "Luzern", t: "Ebikon" }], "Baar");
chk("stars lead the grid", got[0] === "Zug" && got[1] === "Luzern", got.join(","));
chk("route endpoints follow", got.includes("Ebikon"), got.join(","));
chk("last board station included", got.includes("Baar"), got.join(","));
chk("planted negative: duplicate station collapses", got.filter(n => n === "Luzern").length === 1, got.join(","));

// empty last-station must not become a tile
const noLast = mk(["A", "B"], [], "");
chk("planted negative: empty last is no tile", noLast.length === 2 && !noLast.includes(""), noLast.join(","));

// cap: 15 distinct stations in, 12 out, overflow drops from the END
const many = mk(Array.from({ length: 15 }, (_, i) => "S" + i), [], "");
chk("cap holds at 12", many.length === 12, String(many.length));
chk("planted negative: station 13 fell off", !many.includes("S12"), many.join(","));

// -- UI wiring: tab, pane, 4-way switch, render-on-entry, drag surface --
chk("tab button exists", src.includes('id="tabTch"'));
chk("pane exists", src.includes('id="vTch"'));
chk("setTab knows all four panes", /tch:\["tabTch","vTch"\]/.test(src));
chk("entering the tab rebuilds the grid", /if\(t==="tch"\) renderTouch\(\);/.test(src));
chk("release on a tile runs the journey", /setTab\("jrn"\); planJourney\(\);/.test(src));
chk("release on the SAME tile is a cancel, not a query", /t && t!==tchFrom/.test(src));
chk("svg overlay never steals the drag", /#tchSvg\{[^}]*pointer-events:none/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
