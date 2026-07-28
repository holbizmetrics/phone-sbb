// Share a route (Pamela-class real-user demand: links travel WhatsApp-first).
// Runs the REAL shareURL + shareRoute + applyDeepLink. The corpus is built
// around the ways sharing can betray: sharing the RESULT instead of the query
// (a frozen screenshot of a shifting timetable), stamping the sender's clock
// onto a "now" search (arrives already stale), replaying a dead timestamp on
// the receiver's phone (a ghost plan), a cancelled share sheet treated as an
// error, and shipping green but unwired.
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
const SHARE_LBL_SRC = (src.match(/const SHARE_LBL = "[^"]*";/) ||
  [(() => { throw new Error("HARNESS FAILED -- SHARE_LBL not found"); })()])[0];

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- shareRoute / shareURL: the query travels, never the result ----
const mkShare = ({ from = "Z\u00fcrich HB", to = "Bern", mode = "now", val = "",
                   canShare = true, shareErr = null } = {}) => {
  const out = { shared: null, copied: null, copyFailed: false };
  const nav = {
    clipboard: { writeText: (s) => { out.copied = s; return Promise.resolve(); } },
  };
  if (canShare) nav.share = (p) => { out.shared = p; return shareErr ? Promise.reject(shareErr) : Promise.resolve(); };
  const fn = new Function("location", "navigator", `
    let fromName=${JSON.stringify(from)}, toName=${JSON.stringify(to)};
    let whenMode=${JSON.stringify(mode)}, whenValue=${JSON.stringify(val)};
    ${SHARE_LBL_SRC}
    ${grab("shareURL")}
    ${grab("shareRoute")}
    return shareRoute;
  `)({ href: "https://holbizmetrics.github.io/phone-sbb/?stale=1#frag" }, nav);
  return { fire: (ev) => fn(ev), out };
};
{
  const t = mkShare(); t.fire();
  await 0;
  const u = new URL(t.out.shared.url);
  chk("the URL carries from and to, survives a round-trip through encoding",
    u.searchParams.get("from") === "Z\u00fcrich HB" && u.searchParams.get("to") === "Bern", t.out.shared.url);
  chk("a NOW search shares as NOW -- no at= param, the sender's clock is not stamped on",
    !u.searchParams.has("at") && !u.searchParams.has("mode"), t.out.shared.url);
  chk("the sender's own query string and #fragment do not leak into the link",
    !u.searchParams.has("stale") && !u.href.includes("#"), u.href);
  chk("the human text names the route with an arrow", /Z\u00fcrich HB \u2192 Bern/.test(t.out.shared.text), t.out.shared.text);
}
{
  const t = mkShare({ mode: "dep", val: "2026-08-01T09:30" }); t.fire();
  await 0;
  const u = new URL(t.out.shared.url);
  chk("a timed search carries its time", u.searchParams.get("at") === "2026-08-01T09:30", t.out.shared.url);
  chk("...and the text says dep 09:30", /dep 09:30/.test(t.out.shared.text), t.out.shared.text);
  const a = mkShare({ mode: "arr", val: "2026-08-01T18:00" }); a.fire();
  await 0;
  chk("arrive-by survives the trip: mode=arr in the URL, 'arr by' in the text",
    new URL(a.out.shared.url).searchParams.get("mode") === "arr" && /arr by 18:00/.test(a.out.shared.text),
    a.out.shared.url + " " + a.out.shared.text);
}
{
  const t = mkShare({ canShare: false }); t.fire();
  await new Promise(r => setTimeout(r, 0));
  chk("no share sheet -> clipboard fallback with text AND link",
    t.out.copied && t.out.copied.includes("\u2192") && t.out.copied.includes("from=Z%C3%BCrich"), t.out.copied);
  const c = mkShare({ shareErr: Object.assign(new Error("x"), { name: "AbortError" }) }); c.fire();
  await new Promise(r => setTimeout(r, 0));
  chk("a CANCELLED share sheet is a choice, not a failure -- no fallback fires", c.out.copied === null, String(c.out.copied));
  const e = mkShare({ shareErr: new Error("boom") }); e.fire();
  await new Promise(r => setTimeout(r, 0));
  chk("a REAL share failure falls back to the clipboard", e.out.copied !== null, String(e.out.copied));
  const n = mkShare({ from: "" }); n.fire();
  chk("no route yet -> no share call", n.out.shared === null && n.out.copied === null);
}

// ---- applyDeepLink: the read side -- fields fill, dead timestamps refuse ----
const mkDeep = (search) => {
  const els = {};
  const $ = (id) => {
    if (!els[id]) {
      const classes = new Set();
      els[id] = { value: "", innerHTML: "", classes,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c) } };
    }
    return els[id];
  };
  const calls = [];
  const fn = new Function("location", "$", "calls", "state", `
    let fromName="", toName="";
    const setWhen=(m)=>calls.push(["when",m]);
    const setTab=(t)=>calls.push(["tab",t]);
    ${grab("applyDeepLink")}
    const r=applyDeepLink(); state.from=fromName; state.to=toName; return r;
  `);
  const state = {};
  const ret = fn({ search }, $, calls, state);
  return { ret, els, calls, state };
};
{
  const t = mkDeep("?from=Luzern&to=Bellinzona");
  chk("a shared link fills both fields and marks them filled",
    t.els.iFrom.value === "Luzern" && t.els.iTo.value === "Bellinzona"
    && t.els.fFrom.classes.has("has") && t.els.fTo.classes.has("has"), JSON.stringify(t.els));
  chk("...sets the state the planner reads", t.state.from === "Luzern" && t.state.to === "Bellinzona");
  chk("...plans NOW and lands on the Journey tab",
    t.calls.some(c => c[0] === "when" && c[1] === "now") && t.calls.some(c => c[0] === "tab" && c[1] === "jrn"),
    JSON.stringify(t.calls));
  chk("...and reports true", t.ret === true);
}
{
  const t = mkDeep("?from=Luzern&to=Bern&at=2099-01-01T09:30");
  chk("a still-live shared time is honoured as a departure time",
    t.els.whenAt.value === "2099-01-01T09:30" && t.calls.some(c => c[1] === "dep"), JSON.stringify(t.calls));
  const a = mkDeep("?from=Luzern&to=Bern&at=2099-01-01T18:00&mode=arr");
  chk("mode=arr makes it an arrive-by", a.calls.some(c => c[1] === "arr"), JSON.stringify(a.calls));
}
{
  const t = mkDeep("?from=Luzern&to=Bern&at=2020-01-01T09:30");
  chk("a DEAD shared time is not replayed -- fall back to NOW, no ghost plan",
    t.calls.some(c => c[1] === "now") && !t.calls.some(c => c[1] === "dep"), JSON.stringify(t.calls));
  chk("...and says so next to the time controls",
    /already passed/.test(t.els.sunHint.innerHTML), t.els.sunHint.innerHTML);
  const g = mkDeep("?from=Luzern&to=Bern&at=garbage");
  chk("a malformed time is treated like a dead one, never a crash",
    g.calls.some(c => c[1] === "now"), JSON.stringify(g.calls));
  const clean = mkDeep("?from=Luzern&to=Bern");
  chk("no at= means no note -- silence is only earned when nothing was dropped",
    clean.els.sunHint === undefined || clean.els.sunHint.innerHTML === "", "");
}
{
  const t = mkDeep("?from=Luzern");
  chk("half a route is no route -- returns false, touches nothing",
    t.ret === false && !t.calls.length && t.state.from === "", JSON.stringify(t.calls));
  const e = mkDeep("");
  chk("a plain visit (no params) is untouched", e.ret === false && !e.calls.length);
  const x = mkDeep("?from=%22%3E%3Cimg%20src%3Dx%3E&to=Bern");
  const dirty = Object.values(x.els).some(el => (el.innerHTML || "").includes("<img"));
  chk("a hostile station name lands in .value only, never in markup", !dirty,
    JSON.stringify(Object.keys(x.els)));
}

// ---- wiring: green-but-unwired is the named defect class ----
chk("the share bar rides BOTH planners (plain and smart)",
  /shareBarHTML\(\) \+ catFilterNote/.test(src) && /\+ shareBarHTML\(\)/.test(src),
  "a bar rendered on one path silently vanishes when smart-mode flips");
chk("boot actually applies the deep link", /^applyDeepLink\(\);/m.test(src),
  "parser built but never called -- feature dead, tests green");
const css = fs.readFileSync(new URL("../app.css", import.meta.url), "utf8");
chk("the share button is styled", css.includes(".sharebar .shr"), "unstyled = invisible = unshipped");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
