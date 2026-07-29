// T2: the service worker -- the ONE roadmap item flagged with real destroy-risk.
// The roadmap named three ways it ruins the app, so this suite is organised by
// those three and nothing else matters as much:
//   (a) trapping users on a stale cached app version
//   (b) serving old departure times as if live   <- the worst, it LOOKS right
//   (c) breaking app load
// sw.js is not merely grepped here: it is EXECUTED against a fake worker global
// so the fetch handler's actual decisions are observed. The load-bearing test is
// a negative one -- a timetable request must come back UNCLAIMED.
import fs from "fs";
import vm from "vm";
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

const ROOT = new URL("../", import.meta.url).pathname;
const swSrc = fs.readFileSync(ROOT + "sw.js", "utf8");

// ---------- a fake worker global ----------
class Res {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.type = init.type ?? "basic"; }
  get ok() { return this.status >= 200 && this.status < 300; }
  clone() { return new Res(this.body, { status: this.status, type: this.type }); }
  static error() { return new Res(null, { status: 0, type: "error" }); }
}
// The shell is precached under RELATIVE urls ("./index.html") but requested
// under absolute ones. A real CacheStorage resolves both to the same entry; a
// fake that keys on the raw string does not, and then every cache-hit test
// passes for the wrong reason -- a cache-first navigation would MISS and fall
// through to the network, looking exactly like the network-first behaviour it
// is supposed to prove.
const CKEY = u => new URL(String(u && u.url ? u.url : u), "https://holbizmetrics.github.io/").href;
function mkEnv(opts = {}) {
  const stores = new Map();               // cacheName -> Map(url -> Res)
  const handlers = {};
  const log = { skipWaiting: 0, claim: 0, unregistered: 0, fetched: [], put: [] };
  const cacheApi = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        add: async u => {
          const r = await env.fetch(u);
          if (!r || !r.ok) throw new Error("precache " + u);
          m.set(CKEY(u), r);
        },
        // Atomic, like the real one: if any entry fails, NOTHING is stored.
        // Present so the "install used addAll" mutation can actually RUN -- a
        // mutation that crashes the harness is not a mutation that was caught.
        addAll: async us => {
          const got = await Promise.all(us.map(async u => {
            const r = await env.fetch(u);
            if (!r || !r.ok) throw new Error("precache " + u);
            return [CKEY(u), r];
          }));
          for (const [k, v] of got) m.set(k, v);
        },
        put: async (req, res) => { log.put.push(String(req.url || req)); m.set(CKEY(req), res); },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async n => stores.delete(n),
    match: async req => {
      const u = CKEY(req);
      for (const m of stores.values()) if (m.has(u)) return m.get(u);
      return undefined;
    },
  };
  const env = {
    self: null, caches: cacheApi, Response: Res, URL, Promise, Error, console,
    fetch: async u => {
      const url = String(u && u.url ? u.url : u);
      log.fetched.push(url);
      if (opts.offline) throw new Error("offline");
      if (opts.missing && opts.missing.some(m => url.includes(m))) return new Res(null, { status: 404 });
      return new Res("NET:" + url, { type: opts.opaque ? "opaque" : "basic", status: opts.opaque ? 0 : 200 });
    },
    _stores: stores, _log: log, _handlers: handlers,
  };
  env.self = {
    location: { origin: "https://holbizmetrics.github.io" },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => { log.skipWaiting++; },
    clients: { claim: async () => { log.claim++; } },
    registration: { unregister: async () => { log.unregistered++; } },
  };
  vm.createContext(env);
  new vm.Script(swSrc).runInContext(env);
  return env;
}
const ORIGIN = "https://holbizmetrics.github.io";
const evt = () => { const e = { _res: undefined, _claimed: false, waits: [],
  respondWith(p) { this._claimed = true; this._res = p; },
  waitUntil(p) { this.waits.push(p); } }; return e; };
// Returns whether install REJECTED, and never lets that rejection escape. A
// worker whose install can throw must not be able to take the harness down
// with it: a crashed suite prints no tally, and a missing tally scores as
// silence rather than as the failure it is.
const doInstall = async env => {
  const i = evt(); env._handlers.install(i);
  try { await Promise.all(i.waits); return false; } catch (e) { return true; }
};
const fireFetch = async (env, url, init = {}) => {
  const e = evt();
  e.request = { url, method: init.method || "GET", mode: init.mode || "no-cors" };
  env._handlers.fetch(e);
  if (e._claimed) e._res = await e._res;
  return e;
};

// ================= (b) THE TIMETABLE GUARD -- the load-bearing negative ======
{
  const env = mkEnv();
  const services = [
    "https://transport.opendata.ch/v1/stationboard?station=Aarau",
    "https://api.open-meteo.com/v1/forecast?latitude=47",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://de.wikipedia.org/w/api.php?action=query",
  ];
  let claimed = [];
  for (const u of services) { const e = await fireFetch(env, u); if (e._claimed) claimed.push(u); }
  chk("PLANTED TRAP (b): NO timetable/weather/map/wiki request is intercepted by the worker",
    claimed.length === 0, "intercepted: " + claimed.join(", "));
  chk("...so those requests are not even fetched BY the worker (the browser does them)",
    env._log.fetched.length === 0, env._log.fetched.join(", "));
  // comments strippped: sw.js NAMES the four services in its header comment on
  // purpose (that is the documentation of the guard). What must not exist is a
  // host string in executable code.
  const swCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  chk("sw.js caches no API responses at all -- no host of the four appears in its CODE",
    !/transport\.opendata\.ch|open-meteo|overpass|wikipedia/.test(swCode), "");
  chk("control: the comment stripper left the real code intact",
    /addEventListener\("fetch"/.test(swCode) && /url\.origin !== self\.location\.origin/.test(swCode), "");
  const e2 = await fireFetch(env, ORIGIN + "/app.js", { method: "POST" });
  chk("a POST is never intercepted either", !e2._claimed, "");
}

// ================= (a) THE STALE-VERSION TRAP ==============================
{
  const env = mkEnv();
  const threw0 = await doInstall(env);
  chk("install precaches the shell and calls skipWaiting",
    !threw0 && env._log.skipWaiting >= 1, "threw=" + threw0 + " skipWaiting=" + env._log.skipWaiting);

  // a navigation while ONLINE must hit the network, not the cache
  env._log.fetched.length = 0;
  const nav = await fireFetch(env, ORIGIN + "/index.html", { mode: "navigate" });
  chk("PLANTED TRAP (a): a navigation goes to the NETWORK first, even with a cached copy present",
    nav._claimed && env._log.fetched.length === 1 && String(nav._res.body).startsWith("NET:"),
    JSON.stringify(nav._res && nav._res.body));

  // old caches are purged on activate, so a version cannot linger
  env._stores.set("rail-shell-OLD", new Map([[ORIGIN + "/app.js", new Res("ANCIENT")]]));
  const act = evt(); env._handlers.activate(act); await Promise.all(act.waits);
  chk("activate deletes every cache that is not this version",
    ![...env._stores.keys()].includes("rail-shell-OLD"), [...env._stores.keys()].join(","));
  chk("...and claims open pages so the new worker takes effect at once", env._log.claim >= 1, String(env._log.claim));
  chk("the cache name carries the version, so a bump cannot reuse the old bucket",
    /const CACHE = "rail-shell-" \+ SHELL_V/.test(swSrc), "");
  {
    // SHELL_V and index.html's ?v= are one number wearing two hats. If a release
    // bumps one and forgets the other, the worker precaches app.js?v=OLD while
    // the page asks for app.js?v=NEW: every load is a cache MISS that silently
    // works online and has nothing at all offline. Nothing else notices.
    const html = fs.readFileSync(ROOT + "index.html", "utf8");
    const swV = (swSrc.match(/const SHELL_V = "([^"]+)"/) || [])[1];
    const pageV = [...html.matchAll(/app\.(?:css|js)\?v=([^"']+)/g)].map(m => m[1]);
    chk("sw.js SHELL_V matches the ?v= index.html actually asks for",
      !!swV && pageV.length >= 2 && pageV.every(v => v === swV),
      "sw=" + swV + " page=" + pageV.join(","));
  }
  chk("registration asks the browser NOT to serve sw.js from the HTTP cache",
    /updateViaCache:\s*"none"/.test(src), "");
  chk("there is an escape hatch that erases everything and unregisters",
    /RAIL_UNREGISTER/.test(swSrc) && /function railUnregisterSW/.test(src), "");
  const env2 = mkEnv();
  await doInstall(env2);
  const msg = evt(); msg.data = { type: "RAIL_UNREGISTER" };
  env2._handlers.message(msg); await Promise.all(msg.waits);
  chk("the escape hatch really empties the caches and unregisters",
    [...env2._stores.keys()].every(k => env2._stores.get(k).size === 0) && env2._log.unregistered === 1,
    String(env2._log.unregistered));
}

// ================= (c) BREAKING APP LOAD ==================================
{
  const env = mkEnv({ missing: ["apple-touch-180"] });   // one shell asset 404s
  const threw = await doInstall(env);
  chk("PLANTED TRAP (c): one missing shell asset does NOT fail the install",
    !threw && env._log.skipWaiting >= 1, "threw=" + threw);
  const cached = [...env._stores.values()][0];
  chk("...and the rest of the shell is cached anyway", cached && cached.size >= 4, cached && String(cached.size));

  // offline navigation falls back to the cached shell so the app can boot
  const off = mkEnv();
  await doInstall(off);
  off.fetch = async () => { throw new Error("offline"); };
  const nav = await fireFetch(off, ORIGIN + "/index.html", { mode: "navigate" });
  chk("offline, a navigation is served from cache so the app still boots",
    nav._claimed && nav._res && nav._res.status === 200, JSON.stringify(nav._res && nav._res.status));

  // an opaque/error response is never stored
  const op = mkEnv({ opaque: true });
  await doInstall(op);
  op._log.put.length = 0;
  await fireFetch(op, ORIGIN + "/never-seen.png");
  chk("an opaque response (status 0) is never written to the cache",
    op._log.put.length === 0, op._log.put.join(","));
}

// ================= the app-layer stale board ==============================
const a = src.indexOf("function staleBoardFor");
const b = src.indexOf("/* one sentence per row for a screen reader", a);
if (a < 0 || b < 0) throw new Error("HARNESS FAILED -- stale-board markers not found");
const fnSrc = src.slice(a, b);
let storedBoard = null;
const actx = {
  load: (k, d) => (storedBoard === null ? d : storedBoard),
  esc: s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  hhmm: iso => (iso || "").slice(11, 16),
  shortStop: n => n, badge: (c) => ({ label: c || "?" }),
  // The live board's countdown helpers, stubbed FAITHFULLY on purpose: the
  // realistic way this feature breaks is a developer reusing the live row
  // renderer here, and that mutation has to run to be caught, not crash.
  minsUntil: iso => Math.round((new Date(iso) - Date.now()) / 60000),
  depLabel: m => (m <= 0 ? "now" : "in " + m + " minute" + (m === 1 ? "" : "s")),
  LS: { board: "rail.board" }, Date, Math, Array, isNaN,
};
vm.createContext(actx);
new vm.Script(fnSrc + "\nthis.staleBoardFor=staleBoardFor; this.staleBoardHTML=staleBoardHTML; this.staleAgeWords=staleAgeWords; this.clockHM=clockHM;").runInContext(actx);

{
  chk("no cached board means no stale render (and the old error text still shows)",
    actx.staleBoardFor("Aarau") === null, "");
  storedBoard = { name: "Aarau", at: Date.now(), rows: [] };
  chk("an EMPTY cached board is not a board", actx.staleBoardFor("Aarau") === null, "");
  storedBoard = { name: "Bern", at: Date.now(), rows: [{ to: "Thun" }] };
  chk("a board cached for a DIFFERENT station is never shown for this one",
    actx.staleBoardFor("Aarau") === null, "");
  chk("...but the same station under its fuller API name still matches",
    actx.staleBoardFor("Bern") !== null, "");

  const at = Date.now() - 47 * 60000;
  storedBoard = { name: "Aarau", at, rows: [
    { category: "IC", number: "5", to: "Basel SBB", stop: { departure: "2026-07-29T14:05:00+0200", platform: "3" } },
    { category: "S", number: "26", to: "Olten", stop: { departure: "2026-07-29T14:11:00+0200" } },
  ] };
  const html = actx.staleBoardHTML(actx.staleBoardFor("Aarau"));
  chk("the banner says the words the roadmap asked for: stale as of HH:MM",
    /stale as of <b>|<b>stale as of/.test(html) && /stale as of/.test(html), html.slice(0, 140));
  chk("...and how long ago that was, in plain words",
    /47 minutes ago/.test(html), actx.staleAgeWords(47 * 60000));
  chk("it is labelled OFFLINE, not presented as a board",
    /Offline/.test(html), "");
  chk("PLANTED TRAP (b), app layer: a stale row shows a CLOCK TIME and never a countdown",
    /14:05/.test(html) && !/in \d+ minute/.test(html) && !/leaving now/.test(html), html.slice(0, 300));
  // The fixture above departs in the PAST, and a countdown over a past time
  // renders as "now" -- which slips past a regex looking for "in N minutes".
  // So the same trap is planted again with a departure that is genuinely
  // ahead of the clock, where a reused countdown cannot hide.
  storedBoard = { name: "Aarau", at: Date.now() - 47 * 60000, rows: [
    { category: "IC", number: "5", to: "Bern",
      stop: { departure: new Date(Date.now() + 37 * 60000).toISOString().slice(0, 19) } },
  ] };
  const fut = actx.staleBoardHTML(actx.staleBoardFor("Aarau"));
  chk("...and still no countdown when the cached departure is STILL in the future",
    !/in \d+ minute/.test(fut) && !/>now</.test(fut), fut.slice(0, 300));
  chk("the stale renderer never reaches for the live board's countdown helpers at all",
    !/minsUntil|depLabel/.test(fnSrc), "");
  chk("it says what it cannot know: no delays, no platform changes since",
    /no delays/.test(html) && /platform changes since/.test(html), "");
  chk("the rows are still useful -- line, destination and platform survive",
    /IC/.test(html) && /Basel SBB/.test(html) && /Pl\. 3/.test(html), "");
  chk("a row without a platform simply omits it, inventing nothing",
    (html.match(/Pl\./g) || []).length === 1, "");
  chk("the refresh tick is STOPPED when stale is rendered, so nothing recomputes",
    /if\(cached\) stopBoardTimers\(\);/.test(src), "");
  chk("the stale block gets its own class, not the live board's",
    /class="stale"/.test(html) && !/class="dep"/.test(html), "");

  storedBoard = { name: "Aarau", at: Date.now() - 30000, rows: [{ to: "X" }] };
  chk("a very fresh cache says so rather than rounding to 0 minutes",
    /less than a minute ago/.test(actx.staleBoardHTML(actx.staleBoardFor("Aarau"))), "");
  chk("hours are spoken as hours", actx.staleAgeWords(3 * 3600000) === "3 hours ago", actx.staleAgeWords(3 * 3600000));
}

// ---- the board is actually SAVED, or none of the above can ever fire ----
{
  chk("loadBoard persists the board it just rendered",
    /save\(LS\.board, \{name:disp, at:Date\.now\(\), rows:lastBoard/.test(src), "");
  chk("the stale path is only reached from the catch branch, never on success",
    src.indexOf("const cached=staleBoardFor(name)") > src.indexOf("}catch(e){", src.indexOf("async function loadBoard")), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
