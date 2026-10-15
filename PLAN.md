# Plán – Turisťák

*Objevuj, dobývej, poznávej kraj.*

> Krátká verze pro tým. Podrobné zadání pro AI agenty je v [PLAN-AGENTS.md](PLAN-AGENTS.md), přehled dat v [docs/data-khk-prehled.md](docs/data-khk-prehled.md).

## O co jde
- Mapa Královéhradeckého kraje se **všemi body zájmu (POI)** z otevřených dat kraje: asi 2 300 míst, např. hrady, rozhledny, muzea, pivovary, koupaliště, přírodní zajímavosti a památky.
- Hráč patří do jednoho ze **3 týmů**. Dojede k POI, ideálně **veřejnou dopravou**, a **1 minutu** zůstane do **100 m** od POI. Tím jeho tým získá body.
- Kolik bodů POI dává, se počítá z dat (vzácnost, odlehlost, památková hodnota). Body týmů postupně **pomalu ubývají**, takže je potřeba chodit pořád.
- Kraj z toho získá **anonymní statistiku**, kam lidé chodí. Lidé se baví a objevují méně známá místa.

## Téma a vzhled
- **Téma:** objevování kraje: nová místa, historie, příroda, památky, dobrodružství.
- **Týmy:** **Hory** (červená), **Řeky** (modrá), **Lesy** (zelená), stejně jako barvy turistického značení.
- **Motiv:** turistika a orientační běh.
  - Mapa ve stylu orientační mapy.
  - POI jako kontroly OB (fialový kroužek / lampion).
  - Detail POI jako žlutá cedule rozcestníku.
  - Týmy jako značky bílá–barva–bílá.
  - Check-in = „ražení“ kontroly.
- **Tón:** hravý a roztomilý, ale střídmý: kulaté tvary, jednoduché ikony, žádní maskoti.

## MVP (musí být na demo)
1. Mapa s POI, filtry (kategorie, body, vzdálenost) a detailem POI.
2. Nejbližší autobusová a vlaková zastávka k POI a odkaz na vyhledání spoje (IDOS).
3. Výběr týmu, check-in podle GPS (100 m / 60 s) a přičtení bodů.
4. Žebříček týmů s ubýváním bodů.
5. Jednoduchý dashboard pro kraj: návštěvy po POI a kategoriích (heatmapa).

## Až zbude čas
Quick time eventy (bonusový POI na 30 minut), „kdo bude první“ a souboje o POI, denní výzvy, odznaky, plánování spojů přímo v aplikaci z jízdních řádů.

## Dělba práce (4 lidi; ve 3 lidech spojte role C a D)

| Kdo | Role | Úkoly |
|---|---|---|
| **A** | Data | Stáhnout a sjednotit POI do `poi.geojson`, nejbližší zastávky, bodování POI |
| **B** | Frontend / mapa | Mapa, filtry, detail POI, check-in obrazovka, žebříček |
| **C** | Backend / hra | API, týmy, check-in s kontrolou GPS, body a jejich ubývání, události |
| **D** | Doprava + kraj + pitch | Zastávky a odkazy na spoje, dashboard pro kraj, prezentace a demo |

**Rozhraní mezi lidmi:** A předá `poi.geojson` (formát je v PLAN-AGENTS.md). C předá API a B ho používá. Dokud API neexistuje, B pracuje proti mock datům.

## Časový plán
1. **Start (~2 h):** odsouhlasit stack, A vydá první verzi `poi.geojson`, C mock API.
2. **Jádro:** mapa + check-in + body fungují end-to-end.
3. **Doladění:** bodování, ubývání bodů, doprava, dashboard.
4. **Poslední 2 h:** žádné nové featury, jen opravy a demo scénář (jedno POI nasimulované jako „jsem na místě“).

## Rozhodnout hned na začátku
- Stack. Návrh: web (PWA) + Leaflet/MapLibre, backend Node nebo FastAPI + SQLite/Postgres.
- Jak rychle body ubývají (návrh: 2 % za hodinu) a cooldown na POI (návrh: 1 hráč = 1 check-in na POI za 24 h).
