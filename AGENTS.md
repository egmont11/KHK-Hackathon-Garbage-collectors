# AGENTS – podrobné zadání pro AI agenty (Krajánek)

Krátká verze pro lidi je v [PLAN.md](PLAN.md). Přehled všech zkoumaných dat je v [docs/data-khk-prehled.md](docs/data-khk-prehled.md).
Tento dokument je zdroj pravdy pro implementaci. Při práci na úkolu přečti celou sekci své role a sekci **Kontrakty**.

## 0. Kontext a pravidla hackathonu
- Hackathon Královéhradeckého kraje. **Povinné:** použít aspoň jednu datovou sadu kraje. Splňujeme to: POI i zastávky jsou z kraje.
- Povolená data: datakhk.cz a data.gov.cz, ale jen data pro Královéhradecký kraj (CZ052). Celostátní sady je nutné filtrovat na kraj.
- Herní princip:
  - 3 týmy. Hráč dojde k POI a 60 s zůstane do 100 m od něj. Tým dostane `points` daného POI.
  - Hraje se v sezónách (1 sezóna = čtvrtletí). Hráč obsadí každé POI max. 1× za sezónu. Body neubývají, nová sezóna = kompletní reset.
  - Kraj dostává anonymní statistiku návštěv.
- **Název a téma:** Krajánek, tagline „Objevuj, dobývej, poznávej kraj.“ Objevování kraje (místa, historie, příroda, památky), motiv turistiky, maskot Krakonoš. Týmy Hory / Řeky / Lesy (viz 1.2).
- **MVP (musí být na demo):**
  1. Mapa s POI, filtry (kategorie, body, vzdálenost) a detailem POI.
  2. Nejbližší autobusová a vlaková zastávka k POI + odkaz na vyhledání spoje (IDOS).
  3. Výběr týmu, check-in podle GPS (100 m / 60 s) a přičtení bodů.
  4. Žebříček týmů za aktuální sezónu.
  5. Jednoduchý dashboard pro kraj: návštěvy po POI a kategoriích (heatmapa).
- **Stretch (až zbude čas):** quick time eventy (bonusový POI na týden), „co nejvíc z jednoho týmu“ a souboje o POI, odznaky, plánování spojů v aplikaci z jízdních řádů, případně turistické a cyklotrasy. Nezačínat, dokud MVP nefunguje end-to-end.
- **Stack (návrh, odsouhlasit na startu):** web (PWA) + Leaflet, backend Node (TypeScript) + Postgres.
- **Role:** A Data, B Frontend/mapa, C Backend/hra, D Doprava + dashboard kraje + pitch. Ve 3 lidech se spojují role C a D.

## 1. Kontrakty (rozhraní mezi rolemi – neměnit bez domluvy)

### 1.1 `data/poi.geojson` (vyrábí role A, čte B a C)
FeatureCollection, geometrie `Point` v **EPSG:4326, pořadí [lon, lat]**. Properties:

| pole | typ | popis |
|---|---|---|
| `id` | string | stabilní ID: `<dataset_slug>:<OBJECTID>`, např. `hrady:12` |
| `name` | string | název |
| `category` | string | slug kategorie (viz tabulka v 2.2), např. `hrady`, `rozhledny` |
| `category_label` | string | česky, např. „Hrady“ |
| `group` | string | nadkategorie: `pamatky`, `priroda`, `kultura`, `sport`, `gastro`, `sluzby` |
| `description` | string\|null | popis (oříznout HTML a whitespace) |
| `municipality` | string\|null | název obce |
| `municipality_code` | string\|null | kód obce ČSÚ |
| `orp_code` | string\|null | kód ORP |
| `web` | string\|null | URL |
| `tp_id` | string\|null | „ID v datovém skladu Turistického portálu KHK“, pokud existuje |
| `is_nkp` | bool | národní kulturní památka (shoda s vrstvami NKP) |
| `nearest_stop` | object | `{name, type: "bus"\|"train", distance_m, lat, lon}` |
| `merged` | array | POI sloučená na jednom místě (do 5 m, viz 2.3): `[{id, name, category}]`, jinak `[]` |
| `points` | int | body za check-in (viz 2.4) |
| `source` | string | název datové sady kraje |

### 1.2 REST API (vyrábí role C, čte B a D)
```
GET  /api/poi?bbox=&category=&min_points=&near=lat,lon&radius_m=   -> GeoJSON (subset poi.geojson + live stav)
GET  /api/poi/:id                                                   -> detail + poslední tým, počet návštěv
POST /api/players            {name, team}                           -> {player_id, token}
POST /api/checkins/start     {poi_id, lat, lon, accuracy_m}          -> {checkin_id, required_seconds: 60}
POST /api/checkins/:id/ping  {lat, lon, accuracy_m}                  -> {elapsed_s, valid}
POST /api/checkins/:id/finish                                       -> {awarded_points, team_score}
GET  /api/teams                                                     -> [{team, score, members}] (skóre aktuální sezóny)
GET  /api/seasons/current                                           -> {season_id, starts_at, ends_at}
GET  /api/seasons/history                                           -> [{season_id, starts_at, ends_at, ranking: [{team, score}]}]
GET  /api/events/active                                             -> aktivní quick time eventy
GET  /api/stats/poi?from=&to=                                       -> agregace pro dashboard kraje
```
Týmy (ID neměnit): `hory` = Hory, červená `#C2412F`; `reky` = Řeky, modrá `#2F5D9E`; `lesy` = Lesy, zelená `#4A7A3A`. Barvy odpovídají turistickému značení KČT (bílá–barva–bílá).

## 2. Role A – Data

### 2.1 Jak stahovat z datakhk.cz (ArcGIS Hub)
- **Doporučeno (spolehlivé):** ArcGIS REST query, GeoJSON přímo v WGS84:
  `https://services6.arcgis.com/ogJAiK65nXL1mXAW/arcgis/rest/services/<SERVICE>/<LAYER>/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
  - Vrstva je `0`, kromě **Autobusové linky VDKHK = 7** a **Kulturní akce se záštitou = 4**.
  - Limit je obvykle 1 000–2 000 záznamů na dotaz. U větších sad stránkuj přes `resultOffset`/`resultRecordCount` (válečné hroby 1 423, zastávky 4 538).
- Alternativa: `https://www.datakhk.cz/api/download/v1/items/<ITEM_ID>/csv?layers=0`
  - Vrací 302, takže je potřeba `curl -L`.
  - Někdy vrátí 202 „file is being generated“ a je třeba to zkusit znovu.
  - U Rozhleden, Jezdectví a Akcí export **nefunguje** (400/404), použij REST.
- **Pozor na souřadnice:**
  - Sloupec `wkt` / „Zápis vektorové geometrie“ má **prohozené pořadí** (`POINT(lat lon)`).
  - Používej geometrii z REST (`outSR=4326`) nebo sloupce `x`/`y`, resp. „Zeměpisná délka/šířka v souřadnicovém systému WGS84“ (délka = lon).
- **Dva styly schémat:**
  - novější snake_case (`nazev`, `popis`, `nazev_obce`, `kod_obce`, `www`, `x`, `y`),
  - starší dlouhé české hlavičky („Název“, „Popis“, „Název obce“, „Kód obce dle číselníku ČSÚ“, „Webové stránky“).
  - Napiš mapper, který zná obojí.
- Telefony bývají ve formátu `4,2060485537e+11` (Excel). Pokud je chceš zobrazit, normalizuj je, jinak je ignoruj.

### 2.2 Zdrojové sady POI → `category`

| Sada | Item ID | Service | category / group |
|---|---|---|---|
| Hrady | `40a4d224a8b346e89350f5bc9327e29e` | `Hrady/FeatureServer` | hrady / pamatky |
| Zámky | `b03f47566c9a4ce4aa6ed8db765ae824` | `Z%C3%A1mky/FeatureServer` | zamky / pamatky |
| Pevnosti a opevnění | `539847974bf8492c9d7fdf9a369b9f63` | `Pevnosti_a_opevn%C4%9Bn%C3%AD/FeatureServer` | pevnosti / pamatky |
| Muzea a galerie | `ccf33734938a4e638af65c9d8fa106e5` | `Muzea_a_galerie/FeatureServer` | muzea / kultura |
| Církevní památky | `9b6e39773a3e4a05a67edf39005562b7` | `C%C3%ADrkevn%C3%AD_pam%C3%A1tky/FeatureServer` | cirkevni / pamatky |
| Technické památky | `86a1029c7b624bd29502dee734139d11` | `Technick%C3%A9_pam%C3%A1tky/FeatureServer` | technicke / pamatky |
| Architektonické památky | `93d143d3fdbd492197fc23413b4a9542` | `Architektonick%C3%A9_pam%C3%A1tky/FeatureServer` | architektura / pamatky |
| Židovské památky | `42b28ab17ca84687ba2c3cfebe513ddb` | `%C5%BDidovsk%C3%A9_pam%C3%A1tky/FeatureServer` | zidovske / pamatky |
| Ostatní historické památky | `ddba05ea835746b7a4248b63af93288f` | `Ostatn%C3%AD_historick%C3%A9_pam%C3%A1tky/FeatureServer` | historicke / pamatky |
| Národní kulturní památky – bodové | `d0043d8d7dc64e48a2fc06518314b269` | `N%C3%A1rodn%C3%AD_kulturn%C3%AD_pam%C3%A1tky_bodov%C3%A9_objekty/FeatureServer` | nkp / pamatky (+ `is_nkp`) |
| Národní kulturní památky – pozemky | `6c7673331dd54ccf9585dcb3410ca0e7` | `N%C3%A1rodn%C3%AD_kulturn%C3%AD_pam%C3%A1tky_pozemky/FeatureServer` | nkp / pamatky (+ `is_nkp`) |
| Válečné hroby | `f51fcdb253344157a658e9fe3a4cd385` | `V%C3%A1le%C4%8Dn%C3%A9_hroby/FeatureServer` | valecne_hroby / pamatky (1 423 bodů – zvaž jen jako volitelnou vrstvu) |
| Zvony na Broumovsku | `5ab0f07422714877a3799b9462671677` | `Zvony_na_Broumovsku/FeatureServer` | zvony / pamatky |
| Přírodní zajímavosti | `0d629b7fd2c34af8a3e2ba2196aa03cc` | `P%C5%99%C3%ADrodn%C3%AD_zaj%C3%ADmavosti/FeatureServer` | priroda / priroda |
| Rozhledny a vyhlídky | `d3ea6d68bb3b421a8b988c4a58024a0f` | `Rozhledny_a_vyhl%C3%ADdky/FeatureServer` | rozhledny / priroda |
| Botanické zahrady a arboreta | `70487254d6104e7d83a027e83bfeb47e` | `Botanick%C3%A9_zahrady_a_arboreta/FeatureServer` | zahrady / priroda |
| ZOO a zooparky | `49e9f6f95b084caeaf52a09d972838ca` | `ZOO_a_zooparky/FeatureServer` | zoo / priroda |
| Lanovky | `80787793513d464bac25abebebfa4aaa` | `L/FeatureServer` | lanovky / sport |
| Cyklovýlety | `14bb7a922bfc49caa07a70d5ead3982c` | `Cyklov%C3%BDlety/FeatureServer` | cyklovylety / sport (bod = start; má délku v m) |
| Letní koupání | `f7c3fbb0791549bd8fa8c8dcb4818013` | `Letn%C3%AD_koup%C3%A1n%C3%AD/FeatureServer` | koupani / sport |
| Ostatní letní sporty | `baf74cda7f4f49dd99686d8ba1f0a8d8` | `Ostatn%C3%AD_letn%C3%AD_sporty/FeatureServer` | sport / sport |
| Letecké sporty | `270d30d318204f3ebbc73cc3adb5ca30` | `Leteck%C3%A9_sporty/FeatureServer` | letecke / sport |
| Jezdectví | `d69b0c15eaf44e46a5918a4d6f95877a` | `Jezdectv%C3%AD/FeatureServer` | jezdectvi / sport |
| Rybaření | `2dfef5cd6dab461d8eb5596de9dfc2e2` | `Ryba%C5%99en%C3%AD/FeatureServer` | rybareni / sport |
| Golfová hřiště | `5087e0aa719b4742a8f696c38f1042bf` | `Golfov%C3%A1_h%C5%99i%C5%A1t%C4%9B/FeatureServer` | golf / sport |
| Pivovary | `a22dfb6709864e6984f01527491ae70b` | `Pivovary/FeatureServer` | pivovary / gastro |
| Regionální potraviny | `5c0304dbcdfd432fb6a7363b75a00ed1` | `Region%C3%A1ln%C3%AD_potraviny/FeatureServer` | potraviny / gastro |
| Řemeslné výrobky | `a58cd530e36e418d8be4857c01912fe1` | `%C5%98emesln%C3%A9_v%C3%BDrobky/FeatureServer` | remesla / gastro |
| Divadla a filharmonie | `fde032684cd848d4a076fa978b8d5624` | `Divadla_a_filharmonie/FeatureServer` | divadla / kultura |
| Kina | `66de083248634ad1bce9bb98265a5b27` | `Kina/FeatureServer` | kina / kultura |
| Kulturní domy a kongresová centra | `cccf864fdc654c3fae39a54ed20c2183` | `Kulturn%C3%AD_domy/FeatureServer` | kulturni_domy / kultura |
| Hudební kluby a festival parky | `f16bb2cb44c64ee9882eefaa3c263dd6` | `Hudebn%C3%AD_kluby_a_festival_parky/FeatureServer` | kluby / kultura |
| Knihovny | `441d3dc35a064a45940f12f10f1d04ce` | `Knihovny/FeatureServer` | knihovny / kultura (434 – volitelná vrstva) |
| Zábavní centra | `f239c6222745417ba617c8d54afad1ad` | `Z%C3%A1bavn%C3%AD_centra/FeatureServer` | zabava / sport |
| Infocentra | `82ef86e3f1ae448ba9ce25127f95e4f5` | `Infocentra/FeatureServer` | infocentra / sluzby |
| Kempy | `12a0abafaacf4db6974b823bf41f9302` | `Kempy/FeatureServer` | kempy / sluzby |
| Služby (hotely, wellness) | `91f96204064a41b58814cafbe30ffec0` | `Slu%C5%BEby/FeatureServer` | sluzby / sluzby |
| Solné jeskyně | `3b31adc233464ff3ad482313a4010377` | `Soln%C3%A9_jeskyn%C4%9B/FeatureServer` | solne_jeskyne / sluzby |
| Lázně | `f2e7d14c208f44b99741710aeba77ab1` | `L%C3%A1zn%C4%9B/FeatureServer` | lazne / sluzby |
| Kulturní akce se záštitou 2026–2029 (vrstva **4**) | `63be156a63564852b29cdaa27e420024` | `Trval%C3%A9_z%C3%A1%C5%A1tity_Rady_Kr%C3%A1lov%C3%A9hradeck%C3%A9ho_kraje/FeatureServer` | **není POI**: zdroj pro eventy (pole `termin`, text „červen–srpen“) |

Kromě válečných hrobů a knihoven je to asi 1 850 POI, s knihovnami asi 2 300 (to je počet uváděný v PLAN.md), se všemi asi 3 700.

### 2.3 Čištění
- Deduplikace: stejné `name` (normalizované, bez diakritiky a malých/velkých písmen) a vzdálenost < 75 m znamená jedno POI. Ponech první podle pořadí tabulky, ostatní kategorie ulož do `also_in` (např. Adalbertinum je v divadlech i v kulturních domech).
- Stejné místo: POI s různými jmény do 5 m od sebe se sloučí do jednoho. Název „A · B“ (u 3+ „A · B a N další“, název obsažený v jiném se vynechá), ostatní kategorie do `also_in`, seznam v `merged`. Body = průměr bodů sloučených + nejvyšší z nich (max. 100).
- `is_nkp`: shoda s vrstvami NKP (bodové + pozemky) podle vzdálenosti < 150 m nebo podle názvu.
- Zahoď body mimo hranici kraje. Polygon kraje: item `f8a73250419c48f6a8118cfed2720566`, nebo tolerantně bbox 15.0–16.9 E, 49.9–50.9 N.

### 2.4 Bodování POI (`points`, celé číslo 10–100)
Cíl: odměnit méně navštěvovaná a hůř dostupná místa. Kraj chce rozptýlit turisty, ne další davy na Sněžce.
```
base      = 20
rarity    = clamp( sqrt(median_category_size / category_size), 0.6, 2.0 )   # vzácné kategorie víc
remote    = 1.0 + min(nearest_stop.distance_m, 3000) / 3000 * 0.5            # až +50 % za odlehlost
heritage  = 1.5 if is_nkp else 1.0
popular   = category_popularity_factor                                       # viz níže, 0.7–1.2
points    = round(clamp(base * rarity * remote * heritage * popular, 10, 100))
```
`category_popularity_factor` vychází z návštěvnosti turistických cílů podle kategorií v roce 2024 (Infogram kraje, data v `docs/`):
- přírodní cíle 31,4 % → 0.7
- ZOO a zahrady 18,5 % → 0.8
- hrady a zámky 12,2 % → 0.9
- muzea 5,9 % a rozhledny 5,5 % → 1.1
- sakrální a vojenské cíle → 1.2
- ostatní → 1.0

Konstanty dej do jednoho configu, ať se dají ladit.

### 2.5 Nejbližší zastávka
- Bus: Autobusové zastávky VDKHK (`ab928607832141f8bebb36261593107a`, service `Autobusov%C3%A9_zast%C3%A1vky_IREDO/FeatureServer/0`, 4 538 záznamů, pole „Název“ = jméno zastávky ve formátu CIS JŘ, např. `Hořice,aut.st.`). Zastávky MHD v sadě nejsou.
- Vlak: Železniční stanice a zastávky VDKHK (`e64c92bd463e442593e695137e061a35`, 185 záznamů).
- Spočítej haversine, nebo použij KD-tree/BallTree. Ulož nejbližší bus a nejbližší vlak, do `nearest_stop` dej bližší z nich.

### 2.6 Výstupy role A
- `scripts/build_poi.py` (Python 3, jen `requests` + stdlib, případně `shapely`). Spouští se `python scripts/build_poi.py` a je idempotentní.
- `data/poi.geojson` (commitnout; ~2–4 MB je OK) + `data/stops.geojson` (bus + vlak).
- Test: počet POI > 1 500, všechna mají `points` v 10–100, žádné souřadnice mimo bbox kraje, `id` unikátní.

## 3. Role B – Frontend / mapa
**Název aplikace:** Krajánek, tagline „Objevuj, dobývej, poznávej kraj.“
**Vizuální motiv:** turistika. Hravě, ale střídmě, maskot Krakonoš.
- Podklad mapy: světlý, „papírový“, inspirovaný orientační mapou (bílý les, zelené odstíny hustoty, hnědé vrstevnice, modrá voda). Návrh: světlé rastrové dlaždice v Leafletu s teplým filtrem.
- Marker POI: malá cedulka na tyčce. Zabrané POI má cedulku v barvě týmu.
- Detail POI: žlutá cedule rozcestníku (`#F2C230`, tmavý text): název, vzdálenost, body, nejbližší zastávka.
- Ikona týmu: značka bílá–barva–bílá (vodorovné pruhy).
- Check-in: kruhový odpočet 60 s, na konci krátká animace úspěchu.
- Font zaoblený a přátelský (Nunito nebo Baloo 2), rohy zaoblené, ikony jednoduché a lineární.
- PWA (mobil first). Návrh: Vite + React + **Leaflet** + `leaflet.markercluster` (asi 2 000 bodů vyžaduje clustering).
- Podklad: OpenStreetMap tiles (s atribucí) nebo Mapy.cz API, pokud máte klíč.
- Obrazovky:
  1. **Mapa:** clustery, barva markeru podle týmu, který POI naposledy „dobyl“, ikona podle `group`.
  2. **Filtry:** kategorie/skupina, rozsah bodů, vzdálenost od mé polohy (`navigator.geolocation`), „jen dostupné MHD do 500 m“.
  3. **Detail POI:** název, popis, body, obec, web, nejbližší zastávka + tlačítko „Najít spoj“ (viz 5).
  4. **Check-in:** po zahájení kruh/odpočet 60 s. Každých 5 s volá `ping` s polohou. Při opuštění 100 m odpočet pozastaví a varuje.
  5. **Žebříček:** 3 týmy, skóre aktuální sezóny živě (polling 10 s stačí), odpočet do konce sezóny, vítězové minulých sezón.
  6. **Onboarding:** jméno + výběr týmu.
- Do doby, než existuje API, čti `data/poi.geojson` přímo a mockuj týmy.
- Demo režim: query param `?demo=1` umožní nastavit polohu kliknutím do mapy (na pitch bez cestování).

## 4. Role C – Backend / herní logika
- Node (TypeScript, Fastify/Express) + Postgres. Při startu načte `data/poi.geojson`.
- Tabulky: `players(id, name, team, token, created_at)`, `checkins(id, player_id, poi_id, started_at, finished_at, valid, awarded_points)`, `pings(checkin_id, ts, lat, lon, accuracy_m)`, `seasons(id, starts_at, ends_at)`, `team_scores(season_id, team, score, updated_at)`, `events(id, type, poi_id, starts_at, ends_at, multiplier)`.
- **Validace check-inu (anti-cheat):**
  - každý ping: vzdálenost k POI ≤ 100 m a `accuracy_m` ≤ 50,
  - pingy aspoň každých 15 s, jinak se odpočet přeruší,
  - doba mezi prvním a posledním validním pingem ≥ 60 s,
  - rychlost mezi pingy < 30 km/h,
  - stejný hráč a stejné POI jen 1× za sezónu.
- **Sezóny:** 1 sezóna = kalendářní čtvrtletí. Body se během sezóny jen sčítají, neubývají. Na konci sezóny se uloží konečné pořadí (historie vítězů) a nová sezóna začíná od nuly. Délka sezóny musí jít nastavit v konfiguraci (demo: pár minut), přechod na novou sezónu počítej líně při čtení/zápisu, ne cronem.
- **Quick time eventy (stretch):**
  - náhodné POI s `multiplier = 2–3` na týden,
  - „co nejvíc z jednoho týmu“: bonus pro tým, jehož nejvíc hráčů POI orazí, souboje týmů o POI,
  - zdroj zajímavých eventů: kulturní akce se záštitou kraje (vrstva 4).
- **Další stretch:** odznaky za kategorie / počet navštívených POI, turistické a cyklotrasy.
- **Statistika pro kraj:** ukládej jen check-in události (POI, čas, tým). **Neukládej souvislé trasy.** Pingy po 24 h smaž. `/api/stats/poi` vrací agregace po POI, kategorii, ORP a hodině.

## 5. Role D – Doprava, dashboard kraje, pitch
- **MVP doprava:** odkaz do IDOS s předvyplněným cílem (ověřeno, že funguje):
  `https://idos.cz/vlakyautobusy/spojeni/?f=<odkud>&t=<nearest_stop.name>` (URL-encode; `f` může být prázdné nebo nejbližší zastávka hráče).
  Linky VDKHK mají v datech i odkaz na jízdní řád: `https://www.dopravakhk.cz/vyhledat-jizdni-rad.html?query=<číslo linky>`.
- **Stretch – vlastní plánování:** jízdní řády z data.gov.cz od MD, celostátní NeTEx (asi 200 MB, denně aktualizovaný):
  `https://portal.cisjr.cz/pub/netex/NeTEx_VerejnaLinkovaDoprava.zip`.
  Filtrovat na linky IREDO/VDKHK (licence 6xxxxx, např. `631504`). Na hackathon nejspíš příliš velké, preferuj IDOS odkaz.
- Zaručené přípoje (`0575292a366649d19580a2389c55fced`, asi 3 500 řádků) lze zobrazit jako info „autobus čeká na vlak X min“.
- **Dashboard kraje:** heatmapa check-inů, top POI, návštěvy podle kategorie/ORP v čase. Pro srovnání přidej oficiální data:
  - návštěvnost turistických cílů po kategoriích 2021–2025,
  - návštěvnost krajských kulturních institucí 2020–2025.
  - Obojí je v Infogramech kraje a dá se stáhnout skriptem `scripts/harvest_infogram.py` (viz docs).
- **Pitch:** problém (koncentrace turistů, neznámá místa), řešení (hra), přínos pro kraj (data o pohybu lidí, podpora veřejné dopravy), demo, použitá data kraje.

## 6. Pořadí a závislosti
```
A: build_poi.py → poi.geojson v1 (bez bodů, ~2 h) → bodování + zastávky (v2)
C: mock API nad poi.geojson v1 → check-in logika → body + sezóny → eventy
B: mapa nad poi.geojson v1 → filtry/detail → check-in UI napojit na C → žebříček
D: IDOS odkazy (potřebuje nearest_stop z v2) → dashboard (potřebuje /api/stats) → pitch
```
Definition of done pro demo: z mobilu jde vybrat tým, najít POI filtrem, otevřít spoj v IDOS, v demo režimu udělat check-in a vidět body v žebříčku i v dashboardu.

## 7. Konvence
- Monorepo: `data/`, `scripts/`, `frontend/`, `backend/`, `docs/`.
- Velká stažená data (NeTEx, MF výkazy) **necommitovat**, přidat do `.gitignore`.
- Commity malé, popisné, v češtině nebo angličtině. Ne přímo do cizí složky role bez domluvy.
