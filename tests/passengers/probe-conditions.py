#!/usr/bin/env python3
"""Evidence for the `conditions` axis (+ purpose/international-connection).
Writes tests/passengers/conditions-evidence.json.

Same contract as probe-phrasing.py: the app hands date/time straight to
/connections (swissQS, app.js) and renders what comes back, so for the
schedule-shaped conditions the API's answer IS the app's answer. What the app
ADDS on top (EV rib, night board, weather chips) is adjudicated from the repo,
not from here.

The measured property per specimen is not "did it return something" but the
one fact the condition turns on:
  midnight-crossing : does a 23:55 query return arrivals on the NEXT calendar
                      day, with full ISO timestamps the renderer can compare?
  weekend/holiday   : does the API honour the requested DATE (connections
                      dated that day), i.e. real timetable, not today's?
  horizon control   : a date past the timetable horizon must come back empty
                      or error -- if it "works", the date param is decorative
                      and every schedule claim above is vacuous.
  international     : do cross-border destinations resolve end-to-end?

SERIAL with a delay on purpose: this API rate-limits with HTTP 429 (measured
2026-07-30: 40 parallel -> 23 refused).
"""
import datetime as dt
import json, os, time, urllib.parse, urllib.request

BASE = "https://transport.opendata.ch/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "conditions-evidence.json")

today = dt.date.today()


def next_dow(d, dow):  # dow: Mon=0
    return d + dt.timedelta(days=(dow - d.weekday()) % 7 or 7)


SPECIMENS = [
    # axis value            from          to                 date                                time
    # 23:55 rolls PAST the last direct train and the API answers with next-
    # MORNING connections -- kept, because that silent roll is itself evidence
    # (the app renders those cards with no day marker). 23:15 catches the real
    # 23:32 -> 00:31 crosser.
    ("midnight-crossing",   "Zürich HB",  "Bern",            today + dt.timedelta(days=1),      "23:55"),
    ("midnight-crossing",   "Zürich HB",  "Bern",            today + dt.timedelta(days=1),      "23:15"),
    # Sat/Mon 08:00 both return half-hourly ICs and discriminate NOTHING. The
    # discriminator is Zürich's night network: SN trains run Fri/Sat nights
    # ONLY, so Sat 02:00 must return SN rows and a weekday 02:00 must roll to
    # the first morning S.
    ("weekend-schedule",    "Zürich HB",  "Bern",            next_dow(today, 5),                "08:00"),
    ("weekend-schedule",    "Zürich HB",  "Winterthur",      next_dow(today, 6),                "02:00"),
    ("weekend-schedule",    "Zürich HB",  "Winterthur",      next_dow(today, 2) + dt.timedelta(days=1), "02:00"),
    # Dec 25 "works" but so does the past-horizon control, so date-honouring
    # alone proves nothing. The discriminator is Jeûne genevois (2026-09-10, a
    # GENEVA-ONLY Thursday holiday on Sunday service) vs the previous Thursday
    # on a TPG tram corridor: a different departure pattern = holiday grain.
    ("holiday-schedule",    "Zürich HB",  "Bern",            dt.date(today.year, 12, 25),       "08:00"),
    ("holiday-schedule",    "Genève, Bel-Air", "Genève, Palettes", dt.date(2026, 9, 3),          "06:00"),
    ("holiday-schedule",    "Genève, Bel-Air", "Genève, Palettes", dt.date(2026, 9, 10),         "06:00"),
    ("_control-past-horizon", "Zürich HB", "Bern",           today + dt.timedelta(days=450),    "08:00"),
    ("international-connection", "Zürich HB", "Milano Centrale", today + dt.timedelta(days=1),  "08:00"),
    ("international-connection", "Zürich HB", "Paris Gare de Lyon", today + dt.timedelta(days=1), "08:00"),
    ("international-connection", "Zürich HB", "München Hbf", today + dt.timedelta(days=1),      "08:00"),
]


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=25) as r:
            return json.load(r), None
    except Exception as e:  # the error IS data here (horizon control expects one)
        return None, f"{type(e).__name__}: {e}"


def probe(frm, to, date, hhmm):
    q = (f"/connections?limit=4&from={urllib.parse.quote(frm)}&to={urllib.parse.quote(to)}"
         f"&date={date.isoformat()}&time={hhmm}")
    d, err = get(q)
    if err:
        return {"query": q, "error": err}
    cons = (d or {}).get("connections") or []
    out = {"query": q, "n": len(cons), "connections": []}
    for c in cons:
        dep = (c.get("from") or {}).get("departure")
        arr = (c.get("to") or {}).get("arrival")
        cats = [((s.get("journey") or {}).get("category") or "walk")
                for s in (c.get("sections") or [])]
        out["connections"].append({"dep": dep, "arr": arr, "cats": cats})
    if cons:
        deps = [c["dep"][:10] for c in out["connections"] if c["dep"]]
        arrs = [c["arr"][:10] for c in out["connections"] if c["arr"]]
        out["dep_dates"] = sorted(set(deps))
        out["arr_dates"] = sorted(set(arrs))
        out["honours_requested_date"] = date.isoformat() in deps
        out["crosses_midnight"] = any(a > d_ for d_, a in
                                      zip(deps, arrs))
    return out


ev = {"_measured": time.strftime("%Y-%m-%d"), "specimens": []}
for value, frm, to, date, hhmm in SPECIMENS:
    r = probe(frm, to, date, hhmm)
    ev["specimens"].append({"value": value, "from": frm, "to": to,
                            "date": date.isoformat(), "time": hhmm, **r})
    print(f"{value:26} {date} {hhmm}  ->", r.get("error") or
          f"n={r['n']} dates={r.get('dep_dates')} honours={r.get('honours_requested_date')} "
          f"midnight={r.get('crosses_midnight')}")
    time.sleep(1.5)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(ev, f, ensure_ascii=False, indent=1)
print("wrote", OUT)
