# SafeRide

SafeRide is a mobile ride-safety companion. It plans journeys with real OpenStreetMap search and routing, stores the selected trip and trusted contacts, tracks GPS during an active journey, and keeps safety analysis separate from road routing.

## What is included

- Expo mobile app with portrait-first screens for welcome, sign-in, registration, dashboard, journey planning, vehicle details, emergency contacts, route selection, review, active tracking, history, profile, and SOS.
- Nominatim location search and reverse geocoding called directly by the mobile app.
- OSRM driving routes with alternatives called directly by the mobile app.
- Leaflet + OpenStreetMap map rendered in the mobile client with markers, polylines, zoom controls, and route fitting.
- Express REST API with JWT access tokens, BCrypt password hashing, PostgreSQL persistence, route/vehicle/contact/journey storage, GPS updates, emergency events, and a modular safety analyzer interface.
- Drizzle schema plus an SQL migration at `lib/db/drizzle/0001_saferide.sql`.
- OpenAPI contract at `lib/api-spec/openapi.yaml`, with generated clients in `lib/api-client-react` and `lib/api-zod`.

## Configuration

The API server requires:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=<long random value>
```

`SESSION_SECRET` is accepted as a development fallback for JWT signing. Never commit either secret.

The mobile client uses `EXPO_PUBLIC_DOMAIN` for the API host. The managed workflow supplies this automatically. For a physical phone, point it at a reachable backend URL; with USB testing, use `adb reverse tcp:8080 tcp:8080` and the local backend URL described in the project environment.

Nominatim and OSRM are configured in `artifacts/saferide/lib/geo.ts`. They are real public services intended for development and light use. For production traffic, replace their HTTPS endpoints with providers and usage policies appropriate for the deployment; no provider key is hard-coded.

## Run

Install dependencies:

```bash
pnpm install
```

Apply the PostgreSQL schema in development:

```bash
pnpm --filter @workspace/db run push
```

Start the API and Expo workflows from Replit’s workflow controls. The API is available under `/api`, and the mobile preview is available through the Expo preview/QR flow.

## API surface

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users/me`
- `GET|POST /api/contacts`
- `PUT|DELETE /api/contacts/:id`
- `POST /api/journeys`
- `GET /api/journeys/history`
- `GET /api/journeys/:id`
- `POST /api/journeys/:id/safety-analysis`
- `POST /api/journeys/:id/locations`
- `POST /api/journeys/:id/emergency`

## Safety architecture

Routing returns geometry, distance, duration, and alternatives. SafeRide safety analysis is a distinct backend service boundary. Until the assigned environmental/safety data algorithms are connected, the API returns `PENDING` with a null score and the mobile UI says so explicitly rather than inventing a score.

The same separation prepares the backend for modular route-deviation and stationary-condition algorithms without moving routing or map work into the backend.