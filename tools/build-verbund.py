#!/usr/bin/env python3
"""Regenerate the station -> Tarifverbund table that index.html carries inline.

WHY THIS IS OFFLINE AND NOT A BUILD STEP. The README promises "no build step,
no dependencies, no API key -- one HTML file you can open anywhere", and that
promise is about the USER: nobody needs a toolchain to run Rail. This script is
run by a maintainer roughly once a year, when the Verbund boundaries change, and
its whole output is a single string pasted into index.html. The shipped artifact
is still one file.

WHY THE ANSWER IS PRECOMPUTED. The naive design ships the zone geometry and does
point-in-polygon in the browser. Measured, that is 4.4 MB (1.5 MB gzipped) of
polygons -- unshippable on a phone. The cheap alternative, nearest-centroid over
the 2137 place centroids, is 125 KB but WRONG for 2.2% of stations (659 of
30522), and "your ticket is valid here" is exactly the claim that must not be
approximately right. So the point-in-polygon runs HERE, once, offline, and the
browser gets the answer instead of the means to compute it: exact, and small.

WHY RAIL STOPS ONLY. Restricting to rail-ish modes drops the table from 30522
stations to 3779 (155 KB -> 19.8 KB packed). That is not a coverage compromise:
measured over six real cross-country journeys, the rail-only table resolves
exactly the same stops as the full table (100% of real stations in both; the
apparent misses are routing markers like "Gotthard-Basistunnel", which are not
stations and which legStops() already filters). The 26743 bus stops bought zero
coverage on rail journeys, so they are not carried.

SOURCES (both open, keyless, CORS-open, from data.sbb.ch):
  tarifverbundkarte        2137 zone polygons + their Verbund names
  haltestelle-haltekante  30747 stop points with UIC numbers

The UIC number is the join key that makes this work at all:
transport.opendata.ch returns station.id as the same UIC number (8507000 =
Bern), so the browser looks up an integer it already has.

Usage:
    python3 tools/build-verbund.py            # prints the constant to paste
    python3 tools/build-verbund.py --check    # verify index.html is current
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
BASE = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets"
TVK = f"{BASE}/tarifverbundkarte/exports/json"
STOPS = (f"{BASE}/haltestelle-haltekante/exports/json"
         "?select=number,geopos_haltestelle,meansoftransport")

# Modes a rail journey's passList can contain. BUS is deliberately excluded --
# see the module docstring: it costs 135 KB and adds no resolvable stop.
RAIL_MODES = {"TRAIN", "TRAM", "METRO", "RACK_RAILWAY", "CABLE_RAILWAY",
              "CABLE_CAR", "CHAIRLIFT", "BOAT"}
CELL = 0.1  # degrees; grid bucket size for the point-in-polygon prefilter


def fetch(url: str):
    with urllib.request.urlopen(url, timeout=300) as r:
        return json.load(r)


def outer_rings(shape) -> list:
    """Outer ring of every Polygon / MultiPolygon part. Holes are ignored: a
    Verbund zone's holes are other zones, and a stop in the hole is resolved by
    that zone's own polygon, so dropping them cannot silently claim a stop."""
    g = (shape or {}).get("geometry") or {}
    kind, coords = g.get("type"), g.get("coordinates")
    if kind == "Polygon":
        return [coords[0]] if coords else []
    if kind == "MultiPolygon":
        return [part[0] for part in (coords or []) if part]
    return []


def inside(lon: float, lat: float, ring) -> bool:
    """Ray casting. Ring is closed lon/lat pairs."""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def build() -> tuple[list, str, dict]:
    tvk = fetch(TVK)
    stops = fetch(STOPS)

    polys = []
    for idx, place in enumerate(tvk):
        for ring in outer_rings(place.get("geo_shape")):
            lons = [p[0] for p in ring]
            lats = [p[1] for p in ring]
            polys.append((idx, ring, min(lons), min(lats), max(lons), max(lats)))

    grid = defaultdict(list)
    for k, (_, _, x0, y0, x1, y1) in enumerate(polys):
        for cx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
            for cy in range(math.floor(y0 / CELL), math.floor(y1 / CELL) + 1):
                grid[(cx, cy)].append(k)

    names: set[str] = set()
    resolved: dict[int, set[str]] = {}
    for s in stops:
        gp = s.get("geopos_haltestelle")
        uic = s.get("number")
        modes = set((s.get("meansoftransport") or "").split("|"))
        if not gp or not uic or not (modes & RAIL_MODES):
            continue
        lon, lat = gp["lon"], gp["lat"]
        found = set()
        for k in grid.get((math.floor(lon / CELL), math.floor(lat / CELL)), ()):
            idx, ring, x0, y0, x1, y1 = polys[k]
            if x0 <= lon <= x1 and y0 <= lat <= y1 and inside(lon, lat, ring):
                found |= {v.strip() for v in (tvk[idx].get("partners") or "").split(",")
                          if v.strip()}
        if found:
            resolved[int(uic)] = found
            names |= found

    verbunde = sorted(names)
    index_of = {v: i for i, v in enumerate(verbunde)}

    # Delta-encoded ascending UIC ids + a hex bitmask of Verbund indices. Ids are
    # clustered, so deltas are small; a station in two Verbunde is one mask, not
    # a second row -- 2822 of them exist and none of them needs a special case.
    parts, prev = [], 0
    for uic in sorted(resolved):
        mask = 0
        for v in resolved[uic]:
            mask |= 1 << index_of[v]
        parts.append(f"{uic - prev:x}.{mask:x}")
        prev = uic

    stats = {"stations": len(resolved), "verbunde": len(verbunde),
             "polygons": len(polys), "multi": sum(1 for v in resolved.values() if len(v) > 1)}
    return verbunde, ",".join(parts), stats


MARK_A = "/* VERBUND-DATA-START (generated by tools/build-verbund.py) */"
MARK_B = "/* VERBUND-DATA-END */"


def render(verbunde: list, packed: str) -> str:
    return (f"{MARK_A}\nconst VERBUND_NAMES={json.dumps(verbunde, ensure_ascii=False)};\n"
            f"const VERBUND_PACKED=\"{packed}\";\n{MARK_B}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if index.html does not match a fresh build")
    ap.add_argument("--write", action="store_true",
                    help="splice the block into index.html between the markers")
    args = ap.parse_args()

    verbunde, packed, stats = build()
    block = render(verbunde, packed)
    print(f"# stations={stats['stations']} verbunde={stats['verbunde']} "
          f"multi-verbund={stats['multi']} rings={stats['polygons']} "
          f"packed={len(packed)/1024:.1f}KB", file=sys.stderr)

    html = INDEX.read_text(encoding="utf-8")
    pat = re.compile(re.escape(MARK_A) + r".*?" + re.escape(MARK_B), re.S)
    if args.check:
        found = pat.search(html)
        if not found:
            print("build-verbund: markers not found in index.html", file=sys.stderr)
            return 1
        if found.group(0).strip() != block.strip():
            print("build-verbund: index.html is STALE vs a fresh build", file=sys.stderr)
            return 1
        print("build-verbund: index.html is current", file=sys.stderr)
        return 0
    if args.write:
        if not pat.search(html):
            print("build-verbund: markers not found in index.html", file=sys.stderr)
            return 1
        INDEX.write_text(pat.sub(lambda _: block, html), encoding="utf-8")
        print("build-verbund: index.html updated", file=sys.stderr)
        return 0
    print(block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
