# Krajánek

## Spuštění

Backend (port 3001):

```bash
cd backend
npm install
npm run demo
```

Frontend (port 5173, v druhém terminálu):

```bash
cd frontend
npm install
npm start
```

Otevři http://localhost:5173. Pro vývoj s klikací demo polohou spusť frontend pomocí `npm run dev` a otevři `http://localhost:5173/?demo=1`. Demo používá oddělený mock a nesbírá body do skutečného backendu. Produkční build demo query parametry ignoruje; samostatný demo build lze výslovně vytvořit s `VITE_DEMO=1`.

Dashboard kraje: http://localhost:5173/dashboard. První administrátorské heslo zadej přes `ADMIN_PASSWORD`, nebo jej při lokálním spuštění najdeš v souboru `backend/.admin-initial-password` s oprávněním 0600. Heslo se nevypisuje do logů a při prvním přihlášení se musí změnit.

## Nasazení (Docker Compose)

Zkopíruj `.env.example` do `.env`, nastav veřejnou DNS doménu `SITE_ADDRESS` směřující na server a dvě vlastní silná hesla. Potom spusť:

```bash
docker compose up -d --build
```

Caddy vystavuje HTTPS na portu 443 a HTTP přesměruje na HTTPS. Porty 80/443 musí být dostupné pro vystavení certifikátu; volitelné `HTTP_PORT` a `HTTPS_PORT` mění mapování portů. Backend a databáze nemají publikovaný port. Backend důvěřuje proxy hlavičkám jen od vyhrazené adresy Caddy `172.30.57.10`; pokud měníš Docker síť, změň i `TRUSTED_PROXIES`. Za další reverzní proxy je potřeba zachovat TLS také do Caddy; nepřepínej veřejné nasazení na nezabezpečené HTTP.

Data zůstávají v Postgresu, certifikáty ve volume Caddy. Migrace odhlásí existující hráčské relace; účty, hesla, body a historie zůstanou zachovány. Hráči se znovu přihlásí. Při upgradu starého nasazení nastav silné `ADMIN_PASSWORD` a pro jednorázový reset původního `admin/admin` použij `ADMIN_RESET=1` (pak jej odstraň).

Podrobnosti zabezpečení a zbylých omezení GPS/identity: [docs/security-fixes.md](docs/security-fixes.md).
