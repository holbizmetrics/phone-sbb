// User-chosen via: the passenger names the change instead of the sweep guessing it.
//
// The feature is three lines of query string and a great deal of not-lying, so
// that is what this suite is mostly about. The load-bearing checks are negative:
//   - a via is NEVER persisted (a remembered constraint you cannot see)
//   - the on-screen claim is derived from viaName, NEVER from the input box
//     (text typed but not applied must not look like it is filtering)
//   - an empty result under a via says "not in that order", never "no route"
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// Anchored on the section HEADER, not on the declaration: keying off
// `let viaName = ""` meant any edit to that one line took the whole suite down
// with a harness error instead of a failing check -- silence where a verdict
// belongs.
const a = src.indexOf("/* ---------- the passenger chooses the change (user via)");
const b = src.indexOf("/* ---------- scroll-edge fades", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- via block markers not found");
const fnSrc = src.slice(a, b);
chk("control: the extracted block really is the via feature",
  /function viaQS/.test(fnSrc) && /function viaWhyEmpty/.test(fnSrc) && /function viaNote/.test(fnSrc), "");

// ---- a fake field ----
const mkEl = () => ({
  value: "", hidden: false, _focus: 0, focus() { this._focus++; },
  classList: {
    _s: new Set(),
    add(...c) { c.forEach(x => this._s.add(x)); },
    remove(...c) { c.forEach(x => this._s.delete(x)); },
    toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
    contains(c) { return this._s.has(c); },
  },
});
const els = { iVia: mkEl(), fVia: mkEl(), viaAdd: mkEl() };
let plans = 0;
const ctx = {
  $: id => els[id],
  esc: s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  planJourney: () => { plans++; },
  encodeURIComponent, console,
  // stubbed so a "persist the via" mutation RUNS and is scored, rather than
  // crashing the suite on a missing global -- a crash reports as silence
  load: (k, d) => d, save: () => {}, LS: {},
  fromName: "", toName: "", smart: true,
};
vm.createContext(ctx);
new vm.Script(fnSrc + "\nthis.viaQS=viaQS; this.viaOpen=viaOpen; this.viaSet=viaSet; this.viaClear=viaClear;"
  + " this.viaPending=viaPending; this.viaWhyEmpty=viaWhyEmpty; this.viaNote=viaNote;"
  + " this.getVia=()=>viaName; this.setVia=v=>{viaName=v};").runInContext(ctx);

// ================= the query string =================
{
  chk("no via means no via[] in the query at all", ctx.viaQS() === "", ctx.viaQS());
  ctx.setVia("Olten");
  chk("a chosen via becomes via[] on the query", ctx.viaQS() === "&via[]=Olten", ctx.viaQS());
  ctx.setVia("Zürich HB");
  chk("a station with a space and an umlaut is encoded, not pasted raw",
    ctx.viaQS() === "&via[]=Z%C3%BCrich%20HB", ctx.viaQS());
  ctx.setVia("");

  chk("the plain planner's query carries the via",
    /\/connections\?limit=\$\{lim\}&from=\$\{encodeURIComponent\(fromName\)\}&to=\$\{encodeURIComponent\(toName\)\}\$\{viaQS\(\)\}/.test(src), "");
  chk("BOTH smart queries carry it -- the wide one is not a back door around the via",
    (src.match(/from=\$\{f\}&to=\$\{t\}\$\{viaQS\(\)\}&limit=/g) || []).length === 2,
    String((src.match(/from=\$\{f\}&to=\$\{t\}\$\{viaQS\(\)\}&limit=/g) || []).length));
  chk("PLANTED: a named via stands the hub sweep down, so no result can ignore it",
    /const hubList = viaName \? \[\] :/.test(src), "");
}

// ================= never persisted =================
{
  chk("PLANTED: the via is never written to storage under any key",
    !/LS\.via|"rail\.via"/.test(src), "");
  chk("...and the declaration takes no stored default: it starts empty every load",
    /^let viaName = "";$/m.test(fnSrc), fnSrc.split("\n")[0]);
  chk("control: the file really does persist other filters, so the absence above is a choice",
    /save\(LS\.modes/.test(src) && /save\(LS\.cats/.test(src), "");
}

// ================= what the screen claims =================
{
  ctx.setVia("");
  chk("no via, no note and no explanation", ctx.viaNote() === "" && ctx.viaWhyEmpty() === "", "");

  ctx.setVia("Olten");
  const note = ctx.viaNote();
  chk("the note names the stop", /via <b>Olten<\/b>/.test(note), note);
  chk("...and says the sweep stood down, so the shorter list is explained",
    /not sweeping other hubs/.test(note), note);
  chk("...and carries the way out", /viaClear\(\)/.test(note), note);
  ctx.smart = false;
  chk("with the change-finder off there is no sweep to explain, and it does not claim one",
    !/sweeping/.test(ctx.viaNote()) && /via <b>Olten<\/b>/.test(ctx.viaNote()), ctx.viaNote());
  ctx.smart = true;

  const why = ctx.viaWhyEmpty();
  chk("PLANTED: an empty result under a via is 'not in that order', NOT 'no route'",
    /not the same as no route at all/.test(why) && !/no connections/i.test(why), why);
  chk("...and it offers the one tap that answers the other question",
    /viaClear\(\)/.test(why) && /without the via/i.test(why), why);
  chk("the smart planner drops 'Check the station names' when a via is set -- that advice is wrong then",
    /sunWhyEmpty\(\)\|\|\(viaName\?"":"<br>Check the station names\."\)/.test(src), "");
  chk("both planners print the explanation on their empty branch",
    (src.match(/\$\{viaWhyEmpty\(\)\}/g) || []).length === 2,
    String((src.match(/\$\{viaWhyEmpty\(\)\}/g) || []).length));
  chk("both planners print the note above the results",
    (src.match(/\+ viaNote\(\)/g) || []).length === 2,
    String((src.match(/\+ viaNote\(\)/g) || []).length));

  ctx.setVia('Olten<img src=x onerror="alert(1)">');
  chk("XSS: a hostile station name is escaped in the note",
    !/<img/.test(ctx.viaNote()) && /&lt;img/.test(ctx.viaNote()), ctx.viaNote());
  chk("XSS: and in the empty explanation",
    !/<img/.test(ctx.viaWhyEmpty()) && /&lt;img/.test(ctx.viaWhyEmpty()), ctx.viaWhyEmpty());
  ctx.setVia("");
}

// ================= the box vs the search =================
{
  ctx.setVia("");
  els.iVia.value = "Olt";
  ctx.viaPending();
  chk("PLANTED: text typed but never applied MARKS the field, so it cannot look like it is filtering",
    els.fVia.classList.contains("pending"), "");
  ctx.setVia("Olten"); els.iVia.value = "Olten"; ctx.viaPending();
  chk("...and the mark clears once the box and the search agree",
    !els.fVia.classList.contains("pending"), "");
  chk("NULL CONTROL: the rendered claim is read from viaName, never from the input box",
    !/\$\("iVia"\)/.test(fnSrc.slice(fnSrc.indexOf("function viaWhyEmpty"))), "");
  ctx.setVia("");
}

// ================= setting and clearing =================
{
  ctx.setVia(""); plans = 0;
  ctx.fromName = ""; ctx.toName = "";
  ctx.viaSet("Olten");
  chk("choosing a via with no route entered yet stores it and plans nothing",
    ctx.getVia() === "Olten" && plans === 0, String(plans));
  ctx.fromName = "Bern"; ctx.toName = "Luzern";
  plans = 0; ctx.viaSet("Olten");
  chk("choosing one with a route in hand re-plans at once", plans === 1, String(plans));

  plans = 0; ctx.viaClear();
  chk("clearing a live via re-plans -- the answer on screen was constrained by it",
    ctx.getVia() === "" && plans === 1, String(plans));
  chk("...and puts the field away and the offer back", els.fVia.hidden === true && els.viaAdd.hidden === false, "");
  chk("...and empties the box, so nothing is left claiming a constraint",
    els.iVia.value === "" && !els.fVia.classList.contains("has") && !els.fVia.classList.contains("pending"), "");

  plans = 0; ctx.viaClear();
  chk("PLANTED: clearing an already-empty via fires NO search -- an idle tap costs no request",
    plans === 0, String(plans));

  els.fVia.hidden = true; els.viaAdd.hidden = false; els.iVia._focus = 0;
  ctx.viaOpen();
  chk("opening reveals the field, hides the offer and puts the cursor in it",
    els.fVia.hidden === false && els.viaAdd.hidden === true && els.iVia._focus === 1, "");
}

// ================= it travels with the route =================
{
  chk("a shared link carries the via, or the receiver plans a different journey",
    /u\.searchParams\.set\("via", viaName\)/.test(src), "");
  chk("...only when there is one -- a bare route shares bare",
    /if\(viaName\) u\.searchParams\.set\("via"/.test(src), "");
  chk("the shared TEXT says it too, since that is what a person reads",
    /viaName\?` \(via \$\{viaName\}\)`:""/.test(src), "");
  chk("a received link restores the via",
    /const v=\(q\.get\("via"\)\|\|""\)\.trim\(\);/.test(src), "");
  chk("PLANTED: a received via is REVEALED, never applied behind a hidden field",
    /if\(v\)\{ viaName=v; \$\("iVia"\)\.value=v; \$\("fVia"\)\.hidden=false;/.test(src), "");
  chk("the deep-link contract in the comment names the new parameter",
    /deep link: \?from=&to=\[&via=\]/.test(src), "");
}

// ================= wired to the screen at all =================
{
  chk("the via input is autocompleted like the other two station fields",
    /wireAC\("iVia","acVia","fVia", viaSet\);/.test(src), "");
  chk("...and Enter in it applies the typed text",
    /acEnter\("iVia","acVia",\s*viaSet\);/.test(src), "");
  chk("...and typing in it re-checks the applied/unapplied mark",
    /\$\("iVia"\)\.addEventListener\("input", viaPending\);/.test(src), "");
  chk("the markup has the field, the offer button and its own suggestion list",
    /id="fVia"/.test(src) && /id="iVia"/.test(src) && /id="acVia"/.test(src) && /id="viaAdd"/.test(src), "");
  chk("the field starts hidden, so it costs nothing until asked for",
    /<div class="field viafield" id="fVia" hidden>/.test(src), "");
  chk("the help sheet explains it", /route <b>via<\/b> a stop you name/.test(src), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
