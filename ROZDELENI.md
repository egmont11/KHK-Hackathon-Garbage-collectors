# Rozdělení práce

| Kdo | Role | Co přesně |
|---|---|---|
| **Tadeáš** | Design + frontend UI | Vzhled aplikace: styl mapy, cedulky POI, cedule rozcestníku, značky týmů, animace check-inu. Komponenty a obrazovky (mapa, detail, check-in, žebříček, onboarding) nad mock daty. Grafika do pitche. |
| **Karel** | Data + doprava + napojení frontendu | `build_poi.py` → `poi.geojson`, bodování, nejbližší zastávky, odkazy do IDOS. Napojení obrazovek na API: filtry, `ping` při check-inu, polling žebříčku, demo režim `?demo=1`. |
| **Matěj** | Backend + hra | Mock API nad `poi.geojson`, DB, týmy a hráči, check-in s kontrolou GPS, body a sezóny, `/api/stats`. Dashboard pro kraj (heatmapa, grafy), případně quick time eventy. |
| **Všichni** | Pitch + demo | Tadeáš slidy, Karel a Matěj demo scénář a opravy. |

**Rozhraní:** formát `poi.geojson` a API podle [AGENTS.md](AGENTS.md). Každý pracuje ve své složce: Karel `scripts/` + `data/`, Matěj `backend/`, Tadeáš `frontend/`.
