"""Stáhne data z Infogram grafů publikovaných na datakhk.cz.

Grafy jsou na portálu jako položky typu „Document Link“. Data se načítají živě
z https://live-data.jifo.co/<key>; klíč je v HTML grafu (window.infographicData).

Použití:
    python scripts/harvest_infogram.py "Cestovní ruch" "Kultura" -o docs/infogram.json
"""
import argparse
import json
import re
import urllib.parse
import urllib.request

SEARCH = "https://www.datakhk.cz/api/search/v1/collections/all/items"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def doc_links(tag):
    flt = urllib.parse.quote(f"tags IN ('{tag}')")
    data = json.loads(fetch(f"{SEARCH}?limit=100&filter={flt}"))
    for f in data["features"]:
        p = f["properties"]
        if p.get("type") == "Document Link" and "infogram" in (p.get("url") or ""):
            yield p["title"], p["url"].split("?")[0]


def cell(c):
    return c.get("value") if isinstance(c, dict) else c


def charts(url):
    html = fetch(url)
    m = re.search(r"window\.infographicData\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not m:
        return []
    entities = json.loads(m.group(1))["elements"]["content"]["content"]["entities"]
    out = []
    for cid, e in entities.items():
        cd = e.get("props", {}).get("chartData")
        if not cd:
            continue
        key = cd.get("custom", {}).get("live", {}).get("key")
        data = json.loads(fetch(f"https://live-data.jifo.co/{key}"))["data"] if key else cd.get("data")
        sheets = [[[cell(c) for c in row] for row in sheet] for sheet in (data or [])]
        out.append({"chart_id": cid, "live": bool(key), "sheets": sheets})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tags", nargs="+", help="štítky na datakhk.cz, např. Dotace, Kultura, 'Cestovní ruch'")
    ap.add_argument("-o", "--output", default="infogram.json")
    args = ap.parse_args()

    seen, result = set(), []
    for tag in args.tags:
        for title, url in doc_links(tag):
            if url in seen:
                continue
            seen.add(url)
            result.append({"title": title, "url": url, "charts": charts(url)})
            print(f"{title}: {len(result[-1]['charts'])} grafů")
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
