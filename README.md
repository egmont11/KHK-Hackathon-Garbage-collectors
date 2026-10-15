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
PORT=8080 docker compose up -d --build
```

Jediné nastavení je `PORT`, port na serveru, na kterém appka poběží (výchozí 8080). V Coolify stačí nastavit proměnnou `PORT`. Pro GPS a instalaci PWA na telefonech musí být před serverem HTTPS (Coolify ho zajistí přes doménu). Data jsou v Postgresu a přežijí restart.
