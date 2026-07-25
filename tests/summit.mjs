// Runs the REAL summitVerdict/mountainLegs/fillSummit out of index.html.
// The category fixtures below are not invented -- they are what
// transport.opendata.ch actually returned for these routes on 2026-07-25.
// That matters: the whole feature hangs on a claim about someone else's data,
// and a test built from a guess would only prove the guess self-consistent.
import fs from "fs";
const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
console.log("reading " + APP);
const src = fs.readFileSync(APP, "utf8");

const grab = (n) => {
  const i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("HARNESS FAILED -- function not found: " + n);
  const start = src.slice(Math.max(0, i - 6), i) === "async " ? i - 6 : i;
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; started = true; }
    else if (src[k] === "}") { d--; if (started && d === 0) return src.slice(start, k + 1); }
  }
  throw new Error("HARNESS FAILED -- unbalanced braces in " + n);
};
const grabConst = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error("HARNESS FAILED -- could not extract " + what);
  return m[0];
};

let pass = 0, fail = 0;
const chk = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + " :: " + d); } };

// observed live, 2026-07-25
const LIVE = {
  "Zermatt -> Gornergrat":        ["CC"],
  "Vitznau -> Rigi Kulm":         ["CC"],
  "Grindelwald -> Kl. Scheidegg": ["CC"],
  "Stans -> Stanserhorn":         ["FUN", "PB"],
  "Interlaken -> Harder Kulm":    ["FUN"],
  "Lauterbrunnen -> Schilthorn":  ["B", "PB", "PB", "PB"],
  "Luzern -> Pilatus Kulm":       ["B", "B", "GB", "PB"],
  "Interlaken -> Jungfraujoch":   ["R", "GB", "R"],
};
const FLAT = {
  "Zurich HB -> Bern":            ["IC"],
  "Bern -> Zermatt":              ["IC", "R"],
  "Chur -> Arosa":                ["RE"],
  "Montreux -> Rochers-de-Naye":  ["R"],       // a real summit the API files as R
};

const conn = (cats, alt = 2000, name = "Gornergrat") => ({
  sections: cats.map(c => ({ journey: { category: c, number: "1" } })),
  to: { station: { name, coordinate: { x: 45.983, y: 7.784 } }, arrival: "2026-07-25T11:00:00+02:00" },
});

function build({ elev = [3089], hourly = null, code = 0 } = {}) {
  const box = { innerHTML: "" };
  const panel = { dataset: { open: "1" }, querySelector: () => box };
  const H = hourly || {
    time: ["2026-07-25T10:00", "2026-07-25T11:00"],
    weather_code: [code, code], temperature_2m: [8, 8],
    apparent_temperature: [6, 6], precipitation_probability: [10, 10], wind_speed_10m: [12, 12],
  };
  const m = new Function("PANEL", "ELEV", "HOURLY", "CONNS", `
    let jrnConns = CONNS;
    const $ = () => null;
    ${grab("esc")}
    ${grab("shortStop")}
    ${grabConst(/function wxEmoji\(c\)\{[\s\S]*?\n\}/, "wxEmoji")}
    ${grab("wxText")}
    ${grab("wxAt")}
    ${grab("sunFor")}
    ${grabConst(/const MOUNTAIN_CATS=[^;]+;/, "MOUNTAIN_CATS")}
    ${grabConst(/const SUMMIT_MIN_M=[^;]+;/, "SUMMIT_MIN_M")}
    ${grab("mountainLegs")}
    ${grab("summitVerdict")}
    const destWeather = async () => ({ hourly: HOURLY, daily: { time:["2026-07-25"], sunrise:["2026-07-25T05:56"], sunset:["2026-07-25T21:03"] } });
    const routeElevation = async () => ELEV;
    ${grab("fillSummit")}
    return { fillSummit, mountainLegs, summitVerdict, SUMMIT_MIN_M, setConns:(c)=>{jrnConns=c;} };
  `)(panel, elev, H, []);
  return { ...m, panel, box, html: () => box.innerHTML };
}

// which journeys are excursions at all -- against real observed categories
{
  const t = build();
  for (const [route, cats] of Object.entries(LIVE)) {
    chk(`recognised as a mountain trip: ${route}`, t.mountainLegs(conn(cats)).length > 0, cats.join(","));
  }
  for (const [route, cats] of Object.entries(FLAT)) {
    chk(`not a mountain trip: ${route}`, t.mountainLegs(conn(cats)).length === 0, cats.join(","));
  }
}

// control: the ordinary summit case must actually render, or every "renders
// nothing" assertion below is vacuous
{
  const t = build({ code: 0 }); t.setConns([conn(["CC"])]);
  await t.fillSummit(t.panel, 0);
  chk("control: a clear day on a cog railway gets a verdict", /clear at the top/.test(t.html()), t.html());
  chk("control: it names the altitude", /3089 m/.test(t.html()), t.html());
  chk("control: it names the arrival temperature", /on arrival/.test(t.html()), t.html());
  chk("control: good verdicts are marked good", /class="smv good"/.test(t.html()), t.html());
}

// the verdict has to change with the weather, or it is decoration
{
  const cases = [[0, "clear at the top", "good"], [2, "partly cloudy", "good"], [3, "overcast", "bad"],
                 [45, "fog at the top", "bad"], [73, "snow at the top", "bad"], [95, "thunderstorm", "bad"],
                 [63, "wet at the top", "bad"]];
  for (const [code, text, cls] of cases) {
    const t = build({ code }); t.setConns([conn(["PB"])]);
    await t.fillSummit(t.panel, 0);
    chk(`code ${code} -> ${text}`, t.html().includes(text) && t.html().includes(`smv ${cls}`), t.html());
  }
}

// a city funicular is not an excursion, however the API files it
{
  const t = build({ elev: [470] }); t.setConns([conn(["FUN"], 470, "Polyterrasse")]);
  await t.fillSummit(t.panel, 0);
  chk("a 470 m funicular gets no summit verdict", t.html() === "", t.html());
}
{
  const t = build({ elev: [858] }); t.setConns([conn(["FUN"], 858, "Gurten Kulm")]);
  await t.fillSummit(t.panel, 0);
  chk("...but a local 858 m viewpoint still does", /Gurten/.test(t.html()), t.html());
}
{
  // unknown altitude must not silently rule the trip out -- a cable car is evidence
  const t = build({ elev: null }); t.setConns([conn(["PB"])]);
  await t.fillSummit(t.panel, 0);
  chk("unknown altitude keeps the verdict", /clear at the top/.test(t.html()), t.html());
  chk("...without inventing a height", !/ m<\/b>/.test(t.html()), t.html());
}

// a flat journey says nothing at all
{
  const t = build(); t.setConns([conn(["IC"])]);
  await t.fillSummit(t.panel, 0);
  chk("an IC to Bern gets no summit box", t.html() === "", t.html());
}

// missing weather must not become a confident verdict
{
  const t = build({ hourly: { time: ["2026-07-25T11:00"], weather_code: [0], temperature_2m: [null] } });
  t.setConns([conn(["CC"])]);
  await t.fillSummit(t.panel, 0);
  chk("no forecast -> altitude only, no verdict", /3089 m/.test(t.html()) && !/smv/.test(t.html()), t.html());
}
{
  const t = build(); t.setConns([conn(["CC"])]);
  t.panel.dataset.open = "";
  await t.fillSummit(t.panel, 0);
  chk("a panel closed while loading is not painted", t.html() === "", t.html());
}

// summitVerdict boundaries -- the ranges are the claim
{
  const t = build();
  chk("no code -> no verdict", t.summitVerdict(null) === null && t.summitVerdict(undefined) === null);
  chk("1 is still clear, 2 is not", t.summitVerdict(1).v.includes("clear") && !t.summitVerdict(2).v.includes("clear"));
  chk("48 is fog, 51 is not", t.summitVerdict(48).v.includes("fog") && !t.summitVerdict(51).v.includes("fog"));
  chk("77 is snow, 80 is not", t.summitVerdict(77).v.includes("snow") && !t.summitVerdict(80).v.includes("snow"));
  chk("96 is still a thunderstorm", t.summitVerdict(96).v.includes("thunderstorm"));
}

// a station name with a quote must not break out
{
  const t = build(); t.setConns([conn(["CC"], 3089, 'Top" onclick="alert(1)')]);
  await t.fillSummit(t.panel, 0);
  chk("no injected onclick survives escaping", !/onclick="alert/.test(t.html()), t.html());
}

// wiring + no dead twin
chk("fillSummit runs when the sketch panel opens", /fillSummit\(panel,ci\)/.test(src),
  "defined but never called -- green tests, invisible feature");
chk("the string-matching twin is gone", !/summitVerdictFromDesc/.test(src),
  "two verdict functions with different rules, one of them dead, is a trap");
chk("wxAt hands out the raw code", /\bcode, ?emoji:wxEmoji\(code\)/.test(src),
  "without the code, judging the weather means parsing English back into numbers");
for (const cls of ["smtitle", "smbits", "smv", "summitbox"]) {
  chk(`.${cls} is styled`, new RegExp(`\\.${cls}[\\s{:,]`).test(src), "rendered but has no CSS rule");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
