#!/usr/bin/env python3
"""Curated heritage / panorama catalogue -> the HERITAGE_CATALOGUE constant in app.js.

WHY THIS IS OFFLINE AND NOT A RUNTIME FETCH. UNSOLVED-GAPS 1.2: most special
products are invisible in timetable data (a panorama train is an ordinary train
with a product attached; a museum railway's stops are not even stations), so
the algorithmic third (EXT + operator allowlist, shipped as specialRows) cannot
reach them. What reaches them is a small curated list per operator -- product,
route, season -- which changes YEARLY, not hourly. Same decision as the
Tarifverbund table: build-time JSON, one string in app.js, no build step for
the user.

WHAT THIS SCRIPT OWNS. tools/heritage.json is the hand-edited source of truth.
This script (1) VALIDATES it -- a malformed season or a bare http source fails
loudly, never ships; (2) RESOLVES stop names to UIC station ids through
transport.opendata.ch (the same id the browser gets back as station.id, so the
runtime matches an integer it already has); (3) EMITS the compact runtime
constant; (4) CHECKS that app.js carries exactly the constant the JSON would
produce, which is the decidable "is the shipped catalogue current" question.

RESOLUTION IS EXACT-NAME AND LOUD. A stop resolves only when the API returns a
station whose name is byte-equal to the curated name. Anything else stays
`id: null` and is PRINTED: a museum line's halts are usually not stations at all
(Sursee-Triengen: only Sursee resolves), and the runtime then falls back to
name matching for that stop. Silently taking the first fuzzy hit would pin a
steam train to a bus stop.

Usage:
    python3 tools/build-heritage.py --validate          # schema only, offline
    python3 tools/build-heritage.py --resolve           # fill ids from the API, rewrite the JSON
    python3 tools/build-heritage.py --emit              # print the constant
    python3 tools/build-heritage.py --apply             # write it into app.js
    python3 tools/build-heritage.py --check             # exit 0 iff app.js is current
    (--app PATH overrides the app.js location; --json PATH the catalogue)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # cp1252 consoles kill non-ASCII prints

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "tools" / "heritage.json"
APP_PATH = ROOT / "app.js"
API = "https://transport.opendata.ch/v1/locations?type=station&query="
CONST_RE = re.compile(r"^const HERITAGE_CATALOGUE=.*;$", re.M)

DOW = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
EVIDENCE = {"operator", "third-party"}
KINDS = {"panorama", "heritage", "steam", "excursion"}


class Invalid(Exception):
    pass


def _date(s, where):
    if s is None:
        return None
    try:
        return _dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        raise Invalid(f"{where}: bad date {s!r} (want YYYY-MM-DD)")


def validate(doc) -> list:
    """Return the product list or raise Invalid naming the first defect."""
    if not isinstance(doc, dict) or not isinstance(doc.get("products"), list):
        raise Invalid("top level must be an object with a 'products' list")
    _date(doc.get("checked"), "checked")
    seen = set()
    for i, p in enumerate(doc["products"]):
        w = f"products[{i}] ({p.get('id', '?')})"
        for k in ("id", "name", "operator", "kind", "route", "stops", "season", "reservation", "evidence", "source", "quote"):
            if k not in p:
                raise Invalid(f"{w}: missing {k!r}")
        if p["id"] in seen:
            raise Invalid(f"{w}: duplicate id")
        seen.add(p["id"])
        if p["kind"] not in KINDS:
            raise Invalid(f"{w}: kind {p['kind']!r} not in {sorted(KINDS)}")
        if not re.match(r"^https://", p["source"]):
            raise Invalid(f"{w}: source must be an https URL")
        ev = p["evidence"]
        if not isinstance(ev, dict) or ev.get("season") not in EVIDENCE or ev.get("stops") not in EVIDENCE:
            raise Invalid(f"{w}: evidence.season and evidence.stops must each be one of {sorted(EVIDENCE)}")
        if not p["stops"]:
            raise Invalid(f"{w}: no stops")
        for s in p["stops"]:
            n = s if isinstance(s, str) else (s or {}).get("name")
            if not n:
                raise Invalid(f"{w}: a stop has no name")
            if isinstance(s, dict) and s.get("id") is not None and not re.match(r"^\d+$", str(s["id"])):
                raise Invalid(f"{w}: stop {n!r} id must be digits or null")
        if not p["season"]:
            raise Invalid(f"{w}: no season")
        for j, s in enumerate(p["season"]):
            ws = f"{w}.season[{j}]"
            if "dates" in s:
                if not s["dates"]:
                    raise Invalid(f"{ws}: empty dates list")
                for d in s["dates"]:
                    _date(d, ws)
                continue
            f, t = _date(s.get("from"), ws), _date(s.get("to"), ws)
            if f is None:
                raise Invalid(f"{ws}: 'from' required")
            if t is not None and t < f:
                raise Invalid(f"{ws}: to < from")
            d = s.get("days")
            if not (d == "daily" or (isinstance(d, list) and d and set(d) <= DOW)):
                raise Invalid(f"{ws}: days must be 'daily' or a non-empty list of {sorted(DOW)}")
        for j, c in enumerate(p.get("closed", [])):
            wc = f"{w}.closed[{j}]"
            f, t = _date(c.get("from"), wc), _date(c.get("to"), wc)
            if f is None:
                raise Invalid(f"{wc}: 'from' required")
            if t is not None and t < f:
                raise Invalid(f"{wc}: to < from")
    return doc["products"]


def _stop_name(s):
    return s if isinstance(s, str) else s["name"]


def _stop_id(s):
    return None if isinstance(s, str) else s.get("id")


def resolve(doc) -> tuple[int, int, list]:
    """Fill ids in place. Returns (stops, resolved, unresolved-names)."""
    cache: dict[str, str | None] = {}
    total = resolved = 0
    unresolved = []
    for p in doc["products"]:
        new = []
        for s in p["stops"]:
            n = _stop_name(s)
            total += 1
            if n not in cache:
                with urllib.request.urlopen(API + urllib.parse.quote(n), timeout=30) as r:
                    d = json.load(r)
                hit = [x for x in d.get("stations", []) if x.get("id") and x.get("name") == n]
                cache[n] = str(hit[0]["id"]) if hit else None
            sid = cache[n]
            if sid:
                resolved += 1
            else:
                unresolved.append(n)
            new.append({"name": n, "id": sid})
        p["stops"] = new
    return total, resolved, unresolved


def runtime(doc) -> list:
    """The compact shape app.js carries. Keys are short because every byte ships."""
    out = []
    for p in doc["products"]:
        se = []
        for s in p["season"]:
            if "dates" in s:
                se.append({"dates": list(s["dates"])})
            else:
                se.append({"f": s["from"], "t": s.get("to"), "d": s["days"]})
        out.append({
            "id": p["id"], "n": p["name"], "op": p["operator"], "k": p["kind"], "r": p["route"],
            "s": [{"n": _stop_name(s), "id": _stop_id(s)} for s in p["stops"]],
            "se": se,
            "cl": [{"f": c["from"], "t": c.get("to")} for c in p.get("closed", [])],
            "rv": p["reservation"], "ev": p["evidence"]["season"],
            "src": p["source"], "c": doc["checked"],
        })
    return out


def emit(doc) -> str:
    js = json.dumps(runtime(doc), separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    js = js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")   # valid JSON, invalid JS
    return "const HERITAGE_CATALOGUE=" + js + ";"


def current_line(app: Path) -> str:
    m = CONST_RE.findall(app.read_text(encoding="utf-8"))
    if len(m) != 1:
        raise Invalid(f"{app}: expected exactly one 'const HERITAGE_CATALOGUE=...;' line, found {len(m)}")
    return m[0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    for f in ("validate", "resolve", "emit", "apply", "check"):
        g.add_argument("--" + f, action="store_true")
    ap.add_argument("--json", type=Path, default=JSON_PATH)
    ap.add_argument("--app", type=Path, default=APP_PATH)
    a = ap.parse_args(argv)

    try:
        doc = json.loads(a.json.read_text(encoding="utf-8"))
        products = validate(doc)
    except (OSError, ValueError, Invalid) as e:
        print(f"INVALID: {e}")
        return 2

    if a.validate:
        print(f"VALID: {len(products)} products, checked {doc['checked']}")
        return 0
    if a.resolve:
        total, ok, missing = resolve(doc)
        a.json.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"RECORD: stops={total} resolved={ok} unresolved={total - ok}")
        for n in missing:
            print(f"  unresolved (kept as name-only, runtime matches by name): {n}")
        return 0
    line = emit(doc)
    if a.emit:
        print(line)
        return 0
    try:
        have = current_line(a.app)
    except (OSError, Invalid) as e:
        print(f"ERROR: {e}")
        return 2
    if a.check:
        if have == line:
            print(f"CURRENT: app.js carries the catalogue of {len(products)} products (checked {doc['checked']})")
            return 0
        print("STALE: app.js HERITAGE_CATALOGUE differs from tools/heritage.json -- run --apply")
        return 1
    if a.apply:
        txt = a.app.read_text(encoding="utf-8")
        a.app.write_text(txt.replace(have, line, 1), encoding="utf-8")
        print(f"APPLIED: {len(line)} chars, {len(products)} products into {a.app}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
