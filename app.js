/* Rewritten at deploy time by .github/workflows/deploy.yml, which keys on this
   exact line and FAILS THE DEPLOY if the replacement does not take -- a stamp
   that silently stops updating is worse than no stamp at all, because you would
   trust it and test the same old build twice. A file you opened yourself keeps
   saying "dev", which is the truth: it is not a deploy. */
const BUILD = "dev";  // BUILD-STAMP
const API = "https://transport.opendata.ch/v1";
const $ = id => document.getElementById(id);
const LS = { favs:"rail.favs", last:"rail.last", modes:"rail.modes", cats:"rail.cats", routes:"rail.routes", theme:"rail.theme", onboard:"rail.onboard", obpoi:"rail.obpoi", flightbuf:"rail.flightbuf" };
let favs = load(LS.favs, []);
let current = "";        // current departures station
let refreshTimer = null;
let tickTimer = null;
let lastBoard = [];      // cached stationboard for live tick
let openDep = "";        // depKey of the expanded departure -- survives a rebuild

/* ---------- utils ---------- */
function load(k,d){ try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d} }
/* A phone with no free space throws from setItem. Unguarded, that threw out of
   save() and took the CALLER down with it -- and save() runs BEFORE the work at
   five of six call sites, so planning, the mode chips, the departure board and
   the theme toggle all stopped at once, and reloading fixed nothing because the
   disk was still full. Persistence is the only thing allowed to fail here. */
let storageFull=false;
function save(k,v){
  try{ localStorage.setItem(k, JSON.stringify(v)); storageFull=false; }
  catch(e){ storageFull=true; }
}
/* Silence would be a lie: a star that looks stuck but is not, is exactly the
   confident wrong answer this app refuses everywhere else. */
function storageNoteHTML(){
  return storageFull
    ? `<div class="tznote">Your phone is out of storage &#183; favourites, filters and recent routes are not being remembered. Everything else works.</div>`
    : "";
}
function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
// 24-hour, always: a Swiss departure board reads 22:27, never 10:27 PM. h23 (not
// hour12:false) so midnight is 00:00 rather than 24:00.
/* Times must ALWAYS read as Swiss local -- the same numbers on the platform
   board -- no matter what zone the phone is on. new Date(iso).toLocaleTimeString()
   re-renders in the DEVICE zone, so a 00:02 departure showed as 23:02 on a UK
   phone, 18:02 on New York, 07:02 on Tokyo. The one-hour cases are the dangerous
   ones: they look entirely plausible, so nobody questions them and they miss the
   train. The API already states Swiss local time in the string, so read it from
   there instead of converting. (Countdowns are untouched: minsUntil compares
   absolute instants, which is correct in any zone.) */
const ISO_LOCAL=/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/;
function hhmm(iso){
  const m=ISO_LOCAL.exec(iso||"");
  if(m) return m[1];
  const d=new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
}
/* If the phone is on another zone, say so once -- otherwise the header clock
   (device time) and every departure (Swiss time) disagree with no explanation. */
function tzNoteHTML(){
  try{
    const here=Intl.DateTimeFormat().resolvedOptions().timeZone||"";
    if(here==="Europe/Zurich") return "";
    const swiss=new Date().toLocaleString("en-GB",{timeZone:"Europe/Zurich",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).slice(-5);
    const local=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    if(swiss===local) return "";                      // same wall clock, no need to nag
    return `<div class="tznote">All times are Swiss local (${swiss} now) &#183; your device shows ${local}</div>`;
  }catch(e){ return ""; }
}
/* The datetime-local BOUNDARY, in ONE place. Every time this app SHOWS is Swiss
   (tzNoteHTML above says so out loud) and the API reads date=&time= as Swiss wall
   time -- so a value seeded INTO a time field has to be Swiss as well. It was the
   device wall clock: tap "dep" in Mumbai and the field read 18:30 while the
   planner asked for 18:30 SWISS, three and a half hours off; in Auckland it asked
   for the wrong DAY. Zurich agreed with itself, which is why it went unseen.
   MEASURED across six zones and four instants, incl. both DST offsets --
   tests/tz-input.mjs. Not to be confused with flightArriveBy's offset dance,
   which is wall-clock arithmetic on a string the user typed and is correctly
   zone-neutral; the note there says so, and the suite protects it. */
function swissLocal(ms){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Zurich",year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
function minsUntil(iso){ return Math.round((new Date(iso)-Date.now())/60000); }
/* The countdown slot, ONE definition -- depRow renders it and patchRow rewrites
   it every 30s, and two copies of this formula would drift apart. Past an hour
   it stays relative: printing the clock time here just repeated the time already
   shown beside it, which on a first-run-tomorrow board read as a duplicate. */
function depLabel(m){
  if(m<=0) return "now";
  if(m<60) return m+"&#8242;";
  if(m<1440) return Math.round(m/60)+"h";
  return Math.round(m/1440)+"d";
}
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms)}; }

/* category -> colour (SBB-ish) */
function catColor(cat){
  const c=(cat||"").toUpperCase();
  if(/^(IC|ICE|EC|TGV|RJ|EN)/.test(c)) return "var(--red)";
  if(/^(IR|RE|PE)/.test(c))            return "#c026d3";
  if(/^S/.test(c))                     return "var(--blue)";
  if(/^(R|RB)$/.test(c))               return "var(--teal)";
  if(/^(T|NF)/.test(c))                return "var(--amber)";
  if(/^(B|BUS|NB)/.test(c))            return "var(--grn)";
  return "var(--violet)";
}
/* scenic / panoramic trains the default SBB view buries: GoldenPass (PE30, PEGPX),
   Centovalli (PE72), Glacier Express (GEX), Bernina Express (BEX), Voralpen (VAE) */
function isScenic(cat){ return /^(PE|GPX|GEX|BEX|VAE)/.test((cat||"").toUpperCase()); }
function badge(cat,num){ const sc=isScenic(cat); const l=((sc?"&#9968; ":"")+(cat||"")+(num?" "+num:"")).trim()||"&#183;"; return {label:l, col:catColor(cat), scenic:sc}; }

/* What you will actually BOARD. The two-letter category is timetable jargon --
   "BAT 1" on a badge tells you nothing, "boat" tells you to expect a pier. Codes
   checked against the live API, not guessed: the SGV Vierwaldstaettersee sailings
   come back BAT, the Romanshorn-Friedrichshafen crossing FAE, and a real
   Ersatzverkehr on Luzern-Vitznau came back category EV, operator SBB-EV.
   Ordinary trains are deliberately absent: naming the unremarkable case would
   make the remarkable one invisible. */
const VEHICLE={BAT:"boat", FAE:"ferry", PB:"cable car", GB:"gondola",
               CC:"cog railway", FUN:"funicular", EV:"replacement bus"};
function vehicleOf(cat){ return VEHICLE[(cat||"").toUpperCase()]||null; }
/* Ersatzverkehr gets its own loud rib and names the STRETCH it replaces, because
   "there is a bus somewhere on this journey" is not actionable -- the bus leaves
   from a kerb, not your platform, and that is a different walk. A replaced leg
   whose endpoints are missing still gets the warning, unnamed: dropping the
   warning because the detail is absent is the worse failure. Nothing here says
   anything about your ticket. */
function vehicleRibs(secs){
  const ev=[], kinds=[];
  for(const s of secs||[]){
    const cat=((s&&s.journey&&s.journey.category)||"").toUpperCase();
    if(!VEHICLE[cat]) continue;
    if(cat==="EV"){
      const a=s.departure&&s.departure.station&&s.departure.station.name;
      const b=s.arrival&&s.arrival.station&&s.arrival.station.name;
      ev.push(a&&b ? esc(a)+" &#8594; "+esc(b) : "");
    } else if(!kinds.includes(VEHICLE[cat])) kinds.push(VEHICLE[cat]);
  }
  let h="";
  for(const leg of ev) h+=`<span class="rib evbus">&#9888; replacement bus${leg?" &#183; "+leg:""}</span>`;
  if(kinds.length) h+=`<span class="rib veh">${kinds.map(esc).join(" &#183; ")}</span>`;
  return h;
}

/* ---------- API ---------- */
async function api(path, signal){
  const r = await fetch(API+path, signal?{signal}:undefined);
  if(!r.ok) throw new Error("HTTP "+r.status);
  return r.json();
}
const locCache = new Map();
async function locations(q){
  if(locCache.has(q)) return locCache.get(q);
  const d = await api("/locations?type=station&query="+encodeURIComponent(q));
  const s = (d.stations||[]).filter(x=>x.name);
  locCache.set(q,s); return s;
}
/* coordinates-to-stop (cross-vendor finding #4, the cheap one): the API's
   /locations?x=&y= has answered "nearest stop to here" since day one -- unused
   until now. x is latitude, y longitude (their convention, same as coordinate
   objects). Real stops carry an id; addresses and POIs come back id:null and
   are dropped -- a street address is not somewhere a train stops. */
async function nearbyStops(lat,lon){
  const d = await api(`/locations?x=${lat.toFixed(6)}&y=${lon.toFixed(6)}`);
  return (d.stations||[]).filter(x=>x.id&&x.name)
    .sort((a,b)=>(a.distance??1e9)-(b.distance??1e9)).slice(0,5);
}

/* ---------- autocomplete ---------- */
function wireAC(inpId, acId, fieldId, onPick){
  const inp=$(inpId), ac=$(acId), field=$(fieldId);
  const run = debounce(async ()=>{
    const q=inp.value.trim();
    field.classList.toggle("has", q.length>0);
    if(q.length<2){ ac.classList.remove("show"); return; }
    try{
      const s=await locations(q);
      if(!s.length){ ac.classList.remove("show"); return; }
      ac.innerHTML = s.slice(0,7).map(x=>
        `<div data-n="${esc(x.name)}"><span>&#9906;</span><span>${esc(x.name)}</span></div>`).join("");
      ac.dataset.q=q;                  // which query these rows answer -- acEnter checks it
      ac.classList.add("show");
      [...ac.children].forEach(el=>el.onclick=()=>{
        inp.value=el.dataset.n; ac.classList.remove("show");
        field.classList.add("has"); onPick(el.dataset.n);
      });
    }catch(e){ ac.classList.remove("show"); }
  },300);
  inp.addEventListener("input", run);
  inp.addEventListener("focus", ()=>{ if(inp.value.trim().length>=2) run(); });
  document.addEventListener("click", e=>{ if(!field.contains(e.target)) ac.classList.remove("show"); });
}
/* Clearing the departures box used to empty only the TEXT: the board for the
   old station stayed on screen under an empty field -- reading as live
   departures for whatever you typed next -- and, worse, its 30-second poller
   kept running against a volunteer API for a station you had visibly removed.
   Clearing the field means you are done with that station, so the board and
   its timers go with it. */
function clearField(which){
  const map={dep:["iDep","fDep"],from:["iFrom","fFrom"],to:["iTo","fTo"],wan:["iWan","fWan"]};
  const [i,f]=map[which]; $(i).value=""; $(f).classList.remove("has"); $(i).focus();
  if(which==="wan"){
    wanName="";
    $("wanOut").innerHTML=`<div class="hint">Pick how much time you have. The app finds where a train
      leaving soon can take you &#8212; and only shows places it can prove you get back from
      in time, with the last way home printed on every card.</div>`;
  }
  if(which==="dep"){
    stopBoardTimers();
    current=""; lastBoard=[]; openDep="";
    save(LS.last,"");
    $("depOut").innerHTML=`<div class="empty"><div class="big">&#128647;</div>Search a station to see live departures.</div>`;
  }
}

/* ---------- near me ----------
   GPS on an explicit tap only. The app's no-GPS stance is about passive
   tracking; a one-shot position the passenger just asked for is the opposite
   of that. The pin lives where the passenger's question lives: the three
   "where am I" fields (board, journey origin, wander start) and deliberately
   NOT the destination -- you stand at From, you dream of To. Results reuse the
   autocomplete dropdown: same rows, same tap, distance appended, nothing new
   to learn. Every failure keeps its reason -- "denied", "no fix", "no stop
   near here" are three different situations asking three different next moves,
   and collapsing them to a shrug deletes the one fact that mattered. */
const NEAR_PICK={
  dep : n=>showDepartures(n),
  from: n=>{ fromName=n; if(toName) planJourney(); },
  wan : n=>{ wanName=n; if(wanBudget) runWander(); },
};
function nearMsg(ac,msg){
  ac.innerHTML=`<div class="nearmsg">${msg}</div>`;
  ac.classList.add("show");
}
function nearMe(which){
  const map={dep:["iDep","fDep","acDep"],from:["iFrom","fFrom","acFrom"],wan:["iWan","fWan","acWan"]};
  const ids=map[which]; if(!ids) return;
  const [iId,fId,acId]=ids, ac=$(acId);
  if(!navigator.geolocation){ nearMsg(ac,"No location service in this browser &#8212; type the station."); return; }
  nearMsg(ac,"Locating&#8230;");
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{
      const s=await nearbyStops(pos.coords.latitude,pos.coords.longitude);
      if(!s.length){ nearMsg(ac,"No stop near here."); return; }
      ac.innerHTML = s.map(x=>
        `<div data-n="${esc(x.name)}"><span>&#128205;</span><span>${esc(x.name)}</span>`
        + (x.distance!=null?`<span class="t">${Math.round(x.distance)}&#8201;m</span>`:"")
        + `</div>`).join("");
      ac.classList.add("show");
      [...ac.children].forEach(el=>el.onclick=()=>{
        const n=el.dataset.n;
        $(iId).value=n; ac.classList.remove("show");
        $(fId).classList.add("has");
        NEAR_PICK[which](n);
      });
    }catch(e){ nearMsg(ac,"Stop lookup failed ("+esc(e.message)+") &#8212; type the station."); }
  }, err=>{
    nearMsg(ac, err.code===1
      ? "Location permission denied &#8212; type the station."
      : "No location fix &#8212; type the station.");
  }, {timeout:8000, maximumAge:60000});
}

/* ---------- DEPARTURES ---------- */
/* A departure board left open in a background tab polled every 30s forever --
   roughly 2900 requests a day doing nothing for anybody. transport.opendata.ch
   is a volunteer service running on search.ch's goodwill, and the cheapest fix
   available to THEM is to block our origin wholesale, which would kill the app
   for every user at once. Per-user rate limits do not protect against that;
   only not making pointless requests does. So the board sleeps when nobody is
   looking, and wakes with an immediate fetch so it still feels instant. */
function startBoardTimers(name){
  stopBoardTimers();
  if(document.hidden) return;                  // never start while nobody is looking
  refreshTimer=setInterval(()=>loadBoard(name,true), 30000);
  tickTimer=setInterval(tickBoard, 1000);
}
function stopBoardTimers(){
  clearInterval(refreshTimer); clearInterval(tickTimer);
  refreshTimer=null; tickTimer=null;
}
async function showDepartures(name){
  if(!name) return;
  current=name; save(LS.last,name);
  $("iDep").value=name; $("fDep").classList.add("has");
  $("acDep").classList.remove("show");
  renderBoardHead(name);
  $("depOut").innerHTML = `<div id="bh"></div>` + skel(6);
  renderBoardHead(name);
  stopBoardTimers();
  await loadBoard(name);
  startBoardTimers(name);
}
async function loadBoard(name, quiet){
  const rf=$("rf"); if(rf) rf.classList.add("spin");
  try{
    const d=await api("/stationboard?limit=12&station="+encodeURIComponent(name));
    lastBoard = d.stationboard||[];
    const disp=d.station?.name||name;
    /* The first no-flicker attempt patched in place only when the board was
       byte-for-byte the same set in the same order, and fell back to a full
       innerHTML rewrite otherwise. But a departure board CHANGES -- a train
       leaves, every index shifts -- so the fallback was the normal case, and
       rewriting replays `animation:rise` on all twelve rows. The flicker was
       therefore worst exactly when the board was busiest. Reconcile by key
       instead: a train that is still listed keeps its node wherever it moved
       to, only genuinely new departures are created (so only they animate),
       and departed ones are removed. */
    const box=$("depOut"), head=box.querySelector(".boardhead");
    if(quiet && lastBoard.length && head){
      const spare=new Map([...box.querySelectorAll(".dep[data-key]")].map(el=>[el.dataset.key,el]));
      let prev=head;
      lastBoard.forEach((j,i)=>{
        const k=depKey(j);
        let row=spare.get(k);
        if(row){ spare.delete(k); patchRow(row,j); }
        else{
          const tmp=document.createElement("div");
          tmp.innerHTML=depRow(j,i);
          row=tmp.firstElementChild;
          row.style.animationDelay="0ms";   // one arriving row should not wait on the stagger
        }
        row.dataset.i=i;                    // indices shift as trains leave; the row must carry the current one
        if(prev.nextElementSibling!==row) prev.after(row);
        prev=row;
      });
      spare.forEach(el=>el.remove());       // departed
      restoreOpenDep();
    }else{
      const rows = lastBoard.map((j,i)=>depRow(j,i)).join("");
      $("depOut").innerHTML = boardHeadHTML(disp) +
        (rows || `<div class="empty"><div class="big">&#9788;</div>No departures right now.</div>`);
      wireBoardHead(disp);
      restoreOpenDep();
    }
  }catch(e){
    if(!quiet) $("depOut").innerHTML = boardHeadHTML(name) +
      `<div class="err">Couldn&#39;t reach the network.<br>Check your connection and tap &#8635;.</div>`;
    wireBoardHead(name);
  }finally{ const r=$("rf"); if(r) r.classList.remove("spin"); }
}
/* one sentence per row for a screen reader. The visual row is five separate
   fragments (badge, destination, platform, delay, countdown) that read as a
   wall of text with no row boundaries -- this is the row boundary. */
function depAria(j){
  const b=badge(j.category, j.number||j.line);
  const dep=j.stop?.departure, prog=j.stop?.prognosis?.departure;
  const d = prog && dep ? Math.round((new Date(prog)-new Date(dep))/60000) : 0;
  const pl=j.stop?.platform;
  const plChanged=j.stop?.prognosis?.platform && j.stop.prognosis.platform!==pl;
  const effPl=j.stop?.prognosis?.platform||pl;
  const m=minsUntil(prog||dep);
  const parts=[`${b.label} to ${j.to||"unknown destination"}`];
  if(dep) parts.push(hhmm(dep) + (d>=1?` plus ${d} minutes`:""));
  if(effPl) parts.push(`platform ${effPl}`+(plChanged?" changed":""));
  if(m>0) parts.push(`in ${m} minutes`); else if(m===0) parts.push("leaving now");
  return parts.join(", ");
}
/* the one polite live region: silence is the default, material changes speak */
function announce(msg){
  const a=$("annc"); if(!a) return;
  if(a.textContent===msg) a.textContent="";
  a.textContent=msg;
}
function depRow(j,i){
  const b=badge(j.category, j.number||j.line);
  const dep=j.stop?.departure;
  const prog=j.stop?.prognosis?.departure;
  const late = prog && dep && (new Date(prog)-new Date(dep))>=60000;
  const eff = prog || dep;
  const m=minsUntil(eff);
  const mlabel = depLabel(m);
  const pl = j.stop?.platform;
  const plChanged = j.stop?.prognosis?.platform && j.stop.prognosis.platform!==pl;
  const effPl = j.stop?.prognosis?.platform || pl;
  return `<div class="dep" role="listitem" aria-label="${esc(depAria(j))}" data-key="${esc(depKey(j))}" data-i="${i}" style="animation-delay:${i*28}ms">
    <div class="badge" style="background:${b.col}">${b.label}</div>
    <div class="mid">
      <div class="to"><button class="togo" type="button" onclick="planFromBoard(event)"
        title="Plan a journey to ${esc(j.to||"")}">${esc(j.to||"&#8212;")}</button></div>
      <div class="via">${effPl?`<span class="plat${plChanged?" chg":""}">Pl. ${esc(effPl)}${plChanged?" &#9888;":""}</span> `:""}${esc(j.category||"")} ${esc(j.operator||"")}</div>
    </div>
    <div class="rt">
      <div class="min ${m<=2?"now":""}" data-t="${eff}">${mlabel}</div>
      <div class="at">${hhmm(dep)}${late?` <span class="late">+${Math.round((new Date(prog)-new Date(dep))/60000)}</span>`:""}</div>
    </div>
    <div class="dstops"></div>
  </div>`;
}

/* ---------- tapping a departure ----------
   The rows LOOK tappable and people tap them, so they answer the question a
   departure board actually raises: "where does this train go?" The onward route
   is already in the /stationboard response (journey.passList) -- no extra call.
   Two distinct targets so one tap is never ambiguous:
     row           -> expand this train's onward stops
     destination   -> plan a journey there, departing at this train's time      */
function onwardStops(i){
  const j=lastBoard[i]; if(!j) return null;
  const pl=j.passList;
  if(!Array.isArray(pl)) return null;
  // same filter as the journey-leg version: routing markers carry no time
  const rows=pl.filter(p=>p.station?.name && (p.arrival||p.departure));
  // first entry is the station you are standing at -- the interesting part is onward.
  // It is also the malformed row described in legStops(): origin time, terminus id.
  // Two independent guards drop it here (the name filter above, then this slice);
  // that redundancy is deliberate, not leftover.
  return rows.length>1 ? rows.slice(1) : [];
}
function onwardHTML(rows){
  if(rows===null) return `<div class="snone">Route unavailable for this train.</div>`;
  if(!rows.length) return `<div class="snone">No onward stops listed.</div>`;
  return rows.map((p,k)=>{
    const last=k===rows.length-1, t=p.arrival||p.departure;
    return `<div class="sline ${last?"end":""}"><span class="st">${hhmm(t)}</span>`
      + `<span class="sdot"></span><span class="sname">${esc(p.station.name)}</span>`
      + (p.platform?`<span class="splt">Pl.&#8201;${esc(p.platform)}</span>`:"")+`</div>`;
  }).join("");
}
function toggleDeparture(row){
  const panel=row.querySelector(".dstops"); if(!panel) return;
  const open=panel.dataset.open==="1";
  panel.dataset.open=open?"":"1";
  panel.innerHTML=open?"":onwardHTML(onwardStops(+row.dataset.i));
  row.classList.toggle("open",!open);
  row.setAttribute("aria-expanded", String(!open));
  // remember WHICH departure is open, by its stable key -- a busy station shifts
  // its set every refresh, which rebuilds the board and would otherwise silently
  // throw the expansion away mid-read.
  openDep = open ? "" : (row.dataset.key||"");
}
function restoreOpenDep(){
  if(!openDep) return;
  const row=[...document.querySelectorAll(".dep[data-key]")].find(r=>r.dataset.key===openDep);
  if(!row){ openDep=""; return; }                 // that train has departed
  const panel=row.querySelector(".dstops"); if(!panel) return;
  panel.dataset.open="1";
  panel.innerHTML=onwardHTML(onwardStops(+row.dataset.i));
  row.classList.add("open");
}
/* destination name -> Journey tab, prefilled, timed to THIS train */
/* The index is read off the row at tap time, never baked into the handler: rows
   are now reused across refreshes, so a number frozen at render time would point to
   whichever train later took that slot -- and planning a journey on the wrong
   train is the kind of wrong answer you would not catch until the platform. */
function planFromBoard(ev){
  ev.stopPropagation();                       // never also toggle the row
  const i=+(ev.target.closest(".dep[data-i]")?.dataset.i ?? -1);
  const j=lastBoard[i]; if(!j||!j.to) return;
  fromName=current; toName=j.to;
  $("iFrom").value=fromName; $("iTo").value=toName;
  $("fFrom").classList.add("has"); $("fTo").classList.add("has");
  const dep=j.stop?.departure, at=$("whenAt");
  setTab("jrn");
  /* Seed the time BEFORE the mode switch. setWhen() replans as its last act, so
     setting at.value afterwards planned the PREVIOUS train, and the follow-up
     planJourney() was swallowed by the in-flight guard, leaving the wrong
     result standing. It looked correct -- right stations, plausible times -- which
     is why it survived. The order is the entire fix. (That guard dropped a second
     user action later and is gone now: smartPlan supersedes instead of refusing.
     The ordering here still matters -- two sweeps for one tap is waste.) */
  if(dep && at && typeof setWhen==="function"){
    at.value=dep.slice(0,16); whenValue=at.value;
    setWhen("dep");                           // replans, now timed to THIS train
  }else{
    planJourney();
  }
  scrollTo({top:0,behavior:"smooth"});
}
document.addEventListener("click",e=>{
  const row=e.target.closest(".dep[data-i]");
  if(!row) return;
  // the expansion lives INSIDE the row, so a naive row-click handler swallows
  // every interaction with it: you open a train's route, reach in to read a
  // stop, and the row slams shut. Clicks inside the panel are inert; only the
  // row's own surface toggles. (.togo has its own job: plan the journey.)
  if(e.target.closest(".togo") || e.target.closest(".dstops")) return;
  toggleDeparture(row);
});
function tickSketches(){
  document.querySelectorAll('.sketch[data-open="1"]').forEach(panel=>{
    const card=panel.closest(".conn"); if(!card) return;
    const btn=card.querySelector(".skbtn"); if(!btn) return;
    const ci=+(btn.getAttribute("onclick")||"").match(/,(\d+)\)/)?.[1];
    if(!isFinite(ci)) return;
    const svg=panel.querySelector("svg"); if(!svg) return;
    const fresh=document.createElement("div"); fresh.innerHTML=sketchSVG(ci);
    const n=fresh.querySelector("svg"); if(n) svg.replaceWith(n);
  });
}
function tickBoard(){
  document.querySelectorAll(".dep .min[data-t]").forEach(el=>{
    const m=minsUntil(el.dataset.t);
    el.innerHTML = depLabel(m);   // the ONE definition -- this used to re-implement it and win, every second
    el.classList.toggle("now", m<=2);
  });
}
// stable identity for a departure = journey name + scheduled departure (immune to delay/platform churn)
function depKey(j){ return (j.name||((j.category||"")+(j.number||j.line||"")))+"|"+(j.stop?.departure||""); }
/* Read prognosis.DEPARTURE and prognosis.PLATFORM here and nothing else.
   prognosis.arrival at an origin stop is poisoned upstream: on the Aarau board
   (measured 2026-07-27) three different trains leaving 15:58 / 16:01 / 16:08 all
   reported prognosis.arrival = 15:46:27 -- one identical PAST timestamp, at a stop
   whose scheduled arrival is null. It is inert today because nothing reads it; the
   moment someone adds "expected arrival" to this board it becomes a live lie. */
// patch one existing row's mutable fields in place — no node recreation, so no flicker/re-animation
function patchRow(row, j){
  const dep=j.stop?.departure, prog=j.stop?.prognosis?.departure;
  const late = prog && dep && (new Date(prog)-new Date(dep))>=60000;
  const eff = prog || dep;
  const m=minsUntil(eff);
  const pl=j.stop?.platform, plChanged=j.stop?.prognosis?.platform && j.stop.prognosis.platform!==pl;
  const effPl=j.stop?.prognosis?.platform||pl;
  const min=row.querySelector(".min");
  if(min){ min.dataset.t=eff; min.innerHTML = depLabel(m); min.classList.toggle("now", m<=2); }
  const at=row.querySelector(".at");
  if(at) at.innerHTML = `${hhmm(dep)}${late?` <span class="late">+${Math.round((new Date(prog)-new Date(dep))/60000)}</span>`:""}`;
  const via=row.querySelector(".via");
  if(via) via.innerHTML = `${effPl?`<span class="plat${plChanged?" chg":""}">Pl. ${esc(effPl)}${plChanged?" &#9888;":""}</span> `:""}${esc(j.category||"")} ${esc(j.operator||"")}`;
  /* the label must follow the row it describes -- and the ONLY two transitions
     worth speaking are a platform change and a delay appearing. The every-30s
     countdown churn stays silent, or the live region shouts over the user. */
  const before=row.getAttribute("aria-label")||"";
  row.setAttribute("aria-label", depAria(j));
  const who=`${badge(j.category, j.number||j.line).label} to ${j.to||""}`;
  if(plChanged && !/ changed/.test(before)) announce(`${who} now departs platform ${effPl}`);
  else if(late && !/ plus \d+ minutes/.test(before)) announce(`${who} is running ${Math.round((new Date(prog)-new Date(dep))/60000)} minutes late`);
}
function boardHeadHTML(name){
  const on=favs.includes(name);
  return `<div class="boardhead">
    <h2>${esc(name)}</h2>
    <button class="rf" id="rf" type="button" title="refresh" aria-label="Refresh departures">&#8635;</button>
    <button class="ngt" id="ngt" type="button" title="What still leaves tonight" aria-label="What still moves from here tonight">&#127769;</button>
    <button class="star ${on?"on":""}" id="fav" type="button" title="favourite" aria-pressed="${on}" aria-label="${on?"Remove from favourites":"Add to favourites"}">${on?"&#9733;":"&#9734;"}</button>
  </div>`;
}
function renderBoardHead(){ /* placeholder kept for flow */ }
function wireBoardHead(name){
  const fav=$("fav"); if(fav) fav.onclick=()=>toggleFav(name);
  const rf=$("rf"); if(rf) rf.onclick=()=>loadBoard(name);
  const n=$("ngt"); if(n) n.onclick=()=>strandedBoard(name);
}

/* ---------- stranded-now board ----------
   "Last connection missed -- what still moves from here tonight?" The night-
   stranding cluster, distinct from replanning: there may be NO route left, and
   saying so honestly is the feature. One stationboard fetch, grouped by
   line+direction, each group reduced to its LAST run of the night, sorted by
   which option expires first. */
function nightCutoff(nowMs){
  // "tonight" ends at 04:30 local -- a 06:00 train is tomorrow, not a rescue
  const c=new Date(nowMs); c.setHours(4,30,0,0);
  if(c.getTime()<=nowMs) c.setDate(c.getDate()+1);
  return c.getTime();
}
function tonightGroups(board, nowMs){
  const cut=nightCutoff(nowMs);
  const g=new Map();
  for(const j of board||[]){
    const dep=j.stop?.prognosis?.departure || j.stop?.departure;
    const t=dep?new Date(dep).getTime():NaN;
    if(!isFinite(t) || t<nowMs-60000 || t>cut) continue;
    const line=((j.category||"")+" "+(j.number||j.line||"")).trim();
    const key=line+"|"+(j.to||"");
    const cur=g.get(key);
    if(!cur || t>cur.t) g.set(key,{line, to:j.to||"", dep, t});
  }
  // soonest-expiring first: the order in which the options die
  return [...g.values()].sort((a,b)=>a.t-b.t);
}
function nightWrap(name, inner){
  return `<div class="night"><div class="nhead"><span class="ntitle">&#127769; Still moving tonight &#8212; ${esc(shortStop(name))}</span>`
    + `<button class="nx" type="button" aria-label="Close" onclick="closeNight()">&#10005;</button></div>${inner}</div>`;
}
function closeNight(){ const b=$("strandedOut"); if(b) b.innerHTML=""; }
async function strandedBoard(name){
  const box=$("strandedOut"); if(!box||!name) return;
  box.innerHTML=nightWrap(name, `<div class="ncav">checking what still moves&#8230;</div>`);
  try{
    const LIM=100;
    const d=await api(`/stationboard?limit=${LIM}&station=${encodeURIComponent(name)}`);
    const board=d.stationboard||[];
    const disp=d.station?.name||name;
    const now=Date.now();
    const rows=tonightGroups(board, now);
    if(!rows.length){
      /* the honest verdict IS the feature: an empty night board is a finding */
      box.innerHTML=nightWrap(disp,
        `<div class="nnone">&#9888; Nothing moves from here tonight anymore.</div>`
        + `<div class="ncav">Night buses and taxis outside this timetable may still run; the first morning train is not shown here.</div>`);
      return;
    }
    /* If we got a FULL page and its horizon still lies inside tonight, later
       departures can exist beyond what we fetched -- then "last tonight" would
       be a claim the data cannot carry. Downgrade the label, say the horizon. */
    let maxT=-1, maxISO=null;
    for(const j of board){ const s=j.stop?.departure; const t=s?new Date(s).getTime():NaN;
      if(isFinite(t)&&t>maxT){ maxT=t; maxISO=s; } }
    const trunc = board.length>=LIM && maxT<nightCutoff(now);
    const tag = trunc ? "last we can see" : "last tonight";
    box.innerHTML=nightWrap(disp,
      rows.map(r=>`<div class="nrow"><b>${hhmm(r.dep)}</b> <span class="nline">${esc(r.line)}</span> &#8594; ${esc(shortStop(r.to))}<span class="nlast">${tag}</span></div>`).join("")
      + (trunc?`<div class="ncav">The timetable window we could fetch ends at ${hhmm(maxISO)} &#8212; later departures may exist beyond it.</div>`:"")
      + `<div class="ncav">Times are the timetable&#8217;s word, cancellations included where it knows them &#8212; on a broken night, confirm on the platform display too.</div>`);
  }catch(e){
    box.innerHTML=nightWrap(name,
      `<div class="ncav">Could not check (${esc(e&&e.message||"no answer")}) &#8212; an outage, not a &quot;no&quot;. Tap &#127769; to retry.</div>`);
  }
}
function toggleFav(name){
  const i=favs.indexOf(name);
  if(i<0) favs.unshift(name); else favs.splice(i,1);
  favs=favs.slice(0,12); save(LS.favs,favs);
  applyTheme(load(LS.theme,"dark"));
renderFavs(); renderModes(); renderRoutes(); const f=$("fav"); if(f){ const on=favs.includes(name); f.className="star "+(on?"on":""); f.innerHTML=on?"&#9733;":"&#9734;"; }
}
function renderFavs(){
  const el=$("favs");
  if(!favs.length){ el.innerHTML=`<span class="chip" style="color:var(--faint);border-style:dashed" onclick="$('iDep').focus()">&#9734; Star stations for one-tap access</span>`; return; }
  // The name travels in a data attribute, not spliced into the handler string:
  // esc() does not escape an apostrophe, and a station name carrying a quote could
  // break straight out of the onclick. This was the only unescaped API text on the page.
  el.innerHTML = favs.map(n=>`<button class="chip star" data-n="${esc(n)}" onclick="showDepartures(this.dataset.n)">&#9733; ${esc(n)}</button>`).join("");
}
function skel(n){ return Array(n).fill('<div class="skel"></div>').join(""); }

/* ---------- JOURNEY ---------- */
let fromName="", toName="";
function swap(){
  [fromName,toName]=[toName,fromName];
  $("iFrom").value=fromName; $("iTo").value=toName;
  $("fFrom").classList.toggle("has",!!fromName); $("fTo").classList.toggle("has",!!toName);
  if(fromName&&toName) planJourney();
}
function parseDur(s){ // "00d00:56:00"
  const m=/(\d+)d(\d+):(\d+):/.exec(s||""); if(!m) return s||"";
  const d=+m[1], h=+m[2], mi=+m[3]; const tot=d*1440+h*60+mi;
  return tot>=60 ? `${Math.floor(tot/60)}h ${tot%60}m` : `${tot}m`;
}
/* the killer feature: SBB's default list often hides better routes that a
   manual "what if I change at X" search finds, and buries a scary-tight
   transfer in its #1 pick. Smart mode sweeps a set of interchange hubs via[],
   widens the direct scan, computes real per-change buffers, and surfaces the
   options SBB didn't lead with — flagging tight changes and roomier picks. */
let smart = true;
const HUBS = ["Z\u00fcrich HB","Bern","Basel SBB","Luzern","Olten","Arth-Goldau","Lausanne","Biel/Bienne","Z\u00fcrich Flughafen","Winterthur"];
const TIGHT = 5;   // minutes: a change below this is a sprint
const COMFY = 8;   // minutes: at/above this a change is relaxed
const SAFER_LATER = 10;  // a roomier option up to this many min slower still counts as "safer"
const WINDOW_MIN = 25;   // drop absurd detours arriving >this many min past the fastest
// scenic-gateway hubs — swept only when "prefer scenic" is on, to fetch panoramic
// change-routes the default search never returns: Zweisimmen (GoldenPass),
// Andermatt/Brig (Glacier Express), Chur (Bernina Express)
const SCENIC_HUBS = ["Zweisimmen","Andermatt","Chur","Brig"];

let preferScenic = false;   // keep + float panoramic routes even when slower
function onSmartToggle(){
  smart = $("smartTog").checked;
  if(fromName&&toName) planJourney();
}
function onScenicToggle(){
  preferScenic = $("scenicTog").checked;
  if(fromName&&toName) planJourney();
}
let weather = false;   // show arrival-time forecast at the destination (Open-Meteo)
function onWeatherToggle(){
  weather = $("wxTog").checked;
  if(fromName&&toName) planJourney();
}
/* ---------- when to travel: now / leave at / arrive by ----------
   The planner used to answer only "from now". Two things this adds:
   jumping straight to a time (instead of paging through later trains), and
   ARRIVE-BY -- "I must be there by 09:00, what do I catch?" -- which the app
   could not express at all. Both ride the same API params: date/time, plus
   isArrivalTime=1. Empty string = now, so the default path is unchanged.     */
let whenMode = "now";        // now | dep | arr
let whenValue = "";          // datetime-local value, e.g. "2026-07-24T09:00"

function whenQS(){
  if(whenMode === "now" || !whenValue) return "";
  const [d,t] = whenValue.split("T");
  return `&date=${d}&time=${t}` + (whenMode === "arr" ? "&isArrivalTime=1" : "");
}
/* Sun times ride the SAME cached weather request -- open-meteo returns them in
   the station's own zone, so they are read from the string exactly like every
   other time in this app. */
function sunFor(daily, iso){
  if(!daily||!Array.isArray(daily.time)||!iso) return null;
  const day=iso.slice(0,10);
  const i=daily.time.indexOf(day);
  if(i<0) return null;
  return {rise:(daily.sunrise?.[i]||"").slice(11,16), set:(daily.sunset?.[i]||"").slice(11,16)};
}
/* Both ends of the day, one function. "Get me there before the sun goes down" and
   "have me up there when it comes up" are the same ARRIVE-BY question with a
   different target, and the user should not have to compute either. Needs a
   destination first -- there is no sunrise or sunset without a place.
   The two differ in ONE way worth naming: today's sunset is usually still ahead
   of you, today's sunrise usually is not, so the roll-to-tomorrow path below is
   the exception for one and the normal case for the other. */
const SUN_WORDS={
  set : {word:"sunset",  emoji:"&#127751;", past:"already set",   plan:"planning to arrive before it"},
  rise: {word:"sunrise", emoji:"&#127749;", past:"already risen", plan:"planning to be there for it"},
};
async function setWhenSun(which){
  const W=SUN_WORDS[which]; if(!W) return;
  /* Every dead end here says what happened. A tap that silently does nothing
     reads as a broken button, and the user cannot tell "the forecast does not
     reach that far" apart from "the app is stuck". */
  const say=m=>{ const s=$("sunHint"); if(s) s.innerHTML=m; };
  const btnId = which==="rise" ? "segRise" : "segSun";
  if(!toName){ $("jrnOut").innerHTML=`<div class="hint">Pick a destination first &#8212; ${W.word} depends on where you are going.</div>`; return; }
  const btn=$(btnId); if(btn) btn.classList.add("busy");
  try{
    say("");
    const probe = jrnConns[0]?.to?.station?.coordinate
      || (await locations(toName).catch(()=>[]))[0]?.coordinate;
    if(!probe||!probe.x){ say(`Could not place ${esc(shortStop(toName))} on the map, so there is no ${W.word} to look up.`); return; }
    const wx=await destWeather(probe.x, probe.y);
    const days=(wx && wx.daily && Array.isArray(wx.daily.time)) ? wx.daily.time : [];
    if(!days.length){ say(`The forecast service did not answer, so ${W.word} is unknown right now.`); return; }
    /* ONE day, decided once. Reading the time off one day and stamping it onto
       another is how a trip planned for next Saturday silently became tonight.
       Open-Meteo runs timezone=auto, so days[0] is today AT THE DESTINATION --
       more correct than the phone's own date near midnight. */
    let want=(whenValue||"").slice(0,10) || days[0];
    if(!days.includes(want)){
      say(`${W.word[0].toUpperCase()+W.word.slice(1)} is only known ${days.length} day${days.length>1?"s":""} ahead, not for <b>${esc(want)}</b>. `
        + `Pick a nearer day, or set the arrival time yourself.`);
      return;
    }
    let sun=sunFor(wx.daily, want);
    if(!sun||!sun[which]){ say(`No ${W.word} time came back for ${esc(shortStop(toName))} on ${esc(want)}.`); return; }
    // Tapping this at nine in the evening -- or asking for sunrise at any hour
    // after it -- must not request an arrival that is already behind us; roll to
    // the next day the forecast actually covers.
    let rolled=false;
    if(!whenValue){
      const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
      if(`${want}T${sun[which]}` <= now){
        const nxt=days[days.indexOf(want)+1], nsun=nxt?sunFor(wx.daily,nxt):null;
        if(nsun&&nsun[which]){ want=nxt; sun=nsun; rolled=true; }
        else { say(`The sun has ${W.past} at ${esc(shortStop(toName))} today, and tomorrow is beyond the forecast.`); return; }
      }
    }
    whenMode="arr";
    const onSeg = which==="rise" ? "rise" : "sun";
    ["now","dep","arr","sun","rise"].forEach(m=>{const b=$("seg"+m[0].toUpperCase()+m.slice(1)); if(b) b.classList.toggle("on", m===onSeg);});
    const at=$("whenAt"), clr=$("whenClear");
    at.hidden=false; clr.hidden=false;
    at.value=`${want}T${sun[which]}`; whenValue=at.value;
    sunTarget={word:W.word, time:sun[which]};
    say(`${W.emoji} ${W.word} at ${esc(shortStop(toName))} is <b>${sun[which]}</b>`
      + (rolled?` tomorrow`:``) + ` &#183; ${W.plan}`);
    if(fromName) planJourney();
  } finally { const b=$(btnId); if(b) b.classList.remove("busy"); }
}
function setWhen(mode){
  whenMode = mode;
  // the explanation must not outlive the request that caused it
  { sunTarget=null; const s=$("sunHint"); if(s) s.innerHTML="";
    ["segSun","segRise"].forEach(id=>{ const b=$(id); if(b) b.classList.remove("on"); });
    flightOff(); }
  const at=$("whenAt"), clr=$("whenClear");
  ["now","dep","arr"].forEach(m=>$("seg"+m[0].toUpperCase()+m.slice(1)).classList.toggle("on", m===mode));
  if(mode === "now"){
    at.hidden = true; clr.hidden = true; whenValue = "";
    if(fromName && toName) planJourney();
    return;
  }
  at.hidden = false; clr.hidden = false;
  if(!at.value){                       // seed with the next round half-hour, SWISS time
    const s=swissLocal(Date.now()+30*60000);
    at.value = s.slice(0,14) + (+s.slice(14)>=30 ? "30" : "00");
  }
  whenValue = at.value;
  if(fromName && toName) planJourney();
}
function onWhenChange(){
  whenValue = $("whenAt").value;
  sunTarget=null;   // hand-edited: whatever the sun said, this is the user's time now
  flightOff();      // ...and the flight the time was derived from is no longer the reason
  if(whenValue && fromName && toName) planJourney();
}

/* ---------- walking the timetable: earlier / later ----------
   Every answer this app has ever given was ONE window -- whatever came back
   around the time you asked for. If the trains shown were all too early, the
   only move was to retype the time. This walks the window instead.

   Three rules keep it from inventing a page:

   (1) A step is a REAL REQUEST, never a re-slice. It moves the same anchor the
       user could have typed by hand and re-runs the whole search -- so the via,
       the train-category filter and the mode filter travel with it for free. A
       page that quietly dropped the via would be the invisible constraint the
       via feature exists to prevent, one screen further along.
   (2) The anchor stays VISIBLE. Stepping flips the when-control to "Leave at"
       and writes the time into it. A results list that walked itself while the
       control still read "now" would be lying about what was asked.
   (3) A step that did not move is SAID, not rendered as a fresh page. Ask the
       timetable for something before the first train of the day and it hands
       back the same trains; showing them again as "earlier" would be absence of
       data dressed as data. So the two ends are detected and named.

   The list REPLACES rather than appends, deliberately: appending would stack a
   page fetched five minutes ago above a fresh one, both wearing the same live
   delay styling, and nothing on screen would say which prognosis was stale. */
const PG_MIN = 30;            // minutes -- the smallest backward step
let pgAsked   = "";           // "earlier"|"later" while a step is in flight; read once
let pgWas     = 0;            // the anchor-side time of the list we stepped away from
let pgStuck   = "";           // "earlier"|"later" -- that direction returned nothing new
let pgPrev    = null;         // the exact anchor we left, so the way back is exact

// SCHEDULED times, not prognosis: the API's time= filter is scheduled, so
// anchoring on a delayed departure would step past a train that is still listed
// at its booked minute.
function pgDep(c){ return c && c.from && c.from.departure ? new Date(c.from.departure).getTime() : 0; }
function pgArr(c){ return c && c.to   && c.to.arrival     ? new Date(c.to.arrival).getTime()     : 0; }
// Arrive-by is a different question, so it is walked on its own axis: "arrive by
// 09:00" steps to "arrive by 08:00", it does not silently become a departure.
function pgOf(c){ return whenMode === "arr" ? pgArr(c) : pgDep(c); }
function pgTimes(list){ return (list||[]).map(pgOf).filter(t=>t>0).sort((a,b)=>a-b); }
function pgLocal(ms){ return swissLocal(ms); }

function pgStep(dir){
  const ts = pgTimes(jrnConns);
  if(!ts.length || !fromName || !toName) return;
  // step back by the width of what you are looking at -- a list spanning 40
  // minutes steps 40 minutes -- so the window adapts to how busy the route is
  const span = Math.max(ts[ts.length-1] - ts[0], PG_MIN*60000);
  const anchor = dir === "later" ? ts[ts.length-1] + 60000 : ts[0] - span;
  pgAsked = dir;
  pgWas   = dir === "later" ? ts[ts.length-1] : ts[0];
  pgStuck = "";
  pgPrev  = { mode: whenMode, value: whenValue };
  pgApply(whenMode === "arr" ? "arr" : "dep", pgLocal(anchor));
}
function pgBack(){
  if(!pgPrev) return;
  const p = pgPrev; pgPrev = null; pgStuck = ""; pgAsked = "";
  pgApply(p.mode, p.value);
}
// rule (2): the control the user reads must agree with the query we sent
function pgApply(mode, value){
  whenMode = mode; whenValue = value;
  const at=$("whenAt"), clr=$("whenClear");
  if(at){ at.value = value; at.hidden = (mode === "now"); }
  if(clr) clr.hidden = (mode === "now");
  ["now","dep","arr"].forEach(m=>{
    const b=$("seg"+m[0].toUpperCase()+m.slice(1)); if(b) b.classList.toggle("on", m===mode);
  });
  planJourney();
}
/* rule (3). Called with the settled list on EVERY search, not only paged ones:
   a search the user started some other way clears the exhausted mark, because
   "nothing earlier" was a fact about one anchor and one route, not a state. */
function pgObserve(list){
  const dir = pgAsked; pgAsked = "";
  if(!dir){ pgStuck = ""; return; }
  const ts = pgTimes(list);
  if(!ts.length){ pgStuck = dir; return; }            // the step ran off the end of the day
  pgStuck = (dir === "later" ? ts[ts.length-1] > pgWas : ts[0] < pgWas) ? "" : dir;
}
function pgBarHTML(){
  if(!jrnConns.length) return "";
  const w = whenMode === "arr" ? "arriving" : "departing";
  const btn = (d, glyph, lbl) =>
    `<button type="button" class="pg" onclick="pgStep('${d}')" aria-label="${lbl}"`
    + (pgStuck===d ? " disabled" : "") + `>${glyph}</button>`;
  return `<div class="pager">${btn("earlier","&#9650;","Earlier connections, "+w+" sooner")}`
    + `${btn("later","&#9660;","Later connections, "+w+" later")}</div>`;
}
function pgNote(){
  if(!pgStuck) return "";
  return `<div class="pgnote">Nothing ${pgStuck} came back for this route &#8212; this looks like the `
    + `${pgStuck==="earlier"?"first":"last"} service of the day.</div>`;
}
// the empty branch's version: it also carries the way back, since a step that
// lands on nothing must not strand you with no list to step from
function pgWhyEmpty(){
  if(!pgStuck || !pgPrev) return "";
  return `<div class="emptywhy">You stepped ${pgStuck} and the timetable returned nothing, `
    + `so this looks like the ${pgStuck==="earlier"?"start":"end"} of the service day for this route. `
    + `<button type="button" class="linkish" onclick="pgBack()">Back to ${esc(String(pgPrev.value).slice(11,16)||"where you were")}</button></div>`;
}

/* ---------- T13: airport / flight mode ----------
   "Be at the airport by HH:MM" is an ARRIVE-BY question the app can already
   answer. The dangerous half is the number you subtract.

   THE APP DOES NOT KNOW HOW EARLY YOUR AIRLINE WANTS YOU. Check-in deadlines,
   bag-drop cutoffs, passport queues and the walk from the platform to the desk
   are not in any timetable, they differ per airline, airport, destination and
   day, and they change. A confident built-in "be there two hours before" would
   be this app inventing an airline's policy -- and the one feature capable of
   making someone miss a flight.

   So the buffer is NEVER invented: flightBuf starts null and STAYS null until
   you tap a number. Until then no arrive-by time is set and nothing is planned.
   Your choice is remembered afterwards, because it is yours -- not ours. The
   caveat sits under the numbers permanently, not once at first use. */
const FLIGHT_BUFS = [60, 90, 120, 150, 180, 210];
let flightAt = "";                       // datetime-local of the flight itself
let flightBuf = load(LS.flightbuf, null); // MINUTES. null = the user has not said. Never defaulted.

function looksLikeAirport(n){ return /flughafen|a[eé]roport|aeroporto|airport/i.test(n||""); }
function bufWords(m){
  const h=Math.floor(m/60), r=m%60;
  return (h?`${h} h`:"") + (h&&r?" ":"") + (r?`${r} min`:"");
}
function flightArriveBy(at, buf){
  if(!at || buf==null) return "";
  // Shape-check BEFORE parsing. new Date() is not a validator: it happily read
  // "not-a-date:00" as 1999-12-31T22:00 -- a garbage input rendered as a
  // confident departure time, which is the one thing this feature must not do.
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(at)) return "";
  const d=new Date(at.length<=16 ? at+":00" : at);
  if(isNaN(d)) return "";
  return new Date(d.getTime()-buf*60000-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function flightOff(){
  flightAt="";
  const p=$("fltPanel"); if(p) p.hidden=true;
  const b=$("segFlt");   if(b) b.classList.remove("on");
}
function setWhenFlight(){
  const p=$("fltPanel"); if(!p) return;
  sunTarget=null; { const s=$("sunHint"); if(s) s.innerHTML=""; }
  ["segNow","segDep","segArr","segSun","segRise"].forEach(id=>{const b=$(id); if(b) b.classList.remove("on");});
  const b=$("segFlt"); if(b) b.classList.add("on");
  p.hidden=false;
  const fi=$("fltAt");
  if(fi && !fi.value){                    // seed the FLIGHT time, not the arrival
    fi.value=swissLocal(Date.now()+4*3600000).slice(0,14)+"00";
  }
  flightAt = fi ? fi.value : "";
  renderFlight();
}
function onFlightAt(){ flightAt=$("fltAt").value; renderFlight(); }
/* Radio-like on purpose: there is no un-choose. A revoked buffer would leave an
   arrive-by time on screen that was derived from a rule the user just withdrew
   -- a stale derived value, which is the same defect as an invented one. */
function setFlightBuf(m){
  flightBuf = m;
  save(LS.flightbuf, flightBuf);
  renderFlight();
}
function renderFlight(){
  const out=$("fltHint"); if(!out) return;
  const chips=FLIGHT_BUFS.map(m=>
    `<button type="button" class="chip fltbuf${flightBuf===m?" on":""}" onclick="setFlightBuf(${m})">${bufWords(m)}</button>`).join("");
  const airportNote = toName && !looksLikeAirport(toName)
    ? `<div class="fltwarn">&#9888; <b>${esc(shortStop(toName))}</b> does not look like an airport station to us. If your airport has no railway station of its own, this is planning you to the wrong place &#8212; check how you cover the last stretch.</div>`
    : "";
  if(flightBuf==null){
    out.innerHTML = `<div class="fltrow"><span class="fltq">How early do you want to be at the airport?</span></div>`
      + `<div class="fltchips">${chips}</div>`
      + `<div class="fltcav">We are not picking this for you. The app knows trains; it does not know your airline&#8217;s check-in deadline, your bag drop, the queue at security, or the walk from the platform to the desk. Nothing is planned until you choose &#8212; and the deadline printed on your booking beats whatever you choose here.</div>`
      + airportNote;
    return;
  }
  const arr=flightArriveBy(flightAt, flightBuf);
  out.innerHTML = `<div class="fltrow"><span class="fltq">How early do you want to be at the airport?</span></div>`
    + `<div class="fltchips">${chips}</div>`
    + (arr
        ? `<div class="fltcalc">Flight <b>${esc((flightAt||"").slice(11,16))}</b> &#8722; your ${bufWords(flightBuf)} = at the airport by <b>${esc(arr.slice(11,16))}</b>${
            (flightAt||"").slice(0,10)!==arr.slice(0,10) ? ` <span class="fltq">(the day before)</span>` : ""}</div>`
        : `<div class="fltcalc fltq">Set the flight&#8217;s departure time above.</div>`)
    + `<div class="fltcav"><b>${bufWords(flightBuf)} is your number, not your airline&#8217;s rule.</b> This app has no access to check-in deadlines, bag-drop cutoffs or security queues, and it does not model the walk from the platform to the desk. The time on your booking wins.</div>`
    + airportNote;
  if(!arr) return;
  whenMode="arr"; whenValue=arr;
  const at=$("whenAt"), clr=$("whenClear");
  if(at){ at.hidden=false; at.value=arr; }
  if(clr) clr.hidden=false;
  if(fromName && toName) planJourney();
}

/* ---------- transport-mode filter ----------
   The one ZVV-style filter that this API actually honours. Tested: direct,
   bike, accessibility and sleeper are all silently IGNORED, but transportations[]
   genuinely changes the result set -- Luzern->Ruetli goes from a 2-change bus and
   train slog to a single direct BAT lake steamer. For this app's audience a boat
   crossing is not a detour, it is the reason to travel, and SBB buries it behind
   a generic leg. Off by default: an empty selection means "all modes", exactly
   as before. */
const MODES=[{k:"train",label:"Train",ic:"\u{1F686}"},{k:"ship",label:"Boat",ic:"\u{1F6A2}"},
             {k:"cableway",label:"Cable car",ic:"\u{1F6A0}"},{k:"bus",label:"Bus",ic:"\u{1F68C}"},
             {k:"tram",label:"Tram",ic:"\u{1F68B}"}];
let modeSel = load(LS.modes, []);
function modeQS(){
  return (modeSel||[]).map(m=>`&transportations[]=${encodeURIComponent(m)}`).join("");
}
function toggleMode(k){
  modeSel = modeSel.includes(k) ? modeSel.filter(x=>x!==k) : [...modeSel,k];
  save(LS.modes, modeSel); renderModes();
  if(fromName&&toName) planJourney();
}
function renderModes(){
  const el=$("modeChips"); if(!el) return;
  el.innerHTML = MODES.map(m=>
    `<button class="chip mode${modeSel.includes(m.k)?" on":""}" type="button" onclick="toggleMode('${m.k}')" `
    + `aria-pressed="${modeSel.includes(m.k)}" title="${modeSel.includes(m.k)?"Only these modes":"Include every mode"}">`
    + `${m.ic} ${m.label}</button>`).join("")
    + (modeSel.length?`<button class="chip mode clear" type="button" onclick="clearModes()">&#10005; all modes</button>`:"");
  renderCats();   // turning trains off/on changes whether the sub-row applies
}
function clearModes(){ modeSel=[]; save(LS.modes,modeSel); renderModes(); if(fromName&&toName) planJourney(); }
/* The selection is remembered across sessions, so a boat filter set once for a
   lake trip is still on next week when you are trying to get to work -- and a
   bare "no connections found" would send you hunting for a typo in a station
   name that is perfectly correct. Say which filter is doing it, and let the
   sentence itself be the way out. */
/* Same idea for the two sun buttons, and it matters most for sunrise: asking to
   be somewhere before first light very often has NO answer, because the first
   train of the day leaves after it. That is the night refusing, not the search
   failing, and a bare "no connections found" would send you checking the station
   names for a spelling mistake that isn't there. */
let sunTarget=null;
function sunWhyEmpty(){
  if(!sunTarget) return "";
  return `<div class="emptywhy">You asked to arrive before ${esc(sunTarget.word)} at `
    + `<b>${esc(sunTarget.time)}</b>. Nothing gets you there that early &#8212; that is the timetable, not a typo. `
    + `<button type="button" class="linkish" onclick="setWhen('now')">Show the next departures instead</button></div>`;
}
function modeWhyEmpty(){
  if(!modeSel.length) return "";
  const names=MODES.filter(m=>modeSel.includes(m.k)).map(m=>m.label.toLowerCase());
  const list=names.length>1 ? names.slice(0,-1).join(", ")+" or "+names[names.length-1] : names[0];
  return `<div class="emptywhy">You are only showing journeys by ${esc(list)}. `
    + `<button type="button" class="linkish" onclick="clearModes()">Show every mode</button></div>`;
}
/* ---------- train sub-categories (ICE/TGV - EC/IC - IR/PE - RE - S/R) ----------
   SBB's own Erweiterte Suche splits "Zug" into six boxes, and the commuter case
   it was clearly built for is real: "IC only, I am not standing through eight
   regional stops." We can answer it, but NOT the way the mode chips do. The API's
   transportations[] parameter has no sub-train granularity -- checked, not
   assumed -- so this is a POST-FILTER over results we already parse, and that
   difference is what the rest of this block is about.

   The category strings are the ones the live API actually returns (probed over a
   dozen routes: IC IR S TGV RE TER B R EC BAT EV PE ICE NJ T). journey.categoryCode
   and journey.subcategory exist as keys but came back null on every single
   section, so they are deliberately unused -- keying off a field that is always
   null is how you ship a filter that silently matches nothing.

   Two rules keep this from lying:

   1. UNRECOGNISED CATEGORIES PASS. A category we do not classify is not a reason
      to delete someone's connection. The failure directions are not symmetric:
      letting an unknown train through shows you one row too many and you can see
      what it is, while judging it would vanish a real journey and tell you the
      timetable is empty. Same reason walk / bus / boat / tram legs are never
      judged here -- this filter is about which TRAIN you sit on, not about
      re-deciding the mode chips above.
   2. FILTERING IS SAID OUT LOUD. A post-filter over a page of six can leave two
      rows, and two rows reads as "there is barely a service" when the truth is
      "you asked for two of the six". So when the filter is on we fetch a wider
      window to have material to filter, and whenever we drop anything we print
      what we dropped and why. */
const TRAIN_CLASSES=[
  {k:"fast",  label:"ICE/TGV", ic:"\u{1F685}", cats:["ICE","TGV","RJ","RJX","EN","NJ","TE2","EST"]},
  {k:"ic",    label:"EC/IC",   ic:"\u{1F684}", cats:["IC","EC","ICN"]},
  {k:"ir",    label:"IR/PE",   ic:"\u{1F686}", cats:["IR","PE","IRE"]},
  /* EXT is deliberately absent: measured on the live board it is a grab-bag of
     heritage steam runs (DVZO, Bauma 2026-09-06), football shuttles and
     Ersatzzuege -- not a class anyone means by "RE". Leaving it unlisted makes
     rule 1 carry it: unjudged, so never dropped. */
  {k:"re",    label:"RE",      ic:"\u{1F683}", cats:["RE","TER","D"]},
  {k:"local", label:"S/R",     ic:"\u{1F687}", cats:["S","SN","R","RB","RJET"]}
];
let catSel = load(LS.cats, []);
function trainClassOf(cat){
  const c=(cat||"").toUpperCase().trim();
  if(!c) return null;
  for(const t of TRAIN_CLASSES) if(t.cats.includes(c)) return t.k;
  return null;                       // rule 1: unknown is NOT a train we judge
}
/* A connection survives when every leg we RECOGNISE as a train is a type you
   kept. One unwanted train anywhere on the route is enough to drop it -- the
   whole point of "IC only" is that the regional leg is the part you did not
   want to sit on. */
function connTrainOK(c){
  if(!catSel.length) return true;
  for(const s of (c&&c.sections)||[]){
    const k = s&&s.journey ? trainClassOf(s.journey.category) : null;
    if(k && !catSel.includes(k)) return false;
  }
  return true;
}
function catFilter(cs){ return (cs||[]).filter(connTrainOK); }
function catNames(){
  const names=TRAIN_CLASSES.filter(t=>catSel.includes(t.k)).map(t=>t.label);
  return names.length>1 ? names.slice(0,-1).join(", ")+" or "+names[names.length-1] : (names[0]||"");
}
/* Trains only exist as an option when the mode chips allow them, so the sub-row
   hides when they do not. A hidden selection is still harmless: with no train
   legs in the results there is nothing for it to judge. */
function catsRelevant(){ return !modeSel.length || modeSel.includes("train"); }
function toggleCat(k){
  catSel = catSel.includes(k) ? catSel.filter(x=>x!==k) : [...catSel,k];
  save(LS.cats, catSel); renderCats();
  if(fromName&&toName) planJourney();
}
function clearCats(){ catSel=[]; save(LS.cats,catSel); renderCats(); if(fromName&&toName) planJourney(); }
function renderCats(){
  const el=$("catChips"); if(!el) return;
  if(!catsRelevant()){ el.innerHTML=""; return; }
  el.innerHTML = `<span class="catlabel">Train type</span>` + TRAIN_CLASSES.map(t=>
    `<button class="chip mode cat${catSel.includes(t.k)?" on":""}" type="button" onclick="toggleCat('${t.k}')" `
    + `aria-pressed="${catSel.includes(t.k)}" title="${catSel.includes(t.k)?"Only these train types":"Include every train type"}">`
    + `${t.ic} ${t.label}</button>`).join("")
    + (catSel.length?`<button class="chip mode clear" type="button" onclick="clearCats()">&#10005; all train types</button>`:"");
}
/* Rule 2. Said on the way IN (we filtered a real list) and on the way OUT (we
   filtered it to nothing) -- the second is the one that would otherwise read as
   a broken search, so it names the filter and prints the way back out. */
/* Worded around what was DROPPED, never around what was kept. The tempting
   phrasing -- "3 of the next 10 options use EC/IC" -- is false the moment a
   journey survives for a reason other than matching: on Luzern-Vitznau an
   EC/IC filter keeps eight boat and replacement-bus options, because rule 1
   never judges them. They are shown, and they do not use an IC. Counting the
   hidden ones is true in every case, and it is also the number the reader
   actually needs to know the list was cut. */
function catFilterNote(kept, fetched){
  const hid = fetched - kept;
  if(!catSel.length || hid<=0 || !kept) return "";
  return `<div class="catnote"><b>${hid}</b> of the next <b>${fetched}</b> `
    + `option${fetched===1?"":"s"} ${hid===1?"is":"are"} hidden &#8212; ${hid===1?"it uses":"they use"} `
    + `a train type you switched off. That is this filter, not a thin timetable. `
    + `<button type="button" class="linkish" onclick="clearCats()">Show every train type</button></div>`;
}
function catWhyEmpty(){
  if(!catSel.length) return "";
  return `<div class="emptywhy">You are only showing journeys by ${esc(catNames())}. `
    + `<button type="button" class="linkish" onclick="clearCats()">Show every train type</button></div>`;
}
/* ---------- the passenger chooses the change (user via) ----------
   The API has taken via[] all along -- the smart sweep has used it for hubs
   since the day it was written -- so the only piece missing was the passenger
   being able to say WHERE. Two rules keep it honest:

   (1) A via that is set is always VISIBLE, and never persisted. A remembered,
       invisible constraint is how a search quietly stops answering the question
       you think you asked: tomorrow's Bern->Zurich comes back odd and nothing
       on the screen says why. Persisting it would be a convenience worth one
       tap, bought with a bug you cannot see.
   (2) A chosen via TURNS THE HUB SWEEP OFF. Sweeping other interchanges while
       you have named yours is the app arguing with you -- and worse, the list
       would mix routes that honour the via with routes that ignore it, with
       nothing on the card to tell the two apart. */
let viaName = "";
function viaQS(){ return viaName ? `&via[]=${encodeURIComponent(viaName)}` : ""; }
function viaOpen(){ $("fVia").hidden=false; $("viaAdd").hidden=true; $("iVia").focus(); }
function viaSet(n){
  viaName = n;
  $("fVia").classList.add("has");
  viaPending();
  if(fromName&&toName) planJourney();
}
/* The box can hold text the search has not been given yet -- typed, but never
   picked or entered. The results are then unconstrained while the field looks
   like it is constraining them: the same lie as an invisible via, told the
   other way round. So an unapplied box is MARKED, and every claim rendered
   below reads viaName and never the input element. */
function viaPending(){
  const i=$("iVia"); if(!i) return;
  $("fVia").classList.toggle("pending", i.value.trim() !== viaName);
}
/* ...and MARKING it was not enough. Field report 2026-07-30 (Zurich -> Luzern
   via Buchrain): the via applied only on Enter or on tapping a suggestion, so
   typing the stop and then touching anything else -- the To box, a route chip,
   the results -- ran the search with no via at all. The dashed border was the
   whole warning, and it says nothing. On a phone you do not press Enter; you
   tap away. So leaving the box IS applying it: the API resolves a literal
   station name fine (measured against via[]=Buchrain), and if the text was
   junk the via note names it with one tap to drop it -- visible and reversible,
   which an unconstrained search pretending otherwise never was. */
function viaBlur(){
  const i=$("iVia"); if(!i) return;
  const typed=i.value.trim();
  if(!typed || typed===viaName) return;      // nothing pending
  /* A tap on a suggestion blurs the box BEFORE its click lands, and that blur
     carries the half-typed text the dropdown was still answering. Applying it
     here would fire a search for "Buchra" and then a second for "Buchrain".
     One frame is enough for the click to win; if it did, typed===viaName by
     the time this runs and the guard above ends it. */
  setTimeout(()=>{
    const now=$("iVia"); if(!now) return;
    const t=now.value.trim();
    if(t && t!==viaName) viaSet(t);
  }, 150);
}
function viaClear(){
  const had = !!viaName;
  viaName = "";
  $("iVia").value=""; $("fVia").classList.remove("has","pending");
  $("fVia").hidden=true; $("viaAdd").hidden=false;
  if(had && fromName && toName) planJourney();   // only re-plan if it was actually constraining
}
/* An empty result under a via is NOT "no route" -- it is "no route in that
   order", and those are different sentences. Printing the first would send you
   hunting for a typo in three perfectly correct station names. */
function viaWhyEmpty(){
  if(!viaName) return "";
  return `<div class="emptywhy">You asked to travel <b>via ${esc(viaName)}</b>. `
    + `Nothing links the three in that order &#8212; which is not the same as no route at all. `
    + `<button type="button" class="linkish" onclick="viaClear()">Search without the via</button></div>`;
}
function viaNote(){
  if(!viaName) return "";
  return `<div class="vianote">&#8631; via <b>${esc(viaName)}</b>`
    + (smart ? ` &#183; you named the change, so the change-finder is not sweeping other hubs.` : `.`)
    + ` <button type="button" class="linkish" onclick="viaClear()">Drop it</button></div>`;
}

/* ---------- scroll-edge fades ----------
   A faded edge is a CLAIM that there are more chips that way. So it is derived
   from the measured scroll position and never applied statically: a row that
   fits must not advertise chips it does not have, and a row scrolled to its end
   must stop pointing further right. That is the same rule the rest of this file
   follows about not dressing an absence up as data.
   Both edges are computed, because "you have scrolled past something" is worth
   as much as "there is more ahead" once the first chip is off-screen. */
function fadeEdges(el){
  if(!el || !el.classList) return;            // not a rendered element (harness/pre-mount)
  const room = el.scrollWidth - el.clientWidth;
  const x = el.scrollLeft;
  const scrollable = room > 1;                // sub-pixel rounding is not overflow
  el.classList.toggle("fadeL", scrollable && x > 1);
  el.classList.toggle("fadeR", scrollable && x < room - 1);
}
/* Wired once, from the DOM rather than from each painter: the chip rows are
   repainted by four different functions and a fifth is static markup, so hanging
   this off the renderers would mean five call sites and a sixth one forgotten
   later. Observing the elements themselves cannot be forgotten. */
function wireFades(){
  const rows = document.querySelectorAll(".favs");
  rows.forEach(el=>{
    const upd = () => fadeEdges(el);
    upd();
    el.addEventListener("scroll", upd, {passive:true});
    if(window.ResizeObserver)   new ResizeObserver(upd).observe(el);
    if(window.MutationObserver) new MutationObserver(upd).observe(el, {childList:true, subtree:true});
  });
  addEventListener("resize", () => rows.forEach(fadeEdges), {passive:true});
}
/* ---------- route history ----------
   A commuter retypes the same two stations every day. The departures board has
   remembered your last station since day one; the journey side forgot both
   fields every time. Recorded automatically when a search actually runs -- no
   "save route" button to remember -- most recent first, and DIRECTION-DISTINCT,
   because the morning and the evening trip are not the same trip. Reuses the
   favourites chip pattern from the departures board rather than inventing a new
   control: same visual language, nothing new to learn. localStorage only.

   Seed chips (first real-user feedback, Pamela 2026-07-28: "I would have some
   default options to choose from on top of the search bar"): a first-time
   passenger has no history, so this row rendered EMPTY exactly for the person
   who most needed a worked example. With no history we now show example routes
   -- visually dimmed, never written to storage -- and the first real search
   replaces them with the passenger's own. Offers to try the app, not claims
   about the passenger's life, which is why they vanish instead of mixing in. */
const SEED_ROUTES = [
  {f:"Z\u00fcrich HB", t:"Bern"},
  {f:"Z\u00fcrich HB", t:"Z\u00fcrich Flughafen"},
  {f:"Basel SBB", t:"Luzern"},
  {f:"Gen\u00e8ve", t:"Lausanne"},
  {f:"Bern", t:"Interlaken Ost"},
];
let routeHist = load(LS.routes, []);
function shownRoutes(){ return routeHist.length ? routeHist : SEED_ROUTES; }
function rememberRoute(from,to){
  if(!from||!to||from===to) return;
  routeHist = [{f:from,t:to}, ...routeHist.filter(r=>!(r.f===from&&r.t===to))].slice(0,6);
  save(LS.routes, routeHist); renderRoutes();
}
function useRoute(i){
  const r=shownRoutes()[i]; if(!r) return;   // read at tap time, seeds included
  fromName=r.f; toName=r.t;
  $("iFrom").value=r.f; $("iTo").value=r.t;
  $("fFrom").classList.add("has"); $("fTo").classList.add("has");
  planJourney();
}
function renderRoutes(){
  const el=$("routeChips"); if(!el) return;
  const seed = !routeHist.length;
  el.innerHTML = shownRoutes().map((r,i)=>
    `<button class="chip route${seed?" seed":""}" type="button" onclick="useRoute(${i})" `
    + `title="${esc(r.f)} to ${esc(r.t)}${seed?" — an example to try; your own searches replace these":""}">`
    + `${esc(shortStop(r.f))} <span class="ra">&#8594;</span> ${esc(shortStop(r.t))}</button>`
  ).join("");
}
/* Which build you are actually looking at, at the foot of this help sheet. It
   exists because "I retested and it still fails" and "I retested the old file"
   are indistinguishable from the outside, and we burnt a debugging round on
   exactly that ambiguity. Long-press to select and read it back. */
function renderBuild(){
  const el=$("buildStamp"); if(!el) return;
  el.innerHTML = BUILD==="dev"
    ? "build: dev (opened locally, not a deploy)"
    : "build: "+esc(BUILD);
}
/* Recorded when a search RETURNS something, not when one is typed. Remembering
   up front meant every fat-fingered station name became a permanent chip for a
   route that does not exist, and the six slots are small enough that a couple of
   typos evict the trips you actually take. A chip is an offer to repeat a
   journey, so it has to be a journey. */
/* jrnGen is SHARED between the two planners. It used to live only in smartPlan
   (as smartGen), which guarded smart-vs-smart races and nothing else -- so
   flipping the smart toggle off MID-SEARCH let the old smart response sail
   past its own stale-check and paint over the fresh plain results. Measured on
   device 2026-07-26 (operator repro: toggle off while searching; same class
   via the mode chips, which also re-plan mid-flight). One counter, bumped by
   every plan, checked after every await: only the newest search may paint. */
let jrnGen = 0;
/* Barring a stale sweep from PAINTING was only half the fix. Its requests kept
   running -- a bus-filtered wide query is a 1 MB, 14-second response, and a smart
   sweep is ~13 of them -- so a few mode-chip taps stacked dozens of zombie fetches
   on the browser's per-host connection pool. Every NEW search then queued behind
   the corpses: the app looked permanently dead until the tab was closed, which is
   exactly what closing the tab fixes (it kills the pool). Measured on device
   2026-07-26 after ~40 operator repros across three sessions. A superseded sweep
   is now ABORTED, not just silenced. */
let jrnAbort = null;
/* api() throws Error("HTTP 429") etc., but the catch blocks used to discard it
   and print the generic "check your connection" line -- the one situation where
   that advice is wrong (the network is FINE, the service refused us). Rate-limit
   and server errors need different advice than a dead connection.

   Field report 2026-07-30: this function was RIGHT and never ran on the screen
   that mattered. Smart mode routes through tryConns, which caught the error,
   set a boolean and dropped the reason on the floor -- so renderSmart printed
   its own hardcoded "check your connection" while the operator's connection was
   demonstrably fine (measured: 40 requests, 23 came back HTTP 429 "Too many
   requests this minute"). A correct message on a path nobody walks is not a
   correct message. Every failure branch now ends here; `unknown` and `again`
   are the only per-screen words, so a new screen cannot fork the advice. */
function errBox(e, unknown, again){
  const what  = unknown || "whether this journey runs";
  const retry = again   || "tap Search again";
  const m=/^HTTP (\d+)/.exec((e&&e.message)||"");
  if(m&&m[1]==="429") return `<div class="err">The timetable service is rate-limiting us &#8212; too many searches for now.<br>This is not a &quot;no&quot;, and not your connection: wait a minute, then ${retry}.</div>`;
  if(m) return `<div class="err">The timetable service answered with an error (HTTP ${m[1]}), so we do not know ${what}.<br>This is not a &quot;no&quot; &#8212; try again in a moment.</div>`;
  return `<div class="err">We could not reach the timetable, so we do not know ${what}.<br>This is not a &quot;no&quot; &#8212; check your connection and ${retry}.</div>`;
}
function planJourney(){ return smart ? smartPlan() : plainPlan(); }

/* ---------- share a route ----------
   What travels is the QUERY, never the result: timetables shift, so the
   receiver's phone re-plans live instead of trusting a frozen screenshot.
   A "now" search shares as NOW (no at= param) -- stamping the sender's
   clock onto it would arrive already stale. */
function shareURL(){
  const u = new URL(location.href.split("?")[0].split("#")[0]);
  u.searchParams.set("from", fromName);
  u.searchParams.set("to", toName);
  if(viaName) u.searchParams.set("via", viaName);   // a via left behind means the receiver plans a DIFFERENT journey
  if(whenMode!=="now" && whenValue){
    u.searchParams.set("at", whenValue);
    if(whenMode==="arr") u.searchParams.set("mode","arr");
  }
  return u.toString();
}
function shareRoute(ev){
  if(!fromName||!toName) return;
  const when = whenMode==="dep" && whenValue ? `, dep ${whenValue.slice(11,16)}`
             : whenMode==="arr" && whenValue ? `, arr by ${whenValue.slice(11,16)}`
             : "";
  const text = `${fromName} \u2192 ${toName}${viaName?` (via ${viaName})`:""}${when}`;
  const url = shareURL();
  const btn = ev?.currentTarget;
  const copied = () => { if(btn){ btn.textContent="Copied \u2713"; setTimeout(()=>{ btn.innerHTML=SHARE_LBL; },1600); } };
  const copy = () => navigator.clipboard?.writeText(text+"\n"+url).then(copied)
    .catch(()=>{ if(btn) btn.textContent="Could not copy \u2014 long-press the address bar"; });
  if(navigator.share){
    // a cancelled share sheet is a choice, not a failure; only real errors fall back
    navigator.share({ title:"Rail", text, url }).catch(e=>{ if(e && e.name!=="AbortError") copy(); });
  } else copy();
}
const SHARE_LBL = "&#8599; Share this route";
function shareBarHTML(){
  // the pager sits at the FAR LEFT of the row the share button already owns --
  // one bar for "what to do with this list", not a second panel
  return `<div class="sharebar">${pgBarHTML()}<button type="button" class="shr" onclick="shareRoute(event)">${SHARE_LBL}</button></div>`;
}

/* ---------- deep link: ?from=&to=[&via=][&at=][&mode=arr] ----------
   The read side of sharing. A shared time that has already passed is NOT
   replayed -- a dead timestamp would produce a ghost plan -- we fall back to
   NOW and say so next to the time controls. */
function applyDeepLink(){
  let q;
  try{ q = new URLSearchParams(location.search); }catch{ return false; }
  const f=(q.get("from")||"").trim(), t=(q.get("to")||"").trim();
  if(!f||!t) return false;
  fromName=f; toName=t;
  $("iFrom").value=f; $("fFrom").classList.add("has");
  $("iTo").value=t;   $("fTo").classList.add("has");
  const v=(q.get("via")||"").trim();
  if(v){ viaName=v; $("iVia").value=v; $("fVia").hidden=false; $("fVia").classList.add("has"); $("viaAdd").hidden=true; }
  const at=(q.get("at")||"").trim();
  const live = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) && new Date(at).getTime() > Date.now();
  if(live){
    $("whenAt").value=at;
    setWhen(q.get("mode")==="arr" ? "arr" : "dep");     // replans as its last act
  }else{
    setWhen("now");                                      // replans as its last act
    if(at){ const s=$("sunHint"); if(s) s.innerHTML=`<span class="hint">The shared time has already passed &#8212; showing connections from now.</span>`; }
  }
  setTab("jrn");
  return true;
}

/* ---------- T12: meet in the middle ----------
   Two people, two origins -- the From and To fields -- one question: where is
   it FAIR to meet? Fairness is checkable: the stop where the two ride times
   are closest, both leaving now. The N x M trap is dodged by construction:
   the two DIRECT connections (A->B and B->A) already call at every candidate
   worth naming, and each shared stop carries BOTH clock times for free -- so
   the base cost is 2 requests. Only when the two directions never share a
   stop does a fallback fire: at most MEET_FB per-candidate lookups against
   whichever direction answered. Hard ceiling 2+MEET_FB requests, and only
   ever on the button tap -- never on render. */
const MEET_FB = 4;
let meetGen = 0, meetAbort = null, meetRows = [];

function connStops(c){
  // every station the journey actually calls at, with the clock time there.
  // Same predicate as legStops: no name or no time = routing marker, not a
  // stop (and passList[0] can pair the origin's time with the terminus id).
  const out = new Map();
  for(const s of (c.sections||[])){
    const pl = s.journey && s.journey.passList;
    if(!Array.isArray(pl)) continue;
    for(const p of pl){
      const nm = p.station?.name, t = p.arrival || p.departure;
      if(nm && t && !out.has(nm)) out.set(nm, t);
    }
  }
  return out;
}

function meetRow(name, depA, arrA, depB, arrB){
  const mA = Math.round((new Date(arrA)-new Date(depA))/60000);
  const mB = Math.round((new Date(arrB)-new Date(depB))/60000);
  return { name, mA, mB, arrA, arrB, gap: Math.abs(mA-mB),
           together: new Date(arrA) > new Date(arrB) ? arrA : arrB };
}

function meetCardHTML(r, i){
  return `<div class="meetc">
    <div class="meeth">&#129309; <b>${esc(r.name)}</b><span class="meetgap">${
      r.gap===0 ? "perfectly fair" : `fair within ${r.gap} min`}</span></div>
    <div class="meetl">You ride ${r.mA} min, there ${hhmm(r.arrA)} &#183; they ride ${r.mB} min, there ${hhmm(r.arrB)}</div>
    <div class="meetl meetb">both there by <b>${hhmm(r.together)}</b>
      <button type="button" class="meetlegbtn" onclick="meetLeg(${i},false)">my leg</button>
      <button type="button" class="meetlegbtn" onclick="meetLeg(${i},true)">their leg</button></div>
  </div>`;
}

function meetLeg(i, theirs){
  const r = meetRows[i]; if(!r) return;
  // planning THEIR leg swaps the From field to their origin -- an explicit
  // tap, and the share bar in the resulting plan is how you send it to them
  const f = theirs ? toName : fromName;
  fromName = f; toName = r.name;
  $("iFrom").value = f; $("iTo").value = r.name;
  $("fFrom").classList.add("has"); $("fTo").classList.add("has");
  planJourney();
}

async function meetMiddle(){
  const out = $("meetOut");
  if(!fromName || !toName){
    out.innerHTML = `<div class="hint">Put each person&#8217;s starting station in the two fields, then tap again.</div>`;
    return;
  }
  if(fromName === toName){
    out.innerHTML = `<div class="hint">Both fields say ${esc(fromName)} &#8212; you are already meeting there.</div>`;
    return;
  }
  const gen = ++meetGen;
  if(meetAbort) meetAbort.abort();
  meetAbort = new AbortController();
  const sig = meetAbort.signal;
  out.innerHTML = skel(2);
  try{
    // requests 1+2 of the ceiling: the two direct connections
    let eAB=null, eBA=null;
    const [cab, cba] = await Promise.all([
      api(`/connections?limit=1&from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}`, sig)
        .then(d=>(d.connections||[])[0]||null).catch(e=>{ eAB=e; return null; }),
      api(`/connections?limit=1&from=${encodeURIComponent(toName)}&to=${encodeURIComponent(fromName)}`, sig)
        .then(d=>(d.connections||[])[0]||null).catch(e=>{ eBA=e; return null; }),
    ]);
    if(gen!==meetGen) return;                                      // superseded
    if(!cab && !cba){
      // both directions dead: an error is an OUTAGE, absence of both errors
      // is a real "no route" verdict -- do not collapse the two
      if(eAB||eBA) throw (eAB||eBA);
      out.innerHTML = `<div class="empty"><div class="big">&#129309;</div>The timetable finds no way between ${esc(fromName)} and ${esc(toName)} in either direction &#8212; there is no line to meet along.</div>`;
      return;
    }
    const endNames = new Set([
      fromName, toName,
      cab?.from?.station?.name, cab?.to?.station?.name,
      cba?.from?.station?.name, cba?.to?.station?.name,
    ].filter(Boolean));
    let rows = [];
    if(cab && cba){
      const sa = connStops(cab), sb = connStops(cba);
      const depA = cab.from?.departure, depB = cba.from?.departure;
      for(const [nm, tA] of sa){
        if(endNames.has(nm)) continue;
        const tB = sb.get(nm);
        if(tB && depA && depB) rows.push(meetRow(nm, depA, tA, depB, tB));
      }
    }
    let fbNote = "";
    if(!rows.length){
      // the two directions never share a stop (or one direction answered
      // nothing): bounded fallback against whichever direction we have
      const src = cab || cba;
      const depS = src.from?.departure;
      const other = cab ? toName : fromName;   // the origin with no stop data
      const cands = [...connStops(src)].filter(([nm])=>!endNames.has(nm));
      // middle of the route, capped -- the cap IS the feature
      const start = Math.max(0, Math.floor((cands.length-MEET_FB)/2));
      const picked = cands.slice(start, start+MEET_FB);
      let fbFail = 0;
      const qs = await Promise.all(picked.map(([nm]) =>
        api(`/connections?limit=1&from=${encodeURIComponent(other)}&to=${encodeURIComponent(nm)}`, sig)
          .then(d=>(d.connections||[])[0]||null).catch(()=>{ fbFail++; return null; })));
      if(gen!==meetGen) return;                                    // superseded
      picked.forEach(([nm,tS], k)=>{
        const q=qs[k]; if(!q) return;
        const dO=q.from?.departure, aO=q.to?.arrival;
        if(!dO||!aO||!depS) return;
        rows.push(cab ? meetRow(nm, depS, tS, dO, aO) : meetRow(nm, dO, aO, depS, tS));
      });
      fbNote = `<div class="hint">The two directions don&#8217;t share a stop, so this checked ${picked.length} mid-route candidate${picked.length===1?"":"s"} the long way${fbFail?` (${fbFail} lookup${fbFail===1?"":"s"} failed)`:""}.</div>`;
    }
    if(gen!==meetGen) return;                                      // superseded
    if(!rows.length){
      out.innerHTML = `<div class="empty"><div class="big">&#129309;</div>No station between ${esc(fromName)} and ${esc(toName)} could be timed from both sides &#8212; no fair meeting point to name.</div>${fbNote}`;
      return;
    }
    rows.sort((a,b)=>a.gap-b.gap || (new Date(a.together)-new Date(b.together)));
    meetRows = rows.slice(0,3);
    out.innerHTML = fbNote + meetRows.map((r,k)=>meetCardHTML(r,k)).join("")
      + `<div class="hint">Fair = closest ride times, both leaving now. Tap a leg to plan it &#8212; the share bar sends it on.</div>`;
  }catch(e){
    if(gen!==meetGen) return;                                      // superseded
    out.innerHTML = errBox(e);
  }
}

async function plainPlan(){
  if(!fromName||!toName) return;
  const gen=++jrnGen;
  if(jrnAbort) jrnAbort.abort();
  jrnAbort = new AbortController();
  const sig = jrnAbort.signal;
  $("jrnOut").innerHTML = skel(4);
  try{
    // A post-filter needs material to filter. Asking for the usual six and then
    // throwing four away is how you turn a normal timetable into an empty screen,
    // so a train-type filter widens the window instead of thinning the answer.
    const lim = catSel.length ? 16 : 6;
    const d=await api(`/connections?limit=${lim}&from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}${viaQS()}${whenQS()}${modeQS()}`, sig);
    if(gen!==jrnGen) return;                                       // superseded
    const raw=d.connections||[];
    const kept=catFilter(raw);
    if(!kept.length){ pgObserve([]); $("jrnOut").innerHTML=`<div class="empty"><div class="big">&#9940;</div>No connections found.${sunWhyEmpty()}${viaWhyEmpty()}${pgWhyEmpty()}${modeWhyEmpty()}${raw.length?catWhyEmpty():""}</div>`; return; }
    rememberRoute(fromName,toName);   // a real result -- now it is worth a chip
    const cs=kept.slice(0,6);
    cs.forEach(annotate);
    jrnConns = cs;   // render order == the ci the leg buttons index back into
    pgObserve(cs);   // did the step actually move? decided BEFORE the bar is built
    $("jrnOut").innerHTML = shareBarHTML() + pgNote() + viaNote() + catFilterNote(kept.length, raw.length)
      + cs.map((c,i)=>connCard(c,i)).join("") + wondersExpanderHTML(cs[0].to?.station);
    if(weather) fillWeather();
  }catch(e){
    if(gen!==jrnGen) return;                                       // superseded
    $("jrnOut").innerHTML=errBox(e);
  }
}

/* Swallowing an error into [] made the app say "No connections found. Check the
   station names." when the truth was that the request never landed -- sending
   you hunting for a typo in a station name that is perfectly correct. That is
   absence-of-data rendered as data, the one thing this app refuses everywhere
   else, and it was doing it on the busiest path in the app. So the caller is
   told. Pass a note object for queries whose failure CHANGES THE VERDICT (the
   two direct ones); hub sweeps pass nothing, because a hub that times out is
   ordinary and never means the journey does not exist. */
/* Record BOTH outcomes, not just the failure. The two direct queries ask the
   same question at two widths, so one answered query is a definite answer even
   if the other died: an HTTP 200 carrying zero connections means "there is no
   such journey", and that verdict must not be downgraded to "we could not reach
   the timetable" just because its slower twin timed out. The wide query is the
   likeliest request in the app to fail -- bus-filtered, limit 16, it is a 1 MB
   14-second response -- so all-or-nothing was guaranteed to fire eventually. */
/* ...and recording the FAILURE without its REASON was the same defect one layer
   up. `note.failed=true` says a request died; it cannot say the service refused
   us, which is the one case where "check your connection" is false. Keep the
   error itself -- it is the only place that fact exists, and discarding it here
   forced every screen downstream to invent an explanation. */
async function tryConns(qs, note, signal){
  try{ const d=await api("/connections?"+qs, signal); if(note) note.ok=true; return d.connections||[]; }
  catch(e){ if(note){ note.failed=true; note.err=e; } return []; }
}
function connSig(c){ return (c.from?.departure||"")+"|"+(c.to?.arrival||"")+"|"+(c.duration||""); }
function changeDetails(c){
  const rides=(c.sections||[]).filter(s=>s.journey);
  const out=[];
  for(let k=1;k<rides.length;k++){
    // real-time prognosis when present (a delayed train's change is tighter
    // than scheduled — the whole point of tight-vs-safe), else scheduled
    const prevArr=rides[k-1].arrival?.prognosis?.arrival || rides[k-1].arrival?.arrival;
    const nextDep=rides[k].departure?.prognosis?.departure || rides[k].departure?.departure;
    const stn=rides[k].departure?.station?.name || rides[k-1].arrival?.station?.name || "";
    if(!prevArr||!nextDep) continue;
    const b=Math.round((new Date(nextDep)-new Date(prevArr))/60000);
    // which platform you arrive on and which you leave from: a 5-minute change
    // on the same platform and one across the station are not the same change
    const pa=rides[k-1].arrival?.prognosis?.platform || rides[k-1].arrival?.platform || null;
    const pd=rides[k].departure?.prognosis?.platform || rides[k].departure?.platform || null;
    /* A negative buffer means the delayed arrival lands AFTER the onward departure --
       the change you physically cannot make. Dropping it rendered that connection as
       having FEWER changes and no tight warning, so the one journey you will miss
       came out looking cleanest of all. Keep it and let it shout. */
    // where the layover physically happens -- the step-out card needs a coordinate,
    // and an address-station without one simply gets no card, not a guessed one
    const co=rides[k].departure?.station?.coordinate || rides[k-1].arrival?.station?.coordinate || null;
    // the change's own clock times ride along: the onboard bar anchors "which
    // change is NEXT" to them, and without them it could only guess by order
    if(b<600) out.push({stn, b, pa, pd, co, at:prevArr, dt:nextDep, missed:b<0});
  }
  return out;
}
function annotate(c){
  const arrIso = c.to?.prognosis?.arrival || c.to?.arrival;
  const depIso = c.from?.prognosis?.departure || c.from?.departure;
  c._arr = arrIso ? new Date(arrIso).getTime() : Infinity;
  c._dep = depIso ? new Date(depIso).getTime() : 0;
  c._chg = changeDetails(c);
  c._buf = c._chg.length ? Math.min(...c._chg.map(x=>x.b)) : null;
  c._tight = c._buf!=null && c._buf<TIGHT;
  return c;
}

/* ---------- destination weather (Open-Meteo, no key, CORS-open) ---------- */
function wxEmoji(c){
  const E=String.fromCodePoint;
  if(c===0)            return E(0x2600);   // clear
  if(c===1)            return E(0x1F324);  // mainly clear
  if(c===2)            return E(0x26C5);   // partly cloudy
  if(c===3)            return E(0x2601);   // overcast
  if(c>=45&&c<=48)     return E(0x1F32B);  // fog
  if(c>=51&&c<=57)     return E(0x1F326);  // drizzle
  if(c>=61&&c<=67)     return E(0x1F327);  // rain
  if(c>=71&&c<=77)     return E(0x1F328);  // snow
  if(c>=80&&c<=82)     return E(0x1F326);  // rain showers
  if(c>=85&&c<=86)     return E(0x1F328);  // snow showers
  if(c>=95)            return E(0x26C8);   // thunderstorm
  return E(0x2601);
}
/* plain-language description for the same WMO codes the emoji map uses --
   the emoji says the mood, this says the fact. Only surfaced on tap. */
function wxText(c){
  const M={0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Depositing rime fog",
    51:"Light drizzle",53:"Drizzle",55:"Dense drizzle",56:"Freezing drizzle",57:"Freezing drizzle",
    61:"Light rain",63:"Rain",65:"Heavy rain",66:"Freezing rain",67:"Freezing rain",
    71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",
    80:"Light showers",81:"Showers",82:"Violent showers",85:"Snow showers",86:"Snow showers",
    95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm with hail"};
  return M[c] || "";
}
const wxCache={};   // one forecast fetch per destination coord, reused across cards
function destWeather(lat,lon){
  const k=lat+","+lon;
  // widened hourly set: the extra fields cost nothing (same single request) and
  // are what the tap-to-detail overlay reads.
  if(!wxCache[k]) wxCache[k]=fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weather_code,apparent_temperature,precipitation_probability,wind_speed_10m&daily=sunrise,sunset&forecast_days=2&timezone=auto`)
    .then(r=>r.json()).then(d=>({hourly:d.hourly, daily:d.daily})).catch(()=>null);
  return wxCache[k];
}
function wxAt(hourly, arrIso, sunCarry){
  if(!hourly||!arrIso) return null;
  const key=arrIso.slice(0,13);   // yyyy-mm-ddTHH — Open-Meteo times are local (timezone=auto)
  const i=hourly.time.findIndex(t=>t.slice(0,13)===key);
  if(i<0) return null;
  const at=a=>Array.isArray(a)&&a[i]!=null?a[i]:null;   // every extra field is optional
  const code=hourly.weather_code[i];
  // Open-Meteo returns null at the edges of its range, and Math.round(null) is 0 --
  // which printed a confident "0 degrees" for a place we simply have no data for.
  const t=at(hourly.temperature_2m); if(t==null) return null;
  return {
    // the raw code travels with the reading: callers that need to JUDGE the
    // weather must not have to guess it back out of the English description
    code, emoji:wxEmoji(code), temp:Math.round(t), desc:wxText(code),
    feels:at(hourly.apparent_temperature)!=null?Math.round(at(hourly.apparent_temperature)):null,
    rain:at(hourly.precipitation_probability),
    wind:at(hourly.wind_speed_10m)!=null?Math.round(at(hourly.wind_speed_10m)):null,
    hour:hourly.time[i].slice(11,16),
    rise:(sunCarry&&sunCarry.rise)||null, set:(sunCarry&&sunCarry.set)||null,
  };
}
function wxDetailText(w){
  const parts=[];
  if(w.desc) parts.push(w.desc);
  parts.push(`${w.temp}°` + (w.feels!=null && w.feels!==w.temp ? ` (feels ${w.feels}°)` : ""));
  if(w.rain!=null) parts.push(`${w.rain}% rain`);
  if(w.wind!=null) parts.push(`${w.wind} km/h wind`);
  if(w.rise&&w.set) parts.push(`☀ ${w.rise}–${w.set}`);
  return parts.join(" · ") + (w.hour?` · at ${w.hour}`:"");
}
async function fillWeather(){
  const els=[...document.querySelectorAll(".wx[data-t]")];
  if(!els.length) return;
  const byCoord={};
  els.forEach(e=>{ const k=e.dataset.lat+","+e.dataset.lon; (byCoord[k]=byCoord[k]||[]).push(e); });
  for(const k in byCoord){
    const [lat,lon]=k.split(",");
    const wx=await destWeather(lat,lon); const hourly=wx&&wx.hourly;
    byCoord[k].forEach(e=>{
      const w=wxAt(hourly, e.dataset.t, sunFor(wx&&wx.daily, e.dataset.t));
      if(!w) return;
      e.innerHTML=`${w.emoji} ${w.temp}&#176;`;
      e.dataset.detail=wxDetailText(w);   // tap reads this; no refetch
      e.classList.add("tappable");
      e.setAttribute("role","button"); e.setAttribute("tabindex","0");
      e.setAttribute("aria-label",`Weather: ${wxDetailText(w)}`);
    });
  }
}
/* tap a weather chip -> a small dismissable bubble. Delegated, so it survives
   every re-render; tap-away / Esc closes. Nothing fetches on tap. */
function wxClosePop(){ const p=$("wxPop"); if(p) p.remove(); }
function wxShowPop(el){
  wxClosePop();
  const txt=el.dataset.detail; if(!txt) return;
  const pop=document.createElement("div");
  pop.id="wxPop"; pop.className="wxpop"; pop.setAttribute("role","status"); pop.textContent=txt;
  document.body.appendChild(pop);
  const r=el.getBoundingClientRect(), pr=pop.getBoundingClientRect();
  const left=Math.min(Math.max(8, r.left+r.width/2-pr.width/2), innerWidth-pr.width-8);
  const above=r.top>pr.height+12;
  pop.style.left=left+"px";
  pop.style.top=(above ? r.top-pr.height-8 : r.bottom+8)+scrollY+"px";
}
document.addEventListener("click",e=>{
  const chip=e.target.closest(".wx.tappable");
  if(chip){ e.stopPropagation(); (($("wxPop")&&chip===wxShowPop.last)?wxClosePop():(wxShowPop(chip), wxShowPop.last=chip)); return; }
  wxClosePop();
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape") wxClosePop();
  if((e.key==="Enter"||e.key===" ")&&e.target.classList&&e.target.classList.contains("tappable")){
    e.preventDefault(); wxShowPop(e.target); wxShowPop.last=e.target;
  }
});
addEventListener("scroll",wxClosePop,{passive:true});

/* ---------- Natural Wonders (OSM/Overpass, on-demand; Wikipedia enrichment) ----------
   No 4th toggle: a calm tap-to-expand under the journey results. One Overpass call
   per destination coord (cached), async + fail-silent; Wikipedia blurb+thumb layered
   on top of the instant name+distance list. tourism=attraction deliberately excluded
   (proven noisy). Coord convention: station.coordinate.x = lat, .y = lon. */
const CP=c=>String.fromCodePoint(c);
function haversineKm(la1,lo1,la2,lo2){
  const R=6371, r=x=>x*Math.PI/180;
  const dLa=r(la2-la1), dLo=r(lo2-lo1);
  const a=Math.sin(dLa/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function wonderType(t){
  if(t.natural==="peak")            return {emoji:CP(0x26F0), label:"peak"};
  if(t.natural==="glacier")         return {emoji:CP(0x1F9CA),label:"glacier"};
  if(t.natural==="cave_entrance")   return {emoji:CP(0x1F573),label:"cave"};
  if(t.natural==="waterfall"||t.waterway==="waterfall") return {emoji:CP(0x1F4A7),label:"waterfall"};
  if(t.tourism==="viewpoint")       return {emoji:CP(0x1F304),label:"viewpoint"};
  return {emoji:CP(0x1F4CD), label:""};
}
/* ONE Overpass client for the whole app. Two features ask OSM questions -- the
   wonders list around a destination and the en-route finder along a corridor --
   and they had grown two copies of the mirror list, the retry loop and the cache.
   Returns null when NO mirror answered, [] when OSM genuinely has nothing there.
   Callers must keep those apart: "we could not ask" and "there is nothing" look
   identical on screen otherwise, and the second is a lie. A failure is not
   cached, so the next tap tries again instead of inheriting an outage. */
const OVERPASS_HOSTS=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
const overpassCache={};
function overpassQuery(key,q){
  if(overpassCache[key]) return overpassCache[key];
  const p=(async()=>{
    for(const h of OVERPASS_HOSTS){
      try{
        const r=await fetch(h,{method:"POST",body:"data="+encodeURIComponent(q)});
        if(!r.ok) continue;
        return (await r.json()).elements||[];
      }catch(e){ /* try the next mirror */ }
    }
    delete overpassCache[key];               // an outage must not become a verdict
    return null;
  })();
  overpassCache[key]=p;
  return p;
}
function overpass(lat,lon){
  return overpassQuery(lat+","+lon,
    `[out:json][timeout:25];(`
    +`node(around:8000,${lat},${lon})[tourism=viewpoint];`
    +`node(around:8000,${lat},${lon})[natural~"^(cave_entrance|waterfall|peak|glacier)$"];`
    +`way(around:8000,${lat},${lon})[natural~"^(cave_entrance|waterfall|peak|glacier)$"];`
    +`node(around:8000,${lat},${lon})[waterway=waterfall];`
    +`way(around:8000,${lat},${lon})[waterway=waterfall];`
    +`);out center 40;`);
}
function wondersExpanderHTML(dest){
  if(!dest||!dest.coordinate) return "";
  const lat=dest.coordinate.x, lon=dest.coordinate.y;
  if(lat==null||lon==null) return "";
  return `<div class="wonders"><button class="wtoggle" onclick="loadWonders(this,${lat},${lon})">`
    +`${CP(0x26F0)} Natural Wonders near ${esc(dest.name||toName||"destination")}<span class="wchev">&#9662;</span>`
    +`</button><div class="wbody"></div></div>`;
}
async function loadWonders(btn,lat,lon){
  const wrap=btn.closest(".wonders"), body=wrap.querySelector(".wbody");
  if(wrap.dataset.loaded) return;   // one expansion per render
  wrap.dataset.loaded="1"; btn.classList.add("open");
  body.innerHTML=`<div class="wloading">searching nearby&#8230;</div>`;
  const els=await overpass(lat,lon);
  // "we could not ask OSM" is not "OSM says there is nothing here" -- saying the
  // second when the first is true tells you a mountain range is empty.
  if(els===null){ body.innerHTML=`<div class="wempty">Could not reach the map data just now. That is not the same as nothing being here &#8212; tap again to retry.</div>`; return; }
  const seen=new Set(), list=[];
  els.forEach(e=>{
    const t=e.tags||{};
    const name=t.name||t["name:fr"]||t["name:de"];
    if(!name || seen.has(name)) return;
    const la=e.lat??e.center?.lat, lo=e.lon??e.center?.lon;
    if(la==null||lo==null) return;
    seen.add(name);
    list.push({name, ty:wonderType(t), dist:haversineKm(+lat,+lon,la,lo), lat:la, lon:lo, wikipedia:t.wikipedia, wikidata:t.wikidata});
  });
  list.sort((a,b)=>a.dist-b.dist);
  const top=list.slice(0,5);
  if(!top.length){ body.innerHTML=`<div class="wempty">No natural wonders found nearby.</div>`; return; }
  body.innerHTML=top.map((w,i)=>wonderCard(w,i)).join("");
  enrichWonders(top, body);   // Wikipedia layer fills in after
}
function wonderCard(w,i){
  // coord-based Maps link (NOT name) so the pin lands on the exact wonder, never a same-named place elsewhere
  const pin = (w.lat!=null&&w.lon!=null)
    ? `<a class="wpin" href="https://www.google.com/maps/search/?api=1&query=${w.lat},${w.lon}" target="_blank" rel="noopener" title="Open in Maps">${CP(0x1F4CD)}</a>`
    : "";
  return `<div class="wcard" data-i="${i}">
    <div class="wmain"><span class="wemoji">${w.ty.emoji}</span><span class="wname">${esc(w.name)}</span>`
    +`<span class="wmeta">${w.ty.label?esc(w.ty.label)+" &#183; ":""}${w.dist.toFixed(1)} km</span>${pin}</div>
    <div class="wrich"></div>
  </div>`;
}
/* ---------- layover step-out (what's near the CHANGE station) ----------
   The change-buffer maths already knows how long you stand at Olten; this turns
   a long layover from dead time into a choice. Same Overpass client as the
   wonders list, but scoped to the MINUTES YOU ACTUALLY HAVE: half the usable
   buffer walks out, at ~75 m/min, capped -- a layover is not a hike. */
const LAYOVER_MIN=20;   // below this you stay on the platform; a 12' change is a walk to a Gleis, not an outing
const LAYOVER_KEEP=10;  // minutes reserved to get back and find the platform again
function layoverWalkM(b){
  return Math.min(1000, Math.round((b-LAYOVER_KEEP)/2*75));
}
function lpType(t){
  if(t.amenity==="cafe")        return {e:CP(0x2615), l:"caf\u00e9"};
  if(t.amenity==="restaurant")  return {e:CP(0x1F37D),l:"restaurant"};
  if(t.amenity==="ice_cream")   return {e:CP(0x1F366),l:"ice cream"};
  if(t.shop==="bakery")         return {e:CP(0x1F950),l:"bakery"};
  if(t.tourism==="viewpoint")   return {e:CP(0x1F304),l:"viewpoint"};
  if(t.tourism==="museum")      return {e:CP(0x1F3DB),l:"museum"};
  if(t.historic)                return {e:CP(0x1F3F0),l:"historic"};
  if(t.leisure==="park")        return {e:CP(0x1F333),l:"park"};
  return {e:CP(0x1F4CD), l:""};
}
function layoverSpots(lat,lon,r){
  return overpassQuery(`lp:${lat},${lon},${r}`,
    `[out:json][timeout:12];(`
    +`node(around:${r},${lat},${lon})[amenity~"^(cafe|restaurant|ice_cream)$"][name];`
    +`node(around:${r},${lat},${lon})[shop=bakery][name];`
    +`node(around:${r},${lat},${lon})[tourism~"^(viewpoint|museum)$"][name];`
    +`node(around:${r},${lat},${lon})[historic~"^(castle|monument)$"][name];`
    +`way(around:${r},${lat},${lon})[leisure=park][name];`
    +`);out center 30;`);
}
function layoverRows(els, lat, lon, r){
  const seen=new Set(), list=[];
  for(const e of els||[]){
    const t=e.tags||{}; const name=t.name;
    if(!name || seen.has(name)) continue;
    const la=e.lat??e.center?.lat, lo=e.lon??e.center?.lon;
    if(la==null||lo==null) continue;
    const m=haversineKm(+lat,+lon,la,lo)*1000;
    if(m>r) continue;   // "around" is a circle over OSM geometry; re-check against OUR radius
    seen.add(name);
    list.push({name, ty:lpType(t), walk:Math.max(1,Math.ceil(m/75))});
  }
  list.sort((a,b)=>a.walk-b.walk);
  return list.slice(0,6);
}
async function layoverPOI(btn,ci,k){
  const x=jrnConns[ci]?._chg?.[k]; if(!x||!x.co) return;
  const card=btn.closest(".conn"), box=card&&card.querySelector(".lpoi");
  if(!box) return;
  if(box.innerHTML && !box.dataset.err){ box.innerHTML=""; return; }   // second tap folds it away
  delete box.dataset.err;   // a tap on an outage message retries instead of folding
  const r=layoverWalkM(x.b);
  const my=box.dataset.q=String(Date.now()+Math.random());
  box.innerHTML=`<div class="lploading">looking around ${esc(x.stn)}&#8230;</div>`;
  const els=await layoverSpots(x.co.x, x.co.y, r);
  if(box.dataset.q!==my || !box.innerHTML) return;   // folded away or re-asked while loading
  if(els===null){
    box.dataset.err="1";
    box.innerHTML=`<div class="lpcav">Could not check what&#39;s near ${esc(x.stn)} (no map mirror answered) &#8212; an outage, not a &quot;no&quot;. Tap again to retry.</div>`;
    return;
  }
  const rows=layoverRows(els, x.co.x, x.co.y, r);
  const walkMax=Math.max(1,Math.ceil(r/75));
  if(!rows.length){
    box.innerHTML=`<div class="lpempty">Nothing named within a ~${walkMax}&#8242; walk of ${esc(x.stn)} &#8212; a stretch on the platform, then.</div>`;
    return;
  }
  box.innerHTML=`<div class="lphead">${x.b}&#8242; at ${esc(x.stn)} &#8212; enough to step out</div>`
    + rows.map(p=>`<div class="lprow"><span class="lpe">${p.ty.e}</span><span class="lpn">${esc(p.name)}</span><span class="lpm">${p.ty.l?esc(p.ty.l)+" &#183; ":""}${p.walk}&#8242; walk</span></div>`).join("")
    + `<div class="lpcav">One-way walk times; keep ~${LAYOVER_KEEP}&#8242; to be back and find your platform. Opening hours not checked.</div>`;
}
/* ---------- ONBOARD: the pinned "I'm on this one" journey ----------
   Once you board, the planning list is history -- the one journey you are ON
   deserves a surface of its own. A persistent bar holds it across tabs and
   reloads (localStorage, NO GPS, no permission prompt: "which train am I on"
   is something you already know; the app only has to remember it). The gap
   sheet anchors to the NEXT change BY CLOCK, not by list order, and its
   verdict line -- enough to leave the platform / stay on the platform -- is
   always on, because only this app knows the buffer maths behind it. The
   nearby-spots list is OPTIONAL and user-toggleable: the app's first setting. */
let onboard = load(LS.onboard, null);   // slim snapshot of the pinned journey, or null
let obPoi   = load(LS.obpoi, false);    // nearby-spots layer during long changes (the setting)
let obOpen  = false;                    // gap sheet expanded?
let obKey   = "";                       // phase:k of the last paint -- an open sheet re-renders when the anchor moves
const OB_EXPIRE_MIN = 30;               // this long after arrival the pin quietly retires

/* The snapshot is SLIM on purpose: the full connection object drags the whole
   API response into localStorage; the bar needs names, times, legs and the
   change rows -- nothing else. */
function onboardSnap(c){
  const secs=(c.sections||[]).filter(s=>s.journey);
  return {
    from:c.from?.station?.name||"", to:c.to?.station?.name||"",
    dep:c.from?.prognosis?.departure||c.from?.departure||null,
    arr:c.to?.prognosis?.arrival||c.to?.arrival||null,
    legs:secs.map(s=>badge(s.journey.category,s.journey.number).label),
    chg:c._chg||[],
  };
}
/* Which change is NEXT is a clock question: the first one whose onward
   departure has not happened yet. While you stand at Olten waiting for the
   10:25, Olten IS still the next change -- its platform is the one you need. */
function onboardNext(ob,now){
  const chg=ob.chg||[];
  for(let k=0;k<chg.length;k++){
    const x=chg[k];
    if(x.dt && new Date(x.dt).getTime()>now) return {phase:"change",k,x,left:chg.length-k-1};
  }
  const arrT=ob.arr?new Date(ob.arr).getTime():0;
  return {phase: now>arrT ? "arrived" : "arriving", k:-1, x:null, left:0};
}
/* The verdict line is ALWAYS on -- it is the one thing here nobody else can
   tell you. The station signage knows the platform; only the buffer maths
   knows whether those minutes buy you the station hall or just the Gleis. */
function obVerdictHTML(x){
  if(x.missed)          return `<div class="obverdict miss">&#9888; missed by ${-x.b}&#8242; &#8212; this change cannot be made; replan from ${esc(x.stn)}</div>`;
  if(x.b>=LAYOVER_MIN)  return `<div class="obverdict go">${x.b}&#8242; &#8212; enough to leave the platform</div>`;
  return `<div class="obverdict stay">${x.b}&#8242; &#8212; stay on the platform</div>`;
}
function obLineHTML(ob,nx){
  const pin=CP(0x1F4CC);
  if(nx.phase==="arrived")  return `${pin} <b>${esc(ob.to)}</b> &#8212; arrived`;
  if(nx.phase==="arriving"){
    const m=minsUntil(ob.arr);
    return `${pin} &#8594; <b>${esc(ob.to)}</b> ${hhmm(ob.arr)}${m>0&&m<600?` &#183; in ${m}&#8242;`:""} &#183; no more changes`;
  }
  const x=nx.x;
  const t=x.missed?`<b class="obmiss">missed</b>`:`<b>${x.b}&#8242;</b>`;
  return `${pin} &#8594; <b>${esc(ob.to)}</b> &#183; next change ${esc(x.stn)} ${t}${x.pd?` &#183; Pl.&#8201;${esc(x.pd)}`:""}`;
}
function obSheetHTML(ob,nx){
  const unpin=`<button type="button" class="obunpin" onclick="onboardUnpin()">unpin &#8212; I&#39;m off this journey</button>`;
  if(nx.phase!=="change"){
    const line=nx.phase==="arrived"
      ? `Arrived at <b>${esc(ob.to)}</b>.`
      : `No more changes &#8212; ride it out to <b>${esc(ob.to)}</b>, arriving <b>${hhmm(ob.arr)}</b>.`;
    return `<div class="obh">${line}</div>${unpin}`;
  }
  const x=nx.x;
  const times=`${x.at?`arrive ${hhmm(x.at)}${x.pa?` Pl.&#8201;${esc(x.pa)}`:""}`:""}${x.dt?` &#183; depart ${hhmm(x.dt)}${x.pd?` Pl.&#8201;${esc(x.pd)}`:""}`:""}`;
  const later = nx.left>0 ? `then ${nx.left} more change${nx.left===1?"":"s"} &#183; ` : "";
  // the setting travels with the sheet, so turning it on happens exactly where
  // its effect appears -- not in a settings screen the app does not have
  const tog=`<label class="obtog"><input type="checkbox" onchange="onboardPoiToggle(this)"${obPoi?" checked":""}> ${CP(0x1F5FA)}&#65039; show nearby spots during long changes</label>`;
  const poiBox = obPoi && !x.missed && x.b>=LAYOVER_MIN && x.co ? `<div class="obpoi"></div>` : "";
  return `<div class="obh">Next change &#8212; <b>${esc(x.stn)}</b></div>`
    + `<div class="obt">${times}</div>`
    + obVerdictHTML(x)
    + poiBox + tog
    + `<div class="obt">${later}arriving ${esc(ob.to)} <b>${hhmm(ob.arr)}</b></div>`
    + unpin;
}
/* Same Overpass client and row-maths as the layover card; only the container
   differs. Overpass takes real seconds at a big station, so the loading line
   is not decoration -- without it the sheet just looks broken. */
async function obFillPoi(box,x){
  if(!box) return;
  const r=layoverWalkM(x.b);
  const my=box.dataset.q=String(Date.now()+Math.random());
  box.innerHTML=`<div class="lploading">looking around ${esc(x.stn)}&#8230;</div>`;
  const els=await layoverSpots(x.co.x,x.co.y,r);
  if(box.dataset.q!==my) return;   // sheet re-rendered / toggled off while in flight
  if(els===null){
    box.innerHTML=`<div class="lpcav">Could not check what&#39;s near ${esc(x.stn)} (no map mirror answered) &#8212; an outage, not a &quot;no&quot;.</div>`;
    return;
  }
  const rows=layoverRows(els,x.co.x,x.co.y,r);
  if(!rows.length){
    box.innerHTML=`<div class="lpempty">Nothing named within a ~${Math.max(1,Math.ceil(r/75))}&#8242; walk of ${esc(x.stn)}.</div>`;
    return;
  }
  box.innerHTML=rows.map(p=>`<div class="lprow"><span class="lpe">${p.ty.e}</span><span class="lpn">${esc(p.name)}</span><span class="lpm">${p.ty.l?esc(p.ty.l)+" &#183; ":""}${p.walk}&#8242; walk</span></div>`).join("")
    + `<div class="lpcav">One-way walk times; keep ~${LAYOVER_KEEP}&#8242; to be back and find your platform. Opening hours not checked.</div>`;
}
function onboardPin(i){
  const c=jrnConns[i]; if(!c) return;
  onboard=onboardSnap(c);
  save(LS.onboard,onboard);
  obOpen=false; obKey="";
  const host=$("ob"); if(host) host.innerHTML="";   // rebuild the bar from scratch for the new journey
  paintOnboard();
}
function onboardUnpin(){
  onboard=null; save(LS.onboard,null);
  obOpen=false; obKey="";
  paintOnboard();
}
function onboardPoiToggle(el){
  obPoi=!!(el&&el.checked);
  save(LS.obpoi,obPoi);
  renderObSheet();
}
function onboardSheetToggle(){
  const bar=document.querySelector("#ob .obbar"); if(!bar) return;
  obOpen=!obOpen;
  bar.classList.toggle("open",obOpen);
  const btn=bar.querySelector(".obline"); if(btn) btn.setAttribute("aria-expanded",String(obOpen));
  const sheet=bar.querySelector(".obsheet");
  if(obOpen) renderObSheet();
  else if(sheet) sheet.innerHTML="";
}
function renderObSheet(){
  const box=document.querySelector("#ob .obsheet");
  if(!box||!onboard||!obOpen) return;
  const nx=onboardNext(onboard,Date.now());
  box.innerHTML=obSheetHTML(onboard,nx);
  if(obPoi && nx.phase==="change" && !nx.x.missed && nx.x.b>=LAYOVER_MIN && nx.x.co)
    obFillPoi(box.querySelector(".obpoi"), nx.x);
}
/* Runs on load and every 30 s. Only the one-line bar is rewritten each tick --
   the open sheet is left alone (a repaint would kill an in-flight Overpass
   fetch) unless the anchor itself moved to the next change. */
function paintOnboard(){
  const host=$("ob"); if(!host) return;
  if(onboard && onboard.arr && Date.now()>new Date(onboard.arr).getTime()+OB_EXPIRE_MIN*60000){
    onboard=null; save(LS.onboard,null);   // the journey ended; the pin must not haunt tomorrow
  }
  if(!onboard){ host.innerHTML=""; document.body.classList.remove("hasob"); obOpen=false; return; }
  document.body.classList.add("hasob");
  const nx=onboardNext(onboard,Date.now());
  const key=nx.phase+":"+nx.k;
  if(!host.querySelector(".obbar")){
    host.innerHTML=`<div class="obbar"><div class="obtop">`
      +`<button type="button" class="obline" onclick="onboardSheetToggle()" aria-expanded="false" aria-label="Your pinned journey &#8212; tap for the next change"></button>`
      +`<button type="button" class="obx" onclick="onboardUnpin()" aria-label="Unpin this journey">&#10005;</button>`
      +`</div><div class="obsheet"></div></div>`;
  }
  const lineEl=host.querySelector(".obline");
  const line=obLineHTML(onboard,nx);
  if(lineEl.innerHTML!==line) lineEl.innerHTML=line;
  if(obOpen && key!==obKey) renderObSheet();   // the anchor moved while the sheet was open
  obKey=key;
}

/* ---- Wikipedia enrichment (REST summary; keyless, CORS-open) ---- */
const wikiCache={};
function wikiSummary(title,lang){
  const key=lang+":"+title;
  if(wikiCache[key]) return wikiCache[key];
  wikiCache[key]=(async()=>{
    try{
      const r=await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g,"_"))}`);
      if(!r.ok) return null;
      const d=await r.json();
      if(d.type==="disambiguation") return null;
      return d;
    }catch(e){ return null; }
  })();
  return wikiCache[key];
}
// normalize a title/name for matching: strip diacritics, parentheticals, leading articles, punctuation
const wnorm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s*\(.*?\)\s*/g," ").replace(/[^a-z0-9 ]/g," ")
  .replace(/\b(le|la|les|l|der|die|das|il|lo|the|de|du)\b/g," ").replace(/\s+/g," ").trim();
// geo-constrained title lookup: only accept an article NEAR the wonder's coord whose name matches,
// so an untagged "Le Belvedere" near Sion can't grab Ravel's identically-named house in France
const FUZZY_MAX_M=2000;   // exact titles may sit anywhere in the radius; fuzzy ones must be this close
async function wikiGeoTitle(lat,lon,name,lang){
  try{
    const u=`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch`
      +`&gscoord=${lat}%7C${lon}&gsradius=10000&gslimit=20&format=json&origin=*`;
    const r=await fetch(u);
    if(!r.ok) return null;
    const d=await r.json();
    const hits=(d&&d.query&&d.query.geosearch)||[];   // returned nearest-first, each with .dist (m)
    const want=wnorm(name);
    if(want.length<3) return null;
    const multi=want.includes(" ");
    for(const h of hits){
      const t=wnorm(h.title);
      if(t===want) return h.title;                    // exact title: trust it anywhere in the radius
      // Prefix matches are where a generic name grabs a namesake ("Pont" pulling
      // "Pont de la Machine"), so they must ALSO be close -- a POI's own article
      // sits near its coordinate. A single-token name is too generic to prefix-match at all.
      if(multi && h.dist!=null && h.dist<=FUZZY_MAX_M && (t.startsWith(want+" ") || want.startsWith(t+" "))) return h.title;
    }
    return null;
  }catch(e){ return null; }
}
async function wonderWiki(w){
  // clean path first: an explicit OSM wikipedia tag "lang:Title" -> fetch that exact article
  if(w.wikipedia){
    const i=w.wikipedia.indexOf(":");
    if(i>0){ const d=await wikiSummary(w.wikipedia.slice(i+1), w.wikipedia.slice(0,i)); if(d&&d.extract) return d; }
  }
  // fallback: geo-verify by name near the coord (Swiss local langs first). Never show a blurb we can't geo-confirm.
  if(w.lat!=null&&w.lon!=null){
    for(const lang of ["fr","de","it","en"]){
      const title=await wikiGeoTitle(w.lat, w.lon, w.name, lang);
      if(title){ const d=await wikiSummary(title, lang); if(d&&d.extract&&d.extract.length>=25) return d; }
    }
  }
  return null;
}
function enrichWonders(top, body){
  top.forEach(async(w,i)=>{
    const d=await wonderWiki(w);
    if(!d||!d.extract) return;
    const slot=body.querySelector(`.wcard[data-i="${i}"] .wrich`);
    if(!slot) return;
    const thumb=d.thumbnail&&d.thumbnail.source;
    const url=d.content_urls&&d.content_urls.desktop&&d.content_urls.desktop.page;
    const ex=d.extract.length>140 ? d.extract.slice(0,140).trim()+"\u2026" : d.extract;
    slot.innerHTML=`${thumb?`<img class="wthumb" src="${esc(thumb)}" alt="" loading="lazy">`:""}`
      +`<div class="wtext"><p>${esc(ex)}</p>`
      +`${url?`<a href="${esc(url)}" target="_blank" rel="noopener">more</a> &#183; `:""}`
      +`<span class="wattr">from Wikipedia</span></div>`;
  });
}

// resolve to [] if a slow query outruns the cap, so one lagging hub can't stall first paint
function withTimeout(p, ms){ return Promise.race([p, new Promise(r=>setTimeout(()=>r([]), ms))]); }

/* A sweep takes up to five seconds. Refusing to start a new one while the old
   one runs meant a mode chip tapped in that window did NOTHING -- no result, no
   feedback -- and the only reading available to you is that the control is
   broken. A tap is an instruction, so it supersedes: the older sweep is ABORTED
   (its zombie fetches used to jam the connection pool until the tab was closed)
   and barred from painting over the newer answer. */
async function smartPlan(){
  if(!fromName||!toName) return;
  const gen=++jrnGen;
  if(jrnAbort) jrnAbort.abort();
  jrnAbort = new AbortController();
  const sig = jrnAbort.signal;
  $("jrnOut").innerHTML = skel(4);
  try{
    const f=encodeURIComponent(fromName), t=encodeURIComponent(toName);
    // Fire everything at once. The two direct queries (base + wide) are the fast core;
    // hub sweeps run in parallel, each capped so the slowest hub can't hold up first paint.
    const direct={failed:false, ok:false};   // only the two DIRECT queries decide whether "not found" is honest
    const baseP = tryConns(`from=${f}&to=${t}${viaQS()}&limit=6${whenQS()}${modeQS()}`, direct, sig);
    const wideP = tryConns(`from=${f}&to=${t}${viaQS()}&limit=16${whenQS()}${modeQS()}`, direct, sig);
    // A named via stands the sweep down: see the two rules at viaQS(). The
    // API takes ONE via[] here, and a second one is not "more thorough" --
    // it is a different journey the passenger did not ask for.
    const hubList = viaName ? [] : [...HUBS, ...(preferScenic?SCENIC_HUBS:[])].filter(h=>h!==fromName&&h!==toName);
    const HUB_CAP=5000;  // tunable: bounds hub fill-in (hubs measured 3.3-9.3s); the base render fixes PERCEIVED latency regardless of this
    const hubJobs = hubList.map(h=>
      withTimeout(tryConns(`from=${f}&to=${t}&via[]=${encodeURIComponent(h)}&limit=3${whenQS()}${modeQS()}`, null, sig), HUB_CAP)
        .then(cs=>cs.map(c=>{c._via=h; return c;})).catch(()=>[]));

    // Phase 1 -- render the direct/wide results the moment they land (~base latency), hint that more is coming
    const [rawBase, rawWide] = await Promise.all([baseP, wideP]);
    if(gen!==jrnGen) return;                                       // superseded
    // Filter BEFORE the baseline is picked. The baseline is what every other
    // option is scored against ("arrives earlier", "roomier change"), so leaving
    // a filtered-out train as the yardstick would rank the list against a train
    // you just said you did not want.
    const base=catFilter(rawBase), wide=catFilter(rawWide);
    const nRaw=rawBase.length+rawWide.length, nKept=base.length+wide.length;
    const baseline = base[0] ? annotate(base[0]) : null;
    if(base.length||wide.length) rememberRoute(fromName,toName);   // a real result -- now it is worth a chip
    renderSmart(base, wide.slice(), baseline, true, (direct.failed && !direct.ok) ? (direct.err||true) : null, nKept, nRaw);

    // Phase 2 -- hub routes fill in when they arrive; any past the cap are dropped silently
    const rawHubs = (await Promise.allSettled(hubJobs)).flatMap(r=>r.status==="fulfilled"?r.value:[]);
    if(gen!==jrnGen) return;                                       // superseded
    const hubResults = catFilter(rawHubs);
    renderSmart(base, wide.concat(hubResults), baseline, false, (direct.failed && !direct.ok) ? (direct.err||true) : null,
                nKept+hubResults.length, nRaw+rawHubs.length);
    fillJourneyLastHome(gen);   // after the settled render: the slot exists now, and gen bars a stale paint
  }catch(e){
    if(gen!==jrnGen) return;                                       // superseded
    $("jrnOut").innerHTML=errBox(e);
  }
}

// score + pin + paint a candidate set; called twice (fast base-only, then full sweep)
/* reqErr, not reqFailed: a boolean could only ever produce one sentence, and the
   sentence it produced blamed the passenger's connection for the service's
   refusal. It carries the thrown error when the direct query died unanswered,
   and null otherwise -- still falsy at the branch, so the "one answered query is
   a definite answer" rule above is unchanged. */
function renderSmart(base, swept, baseline, searching, reqErr, nKept, nRaw){
  const seen=new Set(), all=[];
  base.concat(swept).forEach(c=>{ const s=connSig(c); if(!seen.has(s)){ seen.add(s); all.push(annotate(c)); } });
  if(!all.length){
    // an empty base can still be rescued by the incoming hub sweep -- don't paint the dead-end while still searching
    /* The mode filter is the one thing on this screen you can be stuck BEHIND,
       and it survives reloads -- so the way out of it must be printed on the
       failure branch too. Suppressing it there deleted the only exit at exactly
       the moment it was needed: an outage plus a remembered tram filter reads as
       a permanently broken app, and the button that fixes it was one line away
       the whole time. Whether the request landed is unknown; that you set a
       filter is not. */
    if(!searching) pgObserve([]);
    if(!searching) $("jrnOut").innerHTML = reqErr
      ? errBox(reqErr) + `${modeWhyEmpty()}${nRaw?catWhyEmpty():""}`
      : `<div class="empty"><div class="big">&#9940;</div>No connections found.${sunWhyEmpty()||((viaName||pgStuck)?"":"<br>Check the station names.")}${viaWhyEmpty()}${pgWhyEmpty()}${modeWhyEmpty()}${nRaw?catWhyEmpty():""}</div>`;
    return;
  }

  const now=Date.now();
  const baseArr = baseline ? baseline._arr : Infinity;
  const baseBuf = baseline ? baseline._buf : null;
  const baseSig = baseline ? connSig(baseline) : "";
  all.forEach(c=>{
    c._isBase = connSig(c)===baseSig;
    c._scenic = (c.sections||[]).some(s=>s.journey && isScenic(s.journey.category));
    c._earlier = c._arr < baseArr;
    c._safer   = !c._isBase && !c._tight && baseline!=null &&
                 (baseline._tight || (baseBuf!=null && c._buf!=null && c._buf>=baseBuf+3)) &&
                 c._arr <= baseArr + SAFER_LATER*60000;   // roomier, within the slower-tolerance window (F4)
    c._beats = c._earlier || c._safer;
    // F3: a genuine "smart pick" (green) must NOT be tight; an earlier-but-tight
    // option is an honest tradeoff, never crowned as safe and never hides its warning
    c._safePick   = c._beats && !c._tight;
    c._fasterTight = c._beats && c._tight;
    c._why = c._safer && c._earlier ? "earlier & roomier"
           : c._safer ? "roomier change"
           : "arrives earlier";
  });

  let cand = all.filter(c=> c._dep > now-60000 || c._isBase);
  const fastest = Math.min(...cand.map(c=>c._arr));
  // scenic routes are exempt from the detour cull when "prefer scenic" is on (slower IS the point)
  cand = cand.filter(c=> c._isBase || (preferScenic && c._scenic) || c._arr <= fastest + WINDOW_MIN*60000);
  cand.sort((a,b)=> (preferScenic ? ((b._scenic?1:0)-(a._scenic?1:0)) : 0) || (b._safePick-a._safePick) || (b._beats-a._beats) || (a._arr-b._arr) || ((b._buf??-1)-(a._buf??-1)) || (a._chg.length-b._chg.length));
  // display-safety: prefer-scenic floats scenics to the top, so with >=7 scenic
  // options a plain slice(0,7) could hide the SBB default / absolute-fastest off the
  // visible list -- the exact "hidden default" sin this app exists to fix. Pin them in.
  const pin = new Set(cand.filter(c=> c._isBase || c._arr===fastest));
  const top = [...pin, ...cand.filter(c=>!pin.has(c))].slice(0,7).sort((a,b)=>
    (preferScenic ? ((b._scenic?1:0)-(a._scenic?1:0)) : 0) || (b._safePick-a._safePick) || (b._beats-a._beats) || (a._arr-b._arr) || ((b._buf??-1)-(a._buf??-1)));
  const nSafe = top.filter(c=>c._safePick).length;
  const swN = new Set(swept.map(connSig)).size;

  jrnConns = top;   // render order == the ci the leg buttons index back into
  if(!searching) pgObserve(top);   // the searching pass is a partial list -- judging the step on it would misread a slow hub as the end of the day
  $("jrnOut").innerHTML = smartHead(baseline, nSafe, swN)
    + shareBarHTML()
    + pgNote()
    + viaNote()
    + catFilterNote(nKept, nRaw)
    + (searching?`<div class="shint">&#8987; searching wider routes&#8230;</div>`
                :jrnZoneFact()+`<div id="jlh"></div>`)   // route-level facts, settled render only (one request per search, not per phase)
    + top.map((c,i)=>connCard(c,i)).join("")
    + (searching?"":wondersExpanderHTML((base[0]||swept[0])?.to?.station));   // expander only on the settled render
  if(weather) fillWeather();
}

function smartHead(baseline, nSafe, swN){
  if(!baseline) return `<div class="shead">Swept ${swN} hub route${swN===1?"":"s"} &#183; best options below &#8595;</div>`;
  const bb=baseline._buf;
  if(baseline._tight){
    return `<div class="shead warn">&#9888; SBB&#39;s fastest pick has a tight <b>${bb}&#8201;min</b> change at <b>${esc(baseline._chg.find(x=>x.b===bb)?.stn||"a hub")}</b>.`
      + (nSafe?` Found <b>${nSafe}</b> option${nSafe===1?"":"s"} with a safer change &#8595;`:` No safer alternative beat it &#8212; it&#39;s the fastest.`)
      + `</div>`;
  }
  if(nSafe) return `<div class="shead good">Swept ${swN} routes &#183; <b>${nSafe}</b> option${nSafe===1?"":"s"} the default list didn&#39;t lead with &#8595;</div>`;
  return `<div class="shead good">SBB&#39;s default looks solid${bb!=null?` (<b>${bb}&#8201;min</b> transfer slack)`:` (direct)`}. Full swept spread below &#8595;</div>`;
}

/* ---------- Tarifverbund coverage (which zone-ticket area a stop is in) ----------
   The answer is PRECOMPUTED, not computed. Shipping the zone geometry and doing
   point-in-polygon in the browser costs 4.4 MB of polygons; the cheap substitute
   (nearest zone centroid) is 125 KB but wrong for 2.2% of stations -- and "is my
   ticket valid here" is the last claim that should be approximately right. So
   tools/build-verbund.py runs the point-in-polygon once, offline, and what ships
   is the answer: exact, 17 KB, no runtime dependency on anyone.

   Keyed by UIC number because transport.opendata.ch already hands us one
   (station.id 8507000 = Bern), so a lookup is an integer hit, not a name match.
   Packed as delta-encoded ids + a hex bitmask, because a station can be in two
   Verbunde at once (315 are) and a bitmask makes that the same row, not a
   special case. */
/* VERBUND-DATA-START (generated by tools/build-verbund.py) */
const VERBUND_NAMES=["A-Welle", "Arcobaleno", "Frimobil", "Libero", "Léman Pass", "Mobilis", "ONDE VERTE", "Ostwind", "Passepartout", "TNW", "Tarifverbund Davos", "Tarifverbund Klosters", "Tarifverbund Schwyz", "Tarifverbund Zug", "Transreno", "Vagabond", "ZVV", "engadin mobil", "unireso"];
const VERBUND_PACKED="81b323.20,7.200,6.200,4.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.201,3.200,1.200,1.200,1.200,1.201,2.1,1.200,d.200,9.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,2.200,1.200,1.200,1.200,3.200,1.200,2.200,a.200,1.200,5.200,1.200,1.200,3.8,1.8,1.8,1.8,1.8,1.8008,4.8000,4.200,1.200,1.200,1.200,1.200,1.200,1.200,1.8000,1.8000,1.8000,1.8000,1.8000,1.8000,1.8000,1.8000,1.8000,7.8,1.200,2.200,3.8000,3.8000,2.200,1.200,c.8,1.200,1.200,1.8008,2.8008,1.8008,2.8048,2.8040,1.8008,1.8008,1.8048,1.8048,1.8040,1.8040,1.8040,1.8040,1.40,1.40,1.8040,1.40,3.40,2.8000,1.8000,1.8000,1.200,1.8040,1.8040,1.8000,1.200,1.8000,1.8000,1.8000,3.8000,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.9,1.9,1.9,1.1,1.1,1.1,1.1,1.1,2.8,1.8,c.200,1.200,1.200,1.200,1.200,d.8,1.8,1.8,2.200,1.200,1.200,4.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,1.8,1.8,1.8,1.8,1.8,2.80,1.80,1.80,1.8,1.400,1.400,1.8,2.8,1.8,1.8,1.9,1.9,1.800,2.9,1.9,1.9,2.20000,3.100,1.200,1.200,1.200,1.200,1.201,1.201,4.1,4.200,3.1000,1.1000,1.800,1.20000,1.201,2.201,7.1,2.80,1.80,6.4,1.4,7.100,1.2,1.2,1.2,1.2,b.20,4.20000,1.20000,1.80,1.80,1.4000,1.2,51.2,12.2,1.2,c.100,a4.100,2e.200,a3.200,11.200,19.200,1.200,1.200,5f.200,6.40010,1.40010,1.40010,1.40010,3.40010,1.40010,1.40010,3.40010,1.40010,1.40010,1.20,1.20,5.40010,1.40010,1.40010,1.20,3.40010,4.20,1.20,2.20,2.20,1.20,1.20,5.20,3.20,2.20,1.20,5.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,6.20,2.20,3.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,3.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,18.20,1.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,2.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,2.20,a.20,3.20,4.20,1.20,1.20,1.20,1.20,1.20,4.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,b.20,1.20,4.20,1.40010,2.40010,a.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,7.20,1.20,1.20,1.20,1.20,e.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,d.20,1.20,1.20,1.20,1.20,2.20,2.20,3.40010,1.20,1.20,1.20,3.20,4.20,1d.20,1.20,3.20,1.8,2.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.24,1.24,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.24,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.8,1.8,1.20,2.20,1.20,11.20,1.20,1.20,1.20,1.20,17.20,5.20,5.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,3.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,2.20,1.20,1.20,1.20,1.20,1.20,3b.20,4e.4,5d.20,1.20,1.20,111.1,1.101,1.101,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,5.100,2.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.101,1.1,1.1,1.1,1.1,1.101,8.100,1.1,39.1,1.1,1.1,1.1,1.1,1.1,1.1,4.1,1.1,1.1,1.1,1.1,1.1,1.1,3.1,1.101,1.101,1.1,1.1,5.1,20.1,1.1,1.1,1.1,1.1,1.1,1.1,1.101,1.101,1.101,5.1,2.101,1.1,1.1,1.1,1.1,1.1,1.1,2.1,1.1,1.10000,1.1,1.1,1.1,2.1,1.1,2.1,1.1,1.1,1.1,2.1,1.100,1.2100,1.2100,1.2000,1.2000,1.2000,1.2000,2.10000,1.10000,2.1,1.1,1.1,1.1,1.1,1.1,1.1,1.2001,1.2001,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.12000,1.2000,2.10000,1.2000,1.2000,6.1,a.1,1.1,3.2000,1.2000,5.3100,b.1,1.1,1.10000,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.10000,d.2000,1.2000,8.2000,6.2100,aa.20,60.10000,1ac.10000,1.10000,2.10000,1.10000,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,4.10000,1.10000,4.10000,1f.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,2.10000,2.10000,1.10000,2.10000,1.10000,3.10000,1.10000,1.10000,1.10000,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10080,1.10000,1.10080,1.10080,2.80,1.80,1.80,1.80,1.80,1.10080,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,2.10000,6.10000,35.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.80,9.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,a.1000,a.80,1.80,7.80,1.80,b.1000,2.3000,1.1000,1.11000,1.11000,1.10000,1.10000,1.10000,1.10000,1.3000,2.3000,1.10000,1.10000,1.10000,4.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10001,1.10001,15.10000,3c.10000,1.10000,1.10000,1.10000,1.10080,1.10000,3.1,1.1,1.1,1.1,2.10001,1.1,1.1,8.80,1.80,1.10080,1.10080,1.80,1.80,1.80,11.10000,1.10000,e.80,1.80,1.80,1.80,1.80,1.80,1.80,20.10000,1.10000,1.1,1.1,1.1,1.1,1.1,1.1,2.10000,1.10000,2.1,1.10000,d.10000,1.10000,1.10000,1.10000,1.1,51.10000,1.80,22.80,8.10000,4.10000,3.10000,6.10000,3.10000,1.10000,5.10000,5.10000,3.80,13d.20,3.20,4.20,3.20,1.20,1.20,1.20,1.24,1.20,1.24,1.24,1.24,2.24,1.4,2.4,1.4,1.4,1.4,1.4,1.4,1.4,1.4,a.20,14.24,1.24,1.24,1.4,1.4,1.4,1.4,1.4,3.24,1.4,1.4,1.4,1.4,1.4,2.4,1.4,1.4,5.4,2.4,2.4,1.4,b.4,1.4,1.4,1.c,1.8,1.8,1.8,2.8,5.c,2.8,2.8,3.24,1.24,1.24,1.24,1.24,1.24,1.24,1.24,1.4,1.4,1.20,1.24,1.24,1.24,1.24,1.24,1.4,1.4,1.4,1.4,1.4,1.20,28.4,1.4,1.24,1.24,1.4,1.4,2.24,3.c,1.c,2.c,6.20,1.20,2.60,1.60,1.60,1.60,2.40,1.40,6.60,1.60,1.40,1.40,1.40,1.40,1.40,1.40,1.40,1.40,1.48,1.48,2.48,3.40,1.40,2.40,2.40,1.40,1f.40,1.40,f.60,1.60,1.60,1.60,1.60,1.60,2.20,1.20,1.20,1.20,1.20,1.20,2.20,2.8,1.8,1.8,1.8,1.8,1.8,1.8,1.48,1.48,1.48,1.48,1.48,1.48,2.40,1.40,1.40,1.40,4.40,4.40,19.8,1.8,1.8,1.8,1.8,1.8,1.48,1.48,1.48,1.48,1.48,1.48,2.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,3.48,2.48,3.8,2.40,1.40,1.40,1.40,1.40,1.40,1.40,1.40,3.40,1.40,6.40,2.c,1.c,1.8,1.8,1.8,6.8,1.8,1.8,1.8,1.8,1.8,1.8,3.8,16.8,14.8,1.8,1.8,1.8,1.8,1.8,1.8,1.c,1.8,1.8,1.8,1.8,2.8,1.8,5.40,1.40,1.48,1.c,1.c,1.8,1.8,1.8,1.8,1.8,1.48,9.24,b.40,1.40,27.40,8.20,4.24,3.48,1.40,1.40,4.24,1.24,1.24,4.4,ab.4,1.4,3b.40,c0.100,1.100,1.3100,1.3100,1.3000,1.1000,1.1000,1.1000,4.3100,7.100,2a.3000,2.3000,1.3000,1.3000,1.3000,1.3000,1.3000,1.3000,1.3000,2.1100,1.1100,1.1100,1.1100,1.1100,3.3000,1.1100,9.3100,1.1000,1.1000,1.1000,57.2,1.2,1.2,15.2,1.2,2.2,1.2,2.2,2.2,3.2,1.2,1.2,2.2,1.2,1.2,1.2,7.8,21.2,1.2,d.2,1b.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,2b.3000,c.80,4.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,b.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,2.2,1.2,1.2,2.2,2.2,2.2,3.2,2.2,32.2,2.2,1.2,1.2,1.2,1.2,12.2,1.2,1.2,1.2,1.2,1.2,1.2,2.2,13.2,12.2,5.2,3.2,1.2,3.2,2.2,3.2,1.2,10.2,1.2,2.2,16.2,3.2,35.2,5.2,11.2,1.2,1.2,1.2,144.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10080,1.10000,1.10000,1.80,1.80,1.80,1.80,1.10000,1.10000,1.10000,1.10000,1.10000,1.80,1.10000,1.10000,1.10000,1.10000,1.10080,1.80,1.80,1.80,8.10000,1.10000,2.10000,1.10080,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10000,1.10080,33.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,5.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,3.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,4.80,5.80,2.80,2.80,1.80,2.80,4.80,3.80,3.80,3.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,3.80,2.80,3.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,21.80,1.80,6.80,2.80,2.80,1.80,3.80,1.80,2.80,1.80,1.80,1.80,3.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,3.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,3.80,18.80,4.80,1.80,1.80,1.80,1.80,1.80,3.80,1.80,2.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,3.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,2a.80,19.80,3.80,33.8,1df.8,2.8,1.8,2.8,1.8,1.8,1.8,1.8,29.8,2.8,1.8,1.8,1.8,5.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,4.8,1.8,1.8,1.8,1.8,1.c,1.c,2.8,1.8,1.8,1.8,1.c,1.8,1.8,1.8,1.8,1.8,a.8,28.8,3.8,3.8,7.8,3.8,1.8,2.8,15.8,1.8,1.8,2.8,1.8,37.8,1.8,7.8,1.8,1.8,1.8,1.8,8.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,3.8,2.8,1.8,1.8,2.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,32.8,1.8,1.8,1.8,2.8,2.8,1.8,1.8,1.8,2.8,1.8,1.8,4.8,1.8,1.8,2.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,1.8,1.8,1.8,2.8,1.8,2.8,39.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,10.8,3.8,2.8,1.8,2.8,9.8,1.8,39.8,2.8,3.8,5.8,21.8,1.8,70.100,11f.8,8.8,2.8,1.8,1.8,1.8,2.8,2b.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,2.8,2.8,1.8,4.8,5.8,1.8,2.8,1.8,1.8,1.8,1.8,1.8,1.8,b.8,1.108,1.9,1.1,19.40010,2.40010,2.40010,2.40010,11.8,1.8,1.8,1.8,1.8,2.9,1.9,1.9,2.108,1.108,1.108,1.108,4.108,5.108,1.8,7.8,1.8,1.8,1.8,1.8,1.8,1.8,6.8,1.8,6.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.108,1.100,1.100,1.100,2.100,1.100,1.100,1.100,1.100,1f.8,1.8,1.8,1.8,1.8,1.8,1.8,4.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,1.8,1.8,2.8,1.8,2.8,7.8,1.8,1.8,5.108,1.108,1.100,1.100,2.100,4.8,2.8,1.8,1.8,1.8,2.8,1.8,1.100,1.100,1.100,1.100,1.100,2.100,1.100,1.100,1.100,1.100,1.100,2.100,4.100,2.8,15.8,1.8,1.8,1.8,1.100,1.8,1.100,1.100,2.8,1.100,1.100,2.100,1.100,1.100,1.100,1.100,1.100,2.8,1.8,7.8,2.8,4.100,6.100,1.100,1.100,2.100,1.8,1.100,3.100,32.100,4.100,1.100,1.100,1.100,2.100,1.100,7.100,2.1000,2.1000,1.100,7.100,2.100,1.100,1.100,3.100,3.3100,1.100,2.100,1.100,1.8,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,1.100,2.100,2e.100,1.100,1c0.4000,2.4000,2.80,2.4000,2c.4000,1.4000,2.4000,1.4000,1.4000,1.4000,9.800,2.800,1.800,1.800,1.400,1.400,1.400,1.400,2.400,1.400,1.400,1.400,2.800,1.800,1.800,1.400,1.400,1.400,3.400,1.400,1.400,1.400,1.400,1.400,2.800,1.400,36.4000,1d.2,1.4000,1.4000,1.4000,1.4000,1.4000,1.4000,e.20000,33.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,a.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,49.20000,1.20000,1.20000,1.20000,1.20000,2.20000,1.20000,e.20000,1.20000,1.20000,2.20000,1.20000,4.20000,1.20000,1.20000,1.20000,11.80,1.80,1.80,2.80,2.80,5.80,1.80,1.80,1.80,2.80,1.80,1.80,16.80,a.80,1.80,c0.10000,2.10000,22.4000,1b4.10001,58.10001,10b.8,19.80,79.200,36.20,26.2,12d.20000,a2.8,37.10000,52.400,143.80,103.80,12d.20,3.20,d3.20,e03.2000,1.2000,1.2000,1.2000,1.2100,1.2100,9d.8,1.40010,6.8,d.40010,2.1,b.2000,1f.10000,1.1,33.80,1.80,1.40010,1.40010,1.40010,9.40010,43.100,1.100,2.100,1.100,5a.c,6.1,13a.200,f6.200,66.2000,13.200,b.40010,c2.100,28.10000,1.1,20.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,40.20000,3.20,1.20,22.2,8.2000,23d.80,8f.80,9d.8,34.20,7.2000,10.2,d7.9,b.1,30.8,16.8,99.80,27.8,55.80,1d.20,38.4,ad.80,40.20000,13b.1,284e.20,1.60,1.60,1.40,1.40,1.40,3.40,1.40,1.4,1.4,2.4,1.4,4.4,1.4,1.40,1.4,7.20,1.20,1.20,5.20,1.20,1.20,1.20,1.20,4.20,8.20,2.20,1.20,1.20,6.20,2.20,1.20,1.20,1.20,1.20,1.20,9a.40,15.20,b.8,1.8,1.8,1.40,1.20,1.20,1.20,3.8,1.8,1.8,1.8,1.8,4.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,1.8,1.8,4.8,1.8,1.8,1.8,1.8,1.8,4.8,1.8,1.8,2.8,1.8,2.8,1.8,3.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,8.8,1.8,3.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,2.8,2.108,1.108,1.100,1.100,1.20,1.100,1.100,1.100,1.100,1.100,1.100,3.100,1.100,1.20,1.100,1.100,1.100,2.100,1.8,1.8,1.100,1.100,1.100,1.100,1.20,1.100,1.100,3.100,1.100,1.100,1.100,1.3100,1.1100,3.1000,1.1000,1.1000,7.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.1000,1.3000,1.3000,12.20,6.2,1.2,1.2,8.2,1.2,1.2,1.2,1.2,1.2,1.2,2.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,1.2,2.2,1.2,3.2,1.2,4.10000,4.80,1.80,5.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,2.80,1.80,1.80,1.80,5.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.80,1.20,1.80,1.80,1.80,7.800,1.800,1.400,1.400,1.800,1.800,2.400,1.400,20.2,1.2,10.20,6.20000,1.20000,1.20000,1.20000,2.20000,1.20000,1.80,1.20000,1.20000,1.20000,a.40010,5.20,1.20,1.20,1.40,2.1,1.1,4.101,1.1,2.2000,1.2000,1.2000,1.200,1.200,2.200,3.10000,2.10000,3.10000,1.80,1.10000,1.10000,1.10000,1.10080,1.10000,1.10001,1.1,1.10000,1.80,3.80,1.80,1.80,1.80,1.80,2.20000,1.20000,1.20000,1.2,1.8,2.20,1.20,4.8,2.8,1.100,1.100,1.3000,1.400,1.20000,2.1100,a.200,1.200,1.40010,1.40010,1.40010,7.40,1.40,1.40,1.40,1.40,1.40,1.20000,1.20000,5.80,2.1000,d.200,6.20000,1.2000,3.8,4.20,8.8,3.8,4.200,b.2,1.2,1.200,4.1000,1.1000,1.20,1.200,5.2,1.2,1.40,1.40,5.1000,1.1000,1.8,1.8,1.8,3.2,5.80,1.80,1.10000,1.10000,1.10000,1.100,2.100,1.100,1.100,1.1000,1.1000,1.24,1.10000,5.2,1.2,2.80,6.10080,1.80,2.1000,1.1000,2.80,12.8,1.8,4f.8,1.8,1.20,3.2,3.8,3.80,1.20000,1.80,1.400,1.400,1.80,1.8,2.400,1.400,3.80,2.20000,3.8,2.400,1.8,1.8,4.100,25.8,1.8,1.8,1.8,1.8,1.400,1.100,1.100,1.100,1.100,1.100,1.1000,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,7.80,1.80,e.4000,2.100,1.100,1.100,1.100,1.100,1.2,1.2,1.2,1.2,3.8,1.8,1.8,2.8,1.8,1.8,1.8,1.8,1.8,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.400,1.8,1.8,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,1.20000,a.4000,1.20000,a.8,1.8,1.8,1.8,2.4,2.1000,1.1000,6.2,1.8,1.8,1.8,1.8,1.800,1.800,1.20000,1.20000,1.20000,1.20000,1.20000,1.20,1.80,1.80,1.80,3.8,c.20,1.20,1.20,1.20,1.20,2.2,e.100,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,1d.80,16.200,2.80,1.80,4.2,f.4000,1.4000,1.4000,1.4000,1e.80,1.80,1.80,1.80,2.8,1.8,3.4,1.4,2.100,16.80,1.80,1.80,1.80,3.20,e.20,1.20,1.20,1.20,a.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,1.20,2a.100,3.100,2.100,1.100,1.100,3.8,1.8,3.100,1.100,1.100,1.100,1.20000,1.20000,1.20000,1.20000,1.8,1.8,1.2,1.2,2.2,1.20,1.20,3.4,1.4,1.2,1.2,2.2,1.2,1.2,1.2,1.2,2.2,1.80,8.10000,1.10000,82f2.2,18f6.8,2.8,28.8,1.8,308.200,8b.200,356.10000,27.10000,1d2.10000,9a8.10000,b.10000,2.10000,1.10000,1.10000,1.10000,1.10000,1.10000,28.10000,196.8,158.8,6.8,47b.200,1.200,8.200,5.200,3.200,8.200,6.200,2.200,a.200,20.200,16.200,1.200,9.200,6.200,2.200,30.200,22.200,c.200,375.20,1.20,1.20,291.8,1.8,1.8,1.8,1.8,1.8,1d8.200,4c.10000,49.10000,2d.8,159.10000,1b.8,7b.200,1733.200,13.10000,25.40010,1.40010,3.40010,1.40010,d.40010,5.40010,2.40010,10a.10000,1.10000,25.40010,1.40010,1f.40010,13.40010,2b.8,1.8,72.20,1.20,38.10000,3.10000,48.20,48.10000,2b.2,3c.40010,5.40010,b.40010,6.40010,8b.200,8.200,1.200,1.200,5.10000,2c.80,34.8,13.20,128.200,40.10000,9.8,89.8,3b.200,1.200,1.200,4.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,1.200,93.200,3.200,6.200,25.8,b.8,2.8,1.8,3.8,c0.8,26.200,32.200,1.200,1.200,2.200,1.200,2.200,2.200,1.200,2.200,1.200,1.200,1.200,1.200,1.200,2.200,2.200,4.200,5.200,1.200,3.200,1.200,1.200,1.200,1.200,3.200,3.200,1.200,2.200,1.200,2.200,2.200,1.200,1.200,3.200,1.200,1.200,2.200,1.200,3.200,1.200,8.200,1.200,1.200,2.200,2.200,1.200,5.200,2.200,2.200,3.200,1.200,1.200,1.200,1.200,9.200,3.200,1.200,1.200,2f.200,2.200,4.200,1.200,4.200,1.200,b.200,5.200,3.200,a.200,26.20,4e.80,c0.100,78.80,4e.8,1.8,1.8,c.8,1.8,3.8,1.8,1.8,1.8,1.8,1.8,1.8,1.8,3.8,1.8,1.8,1.8,1.8,12.8,1.8,1.8,1.8,1.8,1.8,1f.8,34.8,5d.10000,11.1,22.10001,2.10001,2b.10000,4f.10001,2d.20,46.10000,d.10000,24.10000,11.10000,5.10000,25.10000,6.10000,88.10000,1d.10000,3.10000,1.10000,2.10000,3.10000,3.10000,2.10000,22.10000,1.10000,29.10000,8.10000,90.10000,1.10000,2.10000,2.10000,1.10000,a.10000,2.10000,1.10000,1.10000,3.10000,1.10000,1.10000,1.10000,1.10000,3.10000,1.10000,1.10000,2.10000,1.10000,3.10000,2.10000,1.10000,5.10000,2.10000,1.10000,b.10000,7.10000,1.10000,3.10000,1.10000,1.10000,4.10000,9.10000,2.10000,2.10000,3.10000,1.10000,1.10000,3.10000,4.10000,1.10000,2.10000,4.10000,e.10000,3.10000,5.10000,1.10000,2.10000,1.10000,1.10000,2.10000,2.10000,1.10000,2.10000,1.10000,1.10000,2.10000,1.10000,2.10000,1.10000,6.10000,3.10000,1.10000,5.10000,3.10000,1.10000,f.10000,2.10000,2.10000,7.10000,1.10000,3.10000,3.10000,1.10000,2.10000,5.10000,1.10000,1.10000,6.10000,3.10000,1.10000,1.10000,1.10000,1.10000,3.10000,1.10000,1.10000,7.10000,2.10000,1.10000,2.10000,3.10000,3.10000,1.10000,4.10000,7.10000,4.10000,1.10000,4.10000,1.10000,1.10000,1.10000,1.10000,2.10000,5.10000,1.10000,1.10000,1.10000,7.10000,1.10000,2.10000,2.10000,3.10000,3.10000,6.10000,2.10000,6.10000,4.10000,1.10000,1.10000,6.10000,1.10000,1.10000,1.10000,2.10000,1.10000,1.10000,1.10000,4.10000,1.10000,5.10000,2.10000,1.10000,2.10000,1.10000,4.10000,1.10000,1.10000,2.10000,1.10000,3.10000,1.10000,4.10000,2.10000,1.10000,1.10000,6.10000,3.10000,2.10000,3.10000,1.10000,2.10000,4.10000,1.10000,1.10000,4.10000,2.10000,2.10000,2.10000,3.10000,2.10000,2.10000,2.10000,172.20,c.10000,42.10000,79.20,b.20,8.20,5.20,7.20,1.20,1.20,2.20,9.20,19.20,c.20,5.20,19.20,5.20,50.20,4.20,6.20,51.200,2.200,1.200,e.200,1.200,78.200,b0.20,2a.40010,8.40010,1.40010,1.40010,7.40010,2.40010,f.40010,c.40010,3.40010,4.40010,2d.40010,10.40010,4.40010,2.40010,9.40010,2.40010,4.40010,9.40010,8.40010,d.40010,4.40010,2.40010,2.40010,6.40010,2.40010,1.40010,8.40010,c.40010,1.40010,b.40010,b.40010,2.40010,2.40010,e.40010,2.40010,1.40010,4.40010,5.40010,7.40010,2.40010,3a.40010,1.40010,1.40010,4.40010,3.40010,1.40010,3.40010,f.40010,3.40010,2.40010,3.40010,4.40010,4.40010,1.40010,2b.40010,3.40010,27.40010,6.40010,15.40010,2.40010,146.20,120.20,11.20,1.20,1.20,1.20,1.20,1a6.10000,21.40,8.10000,13.8,2a3.40010,1c.40010,b5.8,67.40,f3.8,b.1000,1.1000,1fb.10000,4.200";
/* VERBUND-DATA-END */
const VERBUND_BY_ID=(()=>{
  const m=new Map();
  if(!VERBUND_PACKED) return m;
  let id=0;
  for(const tok of VERBUND_PACKED.split(",")){
    const dot=tok.indexOf(".");
    if(dot<0) continue;
    id+=parseInt(tok.slice(0,dot),16);
    let mask=parseInt(tok.slice(dot+1),16); const names=[];
    for(let b=0; mask; b++, mask>>>=1) if(mask&1) names.push(VERBUND_NAMES[b]);
    m.set(id,names);
  }
  return m;
})();
/* Unknown is UNKNOWN. A stop we cannot resolve returns null and the UI says so;
   it must never fall back to a neighbouring zone's answer, because a confident
   wrong Verbund is worse than a visible gap -- that is the one you get fined
   for. Routing markers ("Gotthard-Basistunnel") carry no real UIC id and land
   here, which is correct: they are not places you can hold a ticket for. */
function verbundOf(stationId){
  const n=Number(stationId);
  if(!Number.isFinite(n)) return null;
  return VERBUND_BY_ID.get(n)||null;
}
/* The Verbunde a leg's stops touch, in travel order, de-duplicated. Stops we
   could not resolve are COUNTED, not dropped: "3 zones" and "3 zones + 2
   unknown" are different facts, and the second must not render as the first. */
function verbundSpan(rows){
  const out={zones:[],unknown:0};
  for(const p of rows||[]){
    const v=verbundOf(p&&p.station&&p.station.id);
    if(!v||!v.length){ out.unknown++; continue; }
    for(const name of v) if(!out.zones.includes(name)) out.zones.push(name);
  }
  return out;
}

/* ---------- expandable leg -> intermediate stops ----------
   Zero extra API calls: every stop already rides along in the connection
   response as section.journey.passList. jrnConns is the render-order
   registry the inline onclick indexes back into. */
let jrnConns=[];
function legStops(ci,si){
  const c=jrnConns[ci]; if(!c) return null;
  const s=(c.sections||[]).filter(x=>x.journey)[si]; if(!s||!s.journey) return null;
  const pl=s.journey.passList;
  if(!Array.isArray(pl)) return null;          // unavailable is NOT the same as non-stop
  // A passList also carries routing markers (e.g. "Bahn-2000-Strecke") which are
  // not stops: no arrival AND no departure. They appear mid-list, not only at the ends.
  // The same filter is what saves us from a MEASURED upstream defect: passList[0]
  // pairs the ORIGIN's departure time and platform with the TERMINUS's station id
  // and name:null (Aarau board 2026-07-27 -- RE to Wettingen carried id 8503505).
  // The name check kills that row. Do not "simplify" this predicate: dropping the
  // name test starts emitting the wrong station id, silently and plausibly.
  return pl.filter(p=>p.station?.name && (p.arrival||p.departure));
}
/* The zone-ticket areas this leg passes through. Deliberately says WHICH ZONES
   THE LEG TOUCHES and never "your ticket is valid" -- whether a given ticket
   covers a given ride depends on tariff rules this app does not model, and a
   wrong yes there is a fine. Naming the zones is checkable; validity is not. */
function verbundHTML(rows){
  const s=verbundSpan(rows);
  if(!s.zones.length && !s.unknown) return "";
  if(!s.zones.length)
    return `<div class="svb"><span class="vbq">No zone-ticket area covers these stops.</span></div>`;
  const chips=s.zones.map(z=>`<span class="vbz">${esc(z)}</span>`).join("");
  const rest=s.unknown
    ? `<span class="vbq">+${s.unknown} stop${s.unknown>1?"s":""} in none</span>` : "";
  return `<div class="svb"><span class="vbq">Zones</span>${chips}${rest}</div>`;
}
/* The zone question, at DECISION time. verbundHTML above names the zones of a
   leg you already expanded -- but "does a zone ticket cover this trip?" is a
   pre-purchase question, decided before any leg is tapped (UNSOLVED-GAPS.md
   para 3). Same honesty rule as verbundHTML: name zones as facts, NEVER say
   "your ticket is valid" -- validity depends on tariff rules this app does not
   model, and a wrong yes costs a fine.
   "all the way" is therefore only claimed when every leg has a stop list and
   every stop resolved to that one Verbund; a single unknown stop demotes the
   card to silence rather than to a rounded-up claim. Multiple zones are safe
   to print regardless: "touches A and B" stays true however many stops are
   unresolved. */
function connZones(ci){
  const c=jrnConns[ci]; if(!c) return null;
  const legs=(c.sections||[]).filter(x=>x.journey);
  if(!legs.length) return {hasLegs:false, zones:[], unknown:0, missing:false};
  const zones=[]; let unknown=0, missing=false;
  legs.forEach((_,si)=>{
    const rows=legStops(ci,si);
    if(rows===null){ missing=true; return; }
    const s=verbundSpan(rows);
    for(const z of s.zones) if(!zones.includes(z)) zones.push(z);
    unknown+=s.unknown;
  });
  return {hasLegs:true, zones, unknown, missing};
}
/* Per-card rib ONLY for a multi-zone crossing -- that differs by route, so it
   discriminates. A single-zone journey is identical on every card; repeating it
   trains the eye to skip the rib row, which then costs the tight-change warning
   that matters. The single-zone TICKET fact is not dropped: it moves to
   jrnZoneFact(), rendered once above the list. */
function connZoneRib(ci){
  const z=connZones(ci);
  if(!z || !z.hasLegs || z.zones.length<2) return "";
  return `<span class="rib vb">&#127903; ${z.zones.map(esc).join(" &#183; ")}</span>`;
}
/* Route-level: "one zone all the way" is what a ticket purchase hangs on. Claimed
   only when EVERY displayed option resolves fully to the SAME single zone -- one
   unresolved stop anywhere and this says nothing rather than rounding up. */
function jrnZoneFact(){
  let zone=null, seen=false;
  for(let i=0;i<jrnConns.length;i++){
    const z=connZones(i);
    if(!z || !z.hasLegs) continue;
    seen=true;
    if(z.unknown || z.missing || z.zones.length!==1) return "";
    if(zone===null) zone=z.zones[0];
    else if(zone!==z.zones[0]) return "";
  }
  if(!seen || zone===null) return "";
  return `<div class="jzf">&#127903; ${esc(zone)} all the way &#8212; every option shown</div>`;
}
/* ---------- am I on the right train? (cross-vendor finding #2) ----------
   Reassurance at the platform edge, from facts the passenger can physically
   check against the train in front of them: the line label, the departure time,
   the platform, and above all the DESTINATION SIGN -- journey.to is what the
   train's front display actually reads, and it is usually a city BEYOND your
   exit stop. That mismatch ("my plan says Sargans, the train says Chur") is the
   classic reason people let their own train leave. Plus the one check that
   works AFTER boarding: the first stop's name -- hear a different one announced
   and you are on the wrong train while it still costs one stop, not a canton.
   The honesty line is load-bearing (UNSOLVED-GAPS para 4: an absence must not
   read as an assurance): this API says NOTHING about train portions, and a
   split train's wrong portion is the one wrong train this check cannot catch. */
function rightTrainHTML(rows,ci,si){
  const s=(jrnConns[ci]?.sections||[]).filter(x=>x.journey)[si];
  if(!s||!s.journey) return "";
  const j=s.journey;
  const sign=j.to||"";
  const lbl=((j.category||"")+(j.number?" "+j.number:"")).trim();
  const dep=s.departure||{};
  const t=dep.prognosis?.departure||dep.departure;
  const pf=dep.prognosis?.platform||dep.platform;
  const exit=s.arrival?.station?.name||"";
  const first=rows&&rows.length>1&&rows[1] ? rows[1] : null;
  let h=`<div class="rtc"><span class="rtt">Right train?</span> `
    + (lbl?`<b>${esc(lbl)}</b>`:"")
    + (sign?` &#8594; sign reads &#8220;<b>${esc(shortStop(sign))}</b>&#8221;`:"")
    + (t?` &#183; dep ${hhmm(t)}`:"")
    + (pf?` &#183; Pl.&#8201;${esc(pf)}`:"");
  if(sign&&exit&&sign!==exit)
    h+=`<span class="rtx">You get off earlier, at ${esc(shortStop(exit))} &#8212; the &#8220;${esc(shortStop(sign))}&#8221; sign is still your train.</span>`;
  if(first)
    h+=`<span class="rtf">First stop after boarding: <b>${esc(first.station.name)}</b> ${hhmm(first.arrival||first.departure)} &#8212; a different name announced means the wrong train, one stop early.</span>`;
  h+=`<span class="rtcav">Train portions (splitting trains) are not in this data &#8212; check the carriage display too.</span>`;
  return h+`</div>`;
}
function stopsHTML(rows,ci,si){
  const rt = Number.isInteger(ci) ? rightTrainHTML(rows,ci,si) : "";
  if(rows===null) return rt+`<div class="snone">Stop list unavailable for this leg.</div>`;
  if(rows.length<=2) return rt+`<div class="snone">Non-stop &#8212; no intermediate stops.</div>`;
  /* replan affordance (UNSOLVED-GAPS 2.1): only when the caller names which
     connection these stops belong to, and never on the journey's own
     destination -- "replan from where you already are going" is a null query. */
  const dest = Number.isInteger(ci) ? jrnConns[ci]?.to?.station?.name : null;
  return rt + verbundHTML(rows) + rows.map((p,k)=>{
    const end = k===0 || k===rows.length-1;
    const t = k===0 ? (p.departure||p.arrival) : (p.arrival||p.departure);
    const rp = dest && p.station.name!==dest
      ? `<button class="srp" type="button" onclick="replanFromStop(event,${ci},${si},${k})"
           aria-label="Replan from ${esc(p.station.name)}, leaving now"
           title="Replan from here, leaving now">&#8635;</button>` : "";
    return `<div class="sline ${end?"end":""}">`
      + `<span class="st">${hhmm(t)}</span><span class="sdot"></span>`
      + `<span class="sname">${esc(p.station.name)}</span>`
      + (p.delay?`<span class="sdly">+${p.delay}&#8242;</span>`:"")
      + (p.platform?`<span class="splt">Pl.&#8201;${esc(p.platform)}</span>`:"")
      + rp
      + `</div>`;
  }).join("");
}
/* ---------- replan from here (UNSOLVED-GAPS 2.1, cross-vendor finding #1) ----------
   The expensive moment is minute 40, when the 3-minute delay becomes 9 and the
   plan is dead. The app has no GPS by design, so "here" is the stop the
   passenger taps in the route they are already looking at: one tap sets that
   stop as origin, keeps the destination, and re-runs the search LEAVING NOW --
   a fresh answer from the broken moment, not a patched-up old one. The stop is
   read off legStops at tap time, never baked into the handler (planFromBoard
   lesson: frozen values point at whichever data later takes that slot). */
function replanFromStop(ev,ci,si,k){
  ev.stopPropagation();
  const rows=legStops(ci,si), p=rows&&rows[k];
  if(!p || !p.station?.name || !toName) return;
  if(p.station.name===toName) return;
  fromName=p.station.name;
  const f=$("iFrom"); if(f){ f.value=fromName; $("fFrom")?.classList.add("has"); }
  setWhen("now");                    // replans as its last act -- "from here" means NOW
  scrollTo({top:0,behavior:"smooth"});
}
function toggleLeg(btn,ci,si){
  const card=btn.closest(".conn"), panel=card.querySelector(".stops");
  const wasOpen = panel.dataset.open===String(si);
  card.querySelectorAll(".legs .b2").forEach(b=>b.classList.remove("on"));
  if(wasOpen){ panel.dataset.open=""; panel.innerHTML=""; return; }   // :empty collapses it
  panel.dataset.open=String(si); btn.classList.add("on");
  panel.innerHTML = stopsHTML(legStops(ci,si),ci,si);
}

/* ---------- route sketch (SVG, no map tiles, no dependency) ----------
   Reuses legStops() above -- same passList, same marker filtering -- and draws
   the journey's real geography: every stop plotted by its lat/lon, legs coloured
   by train category, change stations fattened. Mercator-ish equirectangular with
   a cos(lat) x-correction, which is accurate enough at Swiss scale. Purely
   visual: if coordinates are missing it renders nothing and says so.         */
function routePoints(ci){
  const c=jrnConns[ci]; if(!c) return null;
  const secs=(c.sections||[]).filter(x=>x.journey);
  if(!secs.length) return null;
  const legs=[];
  secs.forEach((s,si)=>{
    const rows=legStops(ci,si) || [];
    const pts=rows.map(p=>({x:+p.station.coordinate?.y, y:+p.station.coordinate?.x, name:p.station.name}))
                  .filter(p=>isFinite(p.x)&&isFinite(p.y));
    if(pts.length>=2) legs.push({pts, col:catColor(s.journey.category)});
  });
  return legs.length?legs:null;
}
/* Station names can be very long ("DTC Dynamic Test Center AG, Vauffelin,
   Route Principale 127"). The SVG is overflow:visible so an unshortened label
   paints outside the card -- shorten first, then clamp by estimated width. */
function shortStop(n){
  let s=(n||"").replace(/,\s*(Bahnhof|Gare|Stazione|Bahnhof\/Gare)\s*$/i,"");
  s=s.split(",")[0].trim();                       // keep the place, drop the address tail
  return s.length>20 ? s.slice(0,19)+"…" : s;
}
function sketchSVG(ci){
  const legs=routePoints(ci);
  if(!legs) return `<div class="snone">No map data for this route.</div>`;
  const all=legs.flatMap(l=>l.pts);
  const lat0=all.reduce((s,p)=>s+p.y,0)/all.length;
  const kx=Math.cos(lat0*Math.PI/180);                 // longitude shrinks with latitude
  const xs=all.map(p=>p.x*kx), ys=all.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const W=560, H=190, PAD=22;
  const sx=(maxX-minX)||1e-6, sy=(maxY-minY)||1e-6;
  const s=Math.min((W-2*PAD)/sx, (H-2*PAD)/sy);        // uniform scale = no distortion
  const ox=(W-sx*s)/2, oy=(H-sy*s)/2;
  const px=p=>(p.x*kx-minX)*s+ox, py=p=>H-((p.y-minY)*s+oy);   // y flipped: north is up
  let out=`<svg class="sk" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sketch of the route geography">`;
  legs.forEach(l=>{
    out+=`<polyline points="${l.pts.map(p=>px(p).toFixed(1)+","+py(p).toFixed(1)).join(" ")}" `
       + `fill="none" stroke="${l.col}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" opacity=".95"/>`;
    l.pts.forEach((p,k)=>{
      const end = k===0 || k===l.pts.length-1;          // leg ends = boarding / change / arrival
      out+=`<circle cx="${px(p).toFixed(1)}" cy="${py(p).toFixed(1)}" r="${end?4.6:2.2}" `
         + `fill="${end?"#fff":l.col}" stroke="${l.col}" stroke-width="${end?2.2:0}"/>`;
    });
  });
  // Label the MEANINGFUL vertices: origin, every change station, destination.
  // Anonymous dots make a correct shape unreadable -- the changes are the story.
  const marks=[{p:legs[0].pts[0], t:legs[0].pts[0].name}];
  legs.forEach((l,i)=>{
    const end=l.pts[l.pts.length-1];
    const name=shortStop(end.name);
    if(!marks.some(m=>m.t===name)) marks.push({p:end, t:name, change:i<legs.length-1});
  });
  marks[0].t=shortStop(marks[0].t);
  // place each label on the side with room, and anchor so it never runs off-frame
  const placed=[];
  marks.forEach(m=>{
    const x=px(m.p), y=py(m.p);
    const w=m.t.length*5.6;                        // ~6px/char at 11px bold
    let anchor = x < W*0.28 ? "start" : x > W*0.72 ? "end" : "middle";
    // a label must never leave the box: flip the anchor if this side has no room
    if(anchor==="end"   && x-w < 2)   anchor="start";
    if(anchor==="start" && x+w > W-2) anchor="end";
    if(anchor==="middle"){ if(x-w/2 < 2) anchor="start"; else if(x+w/2 > W-2) anchor="end"; }
    const dx = anchor==="start" ? 6 : anchor==="end" ? -6 : 0;
    // above unless that would clip the top, or another label already sits there
    // dense clusters (Zermatt / Furi / Trockener Steg sit within a few px of each
    // other) stacked labels on top of one another. Try above, then below, and if
    // both slots are taken OMIT the label -- an unreadable pile is worse than a
    // missing name, and the dot is still there.
    const clash=(cx,cy)=>placed.some(q=>Math.abs(q.x-cx)<Math.max(46,w*0.55) && Math.abs(q.y-cy)<11);
    let dy=null;
    if(y>=16 && !clash(x+dx,y-10)) dy=-10;
    else if(!clash(x+dx,y+16)) dy=16;
    if(dy===null) return;                       // no room: skip this label
    placed.push({x:x+dx, y:y+dy});
    out+=`<text x="${(x+dx).toFixed(1)}" y="${(y+dy).toFixed(1)}" text-anchor="${anchor}" `
       + `class="sklbl${m.change?" chg":""}">${esc(m.t)}</text>`;
  });
  // the train itself, where the timetable says it is right now
  const tn=trainNow(ci);
  if(tn){
    const cx=px(tn).toFixed(1), cy=py(tn).toFixed(1);
    out+=`<circle class="sktrain-halo" cx="${cx}" cy="${cy}" r="9"/>`
       + `<circle class="sktrain" cx="${cx}" cy="${cy}" r="4.5"><title>`
       + `Scheduled position (from the timetable, not GPS) &#8212; between `
       + `${esc(tn.from)} and ${esc(tn.to)}</title></circle>`;
  }
  return out+`</svg>`;
}
/* Where the train is NOW, interpolated from the timetable -- NOT GPS.
   The real live-position feed (opentransportdata GTFS-RT) needs a registered
   key and allows ~2 requests/minute, so it is unusable from a keyless page;
   interpolation is not the cheap option, it is the only viable one. */
function trainNow(ci){
  const c=jrnConns[ci]; if(!c) return null;
  const now=Date.now();
  const secs=(c.sections||[]).filter(s=>s.journey);
  for(let si=0; si<secs.length; si++){
    const rows=legStops(ci,si)||[];
    for(let k=0;k<rows.length-1;k++){
      const a=rows[k], b=rows[k+1];
      const ta=new Date(a.departure||a.arrival).getTime();
      const tb=new Date(b.arrival||b.departure).getTime();
      if(!isFinite(ta)||!isFinite(tb)||tb<=ta) continue;
      if(now>=ta && now<=tb){
        const f=(now-ta)/(tb-ta);
        const ca=a.station?.coordinate, cb=b.station?.coordinate;
        if(!ca||!cb) return null;
        return {x:+ca.y+(+cb.y-+ca.y)*f, y:+ca.x+(+cb.x-+ca.x)*f,
                from:a.station.name, to:b.station.name};
      }
    }
  }
  return null;   // not underway: before departure or after arrival
}
/* The app solves the RAIL part and stops at a station -- but the real
   destination is usually the trailhead / hotel / cable-car base beyond it.
   These two links are that handoff, and they cost nothing: pure hrefs built
   from coordinates already in the connection. By COORDINATE, never by name,
   so they cannot land on a same-named place elsewhere. */
function mapsLinks(ci){
  const c=jrnConns[ci]; if(!c) return "";
  const f=c.from?.station?.coordinate, t=c.to?.station?.coordinate;
  if(!t) return "";
  const dest=`${t.x},${t.y}`;
  const pin=`https://www.google.com/maps/search/?api=1&query=${dest}`;
  const drive=f?`https://www.google.com/maps/dir/?api=1&origin=${f.x},${f.y}&destination=${dest}&travelmode=driving`:"";
  const name=esc(shortStop(c.to?.station?.name||"destination"));
  return `<div class="skmaps">`
    + `<a href="${pin}" target="_blank" rel="noopener">&#128205; ${name} in Maps</a>`
    + (drive?`<a href="${drive}" target="_blank" rel="noopener">&#128663; by car instead</a>`:"")
    + `</div>`;
}
/* ---------- elevation profile ----------
   The sketch shows the journey from ABOVE; this shows the same passList from
   the SIDE. For a Swiss trip that IS the story: Interlaken 568m -> Jungfraujoch
   3496m is not a detail, it is the point. Elevations come from open-meteo --
   the SAME host already used for the weather, keyless and CORS-open. (Checked
   opentopodata first: better dataset, but it sends no CORS header, so a browser
   cannot call it. Verified before building, not after.) */
const elevCache={};
function routeElevation(pts){
  const key=pts.map(p=>p.y.toFixed(3)+","+p.x.toFixed(3)).join("|");
  if(!elevCache[key]){
    const la=pts.map(p=>p.y.toFixed(4)).join(","), lo=pts.map(p=>p.x.toFixed(4)).join(",");
    elevCache[key]=fetch(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`)
      .then(r=>r.json()).then(d=>Array.isArray(d.elevation)?d.elevation:null).catch(()=>null);
  }
  return elevCache[key];
}
function haversine(a,b){
  const R=6371, r=Math.PI/180;
  const dla=(b.y-a.y)*r, dlo=(b.x-a.x)*r;
  const h=Math.sin(dla/2)**2+Math.cos(a.y*r)*Math.cos(b.y*r)*Math.sin(dlo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function elevationSVG(pts,elev){
  const W=560,H=110,PADL=34,PADR=10,PADT=14,PADB=18;
  // x by REAL distance, not stop index -- a steep climb should look steep
  const dist=[0];
  for(let i=1;i<pts.length;i++) dist.push(dist[i-1]+haversine(pts[i-1],pts[i]));
  const total=dist[dist.length-1]||1;
  const lo=Math.min(...elev), hi=Math.max(...elev), span=(hi-lo)||1;
  const px=i=>PADL+(dist[i]/total)*(W-PADL-PADR);
  const py=v=>H-PADB-((v-lo)/span)*(H-PADT-PADB);
  const line=pts.map((_,i)=>`${px(i).toFixed(1)},${py(elev[i]).toFixed(1)}`).join(" ");
  const area=`${PADL},${H-PADB} ${line} ${px(pts.length-1).toFixed(1)},${H-PADB}`;
  // A journey off a summit DESCENDS. Summing only the upward segments and calling
  // it "climbs" was actively misleading on Klein Matterhorn -> Lauterbrunnen: it
  // read "climbs 231 m" for a trip that drops three kilometres.
  let up=0, down=0;
  for(let i=1;i<elev.length;i++){ const dv=elev[i]-elev[i-1]; if(dv>0) up+=dv; else down-=dv; }
  up=Math.round(up); down=Math.round(down);
  const move = down>up*1.5 ? `&#8595; descends <b>${down} m</b>`
             : up>down*1.5 ? `&#9968; climbs <b>${up} m</b>`
             : `&#9968; climbs <b>${up} m</b> &#183; &#8595; descends <b>${down} m</b>`;
  const hiI=elev.indexOf(hi);
  return `<svg class="elev" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile: `
    + `${Math.round(elev[0])} to ${Math.round(elev[elev.length-1])} metres, `
    + `${up} metres of climb and ${down} metres of descent">`
    + `<polygon class="elev-fill" points="${area}"/>`
    + `<polyline class="elev-line" points="${line}" fill="none"/>`
    + `<text class="elev-ax" x="2" y="${(py(hi)+4).toFixed(1)}">${Math.round(hi)}m</text>`
    + `<text class="elev-ax" x="2" y="${(py(lo)+4).toFixed(1)}">${Math.round(lo)}m</text>`
    + `<circle class="elev-peak" cx="${px(hiI).toFixed(1)}" cy="${py(hi).toFixed(1)}" r="3.5"/>`
    + `<text class="elev-peaklbl" x="${px(hiI).toFixed(1)}" y="${(py(hi)-7).toFixed(1)}" `
    + `text-anchor="${hiI>pts.length*0.7?"end":hiI<pts.length*0.3?"start":"middle"}">`
    + `${esc(shortStop(pts[hiI].name))}</text>`
    + `</svg><div class="elev-sum">${move} &#183; `
    + `${Math.round(elev[0])} m &#8594; ${Math.round(elev[elev.length-1])} m &#183; ${total.toFixed(0)} km`
    /* Say where the numbers come from, the way the train dot says "not GPS".
       Kept as a VISIBLE line rather than a title tooltip: this is a phone, and
       there is no hover to reveal one. */
    + `<span class="elev-src">terrain height at each stop &#183; straight between them</span></div>`;
}
async function fillElevation(panel,ci){
  const legs=routePoints(ci); if(!legs) return;
  let pts=legs.flatMap(l=>l.pts);
  if(pts.length>60) pts=pts.filter((_,i)=>i%Math.ceil(pts.length/60)===0);   // stay polite
  /* Below four samples this stops being a profile. A direct train with no stop
     list gives just its two endpoints, and the strip then drew a confident
     diagonal through terrain we never measured -- Zurich->Bern read as a smooth
     137 m ramp when the line passes nothing of the sort. Draw nothing instead. */
  if(pts.length<4) return;
  const elev=await routeElevation(pts);
  if(!elev||elev.length!==pts.length) return;      // fail-silent: no strip, no error
  const box=panel.querySelector(".elevbox");
  if(box && panel.dataset.open==="1") box.innerHTML=elevationSVG(pts,elev);
}
/* ---------- en-route discovery ----------
   Every rail app answers "how do I get from A to B". Nobody answers "I am
   crossing the country -- where should I get OFF?". The passList already gives
   every intermediate stop with coordinates AND times, so ONE Overpass BBOX query
   over the whole corridor (not one per stop) finds what is worth breaking the
   trip for, and each find is anchored to a real stop with a real time. That
   anchoring is the point: an OSM peak might be a four-hour hike, but a wonder
   600 m from a stop the train actually calls at is genuinely reachable. */
function overpassBBox(s,w,n,e){
  const box=`${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return overpassQuery("bbox:"+[s,w,n,e].map(v=>v.toFixed(3)).join(","),
    `[out:json][timeout:25];(`
    +`node(${box})[tourism=viewpoint];`
    +`node(${box})[natural~"^(cave_entrance|waterfall|peak|glacier)$"];`
    +`way(${box})[waterway=waterfall];`
    +`);out center 120;`);
}
const NEAR_KM=3.5;          // further than this is not "get off here"
async function enrouteFind(ci){
  const c=jrnConns[ci]; if(!c) return null;
  const stops=[];
  (c.sections||[]).filter(s=>s.journey).forEach((s,si)=>{
    (legStops(ci,si)||[]).forEach(p=>{
      const co=p.station?.coordinate;
      if(co&&isFinite(+co.x)) stops.push({name:p.station.name, y:+co.x, x:+co.y, t:(p.arrival||p.departure||"").slice(11,16)});
    });
  });
  if(stops.length<3) return null;
  const mid=stops.slice(1,-1);                 // endpoints are not stop-off candidates
  if(!mid.length) return null;
  const pad=0.03;
  const s=Math.min(...stops.map(p=>p.y))-pad, n=Math.max(...stops.map(p=>p.y))+pad;
  const w=Math.min(...stops.map(p=>p.x))-pad, e=Math.max(...stops.map(p=>p.x))+pad;
  const els=await overpassBBox(s,w,n,e);
  if(els===null) return "unreachable";        // kept apart from "found nothing"
  const out=[];
  for(const el of els){
    const t=el.tags||{}; const name=t.name||t["name:de"]||t["name:fr"]||t["name:it"];
    if(!name) continue;
    const la=el.lat ?? el.center?.lat, lo=el.lon ?? el.center?.lon;
    if(la==null) continue;
    let best=null;
    for(const p of mid){
      const dkm=haversine({x:lo,y:la},{x:p.x,y:p.y});
      if(!best||dkm<best.d) best={d:dkm,p};
    }
    if(best && best.d<=NEAR_KM) out.push({name, ty:wonderType(t), km:best.d, stop:best.p});
  }
  const byStop=new Map();
  out.sort((a,b)=>a.km-b.km).forEach(o=>{ if(!byStop.has(o.stop.name)) byStop.set(o.stop.name,o); });
  return [...byStop.values()].sort((a,b)=>(a.stop.t||"").localeCompare(b.stop.t||"")).slice(0,6);
}
async function fillEnroute(panel,ci){
  const box=panel.querySelector(".enroutebox"); if(!box) return;
  box.innerHTML=`<div class="ersearch">looking for reasons to break the trip&#8230;</div>`;
  let finds=null;
  try{ finds=await enrouteFind(ci); }catch(e){ finds=null; }
  if(panel.dataset.open!=="1") return;
  /* Three outcomes, not two. A route with nothing near it and a route we could
     not ask about both used to render as blank, so a dead Overpass mirror looked
     exactly like a dull journey. Only "this route has no stop-offs" stays
     silent -- that one really is nothing to say. */
  if(finds==="unreachable"){ box.innerHTML=`<div class="ersearch">Could not reach the map data, so there may still be something worth stopping for. Close and reopen to retry.</div>`; return; }
  if(!finds||!finds.length){ box.innerHTML=""; return; }
  box.innerHTML=`<div class="ertitle">&#9968; Worth stopping for, on the way</div>`
    + finds.map(f=>`<div class="errow"><span class="erk">${f.ty.emoji}</span>`
        + `<span class="ern">${esc(f.name)}</span>`
        + `<span class="ers">${esc(shortStop(f.stop.name))}${f.stop.t?` &#183; ${f.stop.t}`:""} &#183; ${f.km.toFixed(1)} km</span>`
        + `<a class="erm" href="https://www.google.com/maps/search/?api=1&query=${f.stop.y},${f.stop.x}" target="_blank" rel="noopener" title="Open this stop in Maps">&#128205;</a></div>`).join("");
}
/* ---------- summit verdict ----------
   A cable car, gondola, cog railway or funicular means you are going UP, and the
   only question that matters then is "is it worth it today?" -- because cloud at
   the top ruins the entire point, and a forecast temperature does not tell you
   that. Combines three things the app already has: the mountain leg category,
   the destination forecast at ARRIVAL hour, and the terrain elevation. */
/* Checked against the live API, not guessed: Zermatt-Gornergrat and
   Vitznau-Rigi come back CC, Stanserhorn FUN then PB, Schilthorn PB, Pilatus
   GB then PB, Jungfraujoch GB. What it does NOT catch is a mountain railway the
   operator files as an ordinary R -- Montreux-Rochers-de-Naye is R 37, and the
   last leg up to Jungfraujoch is R 65. Those get no verdict rather than a
   guessed one; sniffing operator codes to catch them would be a bigger lie than
   the omission. */
const MOUNTAIN_CATS=/^(PB|GB|CC|FUN)$/i;
/* A funicular in a city is not an excursion. The Polybahn climbs 41 metres to a
   university building; asking "is the view worth it today" about it is nonsense.
   The destination has to actually be up somewhere -- 800 m clears the Mittelland
   (Bern sits at 540) while keeping the small local viewpoints that are exactly
   this feature's point, like Bern's own Gurten at 858. */
const SUMMIT_MIN_M=800;
function mountainLegs(c){
  return (c.sections||[]).filter(s=>s.journey && MOUNTAIN_CATS.test(s.journey.category||""));
}
function summitVerdict(code){
  if(code==null) return null;
  if(code<=1)            return {v:"clear at the top", good:true};
  if(code===2)           return {v:"partly cloudy up there", good:true};
  if(code===3)           return {v:"overcast at the top — the view may be gone", good:false};
  if(code>=45&&code<=48) return {v:"fog at the top — expect no view", good:false};
  if(code>=71&&code<=77) return {v:"snow at the top", good:false};
  if(code>=95)           return {v:"thunderstorm — not the day for it", good:false};
  return {v:"wet at the top", good:false};
}
/* ---------- summit go-no-go: which DAY is worth it ----------
   Today's verdict answers "is it worth it today?"; this answers the question
   behind it -- "and if not today, WHEN?" -- for trips whose whole value is the
   view (wrong day at Jungfraujoch = the price of the ticket for the inside of
   a cloud). One small daily-codes fetch, each day judged by the SAME
   summitVerdict that judges today: two rules, one truth. */
const dayOutlookCache={};
function dayOutlook(lat,lon){
  const k=(+lat).toFixed(3)+","+(+lon).toFixed(3);
  if(!dayOutlookCache[k]) dayOutlookCache[k]=fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code&forecast_days=7&timezone=auto`)
    .then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(d=>d.daily)
    .catch(e=>{ delete dayOutlookCache[k]; throw e; });   // an outage must not be cached as a verdict
  return dayOutlookCache[k];
}
function bestDayHTML(daily){
  const days=(daily&&daily.time)||[], codes=(daily&&daily.weather_code)||[];
  if(days.length<2) return "";
  const cells=[]; let best=null;
  for(let i=0;i<days.length;i++){
    // the date goes straight into a handler string: only a literal date may pass
    if(!/^\d{4}-\d{2}-\d{2}$/.test(days[i]||"")) continue;
    const v=summitVerdict(codes[i]==null?null:codes[i]);
    const wd=i===0?"today":new Date(days[i]+"T12:00").toLocaleDateString("en-CH",{weekday:"short"});
    cells.push(v
      ? `<button type="button" class="smday ${v.good?"good":"bad"}" onclick="planForDay('${days[i]}')" aria-label="Plan this trip for ${wd}: ${esc(v.v)}">${wxEmoji(codes[i])}<span>${wd}</span></button>`
      : `<span class="smday">?<span>${wd}</span></span>`);   // no data is no verdict
    if(!best&&v&&v.good) best={i,wd,v};
  }
  if(!cells.length) return "";
  const head=best
    ? (best.i===0 ? `Today is a day for it &#8212; ${esc(best.v.v)}.`
                  : `Best day: <b>${best.wd}</b> &#8212; ${esc(best.v.v)}.`)
    : `No clear day at the top in this week&#8217;s forecast.`;
  return `<div class="smdays"><div class="smbest">${head}</div><div class="smstrip">${cells.join("")}</div>`
    + `<div class="smcav">Beyond ~3 days cloud is a tendency, not a promise &#8212; recheck the day before. Tap a day to plan the trip for it.</div></div>`;
}
/* "Check for yourself": a forecast is OUR claim; a webcam is the mountain
   itself. We hand you the door and nothing more -- no embed, no curation,
   because we cannot vouch for a frozen webcam any more than a wrong forecast.
   Both links are coordinate-addressed (no name matching, no API key), and the
   row stays up even when our own outlook is unreachable -- that is precisely
   when someone else's picture is worth the most. */
function smSeeHTML(co){
  const la=+co?.x, lo=+co?.y;
  if(!isFinite(la)||!isFinite(lo)) return "";   // only literal numbers may enter a URL
  const a=la.toFixed(3), o=lo.toFixed(3);
  return `<div class="smsee">check for yourself: `
    +`<a href="https://www.windy.com/-Webcams/webcams?${a},${o},11" target="_blank" rel="noopener">${CP(0x1F4F7)} webcams</a>`
    +` &#183; <a href="https://www.meteoblue.com/en/weather/week/${a}N${o}E" target="_blank" rel="noopener">second forecast</a>`
    +`<span class="smseecav"> &#8212; their pictures, their forecast, not ours</span></div>`;
}
function planForDay(day){
  const at=$("whenAt"); if(!at) return;
  const hh=/^\d{2}:\d{2}$/.test((whenValue||"").slice(11,16)) ? whenValue.slice(11,16) : "08:00";
  at.value=`${day}T${hh}`;
  setWhen("dep");                        // replans as its last act
}
async function fillSummit(panel,ci){
  const box=panel.querySelector(".summitbox"); if(!box) return;
  const c=jrnConns[ci]; if(!c) return;
  const legs=mountainLegs(c);
  if(!legs.length){ box.innerHTML=""; return; }            // not an excursion, say nothing
  const co=c.to?.station?.coordinate, arr=c.to?.arrival;
  if(!co||!arr){ box.innerHTML=""; return; }
  const kinds=[...new Set(legs.map(s=>vehicleOf(s.journey.category)||"mountain railway"))];
  /* Nothing is drawn until the altitude is known. Painting the title first and
     retracting it a second later, once the mountain turns out to be a 41-metre
     city funicular, is worse than the short wait. */
  try{
    const [wx, elevArr, days] = await Promise.all([
      destWeather(co.x, co.y),
      routeElevation([{x:+co.y, y:+co.x}]).catch(()=>null),
      dayOutlook(co.x, co.y).catch(()=>"unreachable")   // its failure must not cost the card
    ]);
    if(panel.dataset.open!=="1") return;
    const alt = Array.isArray(elevArr) && elevArr.length && isFinite(+elevArr[0]) ? Math.round(+elevArr[0]) : null;
    // Unknown altitude keeps the verdict -- a cable car is evidence enough on its
    // own. Only a KNOWN low one rules it out.
    if(alt!=null && alt<SUMMIT_MIN_M){ box.innerHTML=""; return; }
    const w = wx && wxAt(wx.hourly, arr, sunFor(wx&&wx.daily, arr));
    const verdict = w ? summitVerdict(w.code) : null;
    const bits=[];
    if(alt!=null) bits.push(`<b>${alt} m</b>`);
    if(w) bits.push(`${w.emoji} ${w.temp}&#176; on arrival`);
    if(w&&w.rise&&w.set) bits.push(`sun ${w.rise}&#8211;${w.set}`);
    box.innerHTML=`<div class="smtitle">&#128670; ${esc(kinds.join(" + "))} to ${esc(shortStop(c.to.station.name))}`
      + (bits.length?` <span class="smbits">${bits.join(" &#183; ")}</span>`:"")+`</div>`
      + (verdict?`<div class="smv ${verdict.good?"good":"bad"}">${esc(verdict.v)}</div>`:"")
      /* three outcomes, never two: the outlook that could not be fetched must
         not render like a week with no good day */
      + (days==="unreachable"
          ? `<div class="smcav">Could not load the week&#8217;s outlook &#8212; an outage, not a &quot;no&quot;.</div>`
          : bestDayHTML(days))
      + smSeeHTML(co);
  }catch(e){ box.innerHTML=""; }
}
/* ---------- last way back ----------
   The question an excursion actually ends on. Two things make it non-obvious
   enough to be worth asking for you: the last departure is often much earlier
   than you would guess on a mountain (the last train down from Jungfraujoch
   leaves at 18:15, checked live, not at some comfortable evening hour), and
   "last" has to be counted from the moment YOU get there -- a service that left
   before your train arrived is not a way home. */
/* The window ends at 03:00 the NEXT morning, not at midnight. Checked against
   the live API: the last two services back from Vitznau leave at 22:51 and
   23:21 and arrive after midnight, so a midnight cutoff hides them and the app
   would hurry you off the mountain an hour early. Being wrong in the safe
   direction is still being wrong, and here it costs you the evening. */
function homeCutoff(arriveISO){
  const m=/^(\d{4})-(\d{2})-(\d{2})T/.exec(arriveISO||"");
  if(!m) return null;
  /* UTC purely as calendar arithmetic on a date-only value -- no instant is
     being converted, so no zone or DST is involved. */
  const d=new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}
/* Picks the latest departure you could still catch. Sorted here rather than
   trusting the response order: this is an ARRIVE-BY query, so ordering by
   departure is the API's convention and not a promise, and reading the wrong
   end of the list would say "you have four hours" to someone who has forty
   minutes. Returns null when nothing qualifies -- the caller must not render
   that as an absent feature. */
function lastHome(conns, arriveISO){
  const arr = arriveISO ? new Date(arriveISO).getTime() : NaN;
  const cand=[];
  for(const c of conns||[]){
    const dep = c && c.from && c.from.departure;
    const t = dep ? new Date(dep).getTime() : NaN;
    if(!isFinite(t)) continue;
    if(isFinite(arr) && t < arr) continue;          // it left before you got there
    cand.push({dep, arr:(c.to && c.to.arrival) || null, t});
  }
  if(!cand.length) return null;
  cand.sort((a,b)=>a.t-b.t);
  const last=cand[cand.length-1];
  return {dep:last.dep, arr:last.arr,
          slack: isFinite(arr) ? Math.round((last.t-arr)/60000) : null};
}
async function fillLastHome(panel,ci){
  const box=panel.querySelector(".homebox"); if(!box) return;
  const c=jrnConns[ci]; if(!c) return;
  const back=c.to?.station?.name, home=c.from?.station?.name, arr=c.to?.arrival;
  const day=homeCutoff(arr);
  if(!back||!home||!day){ box.innerHTML=""; return; }
  box.innerHTML=`<div class="lhsearch">checking the last way back&#8230;</div>`;
  let res;
  try{
    const d=await api(`/connections?from=${encodeURIComponent(back)}&to=${encodeURIComponent(home)}`
      + `&date=${day}&time=03:00&isArrivalTime=1&limit=6`);
    res=lastHome(d.connections, arr);
  }catch(e){ res="unreachable"; }
  if(panel.dataset.open!=="1") return;
  /* Three outcomes, not two -- the same rule the en-route finder learned. A
     timetable we could not reach and a genuine one-way trip are opposite facts,
     and rendering both as blank turns an outage into a verdict. */
  if(res==="unreachable"){
    box.innerHTML=`<div class="lhsearch">Could not check the last way back, so do not read this as "there is none". Close and reopen to retry.</div>`;
    return;
  }
  if(!res){
    box.innerHTML=`<div class="lhtitle">Last way back</div>`
      + `<div class="lhnone">&#9888; Nothing gets you home tonight after you arrive</div>`;
    return;
  }
  const tight = res.slack!=null && res.slack < 60;
  const stay = res.slack==null ? ""
    : `<span class="lhslack">${res.slack<60 ? res.slack+"&#8242;" : Math.floor(res.slack/60)+"h "+(res.slack%60)+"&#8242;"} there</span>`;
  box.innerHTML=`<div class="lhtitle">Last way back</div>`
    + `<div class="lhrow${tight?" tight":""}">${hhmm(res.dep)}${res.arr?` &#8594; ${hhmm(res.arr)}`:""} ${stay}</div>`;
}

/* ---------- last way home ON THE RESULTS LIST ----------
   The per-card version above answers "how long can I stay?" for a connection
   you already opened -- two taps deep. But "is there a way home at all?" is a
   criterion for CHOOSING a connection, not a detail of the chosen one: whoever
   is stranded at 19:00 picked their train long before the app mentioned it.
   Wander prints the last way home on every card at decision time; Journey never
   inherited the pattern (UNSOLVED-GAPS.md para 3). This is that migration.
   One request per settled search -- the fact is route-level, identical for
   every displayed card, so it renders once above them, not seven times. */
function jlhRowHTML(res, dest){
  /* Three outcomes, not two -- same rule as fillLastHome above. An outage and
     a genuine one-way trip are opposite facts; both rendered blank turns the
     outage into a verdict. */
  if(res==="unreachable")
    return `<div class="jlh unk">Could not check the last way home &#8212; an outage, not a &quot;no&quot;.</div>`;
  if(!res)
    return `<div class="jlh none">&#9888; Nothing comes back from <b>${esc(dest)}</b> tonight &#8212; one way, unless you stay over.</div>`;
  /* "verified": asserts a train that EXISTS, not that it is THE last -- the safe
     claim-direction on thin lines (wanCard fixed this vocabulary first). */
  return `<div class="jlh ok">&#127769; Last verified way home from <b>${esc(dest)}</b>: <b>${hhmm(res.dep)}</b>${res.arr?` &#8594; ${hhmm(res.arr)}`:""}</div>`;
}
/* Per-card verdict from the SAME single query -- a pure local comparison, no
   extra request. A 19:44 arrival and a 21:10 arrival are different stranding
   risks at the same destination. Gated: roomy cards render NOTHING (suppressed
   is a hidden fact, not a doubt); an outage renders nothing here either, so a
   failed query can never be flattened into "no way home" at rib length. */
function jlhCardRib(res, remaining){
  if(res===undefined || res==="unreachable") return "";
  if(!res) return `<span class="rib tight">&#9888; no later way home verified after this arrival</span>`;
  const tight = (res.slack!=null && res.slack<=90) || remaining<=3;
  if(!tight) return "";
  const s = res.slack==null ? ""
    : ` &#183; ${res.slack<60?res.slack+"&#8242;":Math.floor(res.slack/60)+"h "+(res.slack%60)+"&#8242;"} after you arrive`;
  return `<span class="rib tight">&#9888; last verified way home ${hhmm(res.dep)}${s}</span>`;
}
async function fillJourneyLastHome(gen){
  const box=$("jlh"); if(!box) return;
  const first=jrnConns.reduce((a,x)=>(!a || x._arr<a._arr)?x:a, null);
  const back=first?.to?.station?.name, home=first?.from?.station?.name;
  const day=homeCutoff(first?.to?.arrival);
  if(!back||!home||back===home||!day) return;   // nothing to say; the box stays empty, claiming nothing
  let res, homeConns=null;
  try{
    const d=await api(`/connections?from=${encodeURIComponent(back)}&to=${encodeURIComponent(home)}`
      + `&date=${day}&time=03:00&isArrivalTime=1&limit=6`, jrnAbort && jrnAbort.signal);
    homeConns=d.connections||[];
    /* Counted from the EARLIEST displayed arrival: a service that leaves before
       you could possibly be there is not a way home for any of these options. */
    res=lastHome(homeConns, first.to.arrival);
  }catch(e){ res="unreachable"; }
  if(gen!==jrnGen) return;      // superseded -- a stale answer must not paint over a new route
  box.innerHTML=jlhRowHTML(res, back);
  if(homeConns===null) return;  // outage: the top line carries it; cards stay silent
  document.querySelectorAll(".jlhc").forEach(el=>{
    const c=jrnConns[+el.dataset.ci], a=c?.to?.arrival; if(!a) return;
    const at=new Date(a).getTime();
    const remaining=homeConns.filter(x=>{
      const t=new Date((x&&x.from&&x.from.departure)||NaN).getTime();
      return isFinite(t)&&t>=at;
    }).length;
    el.innerHTML=jlhCardRib(lastHome(homeConns, a), remaining);
  });
}

function toggleSketch(btn,ci){
  const card=btn.closest(".conn"), panel=card.querySelector(".sketch");
  const open = panel.dataset.open==="1";
  panel.dataset.open = open?"":"1";
  panel.innerHTML = open?"":(sketchSVG(ci)+`<div class="elevbox"></div>`+`<div class="summitbox"></div>`+`<div class="homebox"></div>`+`<div class="enroutebox"></div>`+mapsLinks(ci));
  if(!open){ fillElevation(panel,ci); fillSummit(panel,ci); fillLastHome(panel,ci); fillEnroute(panel,ci); }
  btn.classList.toggle("on",!open);
  btn.setAttribute("aria-expanded", String(!open));
}

/* Dual time. A visitor thinks in the zone they came from: "arrives 22:47 Swiss"
   means nothing until it also says "= 16:47 your time" -- for calling home, for
   a connecting flight, for knowing whether that is late. Swiss time stays the
   headline (it is what the platform board says and what you must act on); the
   home-zone reading is the quiet second line. Invisible for anyone already in
   Swiss time, which is almost everyone -- so it costs the calm nothing. */
let _tzDiff=null;
function tzDiffers(){
  if(_tzDiff!==null) return _tzDiff;
  try{
    const probe=new Date();
    const swiss=probe.toLocaleTimeString("en-GB",{timeZone:"Europe/Zurich",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    const here =probe.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    _tzDiff = swiss!==here;
  }catch(e){ _tzDiff=false; }
  return _tzDiff;
}
function deviceEcho(iso){                       // the SAME instant, read on the traveller's own clock
  if(!tzDiffers()) return "";
  const d=new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
}
function tzZoneLabel(){
  try{ return (Intl.DateTimeFormat().resolvedOptions().timeZone||"").split("/").pop().replace(/_/g," "); }
  catch(e){ return "your time"; }
}
function connCard(c,i){
  /* Prognosis first, exactly as the departure board and the change-buffer maths
     already do. Reading the scheduled time here meant the same train showed
     "14:02" on this card and "14:02 +11" on the board -- and the card is the one
     you look at when deciding whether you can still make it. */
  const dep=c.from?.prognosis?.departure || c.from?.departure;
  const arr=c.to?.prognosis?.arrival || c.to?.arrival;
  const dly=(a,b)=>a&&b ? Math.round((new Date(a)-new Date(b))/60000) : 0;
  const dDly=dly(c.from?.prognosis?.departure, c.from?.departure);
  const aDly=dly(c.to?.prognosis?.arrival, c.to?.arrival);
  const dTag=dDly>0?`<span class="sdly">+${dDly}&#8242;</span>`:"";
  const aTag=aDly>0?`<span class="sdly">+${aDly}&#8242;</span>`:"";
  const secs=(c.sections||[]).filter(s=>s.journey);
  const tr=c._chg ? c._chg.length : (c.transfers||0);
  const legs = secs.map((s,si)=>{
    const b=badge(s.journey.category, s.journey.number);
    return `<button class="b2" style="background:${b.col}" onclick="toggleLeg(this,${i},${si})" title="Show stops on this leg">${b.label}</button>`;
  }).join('<span class="sep">&#8250;</span>') || '<span class="sep">walk</span>';
  const lhint = secs.length ? `<span class="lhint">tap a leg for stops</span>` : "";
  const chg = c._chg || [];
  const chgHTML = chg.length ? `<div class="chg">`+chg.map((x,k)=>{
    const cls = x.b<TIGHT?"tight":x.b<COMFY?"warn":"";
    const pf = x.pa && x.pd && x.pa!==x.pd ? ` <span class="cxpf">${esc(x.pa)}&#8594;${esc(x.pd)}</span>`
             : x.pd ? ` <span class="cxpf">Pl.&#8201;${esc(x.pd)}</span>` : "";
    const t = x.missed ? `<b>missed by ${-x.b}&#8242;</b>` : `<b>${x.b}&#8242;</b>`;
    // a long layover with a known coordinate is an invitation, not just a wait
    const out = !x.missed && x.b>=LAYOVER_MIN && x.co
      ? ` <button type="button" class="cxout" onclick="layoverPOI(this,${i},${k})" aria-label="What is near ${esc(x.stn)} in this ${x.b}-minute layover">${CP(0x2615)} step out?</button>` : "";
    return `<span class="cx ${cls}">${esc(x.stn)} ${t}${pf}${out}</span>`;
  }).join("")+`</div>` : "";
  const scenic = secs.some(s=>isScenic(s.journey.category));
  let ribs="";
  /* Before scenic: a replaced leg changes whether you take this train at all. */
  ribs+=vehicleRibs(secs);
  if(scenic) ribs+=`<span class="rib scenic">&#9968; scenic &#183; panoramic route</span>`;
  if(c._safePick) ribs+=`<span class="rib pick">&#9889; smart pick${c._why?" &#183; "+c._why:""}</span>`;
  else if(c._fasterTight) ribs+=`<span class="rib tight">&#9889; faster &#183; tight ${c._buf}&#8242; change</span>`;
  else if(c._isBase) ribs+=`<span class="rib base">SBB default</span>`;
  if(c._tight && !c._fasterTight) ribs+=`<span class="rib tight">&#9888; tight change</span>`;
  ribs+=connZoneRib(i);   // zone facts are a pre-purchase criterion, so they ride the card, not the stop list
  ribs+=`<span class="jlhc" data-ci="${i}"></span>`;   // per-card last-way-home slot, painted by fillJourneyLastHome
  if(c._via) ribs+=`<span class="viatag">via ${esc(c._via)}</span>`;
  const dm=minsUntil(dep);
  /* The platform is the one thing you need while standing IN the station, and it
     is already in the connection response -- no extra request. Prognosis first:
     a platform change is exactly the case where the scheduled value misleads. */
  const pfD=c.from?.prognosis?.platform || c.from?.platform;
  const pfA=c.to?.prognosis?.platform || c.to?.platform;
  const pfChanged=c.from?.prognosis?.platform && c.from.prognosis.platform!==c.from.platform;
  const pfrow = pfD ? `<div class="pfrow"><span class="pf${pfChanged?" chg":""}">Pl.&#8201;${esc(pfD)}${pfChanged?" &#9888;":""}</span>`
    + (pfA?`<span class="pfa">arrives Pl.&#8201;${esc(pfA)}</span>`:"") + `</div>` : "";
  // both-ends weather delta: origin forecast at DEPARTURE hour (left of arrow),
  // destination at ARRIVAL hour (right) — same wxAt/destWeather path, data-t = the hour to look up
  const cto=c.to?.station?.coordinate, cfr=c.from?.station?.coordinate;
  const wxD = (weather && cto && arr) ? `<span class="wx" data-t="${esc(arr)}" data-lat="${cto.x}" data-lon="${cto.y}"></span>` : "";
  const wxO = (weather && cfr && dep) ? `<span class="wx" data-t="${esc(dep)}" data-lat="${cfr.x}" data-lon="${cfr.y}"></span>` : "";
  return `<div class="conn ${c._safePick?"win":""} ${c._tight?"hastight":""}" style="animation-delay:${i*30}ms">
    <div class="top">
      ${wxO}<div class="tt">${hhmm(dep)}${dTag}</div><span class="arr">&#8594;</span>${wxD}<div class="tt">${hhmm(arr)}${aTag}</div>
      <div class="dur"><b>${parseDur(c.duration)}</b><span>${tr} change${tr===1?"":"s"}</span></div>
    </div>
    ${tzDiffers()&&dep&&arr ? `<div class="tzecho">${esc(tzZoneLabel())} time: ${deviceEcho(dep)} &#8594; ${deviceEcho(arr)}</div>` : ""}
    ${pfrow}
    <div class="legs">${legs}${lhint}
      <button class="skbtn" type="button" aria-expanded="false" onclick="toggleSketch(this,${i})"
              aria-label="Show a sketch of the whole route"
              title="Sketch the whole route">&#128506; map</button></div>
    <div class="stops"></div>
    <div class="sketch"></div>
    ${chgHTML}
    <div class="lpoi"></div>
    <div class="meta"><div class="rbrow">${ribs}</div>${dm>0&&dm<90?`Departs in <b>${dm} min</b>`:"Departs "+hhmm(dep)}</div>
    <button type="button" class="obpin" onclick="onboardPin(${i})" aria-label="Pin this journey &#8212; I&#39;m on this one">${CP(0x1F4CC)} I&#39;m on this one</button>
  </div>`;
}

/* ---------- WANDER ---------- */
/* The other two tabs answer "when does my train go" and "how do I get to B".
   This one answers a question neither can hold: "I have two hours and no
   destination -- where can I go, and can I get BACK?" The outbound side is
   free: one stationboard response already lists every stop each departing
   train reaches (passList), so candidates cost no extra requests. The return
   side is the load-bearing half and is never assumed: riding out is a fact you
   can see on the board, riding back is a claim -- unchecked, it strands you.
   Every card shown carries a VERIFIED return within the budget plus the last
   way home tonight, because "the last train already left" is the failure that
   turns a nice afternoon into a hotel bill. */
let wanName = "";
let wanBudget = 0;                 // minutes; 0 = not chosen yet
let wanRun = 0;                    // stale-response guard: only the newest search may paint
const WAN_MIN_RIDE = 10;           // shorter than this is a tram hop, not an outing
const WAN_MIN_DWELL = 15;          // arriving with no time to leave the platform is not "being there"
const WAN_MAX_CAND = 5;            // 1 board + 2 requests each -- volunteer API, explicit action only

function setWanBudget(min, el){
  wanBudget = min;
  document.querySelectorAll("#wanBudget .chip").forEach(c=>c.classList.toggle("on", c===el));
  if(wanName) runWander();
}
/* The API speaks Swiss wall time; the device may be anywhere. Same discipline
   as hhmm(), pointed the other way: format the instant IN Zurich's zone.
   MEASURED 2026-07-26, not assumed: the combined `when=` form silently IGNORES
   its value when isArrivalTime is set (12:00 and 22:00 anchors returned
   byte-identical results); only the split date=&time= form honours the anchor.
   A parameter the server drops without an error is exactly the kind of thing
   that ships green and strands someone -- hence query-string, not ISO. */
function swissQS(d){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Zurich",year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
  const g=t=>p.find(x=>x.type===t)?.value||"00";
  return `&date=${g("year")}-${g("month")}-${g("day")}&time=${g("hour")}:${g("minute")}`;
}
function fmtDur(m){ return m>=60 ? Math.floor(m/60)+"&#8201;h"+(m%60?" "+String(m%60).padStart(2,"0")+"&#8242;":"") : m+"&#8242;"; }

/* Outbound candidates: direct rides only, straight off the board's passLists.
   A stop qualifies when there is still room, inside the budget, to dwell at
   least WAN_MIN_DWELL and ride the same distance back. */
function wanCandidates(board, now, deadline){
  const best=new Map();                          // station -> earliest-arriving direct ride
  for(const j of board||[]){
    const dep=j.stop?.departure; if(!dep) continue;
    const depT=new Date(dep).getTime();
    if(isNaN(depT) || depT<now-60000) continue;
    const pl=Array.isArray(j.passList)?j.passList.slice(1):[];
    for(const p of pl){
      const nm=p.station?.name, arr=p.arrival;
      if(!nm||!arr||nm===wanName) continue;
      const arrT=new Date(arr).getTime(); if(isNaN(arrT)) continue;
      const ride=Math.round((arrT-depT)/60000);
      if(ride<WAN_MIN_RIDE) continue;
      if(arrT + (WAN_MIN_DWELL+ride)*60000 > deadline) continue;
      const prev=best.get(nm);
      if(!prev || arrT<prev.arrT)
        best.set(nm,{name:nm, dep, arr, arrT, ride, cat:j.category,
                     num:j.number||j.line, scenic:isScenic(j.category)});
    }
  }
  // the ride is the point: scenic first, then the longest ride that still fits
  return [...best.values()]
    .sort((a,b)=>(b.scenic?1:0)-(a.scenic?1:0) || b.ride-a.ride)
    .slice(0,WAN_MAX_CAND);
}
/* Return legs for one candidate. Two separate verdicts, never conflated:
   ret     -- latest connection back that still lands inside the budget
              (latest departure == most time there). null = none exists.
   retOk   -- whether that query ANSWERED. A dead request is "unknown",
              not "no return"; absence of data must never render as data.
   last    -- last way home tonight (arriving by ~03:00), same ok/unknown split. */
async function wanReturns(c, deadline){
  const from=encodeURIComponent(c.name), to=encodeURIComponent(wanName);
  /* Measured quirk (2026-07-26): the arrival-anchored window can end ~30' short
     of the anchor, so the "latest return" found here may under-report the real
     dwell a little. That bias is the SAFE direction -- a shown return always
     exists and always fits the budget; it just may not be the very last that
     would. Never trade this for a forward query that could overshoot. */
  try{
    const d=await api(`/connections?limit=6&from=${from}&to=${to}${swissQS(new Date(deadline))}&isArrivalTime=1`);
    const ok=(d.connections||[]).filter(r=>{
      const rd=new Date(r.from?.departure).getTime(), ra=new Date(r.to?.arrival).getTime();
      return !isNaN(rd) && !isNaN(ra) && rd>=c.arrT+WAN_MIN_DWELL*60000 && ra<=deadline+60000;
    }).sort((a,b)=>new Date(b.from.departure)-new Date(a.from.departure));
    c.ret=ok[0]||null; c.retOk=true;
  }catch(e){ c.ret=null; c.retOk=false; }
  try{
    const night=new Date(); night.setHours(27,0,0,0);          // rolls to 03:00 tomorrow
    const d=await api(`/connections?limit=6&from=${from}&to=${to}${swissQS(night)}&isArrivalTime=1`);
    const late=(d.connections||[])
      .filter(r=>{ const rd=new Date(r.from?.departure).getTime(); return !isNaN(rd)&&rd>=c.arrT; })
      .sort((a,b)=>new Date(b.from.departure)-new Date(a.from.departure));
    c.last=late[0]?.from?.departure||null; c.lastOk=true;
  }catch(e){ c.last=null; c.lastOk=false; }
}
function wanCard(c){
  const b=badge(c.cat,c.num);
  const dwell=c.ret ? Math.round((new Date(c.ret.from.departure)-c.arrT)/60000) : null;
  const retDur=c.ret ? Math.round((new Date(c.ret.to.arrival)-new Date(c.ret.from.departure))/60000) : null;
  const chg=c.ret ? Math.max(0,(c.ret.sections||[]).filter(s=>s.journey).length-1) : 0;
  const legs = c.ret
    ? `out <b>${hhmm(c.dep)} &#8594; ${hhmm(c.arr)}</b> (${fmtDur(c.ride)})<br>`
      +`there <b>${fmtDur(dwell)}</b><br>`
      +`back <b>${hhmm(c.ret.from.departure)} &#8594; ${hhmm(c.ret.to.arrival)}</b> (${fmtDur(retDur)}${chg?`, ${chg} change${chg>1?"s":""}`:""})`
    : `out <b>${hhmm(c.dep)} &#8594; ${hhmm(c.arr)}</b> (${fmtDur(c.ride)})`;
  // slow-return trap, named: the way back costs half again what the way out did
  const warn = retDur && retDur>c.ride*1.5
    ? `<span class="wwarn">&#9888; return takes ${fmtDur(retDur)} &#8212; ${Math.round((retDur/c.ride-1)*100)}% longer than the way out</span>` : "";
  const unv = !c.retOk
    ? `<span class="wunv">return UNVERIFIED &#8212; the timetable did not answer; do not board on this card alone</span>` : "";
  /* "verified" is load-bearing: the arrival-window quirk above means a LATER
     train home may exist unseen. The one printed is a train that EXISTS -- plan
     around it and you cannot be stranded; claiming it is THE last would lie in
     the dangerous direction on thin lines. */
  const lastLine = c.lastOk
    ? (c.last ? `<div class="wlast">last verified way home departs ${hhmm(c.last)}</div>`
              : `<div class="wlast">&#9888; no later way home could be verified &#8212; treat the return above as your last safe one</div>`)
    : `<div class="wlast">last-way-home check did not answer &#8212; verify before you linger</div>`;
  return `<div class="wcard">
    <div class="whead">
      <div class="badge" style="background:${b.col}">${b.label}</div>
      <div class="wto">${esc(c.name)}</div>
      <div class="wride">${fmtDur(c.ride)}</div>
    </div>
    <div class="wlegs">${legs}</div>
    ${warn}${unv}${lastLine}
  </div>`;
}
async function runWander(){
  if(!wanName||!wanBudget) return;
  const run=++wanRun, out=$("wanOut");
  out.innerHTML=skel(4);
  const now=Date.now(), deadline=now+wanBudget*60000;
  let board;
  try{
    const d=await api("/stationboard?limit=15&station="+encodeURIComponent(wanName));
    board=d.stationboard||[];
  }catch(e){
    if(run!==wanRun) return;
    out.innerHTML=errBox(e, "what leaves from here", "try again");
    return;
  }
  const cands=wanCandidates(board, now, deadline);
  if(run!==wanRun) return;
  if(!cands.length){
    out.innerHTML=`<div class="empty"><div class="big">&#8987;</div>No round trip fits in ${fmtDur(wanBudget)} from ${esc(wanName)}.<br>Try a bigger budget &#8212; the shortest outing needs the ride out, ${WAN_MIN_DWELL}&#8242; there, and the ride back.</div>`;
    return;
  }
  await Promise.all(cands.map(c=>wanReturns(c, deadline)));
  if(run!==wanRun) return;
  // a candidate with an ANSWERED query and no fitting return fails the premise -> drop.
  // an UNANSWERED query is shown, loudly unverified -- unknown is not "no".
  const show=cands.filter(c=>c.ret||!c.retOk);
  if(!show.length){
    out.innerHTML=`<div class="empty"><div class="big">&#8987;</div>Trains go out, but nothing gets you back inside ${fmtDur(wanBudget)}.<br>Try a bigger budget.</div>`;
    return;
  }
  out.innerHTML=show.map(wanCard).join("");
}

/* ---------- touch timetable ---------- */
/* Tiles come from data the app already holds -- starred stations first, then
   recent-route endpoints, then the last board station. Deduped, capped at 12.
   Rebuilt on every visit to the tab, so a new star shows up without a reload. */
function tchStations(){
  const seen=new Set(), out=[];
  const add=n=>{ if(n && !seen.has(n)){ seen.add(n); out.push(n); } };
  favs.forEach(add);
  routeHist.forEach(r=>{ add(r.f); add(r.t); });
  add(load(LS.last,""));
  return out.slice(0,12);
}
/* Grid render */
function renderTouch(){
  const g=$("tchGrid"), h=$("tchHint"), st=tchStations();
  if(st.length<2){
    g.innerHTML="";
    h.innerHTML="Star stations or plan a journey first &#8212; the places this app knows about become tiles here, and you drag a line between two of them to plan that trip.";
    return;
  }
  h.innerHTML="Drag from one tile to another &#8212; the line is the journey.";
  g.innerHTML=st.map(n=>`<div class="tile" data-n="${esc(n)}">${esc(shortStop(n))}</div>`).join("");
}
let tchFrom=null;
function tchCenter(el){
  const r=el.getBoundingClientRect(), w=$("tchWrap").getBoundingClientRect();
  return [r.left-w.left+r.width/2, r.top-w.top+r.height/2];
}
function tchLine(x1,y1,x2,y2){
  $("tchSvg").innerHTML =
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--red)" stroke-width="3.5" stroke-linecap="round"/>`
   +`<circle cx="${x1}" cy="${y1}" r="7" fill="var(--red)"/>`
   +`<circle cx="${x2}" cy="${y2}" r="7" fill="var(--red)"/>`;
}
function tchTileAt(x,y){
  const el=document.elementFromPoint(x,y);
  return el && el.closest ? el.closest(".tile") : null;
}
function tchEnd(commit,x,y){
  const g=$("tchGrid");
  let target=null;
  if(commit && tchFrom){
    const t=tchTileAt(x,y);
    if(t && t!==tchFrom) target=t;
  }
  if(target){
    const from=tchFrom.dataset.n, to=target.dataset.n;
    fromName=from; toName=to;
    $("iFrom").value=from; $("iTo").value=to;
    $("fFrom").classList.add("has"); $("fTo").classList.add("has");
    setTab("jrn"); planJourney();
  }
  tchFrom=null; $("tchSvg").innerHTML="";
  g.querySelectorAll(".tile").forEach(t=>t.classList.remove("sel","dim"));
}
(function(){
  const g=$("tchGrid"); if(!g) return;
  g.addEventListener("pointerdown", e=>{
    const t=e.target.closest(".tile"); if(!t) return;
    tchFrom=t; g.setPointerCapture(e.pointerId);
    g.querySelectorAll(".tile").forEach(x=>x.classList.toggle("dim", x!==t));
    t.classList.add("sel");
    const [x,y]=tchCenter(t), w=$("tchWrap").getBoundingClientRect();
    tchLine(x,y,e.clientX-w.left,e.clientY-w.top);
  });
  g.addEventListener("pointermove", e=>{
    if(!tchFrom) return;
    const w=$("tchWrap").getBoundingClientRect();
    const [x1,y1]=tchCenter(tchFrom);
    const hov=tchTileAt(e.clientX,e.clientY);
    g.querySelectorAll(".tile").forEach(t=>{
      const on = t===tchFrom || (hov===t && t!==tchFrom);
      t.classList.toggle("sel", on);
      t.classList.toggle("dim", !on);
    });
    if(hov && hov!==tchFrom){ const [x2,y2]=tchCenter(hov); tchLine(x1,y1,x2,y2); }
    else tchLine(x1,y1,e.clientX-w.left,e.clientY-w.top);
  });
  g.addEventListener("pointerup", e=>tchEnd(true,e.clientX,e.clientY));
  g.addEventListener("pointercancel", ()=>tchEnd(false));
})();

/* ---------- tabs / clock / boot ---------- */
function setTab(t){
  const m={dep:["tabDep","vDep"], jrn:["tabJrn","vJrn"], wan:["tabWan","vWan"], tch:["tabTch","vTch"]};
  for(const k in m){
    $(m[k][0]).classList.toggle("on", k===t);
    $(m[k][1]).classList.toggle("on", k===t);
  }
  if(t==="tch") renderTouch();
}
/* The logo was the one thing on screen with nothing to do. Now it answers the
   question the app quietly raises: most of what this does is a tap you would
   not guess was there. Static markup -- no state, nothing to load. */
function toggleHelp(){
  const s=$("help"), b=$("helpBtn"), open=!s.classList.contains("on");
  s.classList.toggle("on", open);
  b.setAttribute("aria-expanded", String(open));
  document.body.style.overflow = open ? "hidden" : "";
  if(open) s.scrollTop=0;
}
function helpScrim(e){ if(e.target===e.currentTarget) toggleHelp(); }   // tap outside the sheet
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && $("help")?.classList.contains("on")) toggleHelp();
});
/* Theme: dark <-> light, dark by default, persisted. The OS preference is
   deliberately not consulted -- the operator runs a light desktop and wants the
   app dark, which is exactly the case an OS-follows-you default gets wrong. */
const THEMES=["dark","light"];
function applyTheme(t){
  const r=document.documentElement;
  r.setAttribute("data-theme", t==="light" ? "light" : "dark");
  const b=$("themeBtn");
  if(b){
    b.innerHTML = t==="light" ? "&#9728;" : "&#9790;";     // sun when light, moon when dark
    b.setAttribute("aria-label", t==="light" ? "Light theme. Switch to dark." : "Dark theme. Switch to light.");
    b.title = t==="light" ? "Light -- tap for dark" : "Dark -- tap for light";
  }
}
function cycleTheme(){
  const cur=load(LS.theme,"dark");
  const next=THEMES[(THEMES.indexOf(cur)+1)%THEMES.length];
  save(LS.theme,next); applyTheme(next);
}
function tickClock(){
  const d=new Date();
  $("clk").textContent=d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  $("clkd").textContent=d.toLocaleDateString([], {weekday:"short",day:"numeric",month:"short"});
  /* The note was written but never rendered -- #tzNote sat empty, so the one
     thing that explains why this clock (device time) disagrees with every
     departure below it (Swiss time) never appeared. Rewritten only when the
     text actually changes, since this runs every second. */
  const box=$("tzNote"); if(!box) return;
  const html=tzNoteHTML()+storageNoteHTML();
  if(box.innerHTML!==html) box.innerHTML=html;
}

/* Enter must work. Until now only the departures box had a key handler: on the
   journey side you could type a full station name, press Enter, and nothing at
   all happened -- the search only fired if you TAPPED a dropdown row. Typing
   the name and hitting Enter is the most ordinary thing a person does with two
   text fields, so it now takes the top suggestion (or the literal text) and
   searches. Also gives the dropdown keyboard selection, which it never had. */
function acEnter(inpId, acId, onPick){
  const inp=$(inpId), ac=$(acId);
  inp.addEventListener("keydown", e=>{
    const rows=[...ac.querySelectorAll("div")], open=ac.classList.contains("show");
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      if(!open||!rows.length) return;
      e.preventDefault();
      const cur=rows.findIndex(r=>r.classList.contains("sel"));
      const nxt=e.key==="ArrowDown" ? Math.min(cur+1,rows.length-1) : Math.max(cur-1,0);
      rows.forEach(r=>r.classList.remove("sel")); rows[nxt<0?0:nxt].classList.add("sel");
      return;
    }
    if(e.key!=="Enter") return;
    e.preventDefault();
    const typed=inp.value.trim();
    /* The dropdown is debounced 300ms behind the keyboard, so a fast typist who
       finishes "Zurich HB" and hits Enter can still be looking at rows fetched
       for "Zur" -- silently taking row 0 would have sent them to Zurich
       Altstetten. Only trust the top row when it actually answers what is in
       the box; otherwise search the literal text, which the API resolves fine.
       An arrow-selected row is always honoured: that was a deliberate choice. */
    const fresh = ac.dataset.q === typed;
    const sel=rows.find(r=>r.classList.contains("sel")) || (open&&fresh?rows[0]:null);
    const name=sel? sel.dataset.n : typed;
    if(!name) return;
    inp.value=name; ac.classList.remove("show"); inp.blur();
    onPick(name);
  });
}
acEnter("iFrom","acFrom", n=>{ fromName=n; $("fFrom").classList.add("has"); if(toName) planJourney(); });
acEnter("iTo","acTo",     n=>{ toName=n;   $("fTo").classList.add("has");   if(fromName) planJourney(); });
acEnter("iVia","acVia",   viaSet);
acEnter("iWan","acWan",   n=>{ wanName=n;  $("fWan").classList.add("has");  if(wanBudget) runWander(); });
wireAC("iDep","acDep","fDep", showDepartures);
wireAC("iFrom","acFrom","fFrom", n=>{ fromName=n; if(toName) planJourney(); });
wireAC("iTo","acTo","fTo",     n=>{ toName=n;   if(fromName) planJourney(); });
wireAC("iVia","acVia","fVia", viaSet);
$("iVia").addEventListener("input", viaPending);
$("iVia").addEventListener("blur", viaBlur);
wireAC("iWan","acWan","fWan",  n=>{ wanName=n;  if(wanBudget) runWander(); });
$("iDep").addEventListener("keydown",e=>{ if(e.key==="Enter"){e.target.blur(); showDepartures(e.target.value.trim());}});

/* Anything that draws remembered state has to be called HERE, on load. Twice now
   a feature arrived wired only into toggleFav(), so its chips appeared solely as
   a side effect of starring a station -- green CI, invisible app. */
renderFavs();
renderModes();
renderCats();     // renderModes() cascades into it, but a remembered filter must not depend on a cascade
renderRoutes();
renderBuild();
wireFades();      // after the painters: the rows must have their chips before anything measures them
tickClock(); setInterval(tickClock,1000); setInterval(tickSketches,15000);
paintOnboard(); setInterval(paintOnboard,30000);   // the pinned journey survives a reload -- the bar must too
const last=load(LS.last,"");
/* Wander starts where you last looked at departures -- one tap on a budget
   chip and it runs; typing a start station stays possible but optional. */
if(last){ $("iWan").value=last; wanName=last; $("fWan").classList.add("has"); }
if(last) showDepartures(last);
else $("depOut").innerHTML=`<div class="empty"><div class="big">&#128647;</div>Search a station to see live departures.</div>`;
applyDeepLink();   // AFTER the board default so a shared link lands on the Journey tab, planned

document.addEventListener("visibilitychange",()=>{
  if(document.hidden){ stopBoardTimers(); return; }       // asleep: zero requests
  if(current){ loadBoard(current,true); startBoardTimers(current); }
});
