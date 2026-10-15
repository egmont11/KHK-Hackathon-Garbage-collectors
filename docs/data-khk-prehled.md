# Otevřená data Královéhradeckého kraje – přehled (stav 15. 10. 2026)

## Zdroje
- **Portál kraje:** https://www.datakhk.cz (ArcGIS Hub, 146 datových sad). Sady jsou zrcadlené na data.gov.cz.
- **data.gov.cz, vydavatel Královéhradecký kraj (IČO 70889546):** 1 958 záznamů, 626 unikátních názvů. 456 z nich jsou „ZPS obec …“ (Základní prostorová situace z digitální technické mapy kraje: JVF/ZIP, 4 vrstvy na obec, těžké na zpracování).
- **Formáty u sad z datakhk.cz:** CSV, GeoJSON, JSON, KML, Shapefile/ZIP, plus ArcGIS REST API.
  - Stažení: `https://www.datakhk.cz/api/download/v1/items/<id>/geojson?layers=0` (vrací přesměrování 302, curl potřebuje `-L`)
  - Vyhledávání: `https://www.datakhk.cz/api/search/v1/collections/dataset/items?q=...`
- **SPARQL:** https://data.gov.cz/sparql (filtr `CONTAINS(STR(?publisher), "70889546")`)

Ověřeno: „Počet obydlených domů dle připojení na kanalizaci v obcích“ → GeoJSON, 448 obcí, pole `kanal_sit`, `cov`, `zumpa`, `bez_a_nezj`, `celkem`.

## Datové sady kraje podle témat

### Doprava a silnice
Autobusové linky VDKHK · Autobusové zastávky VDKHK · Železniční stanice a zastávky VDKHK · Železniční tratě VDKHK · Informační centra autobusové dopravy · Seznam zaručených přípojů · **Stav povrchu silnic** · **Opravy silniční infrastruktury od 2016 (bodové/liniové)** · **Plán zimní údržby silnic** · Letiště · Plochy pro sportovní létající zařízení · Lanovky

### Životní prostředí a voda
**Podíl / počet obydlených domů dle připojení na kanalizaci** · Záplavová území (5/20/100/500letá voda, aktivní zóna) · CHKO · Národní parky · Přírodní parky · Přírodní rezervace a památky · ÚSES · Botanické zahrady

### Zdravotnictví a sociální oblast
Nemocnice · Lékařská pohotovostní služba · Praktičtí lékaři (dospělí, děti) · Zubní lékaři · Gynekologové · Následná lůžková péče · Odborné léčebné ústavy · Výjezdové základny ZZS · **Poskytovatelé sociálních služeb** · Stanice HZS · Služebny Policie ČR

### Školství
Školy a školská zařízení · Přijímací řízení na SŠ/VOŠ · **Dojížďka do středních škol / VOŠ** · Počty žáků podle oborů · Domovy mládeže · ZUŠ · DDM · Studenti a absolventi VŠ

### Finance kraje
Příjmy · Výdaje · Kapitálové výdaje · Investice · Dluh · Úvěry · Sdílené daně · Stavy účtů · Dotace 2021–2025 (kraj/okresy/ORP, individuální/programové)

### Ekonomika a rozvoj
Průmyslové zóny · Inovativní firmy · Inovační infrastruktury · Klastry · Investiční pobídky · Hospodářsky a sociálně ohrožené oblasti · Strategická mapa kraje · MAS a DSO · ZÚR (rozvojové oblasti a osy, veřejně prospěšné stavby, územní rezervy)

### Cestovní ruch a kultura
Hrady · Zámky · Muzea a galerie · Rozhledny · Kempy · Letní koupání · Cyklovýlety · Pivovary · Regionální potraviny · Řemeslné výrobky · Kina · Divadla · Knihovny · Památky (NKP, rezervace, zóny, válečné hroby, židovské památky…) · Infocentra · Turistické regiony

### Územní členění
Hranice kraje / okresů / ORP / POÚ / obcí · Adresář obcí · Administrativní členění obcí

## Další vydavatelé na data.gov.cz s daty pro KHK
- **Statutární město Hradec Králové** (8 sad, např. výsledky voleb)
- **ČSÚ** – volby a statistiky za okresy kraje
- **MŠMT** – Rejstřík škol, Královéhradecký kraj
- **MZe** – LPIS po okresech
- **SPÚ** – BPEJ, Královéhradecký kraj
- **MMR** – INSPIRE, využití území, KHK
- Úřední desky měst (Vrchlabí, Jičín, Jaroměř, Dvůr Králové, Rychnov n. Kn.)

## Finance – detail (ověřeno 15. 10. 2026)

### Sady kraje: jen souhrny
Každá finanční sada má v ArcGIS službě jedinou vrstvu se **6 řádky (roky 2020–2025)** a jedním číslem na rok. Všechny distribuce na data.gov.cz vedou na tutéž vrstvu.

| Sada | Pole | Jednotka (odhad) | 2020 → 2025 |
|---|---|---|---|
| Příjmy | `prijmy` | mld Kč | 16,7 → 23,3 |
| Výdaje | `vydaje` | mld Kč | 17,8 → 24,0 |
| Kapitálové výdaje | `kapit_vyd` | mil Kč | 3 514 → 4 537 |
| Investice | `investice` | mld Kč | 3,51 → 4,54 |
| Investiční přijaté transfery | `inv_pr_tr` | mil Kč | 1 260 → 1 120 |
| Dluh | `dluh` | mil Kč | 647 → 685 |
| Dlouhodobé úvěry | `dl_uvery` | mil Kč | 631 → 360 |
| Ukazatel dluhové služby | `ukaz_dl_sl` | % | 0,04 → 0,77 |
| Stavy na účtech | `stavy_na_bu` | mil Kč | 2 133 → 2 803 |
| Sdílené daně | `sdil_dane` | mil Kč | 4 658 → 7 161 (**chyba: rok 2024 dvakrát, 2025 chybí**) |

Dotace 2021–2025 jsou jen agregace „počet dotací + suma“, nikoli seznam příjemců:
- kraj: 1 řádek (9 686 dotací, 2,92 mld Kč; programové mají i úspěšnost žádostí 87,1 %),
- okresy: 5 řádků,
- ORP: 15 řádků.

„Organizace Královéhradeckého kraje“: 126 příspěvkových a dalších organizací kraje (IČO, odbor, typ, adresa, GPS, fotky).

### Podrobná data: MF „FIN 2-12 M – Plnění rozpočtu ÚSC“ (data.gov.cz)
- Ministerstvo financí ho publikuje měsíčně pro všechny kraje a obce. Filtrem `ZC_KRAJ = CZ052` z něj vznikne dataset jen pro KHK.
- Stažení: `https://monitor.statnipokladna.gov.cz/data/extrakty/csv/FinM/<RRRR>_<MM>_Data_CSUIS_FINM.zip` (s příponou `.zip`).
- Hlavní soubor `FINM201_*.csv`: středník jako oddělovač, záporná čísla mají mínus na konci (`123.45-`).
- Sloupce: IČO, typ (2 = příjmy, 3 = výdaje), **paragraf** (odvětví), položka, schválený rozpočet, rozpočet po změnách, skutečnost.
- 12/2024 pro KHK: 94 201 řádků, 494 účetních jednotek (kraj + obce + svazky obcí).
  - Samotný kraj (IČO 70889546): 980 řádků, výdaje 37 mld Kč v nekonsolidované podobě, tedy včetně převodů mezi vlastními fondy (§ 6330 = 14,8 mld). Proto číslo neodpovídá 22 mld ze sady kraje.
  - **Výdaje na cestovní ruch (§ 2143):** kraj 35,2 mil Kč; dalších 176 subjektů v kraji celkem 145 mil Kč.
- Číselníky paragrafů a položek jsou na monitor.statnipokladna.gov.cz.

## Turistika a kultura – detail (ověřeno 15. 10. 2026)
Celkem asi **2 280 bodů** (bez knihoven asi 1 850). Všechny mají souřadnice WGS84 a adresu s kódem obce, ORP a okresu, takže se dají spojit s financemi.

| Sada | Počet | Zajímavá pole kromě adresy a GPS |
|---|---|---|
| Hrady / Zámky / Pevnosti | 21 / 33 / 38 | popis, ID turistického portálu |
| Muzea a galerie | 160 | typ muzea, zaměření, zřizovatel, bezbariérovost |
| Církevní / technické / architektonické / židovské / ostatní hist. památky | 162 / 67 / 74 / 14 / 51 | popis |
| Přírodní zajímavosti | 128 | popis |
| Rozhledny a vyhlídky* | 49 | popis, web |
| Cyklovýlety | 73 | **délka v m**, popis (body, ne trasy) |
| Lanovky | 20 | popis |
| Letní koupání | 54 | turistický region, kategorie (3 úrovně), popis, kontakty |
| Kempy | 35 | region, kategorie, kontakty |
| Služby (hotely, wellness…) | 79 | region, kategorie, krátký popis, kontakty |
| Ostatní letní sporty / letecké sporty / jezdectví* / rybaření / golf | 61 / 17 / 89 / 30 / 9 | kategorie, popis; golf má jamky, par, veřejnost |
| Pivovary / regionální potraviny / řemeslné výrobky | 34 / 102 / 64 | region, popis, kontakty |
| Solné jeskyně / lázně / ZOO / botanické zahrady | 15 / 7 / 2 / 2 | — |
| Infocentra | 74 | popis |
| Zábavní centra | 27 | popis |
| Divadla / kina / kulturní domy / hudební kluby | 33 / 51 / 56 / 36 | **kapacita**, typ, bezbarierovost, počet sálů |
| Knihovny | 434 | typ, zřizovatel, bezbariérovost |
| Zvony na Broumovsku | 53 | počet zvonů, typ objektu |
| Kulturní akce s trvalou záštitou 2026–2029* | 30 | zaměření, **termín** (text, např. „červen–srpen“), pořadatel, popis |
| Turistické regiony | 7 | polygony (Krkonoše, Český ráj, Broumovsko…) |

\* CSV export z datakhk.cz nefunguje (400/404), data jdou stáhnout přes ArcGIS REST:
`https://services6.arcgis.com/ogJAiK65nXL1mXAW/arcgis/rest/services/<služba>/FeatureServer/<vrstva>/query?where=1%3D1&outFields=*&f=geojson`
(rozhledny `Rozhledny_a_vyhlídky/0`, jezdectví `Jezdectví/0`, akce `Trvalé_záštity_Rady_Královéhradeckého_kraje/4`).

**Chybí:** návštěvnost, otevírací doby, ceny, hodnocení a úplný seznam ubytování (jen 79 „služeb“ a 35 kempů). Sloupec „ID v datovém skladu Turistického portálu KHK“ ale umožňuje odkázat na detail na turistickém portálu kraje.

## Skrytá data v grafech (Infogram) na datakhk.cz
Stránky jako https://www.datakhk.cz/pages/dotace a štítky (`search?tags=Dotace`, `Kultura`, `Cestovní ruch`, `Památky`) obsahují kromě datových sad asi 75 položek typu „Document Link“. Jsou to grafy v Infogramu. Data z nich se dají stáhnout:
1. V HTML stránky grafu je `window.infographicData`, a v něm u každého grafu `chartData.custom.live.key`.
2. `GET https://live-data.jifo.co/<key>` vrátí JSON `{data: [[[řádek],…]]}` s tabulkou, kterou kraj živě obnovuje (zdroj dotací: IS PROFIS).
3. Grafy bez `live.key` mají data přímo v `chartData.data`.

Skript: `scripts/harvest_infogram.py`, výstup: `docs/infogram-turistika-dotace.json`.

**Dotace (podrobněji než datové sady):**
- programové dotace po letech 2016–2026, rozdělené na 11 oblastí a v každé na jednotlivé dotační programy,
- totéž po ORP (2018–2026),
- individuální dotace, kotlíkové dotace (žádosti podané a schválené),
- sociální péče po ORP a okresech, čerpání EU fondů.

Stále ale **bez seznamu příjemců a projektů**.

**Turistika a kultura (návštěvnost):**
- Návštěvnost krajských kulturních institucí 2020–2025 **po jednotlivých institucích** (muzea, galerie, hvězdárny…).
- Návštěvnost turistických cílů podle kategorií 2021–2025 (v tisících: přírodní cíle, ZOO, hrady a zámky, rozhledny…). **Jen kategorie, ne jednotlivá místa.**
- Sčítače na Labské stezce 2019–2024 (Kuks, Smiřice, Věkoše, Vysoká n. L.).
- TOP 10 zemí původu turistů 2018–2023, profil českých a zahraničních návštěvníků (2× 18 grafů).
- Hromadná ubytovací zařízení (počet, lůžka, přenocování, využití pokojů).
- Příspěvky kraje na kulturní akce (asi 35 festivalů s částkou), návštěvnost významných akcí.
- Svatby podle regionů.

**NKP – pozemky:** 20 záznamů. Jsou to národní kulturní památky ve správě organizací kraje (např. Betlém u Kuksu, zámek Náchod). Obsahují ÚSKP číslo a odkaz na pamatkovykatalog.cz.

## Co v datech chybí
Kraj ani data.gov.cz pro KHK nepublikují data o **odpadech, sběrných místech ani kontejnerech**. Hledání „odpad“ a „kontejner“ na datakhk.cz vrací 0 výsledků, „sběr“ 1 výsledek.
