// T5: the privacy section is TEXT that makes CLAIMS, and text rots silently --
// the day someone adds an analytics snippet or a fifth API, the paragraph
// becomes a lie with no failing test. So this suite pins each sentence to the
// code it describes: every fetch target must be on the named four-service
// list, no analytics/tracker fingerprints anywhere, persistence is
// localStorage-only, and geolocation stays behind the one explicit tap.
import { src, APP } from "./_src.mjs";
console.log("reading " + APP);

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// ---- the four services, and ONLY the four ----
const ALLOWED = [
  "transport.opendata.ch",     // timetable
  "api.open-meteo.com",        // weather + elevation
  "overpass-api.de",           // nearby places (OSM)
  "overpass.kumi.systems",     //   -- second mirror, same service
  "wikipedia.org",             // sights
];
{
  // every https URL that appears in a FETCHABLE position: template literals and
  // string constants. Tap-to-open <a href> links are the user's own outbound
  // step -- the privacy text says so -- but collect everything and split.
  const urls = [...src.matchAll(/https:\/\/(?:\$\{lang\}\.)?([a-z0-9.-]+)/g)].map(m => m[1]);
  const outboundLinks = ["www.windy.com", "www.meteoblue.com", "www.google.com", "github.com"];
  const unknown = [...new Set(urls)].filter(h =>
    !ALLOWED.some(a => h === a || h.endsWith("." + a.replace(/^www\./, ""))) &&
    !outboundLinks.includes(h));
  chk("every network host is either one of the four named services or a named tap-to-open link",
    unknown.length === 0, "unlisted hosts: " + unknown.join(", "));
  chk("the help text counts what the code does: exactly four services",
    /exactly four services/.test(src) &&
    /transport\.opendata\.ch/.test(src) && /Open-Meteo/.test(src) &&
    /Overpass/.test(src) && /Wikipedia/.test(src), "");
}

// ---- no tracker fingerprints ----
{
  // domain forms only: "plausible" bare is an English word this codebase uses in comments
  const trackers = /gtag|google-analytics|googletagmanager|analytics\.js|plausible\.io|matomo|hotjar|sentry|mixpanel|amplitude|segment\.com|facebook\.net|doubleclick/i;
  chk("no analytics or tracker fingerprint anywhere in the shipped document",
    !trackers.test(src), (src.match(trackers) || [])[0]);
  chk("no cookies are ever written", !/document\.cookie/.test(src), "");
  chk("no beacons", !/sendBeacon/.test(src), "");
}

// ---- persistence is the browser's own storage, nothing remote ----
{
  chk("state persists in localStorage only -- no IndexedDB, no remote sync",
    /localStorage/.test(src) && !/indexedDB/i.test(src), "");
  chk("nothing POSTs anywhere except the Overpass query",
    (src.match(/method:\s*"POST"/g) || []).length === 1, "");
}

// ---- geolocation: one tap, one lookup ----
{
  const asks = (src.match(/getCurrentPosition/g) || []).length;
  chk("location is asked for exactly once -- the nearest-stop tap, no background watcher",
    asks === 1 && !/watchPosition/.test(src), "getCurrentPosition sites: " + asks);
}

// ---- the section itself is there and findable ----
{
  chk("the help sheet has the Privacy section", /<h3>Privacy<\/h3>/.test(src) && /id="privacy"/.test(src), "");
  chk("it says the load-bearing sentence: nothing about you here",
    /nothing about you here/.test(src), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
