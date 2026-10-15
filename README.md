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

Otevři http://localhost:5173. Demo režim s polohou klikem do mapy: http://localhost:5173/?demo=1

Dashboard kraje: http://localhost:5173/dashboard (admin / admin). V demo režimu trvá zabírání 10 s.

## Nasazení (Docker Compose)

```bash
cp .env.example .env
docker compose up -d --build
```

V `.env` nastav `SITE_ADDRESS` na doménu serveru (např. `krajanek.example.cz`), Caddy pak samo zajistí HTTPS, bez kterého na telefonech nefunguje GPS ani instalace PWA. Data jsou v Postgresu a přežijí restart.
