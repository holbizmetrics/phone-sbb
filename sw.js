/* T2 service worker -- the one item on the roadmap with real destroy-risk.
   Three ways a careless service worker ruins this app, and the guard for each:

   (a) TRAPPING YOU ON A STALE APP VERSION so updates never arrive.
       Guard: navigation requests are NETWORK-FIRST, never cache-first. An
       online phone always gets today's index.html, and index.html is what
       names the ?v= of the css/js. Plus skipWaiting + clients.claim, and
       activate deletes every cache that is not this exact version.

   (b) SERVING OLD DEPARTURE TIMES AS IF LIVE -- the worst one, because it
       looks right. Guard: THIS WORKER NEVER TOUCHES THE TIMETABLE. The fetch
       handler returns without calling respondWith for anything cross-origin,
       so all four services (transport.opendata.ch, Open-Meteo, Overpass,
       Wikipedia) go straight to the network exactly as they do today. There
       is deliberately no API caching here at all. Showing a stale board is
       the APP's job, because only the app can label it "stale as of HH:MM";
       a cached response inside a worker arrives with no way to say so.

   (c) BREAKING APP LOAD. Guard: every path falls back to a plain fetch, a
       failed precache does not fail the install, and only same-origin GET
       with a 200/basic response is ever stored. */

const SHELL_V = "20260729k";
const CACHE = "rail-shell-" + SHELL_V;
const SHELL = [
  "./",
  "./index.html",
  "./app.css?v=" + SHELL_V,
  "./app.js?v=" + SHELL_V,
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/apple-touch-180.png",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Individually, not addAll: addAll is all-or-nothing, so ONE renamed icon
    // would fail the whole install and leave the app with no worker at all.
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => n === CACHE ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

/* The operator's escape hatch. If a worker ever does go wrong in the field,
   the page can tell it to erase everything and unregister itself, and the next
   load is a normal uncached site. A guard that cannot be turned off is not a
   guard. */
self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "RAIL_UNREGISTER") return;
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => caches.delete(n)));
    await self.registration.unregister();
  })());
});

async function cacheOk(req, res) {
  // opaque (cross-origin, no-cors) and error responses are never stored: an
  // opaque response has status 0, so "it worked" is unknowable
  if (!res || !res.ok || res.type !== "basic") return res;
  const c = await caches.open(CACHE);
  c.put(req, res.clone()).catch(() => {});
  return res;
}

async function navigationFirst(req) {
  try {
    return await cacheOk(req, await fetch(req));
  } catch (err) {
    // offline: the shell, so the app boots and can show its own stale board
    return (await caches.match(req)) || (await caches.match("./index.html"))
        || (await caches.match("./")) || Response.error();
  }
}

async function shellFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try { return await cacheOk(req, await fetch(req)); }
  catch (err) { return Response.error(); }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                     // untouched
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  // THE TIMETABLE GUARD. Returning without respondWith means the browser
  // performs the request itself -- the worker is not in the path at all.
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") { e.respondWith(navigationFirst(req)); return; }
  e.respondWith(shellFirst(req));
});
