// Runs the REAL vehicle/Ersatzverkehr signals out of index.html. No browser, no network.
//
// The load-bearing cases are the NEGATIVE ones, and one negative is the whole
// feature: an ordinary bus leg (category B) must NOT read as a replacement bus.
// A scheduled PostBus through a valley is the normal way to get there; "your
// train is a bus today" is a warning about a train that isn't running. Collapse
// those two and the warning means nothing, because it would fire on half the
// network.
//
// The category codes were checked against the live API rather than guessed:
// SGV's Vierwaldstaettersee sailings come back BAT, the Romanshorn crossing FAE,
// and a real Ersatzverkehr on Luzern-Vitznau came back category EV / operator
// SBB-EV. If a future API change renames one, these fail -- which is the point.
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
const constOf = (n) => {
  const m = src.match(new RegExp("const " + n + "=[\\s\\S]*?;\\n"));
  if (!m) throw new Error("HARNESS FAILED -- const not found: " + n);
  return m[0];
};

const app = new Function(`
  ${grab("esc")}
  ${constOf("VEHICLE")}
  ${grab("vehicleOf")}
  ${grab("vehicleRibs")}
  return { VEHICLE, vehicleOf, vehicleRibs };
`)();

let pass = 0, fail = 0;
const chk = (n, c, d = "") => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + " :: " + d); }
};

// ---- harness control: prove the table was really extracted, not stubbed ----
// Without this every "returns null" case below would pass against an empty
// object -- green, and measuring nothing.
chk("control: the vehicle table really came through",
    app.VEHICLE.EV === "replacement bus" && app.VEHICLE.BAT === "boat"
      && Object.keys(app.VEHICLE).length >= 7, JSON.stringify(app.VEHICLE));

// ---- positives: codes seen on the live API ----
chk("BAT is a boat", app.vehicleOf("BAT") === "boat");
chk("FAE is a ferry", app.vehicleOf("FAE") === "ferry");
chk("CC is a cog railway", app.vehicleOf("CC") === "cog railway");
chk("PB is a cable car", app.vehicleOf("PB") === "cable car");
chk("GB is a gondola", app.vehicleOf("GB") === "gondola");
chk("FUN is a funicular", app.vehicleOf("FUN") === "funicular");
chk("EV is a replacement bus", app.vehicleOf("EV") === "replacement bus");
chk("a lowercase category still resolves", app.vehicleOf("bat") === "boat");

// ---- negatives: the ones that make the signal mean something ----
// A scheduled bus is not a replacement bus. This is THE case: if B mapped to
// anything, the Ersatzverkehr warning would fire on ordinary PostBus legs and
// stop being a warning at all.
chk("an ordinary bus is NOT a replacement bus", app.vehicleOf("B") === null,
    String(app.vehicleOf("B")));
chk("a plain train says nothing", app.vehicleOf("IC") === null, String(app.vehicleOf("IC")));
chk("an S-Bahn says nothing", app.vehicleOf("S") === null, String(app.vehicleOf("S")));
chk("a tram says nothing", app.vehicleOf("T") === null, String(app.vehicleOf("T")));
chk("an unknown code says nothing", app.vehicleOf("ZZ") === null);
chk("empty string is null", app.vehicleOf("") === null);
chk("undefined is null", app.vehicleOf(undefined) === null);
chk("null is null", app.vehicleOf(null) === null);
// EV is an exact code, not a prefix: EC and EN are real train categories and
// must not be swept up by a startsWith.
chk("EC is not EV", app.vehicleOf("EC") === null, String(app.vehicleOf("EC")));
chk("EN is not EV", app.vehicleOf("EN") === null, String(app.vehicleOf("EN")));

// ---- vehicleRibs ----
const sec = (cat, from, to) => ({
  journey: { category: cat },
  departure: from ? { station: { name: from } } : undefined,
  arrival: to ? { station: { name: to } } : undefined,
});

// The null control for the whole ribbon: an ordinary train journey must emit
// NOTHING. A strip that always appears is decoration, not information.
chk("an ordinary journey gets no vehicle rib",
    app.vehicleRibs([sec("IC"), sec("S"), sec("B")]) === "",
    app.vehicleRibs([sec("IC"), sec("S"), sec("B")]));

let h = app.vehicleRibs([sec("IC"), sec("EV", "Luzern, Bahnhof", "K\u00fcssnacht am Rigi")]);
chk("a replaced leg warns", h.includes("replacement bus") && h.includes("evbus"), h);
chk("the warning names the stretch it replaces",
    h.includes("Luzern, Bahnhof") && h.includes("K\u00fcssnacht am Rigi"), h);
chk("the warning carries the warning glyph", h.includes("&#9888;"), h);

// A replaced leg with no endpoints still warns. Dropping the warning because
// the DETAIL is missing would delete the fact that mattered.
h = app.vehicleRibs([sec("EV")]);
chk("a replaced leg with unknown endpoints still warns",
    h.includes("replacement bus") && !h.includes("undefined"), h);

h = app.vehicleRibs([sec("BAT", "Luzern Bahnhofquai", "Vitznau")]);
chk("a boat leg says boat", h.includes("boat") && h.includes('class="rib veh"'), h);
chk("a boat leg is not a warning", !h.includes("evbus"), h);

h = app.vehicleRibs([sec("CC"), sec("CC"), sec("PB")]);
chk("repeated vehicles are listed once",
    (h.match(/cog railway/g) || []).length === 1 && h.includes("cable car"), h);

h = app.vehicleRibs([sec("EV", "A", "B"), sec("CC")]);
chk("a replaced leg and a cog railway both show",
    h.includes("replacement bus") && h.includes("cog railway"), h);

h = app.vehicleRibs([sec("EV", "A", "B"), sec("EV", "C", "D")]);
chk("two replaced legs are two warnings",
    (h.match(/replacement bus/g) || []).length === 2, h);

// The rib must never assert anything about a ticket -- same rule as the zone
// ribbon. Whether a replacement bus honours your ticket is a tariff question.
chk("the rib never claims a ticket is valid",
    !/valid|g&uuml;ltig|ticket/i.test(app.vehicleRibs([sec("EV", "A", "B"), sec("BAT")])), "");

// ---- degenerate inputs must not throw: this runs while a card renders ----
chk("empty sections yield nothing", app.vehicleRibs([]) === "");
chk("null sections yield nothing", app.vehicleRibs(null) === "");
chk("undefined sections yield nothing", app.vehicleRibs(undefined) === "");
chk("a section with no journey is skipped", app.vehicleRibs([{}, sec("CC")]).includes("cog railway"));
chk("a journey with no category is skipped", app.vehicleRibs([{ journey: {} }]) === "");

// A station name is API text and lands in innerHTML.
h = app.vehicleRibs([sec("EV", "A & B", "<script>")]);
chk("station names are escaped", h.includes("&amp;") && !h.includes("<script>"), h);

// ---- the wiring, not just the function ----
// A unit that works but is never called is the failure mode this repo has hit
// five times. connCard is too entangled to run headless here, so this asserts
// the call site in the real source instead -- weaker than executing it, and
// said plainly rather than dressed up as an end-to-end check.
const card = grab("connCard");
chk("connCard actually calls vehicleRibs", /ribs\s*\+=\s*vehicleRibs\(/.test(card),
    "call site missing from connCard");
chk("the vehicle ribs come before the scenic rib",
    card.indexOf("vehicleRibs(") < card.indexOf("rib scenic"), "");

// The summit feature used to carry its own copy of this table. One table, or
// they drift and a gondola becomes a cable car in half the app.
const summit = grab("fillSummit");
chk("fillSummit reuses the one vehicle table",
    summit.includes("vehicleOf(") && !summit.includes('GB:"gondola"'), "");

console.log(`\nvehicle: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
