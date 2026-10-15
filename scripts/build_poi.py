"""Sestaví data/poi.geojson a data/stops.geojson z datových sad Královéhradeckého kraje.

Zdroj: ArcGIS REST služby za datakhk.cz (GeoJSON přímo v WGS84). Formát výstupu
je kontrakt 1.1 v AGENTS.md. Skript je idempotentní; stažená data cachuje do
data/.cache, takže jde spustit i offline (--offline).

Použití:
    python scripts/build_poi.py                  # stáhne a sestaví
    python scripts/build_poi.py --offline        # jen z cache
    python scripts/build_poi.py --with-war-graves  # + válečné hroby (1 423 bodů)
"""
import argparse
import html
import json
import math
import re
import statistics
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / ".cache"
BASE = "https://services6.arcgis.com/ogJAiK65nXL1mXAW/arcgis/rest/services"

# --- Konfigurace (ladit tady) -------------------------------------------------
CONFIG = {
    "dedup_m": 75,           # stejné jméno a blíž než tohle = jedno POI
    "nkp_match_m": 150,      # NKP shoda podle vzdálenosti (jen u památek)
    "bbox": (15.0, 49.9, 16.9, 50.9),  # záložní hranice kraje (lon/lat)
    "points": {
        "base": 30,
        "rarity_min": 0.6,
        "rarity_max": 2.0,
        "remote_cap_m": 3000,
        "remote_bonus": 0.5,
        "nkp_factor": 1.5,
        "min": 10,
        "max": 100,
    },
    # Návštěvnost turistických cílů dle kategorií 2024 (Infogram kraje):
    # přírodní 31,4 %, ZOO a zahrady 18,5 %, hrady a zámky 12,2 %, muzea 5,9 %, rozhledny 5,5 %.
    "popularity": {
        "priroda": 0.7,
        "zoo": 0.8, "zahrady": 0.8,
        "hrady": 0.9, "zamky": 0.9,
        "muzea": 1.1, "rozhledny": 1.1,
        "cirkevni": 1.2, "zidovske": 1.2, "zvony": 1.2,      # sakrální
        "pevnosti": 1.2, "valecne_hroby": 1.2,               # vojenské
    },
    "popularity_default": 1.0,
}

# (slug služby, category, category_label, group, volitelná)
DATASETS = [
    ("Hrady", "hrady", "Hrady", "pamatky"),
    ("Zámky", "zamky", "Zámky", "pamatky"),
    ("Pevnosti_a_opevnění", "pevnosti", "Pevnosti a opevnění", "pamatky"),
    ("Muzea_a_galerie", "muzea", "Muzea a galerie", "kultura"),
    ("Církevní_památky", "cirkevni", "Církevní památky", "pamatky"),
    ("Technické_památky", "technicke", "Technické památky", "pamatky"),
    ("Architektonické_památky", "architektura", "Architektonické památky", "pamatky"),
    ("Židovské_památky", "zidovske", "Židovské památky", "pamatky"),
    ("Ostatní_historické_památky", "historicke", "Ostatní historické památky", "pamatky"),
    ("Národní_kulturní_památky_bodové_objekty", "nkp", "Národní kulturní památky", "pamatky"),
    ("Národní_kulturní_památky_pozemky", "nkp", "Národní kulturní památky", "pamatky"),
    ("Válečné_hroby", "valecne_hroby", "Válečné hroby", "pamatky"),
    ("Zvony_na_Broumovsku", "zvony", "Zvony na Broumovsku", "pamatky"),
    ("Přírodní_zajímavosti", "priroda", "Přírodní zajímavosti", "priroda"),
    ("Rozhledny_a_vyhlídky", "rozhledny", "Rozhledny a vyhlídky", "priroda"),
    ("Botanické_zahrady_a_arboreta", "zahrady", "Botanické zahrady a arboreta", "priroda"),
    ("ZOO_a_zooparky", "zoo", "ZOO a zooparky", "priroda"),
    ("L", "lanovky", "Lanovky", "sport"),
    ("Cyklovýlety", "cyklovylety", "Cyklovýlety", "sport"),
    ("Letní_koupání", "koupani", "Letní koupání", "sport"),
    ("Ostatní_letní_sporty", "sport", "Letní sporty", "sport"),
    ("Letecké_sporty", "letecke", "Letecké sporty", "sport"),
    ("Jezdectví", "jezdectvi", "Jezdectví", "sport"),
    ("Rybaření", "rybareni", "Rybaření", "sport"),
    ("Golfová_hřiště", "golf", "Golfová hřiště", "sport"),
    ("Pivovary", "pivovary", "Pivovary", "gastro"),
    ("Regionální_potraviny", "potraviny", "Regionální potraviny", "gastro"),
    ("Řemeslné_výrobky", "remesla", "Řemeslné výrobky", "gastro"),
    ("Divadla_a_filharmonie", "divadla", "Divadla a filharmonie", "kultura"),
    ("Kina", "kina", "Kina", "kultura"),
    ("Kulturní_domy", "kulturni_domy", "Kulturní domy a kongresová centra", "kultura"),
    ("Hudební_kluby_a_festival_parky", "kluby", "Hudební kluby a festival parky", "kultura"),
    ("Knihovny", "knihovny", "Knihovny", "kultura"),
    ("Zábavní_centra", "zabava", "Zábavní centra", "sport"),
    ("Infocentra", "infocentra", "Infocentra", "sluzby"),
    ("Kempy", "kempy", "Kempy", "sluzby"),
    ("Služby", "sluzby", "Služby", "sluzby"),
    ("Solné_jeskyně", "solne_jeskyne", "Solné jeskyně", "sluzby"),
    ("Lázně", "lazne", "Lázně", "sluzby"),
]
OPTIONAL = {"valecne_hroby"}

BUS_SERVICE = "Autobusové_zastávky_IREDO"
TRAIN_SERVICE = "Železniční_stanice_a_zastávky_VDKHK"
BORDER_SERVICE = "Hranice_Královéhradeckého_kraje"
ORP_RE = re.compile(r"52\d\d")  # kódy ORP v KHK: 5201–5215


# --- Stahování ----------------------------------------------------------------
def http_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "krajanek-build/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def fetch_layer(service, offline=False, layer=0, page=1000):
    """Všechny featury vrstvy jako GeoJSON (stránkuje přes resultOffset)."""
    cache = CACHE / f"{service}.geojson"
    if cache.exists() and offline:
        return json.loads(cache.read_text("utf-8"))["features"]
    if offline:
        raise SystemExit(f"Chybí cache {cache}, spusť bez --offline.")
    url = f"{BASE}/{urllib.parse.quote(service)}/FeatureServer/{layer}/query"
    features, offset = [], 0
    while True:
        qs = urllib.parse.urlencode({
            "where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": page,
        })
        data = http_json(f"{url}?{qs}")
        if "error" in data:
            raise RuntimeError(f"{service}: {data['error']}")
        batch = data.get("features", [])
        features += batch
        if not batch or not data.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += len(batch)
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), "utf-8")
    return features


# --- Geometrie ----------------------------------------------------------------
def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def representative_point(geom):
    """[lon, lat] pro Point, první bod linie (start výletu), těžiště vrcholů polygonu."""
    if not geom:
        return None
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return c
    if t == "MultiPoint":
        return c[0]
    if t == "LineString":
        return c[0]
    if t == "MultiLineString":
        return c[0][0]
    if t in ("Polygon", "MultiPolygon"):
        ring = c[0] if t == "Polygon" else c[0][0]
        pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
        return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]
    return None


def point_in_rings(lon, lat, rings):
    inside = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def border_test(offline):
    """Funkce (lon, lat) -> bool. Polygon kraje s 1km tolerancí, jinak bbox."""
    x0, y0, x1, y1 = CONFIG["bbox"]

    def in_bbox(lon, lat):
        return x0 <= lon <= x1 and y0 <= lat <= y1
    try:
        feats = fetch_layer(BORDER_SERVICE, offline)
        g = feats[0]["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        rings = [r for poly in polys for r in poly]
    except Exception as e:  # noqa: BLE001 – hranice je jen pojistka
        print(f"  ! hranice kraje nedostupná ({e}), používám bbox")
        return in_bbox
    # vrcholy hranice pro toleranci (body těsně za čárou, např. hraniční přechody)
    border_pts = [p for r in rings for p in r[::5]]
    grid = Grid([(p[1], p[0], None) for p in border_pts])

    def inside(lon, lat):
        if not in_bbox(lon, lat):
            return False
        if point_in_rings(lon, lat, rings):
            return True
        hit = grid.nearest(lat, lon, max_m=1000)
        return hit is not None
    return inside


class Grid:
    """Jednoduchý prostorový index pro hledání nejbližšího bodu."""
    CELL = 0.02  # stupně (~1,4–2,2 km)

    def __init__(self, items):  # items: (lat, lon, payload)
        self.cells = {}
        for it in items:
            self.cells.setdefault(self._key(it[0], it[1]), []).append(it)

    def _key(self, lat, lon):
        return (int(math.floor(lat / self.CELL)), int(math.floor(lon / self.CELL)))

    def nearest(self, lat, lon, max_m=50000):
        ky, kx = self._key(lat, lon)
        best, best_d = None, float("inf")
        ring = 0
        while ring * self.CELL * 70000 < max_m + 2 * self.CELL * 111000:
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dy), abs(dx)) != ring:
                        continue
                    for it in self.cells.get((ky + dy, kx + dx), ()):
                        d = haversine(lat, lon, it[0], it[1])
                        if d < best_d:
                            best, best_d = it, d
            # další kroužek už nemůže být blíž než ring*CELL v šířce (~70 km/° v délce)
            if best is not None and best_d < ring * self.CELL * 70000:
                break
            ring += 1
        if best is None or best_d > max_m:
            return None
        return best, best_d


# --- Čištění atributů ---------------------------------------------------------
TAG_RE = re.compile(r"<[^>]+>")


def clean_text(v):
    if v is None:
        return None
    s = html.unescape(TAG_RE.sub(" ", str(v)))
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def norm_name(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def clean_url(v):
    v = clean_text(v)
    if not v or v in ("-", "0"):
        return None
    v = v.split()[0].rstrip(",;")
    if not re.match(r"^https?://", v, re.I):
        v = "http://" + v
    return v


def pick(p, *keys):
    for k in keys:
        v = clean_text(p.get(k))
        if v and v != "-":
            return v
    return None


def as_code(v):
    if v is None or v == "":
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip() or None


def poi_name(p, category, municipality):
    name = pick(p, "nazev", "Název")
    if name:
        return name
    if category == "kempy":
        place = (pick(p, "region") or "").split("/")[0].strip() or municipality
        return f"Kemp {place}" if place else "Kemp"
    if category == "lazne":
        return pick(p, "pozn") or f"Lázně {municipality or ''}".strip()
    if category == "valecne_hroby":
        return f"Válečný hrob {pick(p, 'katastr') or municipality or ''}".strip()
    return None


def map_feature(f, service, category, label, group):
    p = f.get("properties") or {}
    coord = representative_point(f.get("geometry"))
    if coord is None and p.get("x") and p.get("y"):
        coord = [p["x"], p["y"]]  # x = délka (lon), y = šířka (lat); wkt má pořadí prohozené!
    if coord is None:
        return None
    municipality = pick(p, "nazev_obce", "Název obce")
    name = poi_name(p, category, municipality)
    if not name:
        return None
    oid = p.get("OBJECTID", p.get("OBJECTID_1", f.get("id")))
    desc = pick(p, "popis", "Popis", "popis_zkraceny", "poznamka", "objekt", "typ_zarizeni", "druh_zarizeni")
    if category == "cyklovylety" and p.get("delka"):
        km = float(p["delka"]) / 1000
        desc = f"Délka trasy {km:.1f} km. " + (desc or "")
    return {
        "lon": round(float(coord[0]), 6),
        "lat": round(float(coord[1]), 6),
        "id": f"{category}:{oid}" if category != "nkp" else f"nkp{'_pozemky' if 'pozemky' in service else ''}:{oid}",
        "name": name,
        "category": category,
        "category_label": label,
        "group": group,
        "description": (desc or "").strip() or None,
        "municipality": municipality,
        "municipality_code": as_code(p.get("kod_obce")),
        "orp_code": as_code(p.get("kod_orp")),
        "web": clean_url(p.get("www") or p.get("Webové stránky")),
        "tp_id": as_code(p.get("ds_id")),
        "is_nkp": category == "nkp",
        "also_in": [],
        "source": service.replace("_", " "),
    }


# --- Pipeline -----------------------------------------------------------------
def load_pois(offline, with_optional):
    pois = []
    for service, category, label, group in DATASETS:
        if category in OPTIONAL and not with_optional:
            continue
        feats = fetch_layer(service, offline)
        mapped = [m for m in (map_feature(f, service, category, label, group) for f in feats) if m]
        print(f"  {service:42s} {len(feats):5d} → {len(mapped):5d}")
        pois += mapped
    return pois


def dedupe(pois):
    """Stejné normalizované jméno do dedup_m → jedno POI (první dle pořadí DATASETS).
    NKP navíc splyne s blízkou památkou (do nkp_match_m) – jen jí nastaví is_nkp."""
    kept, grid_items = [], {}
    for p in pois:
        key = norm_name(p["name"])
        dup = None
        for q in grid_items.get(key, ()):
            if haversine(p["lat"], p["lon"], q["lat"], q["lon"]) < CONFIG["dedup_m"]:
                dup = q
                break
        if dup is None and p["category"] == "nkp":
            dup = nearest_heritage(p, kept)
        if dup is not None:
            if p["category"] != dup["category"] and p["category"] not in dup["also_in"]:
                dup["also_in"].append(p["category"])
            dup["is_nkp"] = dup["is_nkp"] or p["is_nkp"]
            dup["description"] = dup["description"] or p["description"]
            dup["web"] = dup["web"] or p["web"]
            continue
        kept.append(p)
        grid_items.setdefault(key, []).append(p)
    return kept


def nearest_heritage(nkp, kept):
    nk = norm_name(nkp["name"])
    best, best_d = None, float("inf")
    for q in kept:
        if q["group"] != "pamatky":
            continue
        d = haversine(nkp["lat"], nkp["lon"], q["lat"], q["lon"])
        qn = norm_name(q["name"])
        name_hit = d < 2000 and (nk in qn or qn in nk) and min(len(nk), len(qn)) >= 4
        if (d < CONFIG["nkp_match_m"] or name_hit) and d < best_d:
            best, best_d = q, d
    return best


def load_stops(offline):
    stops = []
    for f in fetch_layer(BUS_SERVICE, offline):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        stops.append({"id": f"bus:{p['OBJECTID']}", "name": clean_text(p["nazev"]), "type": "bus",
                      "lat": round(lat, 6), "lon": round(lon, 6),
                      "municipality": clean_text(p.get("nazev_obce")), "municipality_code": as_code(p.get("kod_obce")),
                      "orp_code": as_code(p.get("kod_orp")), "platform": as_code(p.get("stanoviste"))})
    for f in fetch_layer(TRAIN_SERVICE, offline):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        stops.append({"id": f"train:{p['OBJECTID']}", "name": clean_text(p["nazev"]), "type": "train",
                      "lat": round(lat, 6), "lon": round(lon, 6),
                      "municipality": clean_text(p.get("nazev_obce")), "municipality_code": as_code(p.get("kod_obce")),
                      "orp_code": as_code(p.get("kod_orp")), "platform": None})
    return [s for s in stops if s["name"]]


def fix_admin_codes(pois, stops):
    """Opraví orp_code (a doplní chybějící obec) podle zastávek.

    Zdrojové sady mají v kod_orp chyby: Pivovary tam mají kód okresu (CZ0522),
    Rozhledny kód obce, pobočky knihovny v HK kódy ORP jiných měst, Cyklovýlety
    obec vůbec nemají. Zastávky (≈4 700 bodů) jsou konzistentní, takže z nich
    vezmeme obec → ORP většinovým hlasem a POI bez obce dostanou obec
    i ORP z nejbližší zastávky, obec bez zastávek jen ORP."""
    votes = {}
    for s in stops:
        if s["municipality_code"] and s["orp_code"] and ORP_RE.fullmatch(s["orp_code"]):
            votes.setdefault(s["municipality_code"], Counter())[s["orp_code"]] += 1
    obec_orp = {k: v.most_common(1)[0][0] for k, v in votes.items()}
    names = {s["municipality_code"]: s["municipality"] for s in stops if s["municipality_code"]}
    grid = Grid([(s["lat"], s["lon"], s) for s in stops if s["municipality_code"] in obec_orp])
    fixed = filled = 0
    for p in pois:
        orp = obec_orp.get(p["municipality_code"])
        if not orp:  # obec bez zastávky (Brada-Rybníček) nebo chybí úplně (cyklovýlety)
            hit = grid.nearest(p["lat"], p["lon"])
            if hit:
                s = hit[0][2]
                orp = obec_orp[s["municipality_code"]]
                if not p["municipality_code"]:
                    p["municipality_code"] = s["municipality_code"]
                    p["municipality"] = p["municipality"] or names[s["municipality_code"]]
                    filled += 1
        if orp and orp != p["orp_code"]:
            p["orp_code"] = orp
            fixed += 1
    print(f"ORP opraveno: {fixed}, obec doplněna z nejbližší zastávky: {filled}")


def idos_url(stop_name):
    return "https://idos.cz/vlakyautobusy/spojeni/?" + urllib.parse.urlencode({"f": "", "t": stop_name})


def attach_stops(pois, stops):
    grids = {t: Grid([(s["lat"], s["lon"], s) for s in stops if s["type"] == t]) for t in ("bus", "train")}
    for p in pois:
        found = {}
        for t, g in grids.items():
            hit = g.nearest(p["lat"], p["lon"])
            if hit:
                s, d = hit[0][2], hit[1]
                found[t] = {"name": s["name"], "type": t, "distance_m": round(d), "lat": s["lat"], "lon": s["lon"]}
        p["nearest_bus"] = found.get("bus")
        p["nearest_train"] = found.get("train")
        p["nearest_stop"] = min(found.values(), key=lambda s: s["distance_m"]) if found else None
        p["idos_url"] = idos_url(p["nearest_stop"]["name"]) if p["nearest_stop"] else None


def score(pois):
    c = CONFIG["points"]
    sizes = {}
    for p in pois:
        sizes[p["category"]] = sizes.get(p["category"], 0) + 1
    median = statistics.median(sizes.values())
    for p in pois:
        rarity = min(max(math.sqrt(median / sizes[p["category"]]), c["rarity_min"]), c["rarity_max"])
        dist = p["nearest_stop"]["distance_m"] if p["nearest_stop"] else c["remote_cap_m"]
        remote = 1.0 + min(dist, c["remote_cap_m"]) / c["remote_cap_m"] * c["remote_bonus"]
        heritage = c["nkp_factor"] if p["is_nkp"] else 1.0
        popular = CONFIG["popularity"].get(p["category"], CONFIG["popularity_default"])
        raw = c["base"] * rarity * remote * heritage * popular
        p["points"] = int(round(min(max(raw, c["min"]), c["max"])))


def to_feature(p, keys):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
            "properties": {k: p[k] for k in keys}}


POI_KEYS = ["id", "name", "category", "category_label", "group", "description", "municipality",
            "municipality_code", "orp_code", "web", "tp_id", "is_nkp", "also_in", "nearest_stop",
            "nearest_bus", "nearest_train", "idos_url", "points", "source"]


def write_geojson(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")


def validate(pois):
    x0, y0, x1, y1 = CONFIG["bbox"]
    ids = [p["id"] for p in pois]
    errors = []
    if len(pois) <= 1500:
        errors.append(f"málo POI: {len(pois)}")
    if len(set(ids)) != len(ids):
        errors.append("duplicitní id")
    errors += [f"body mimo 10–100: {p['id']}" for p in pois if not 10 <= p["points"] <= 100]
    errors += [f"mimo bbox: {p['id']}" for p in pois if not (x0 <= p["lon"] <= x1 and y0 <= p["lat"] <= y1)]
    errors += [f"bez zastávky: {p['id']}" for p in pois if not p["nearest_stop"]]
    errors += [f"neplatné ORP: {p['id']} {p['orp_code']}" for p in pois if not ORP_RE.fullmatch(p["orp_code"] or "")]
    if errors:
        raise SystemExit("VALIDACE SELHALA:\n  " + "\n  ".join(errors[:20]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="nestahovat, použít data/.cache")
    ap.add_argument("--with-war-graves", action="store_true", help="přidat válečné hroby (1 423 bodů)")
    args = ap.parse_args()

    print("POI:")
    pois = load_pois(args.offline, args.with_war_graves)
    inside = border_test(args.offline)
    before = len(pois)
    pois = [p for p in pois if inside(p["lon"], p["lat"])]
    print(f"mimo kraj zahozeno: {before - len(pois)}")
    before = len(pois)
    pois = dedupe(pois)
    print(f"duplicity sloučeny: {before - len(pois)}")

    print("Zastávky:")
    stops = load_stops(args.offline)
    print(f"  bus {sum(s['type'] == 'bus' for s in stops)}, vlak {sum(s['type'] == 'train' for s in stops)}")
    fix_admin_codes(pois, stops)
    attach_stops(pois, stops)
    score(pois)
    validate(pois)

    pois.sort(key=lambda p: p["id"])
    write_geojson(DATA / "poi.geojson", [to_feature(p, POI_KEYS) for p in pois])
    write_geojson(DATA / "stops.geojson",
                  [to_feature(s, ["id", "name", "type", "municipality", "municipality_code", "orp_code", "platform"])
                   for s in stops])

    pts = sorted(p["points"] for p in pois)
    print(f"\nHotovo: {len(pois)} POI (NKP {sum(p['is_nkp'] for p in pois)}), {len(stops)} zastávek")
    print(f"body min/medián/max: {pts[0]}/{pts[len(pts) // 2]}/{pts[-1]}")
    print(f"→ {DATA / 'poi.geojson'}\n→ {DATA / 'stops.geojson'}")


if __name__ == "__main__":
    main()
