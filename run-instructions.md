# SafeRide — Complete Run Instructions

## Prerequisites
* Node.js & pnpm installed
* PostgreSQL running locally or via connection string

---

## 1. Environment Setup

Create `.env` inside `artifacts/api-server`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saferide
JWT_SECRET=your-super-secret-jwt-key-here
PORT=8080
```

Apply database migration:
```bash
pnpm --filter @workspace/db run push
```

---

## 2. Start Backend Server (Terminal 1)

```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\api-server"
node --enable-source-maps --env-file=.env ./dist/index.mjs
```
*(Alternative dev mode)*:
```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\api-server"
pnpm run dev
```

---

## 3. Start Frontend Mobile App / Expo Web (Terminal 2)

```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\saferide"
$env:EXPO_PUBLIC_DOMAIN="http://localhost:8080"
pnpm exec expo start --web
```
*(For physical mobile device via LAN)*:
```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\saferide"
$env:EXPO_PUBLIC_DOMAIN="http://<YOUR_PC_LAN_IP>:8080"
pnpm exec expo start --lan -c
```
