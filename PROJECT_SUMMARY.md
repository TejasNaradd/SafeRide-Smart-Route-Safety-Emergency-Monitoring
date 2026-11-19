# SafeRide — Comprehensive Project Summary & Architecture Reference

> **SafeRide** is an intelligent, privacy-first mobile safety companion and real-time journey monitoring platform designed to protect commuters (especially women, late-night riders, and students). Built with a deterministic **100-meter equidistant spatial safety engine**, SafeRide combines real-time GPS tracking, OpenStreetMap routing, and Nagpur GIS infrastructure to score route safety, detect route deviations, evaluate prolonged stationary conditions, and trigger automated emergency SOS dispatches across multiple communication channels.

---

## Table of Contents
1. [System Architecture & Tech Stack](#1-system-architecture--tech-stack)
2. [End-to-End User Journey & Application Flow](#2-end-to-end-user-journey--application-flow)
3. [100-Meter Equidistant Safety Scoring & Threat Engine](#3-100-meter-equidistant-safety-scoring--threat-engine)
4. [Vector Deviation & Real Crime Hotspot Matrix](#4-vector-deviation--real-crime-hotspot-matrix)
5. [High-Definition Map Engine & Spatial Overlays](#5-high-definition-map-engine--spatial-overlays)
6. [Automated Multi-Channel Emergency Dispatch System](#6-automated-multi-channel-emergency-dispatch-system)
7. [Strict GPS Guard Rails & Jitter Filtering](#7-strict-gps-guard-rails--jitter-filtering)
8. [Database Schema & Data Models](#8-database-schema--data-models)
9. [REST API Endpoint Reference](#9-rest-api-endpoint-reference)
10. [Visual Walkthrough Assets & How to Run](#10-visual-walkthrough-assets--how-to-run)

---

## 1. System Architecture & Tech Stack

```
                               ┌──────────────────────────────────────────────┐
                               │             SafeRide Mobile App              │
                               │          (Expo SDK 57 / React Native)        │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┼─────────────────────────────┐
                       │                              │                             │
                       ▼                              ▼                             ▼
        ┌────────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
        │  HD Mapbox Map (Leaflet)   │  │  100m Threat Engine (A1)  │  │   Automated Cloud SMS     │
        │  • Mapbox Streets v12 @2x  │  │  • 100m Equidistant Step  │  │  • Server Background SMS  │
        │  • CCTV & Police Overlays  │  │  • Crime Hotspot Buffers  │  │  • Native SMS App Intent  │
        │  • Crime Danger Zones      │  │  • Vector Deviation ΔD    │  │  • WhatsApp Broadcast     │
        │  • Live Pulsing GPS Marker │  │  • Signal Grace Periods   │  │  • 112 Speed Dial         │
        └────────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
                                                      │
                                                      ▼ (REST JSON / JWT)
                               ┌──────────────────────────────────────────────┐
                               │           SafeRide Express API (Port 8080)   │
                               │  • JWT Auth • Safety Analyzers • GPS Stream  │
                               │  • POST /api/journeys/:id/dispatch-sms       │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼ (Drizzle ORM)
                               ┌──────────────────────────────────────────────┐
                               │           PostgreSQL Database                │
                               │  • users • journeys • routes • gps_points    │
                               │  • emergency_events • stationary_events      │
                               └──────────────────────────────────────────────┘
```

### Technology Matrix:
| Layer | Technologies Used | Key Responsibilities |
| :--- | :--- | :--- |
| **Mobile Client** | Expo SDK `~57.0.25`, React Native `0.86.3`, TypeScript 5.9 | Native mobile UI, real-time GPS hardware streaming, foreground permission management, haptic cues. |
| **HD Mapping Engine** | `react-native-webview` `13.16.1`, Leaflet 1.9.4, CartoDB Voyager Retina @2x | Hardware-accelerated tile rendering, route polylines with drop shadows, pulsing live radar marker, translucent safety overlays. |
| **Routing / Geocoding** | OSRM (`router.project-osrm.org`), Nominatim OpenStreetMap | Multi-route generation (guaranteeing $\ge 2$ distinct routes) + local landmark fallback lookup. |
| **Backend API** | Node.js, Express `5.2.1`, Pino logger, Zod | RESTful endpoints, JWT validation, automated cloud SMS dispatch, threat analysis endpoints. |
| **Database** | PostgreSQL, Drizzle ORM `^0.45.2` | Persistent storage for users, vehicles, emergency contacts, recorded GPS breadcrumbs, and SOS logs. |

---

## 2. End-to-End User Journey & Application Flow

```
[ Welcome / Auth ] ──► [ Home Dashboard ] ──► [ Step 1: Location & 1-Tap Demo ] ──► [ Step 2: Vehicle Info ]
                                                                                           │
[ Live Active Ride ] ◄── [ Step 5: Review & Strict GPS Gate ] ◄── [ Step 4: Route Selection ] ◄── [ Step 3: Contacts ]
        │
        ├── Normal Monitoring (Score 80-100: Silent background tracking)
        ├── Warning Tier (Score 60-79: Amber warning banner on HUD)
        ├── High Risk Tier (Score 35-59: 30-Second Check-in Modal) ──► [ "I am Safe" (Dismisses) ]
        │                                                         └──► [ Timeout (Auto-Dispatches SMS) ]
        └── Critical Tier (Score <35 / GPS Lost / SOS: Multi-channel Emergency Dispatch)
        │
        ▼
[ Journey Completion Summary ] ──► [ Interactive Journey History & Replay ]
```

### Detailed Screen-by-Screen Breakdown:

1. **Authentication Screen (`artifacts/saferide/app/index.tsx:62`):**
   * Register with Name, Email, and 8-character password (hashed with `bcryptjs` 12 rounds).
   * Login returns a secure JWT stored in `AsyncStorage`.
2. **Home Dashboard (`artifacts/saferide/app/index.tsx:69`):**
   * Displays welcome banner, quick action toolkit (Journey History, Emergency Contacts, Safety First).
3. **Step 1: Location Selection & 1-Tap Demo (`artifacts/saferide/app/index.tsx:74`):**
   * **⚡ 1-Tap Nagpur Demo Ride Button:** Instantly auto-fills Ramdeobaba University (RBU) ➔ Nagpur Railway Station with vehicle details for fast PPT/viva presentations.
   * Search Pickup and Drop-off locations using OpenStreetMap Nominatim with local landmark fallbacks.
   * "Use my current location" button with automatic reverse-geocoding.
4. **Step 2: Vehicle & Driver Information (`artifacts/saferide/app/index.tsx:189`):**
   * Captures License Plate (mandatory, auto-capitalized), Driver Name, Car Model, and Color.
5. **Step 3: Trusted Emergency Contacts (`artifacts/saferide/app/index.tsx:194`):**
   * Allows adding, editing, deleting, and selecting trusted emergency contacts who receive automated SMS alerts.
6. **Step 4: Guaranteed Multi-Route Safety Scoring (`artifacts/saferide/app/index.tsx:203`):**
   * Generates at least **2 to 4 distinct routes** (Main Arterial, Northern Bypass, Southern Ring Road).
   * Runs the **100m Equidistant Resampling Algorithm** across every candidate route.
   * Evaluates lighting, CCTV, police station proximity, accident blackspots, crime hotspots, and time-of-day.
   * Pre-selects the **Safest Route** with a risk badge and factor breakdown.
7. **Step 5: Review & Strict Pre-Ride GPS Gate (`artifacts/saferide/app/index.tsx:229`):**
   * **Strict Pre-Ride Gate:** Actively checks device GPS hardware toggle (`Location.hasServicesEnabledAsync()`) and location permissions. Blocks ride start if GPS is disabled.
8. **Step 6: Live Active Journey Monitoring (`artifacts/saferide/components/ActiveMonitoring.tsx:122`):**
   * Real-time GPS stream (`Location.watchPositionAsync`) updating every 4 seconds.
   * Continuous GPS hardware disconnection monitor: Turning off GPS mid-ride immediately triggers a **"GPS Lost / Potential Tampering" threat anomaly (+35 threat points)** and opens the check-in modal.
   * Renders real-time HUD with **3 Core Live Safety Pillars** (Route Deviation, Vehicle Stoppage, Nearby Infrastructure).
9. **Step 7: 30-Second Safety Check-in Modal (`artifacts/saferide/components/SafetyCheckinModal.tsx`):**
   * Triggers automatically when Threat Score enters High Risk (41–65) or GPS is turned off.
   * Visual animated countdown ring with audio/haptic vibration alert at 15s.
   * **"I am Safe" Button:** Instantly dismisses the modal, resets the threat escalation, and logs user safety confirmation.
   * **Timeout Auto-Escalation:** If 30 seconds expire with no response $\to$ **automatically invokes backend cloud SMS dispatch**.
10. **Step 8: Multi-Channel Emergency SOS Dispatch (`artifacts/saferide/lib/dispatch.ts`):**
    * **Automated Cloud SMS:** Backend sends alert payload to emergency contacts via SMS Gateway.
    * **1-Tap Native SMS Intent:** Opens pre-filled SMS composer with Google Maps link and vehicle info.
    * **1-Tap WhatsApp Broadcast:** Share alert to WhatsApp groups/family.
    * **Direct 112 Speed Dial:** Direct phone call to police dispatch.
11. **Step 9: Post-Ride Completion Summary (`artifacts/saferide/components/ActiveMonitoring.tsx:938`):**
    * Displays final safety score, total distance, duration, route deviations count, stationary count, and 7-factor breakdown.
12. **Step 10: Interactive Journey History & Replay (`artifacts/saferide/components/JourneyDetailModal.tsx`):**
    * Tapping any history card opens the full Journey Detail View.
    * Replays planned route polyline and actual recorded GPS breadcrumb trail on the interactive map.

---

## 3. 100-Meter Equidistant Safety Scoring & Threat Engine

### 100-Meter Equidistant Sampling Methodology
For any given route of length $L$ meters, SafeRide resamples the polyline into equidistant checkpoints every **100 meters** along the road geometry (`artifacts/saferide/lib/threat.ts:660`):

$$\text{Total Checkpoints } (N) = \left\lfloor \frac{L}{100} \right\rfloor + 1$$

For example, a **5.2 km route** generates exactly **53 sample checkpoints** ($0\text{m}, 100\text{m}, 200\text{m}, \dots, 5200\text{m}$).

```
Start [0m] ──100m──► [100m] ──100m──► [200m] ──100m──► ... ──100m──► Destination [5200m]
   │                   │                   │                                    │
   ▼                   ▼                   ▼                                    ▼
Checked for         Checked for         Checked for                          Checked for
Police, CCTV,       Police, CCTV,       Police, CCTV,                        Police, CCTV,
Lighting, Crime     Lighting, Crime     Lighting, Crime                      Lighting, Crime
```

### Factor Weight Distribution:
$$\text{Threat Score } (T) = \frac{\sum_{i=1}^{7} (w_i \times p_i)}{\sum_{i=1}^{7} w_i} \times 100 \quad (0 \le T \le 100)$$
$$\text{Safety Score } (S) = 100 - T \quad (0 \le S \le 100)$$

| Factor ($i$) | Weight ($w_i$) | Percentage | Evaluation Matrix / Penalty ($p_i$) |
| :--- | :---: | :---: | :--- |
| **1. Route Deviation** | `0.30` | 30% | On-route ($\le 60\text{m}$): $p=0.00$<br>Traffic bypass ($\le 250\text{m}$, $\Delta D_{\text{dest}} < 0$): $p=0.15$<br>Major bypass ($\le 500\text{m}$, $\Delta D_{\text{dest}} < 0$): $p=0.30$<br>Suspicious detour ($>400\text{m}$ moving away): $p=0.85\text{--}0.95$ |
| **2. Stationary Condition** | `0.20` | 20% | Moving ($>1.5\text{ m/s}$): $p=0.00$<br>Traffic signal stop ($\le 90\text{s}$ grace): $p=0.00$<br>Brief halt ($\le 90\text{s}$): $p=0.20$<br>Stoppage in high-crime zone ($>60\text{s}$): $p=0.85$<br>Prolonged ($>5\text{ min}$): $p=0.75\text{--}1.00$ |
| **3. Street Lighting** | `0.12` | 12% | Well-lit corridor (e.g. Wardha Rd, Katol Rd, Central Ave): $p=0.00$<br>Partially lit street: $p=0.35$<br>Unlit outer bypass / dark stretch: $p=0.85\text{--}0.90$ |
| **4. CCTV & Police Presence** | `0.12` | 12% | Inside Smart City CCTV bubble / Police $\le 500\text{m}$: $p=0.00$<br>Police station within 800m: $p=0.30$<br>Isolated from CCTV & Police ($>1.5\text{km}$): $p=0.70$ |
| **5. Accident & Crime Hotspots** | `0.10` | 10% | Clear road: $p=0.00$<br>Within buffer of known crime pocket or blackspot: $p=0.80\text{--}1.00$ (with night multiplier) |
| **6. Road Hierarchy** | `0.08` | 8% | Major arterial / National Highway: $p=0.00$<br>Secondary collector road: $p=0.25$<br>Unpaved / isolated industrial lane: $p=0.75$ |
| **7. Time of Day Context** | `0.08` | 8% | Daytime (06:00–20:00 IST): $p=0.00$<br>Evening (20:00–22:30 IST): $p=0.25$<br>Late Night (22:30–06:00 IST): $p=0.75$ |

### Threat Tiers & Automated Actions:
```
 Threat Score T   Safety Score S   Tier Level   Automated Action
────────────────────────────────────────────────────────────────────────────────
 0 ≤ T ≤ 20       80 ≤ S ≤ 100     LOW          Silent background monitoring
 21 ≤ T ≤ 40      60 ≤ S ≤ 79      MEDIUM       Amber warning banner on HUD
 41 ≤ T ≤ 65      35 ≤ S ≤ 59      HIGH         Trigger 30s Safety Check-in Modal
 66 ≤ T ≤ 100      0 ≤ S ≤ 34      CRITICAL     Auto Emergency Cloud SMS Dispatch
```

---

## 4. Vector Deviation & Real Crime Hotspot Matrix

### Vector-Based Deviation Classifier:
The system uses the destination distance delta ($\Delta D_{\text{dest}}$) to determine intent:

$$\Delta D_{\text{dest}} = \text{Dist}(P_{\text{new}}, \text{Destination}) - \text{Dist}(P_{\text{old}}, \text{Destination})$$

* **$\Delta D_{\text{dest}} < -10\text{m}$ (Moving closer to destination):** Classified as `TRAFFIC_BYPASS_DETOUR` (low penalty $p=0.15$).
* **$\Delta D_{\text{dest}} \ge 0$ (Moving away from destination):** Classified as `SUSPICIOUS_DIVERSION` (high penalty $p=0.85\text{--}0.95$).

### Verified Nagpur Crime & Vulnerability Hotspots:
| Hotspot Name | Coordinates | Category | Buffer | Base Penalty | Night Multiplier | Description |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **Gittikhadan Quarry Belt** | `21.1710, 79.0480` | Violent Crime | 350 m | 0.90 | 1.25× | Isolated rock quarry, dark stretch, assault risk |
| **Seminary Hills Rear Wooded Area** | `21.1620, 79.0510` | Sexual Assault Risk | 400 m | 0.85 | 1.30× | Dense unlit tree cover, harassment vulnerability |
| **Kalamna Freight Rail Sidings** | `21.1850, 79.1120` | Robbery Hotspot | 450 m | 0.85 | 1.20× | Goods shed sidings, night mugging reports |
| **Pardi–Bhandara Bypass** | `21.1150, 79.1450` | Isolated Dark Zone | 500 m | 0.80 | 1.25× | Industrial warehouse bypass, zero police patrolling |
| **Beltarodi Ring Rd Underpass** | `21.1800, 79.0150` | Robbery Hotspot | 400 m | 0.85 | 1.20× | Sparse traffic, vehicle intercept reports |
| **Hingna MIDC Waste Belt** | `21.1080, 79.0050` | Isolated Dark Zone | 450 m | 0.80 | 1.25× | Industrial wasteland after 21:00, unmonitored |

---

## 5. High-Definition Map Engine & Spatial Overlays

The Leaflet Map component (`artifacts/saferide/components/MapPreview.tsx`) renders on **CartoDB Voyager Retina @2x vector tiles**:

* 🚔 **Police Stations:** Deep navy badge pins with 24/7 status popups.
* 📹 **Smart City CCTV:** Translucent emerald green surveillance bubbles ($150\text{m}\text{--}450\text{m}$ radius).
* 🚨 **Crime Hotspots & Blackspots:** Translucent crimson danger circles ($250\text{m}\text{--}500\text{m}$ radius).
* 📍 **Live Vehicle Marker:** Pulsing blue radar indicator with animated ripple effect.
* 🛣️ **Route Polylines:** Shadow-drop underlay with emerald green stroke for selected route, gray dashed line for alternatives.

---

## 6. Automated Multi-Channel Emergency Dispatch System

When an emergency occurs (manual SOS pressed or 30s check-in modal expires without response), SafeRide triggers:

```
🚨 SAFERIDE EMERGENCY ALERT

User: Priya Sharma (priya@example.com)
Reason: No response to safety check-in after 30 seconds
Threat Score: 78/100 (CRITICAL RISK)

📍 Location: Katol Road -> Nagpur Railway Station
🗺 Live GPS: 21.17120, 79.05430
🔗 Google Maps: https://maps.google.com/?q=21.17120,79.05430

🚗 Vehicle: Toyota Glanza (White)
   Plate: MH 31 AB 1234
   Driver: Ramesh Kumar

⏰ Time: 2026-09-26 23:14:02 IST
🆘 Please check on rider or call 112 immediately.
```

### Multi-Channel Communication:
1. **Automated Backend Cloud SMS (`POST /api/journeys/:id/dispatch-sms`):** Dispatches SMS to all contacts in the background via SMS gateway.
2. **Native SMS App Intent:** Opens phone's default Messages app pre-filled with all contacts and Google Maps link.
3. **WhatsApp Broadcast:** 1-tap sharing to WhatsApp groups and family.
4. **Direct 112 Speed Dial:** 1-tap call to emergency police dispatch.

---

## 7. Strict GPS Guard Rails, Jitter Filtering & Dynamic In-Flight Rerouting

* **Pre-Ride Gate:** Blocks starting a journey if device Location Services (GPS toggle) are disabled or permissions are missing.
* **Continuous In-Ride Health Checker:** If GPS is switched off mid-ride, triggers an immediate high-priority safety check-in modal.
* **Indoor Accuracy & Stationary Dead-Band Anchor:** Coarse Wi-Fi/Cell fixes ($> 35\text{m}$ error radius) are filtered out, and displacements $< 8\text{m}$ with speeds $< 1.8\text{ km/h}$ lock coordinates and speed strictly to $0.0\text{ km/h}$ to eliminate indoor jitter.
* **Dynamic Forward Route Trimming (Ola / Uber Style):** The forward navigation line dynamically trims in real time, starting from the moving car cursor and connecting to the destination, while the traversed path is recorded as cyan breadcrumbs.
* **In-Flight Turn-Missed Auto-Rerouting:** If the driver misses a turn or takes a side street ($> 85\text{m}$ off route for 2 consecutive ticks), the system automatically recalculates a fresh road route from `current location ➔ destination` in the background and re-draws the blue route line in real time.
* **Smooth Camera Follow:** Leaflet smoothly pans and centers on the vehicle as it navigates.

---

## 8. Database Schema & Data Models

Managed via Drizzle ORM (`lib/db/src/schema/index.ts`):

```
users (id, name, email, password_hash, created_at)
emergency_contacts (id, user_id, name, phone, relationship, created_at)
vehicles (id, user_id, license_plate, driver_name, model, color)
journeys (id, user_id, pickup, destination, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, selected_route_id, route_distance_meters, route_duration_seconds, status, created_at)
journey_routes (id, journey_id, points_json, distance_meters, duration_seconds, safety_score, risk_level)
location_points (id, journey_id, latitude, longitude, speed_meters_per_second, accuracy_meters, recorded_at)
emergency_events (id, journey_id, type, message, latitude, longitude, created_at)
```

---

## 9. REST API Endpoint Reference

Base URL: `http://<YOUR_LOCAL_IP>:8080/api`

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/auth/register` | No | Register new account |
| `POST` | `/auth/login` | No | Authenticate user & retrieve JWT |
| `GET` | `/users/me` | Yes | Get authenticated user profile |
| `GET\|POST` | `/contacts` | Yes | List / Create emergency contacts |
| `PUT\|DELETE` | `/contacts/:id` | Yes | Update / Delete emergency contact |
| `POST` | `/journeys` | Yes | Create journey & store planned route points |
| `GET` | `/journeys/history` | Yes | List past journeys with metrics |
| `GET` | `/journeys/:id` | Yes | Get journey details (route points, breadcrumbs, SOS logs) |
| `POST` | `/journeys/:id/locations` | Yes | Record live GPS coordinate breadcrumb |
| `POST` | `/journeys/:id/emergency` | Yes | Trigger emergency event (SOS / Deviation / Stoppage) |
| `POST` | `/journeys/:id/dispatch-sms` | Yes | **NEW** Automated background cloud SMS dispatch |
| `POST` | `/journeys/:id/complete` | Yes | Finalize journey with final safety score |

---

## 10. Visual Walkthrough Assets & How to Run

### Interactive Visual Walkthrough & Media Files (In Project Root):
* **`DEMO_WALKTHROUGH.html`**: Standalone interactive visual walkthrough simulator. Double-click to open in any web browser.
* **`SafeRide_Demo_Walkthrough.gif`**: Animated demonstration walkthrough recording in the root directory.

---

### How to Run the App:

#### Terminal 1 — Start Backend Server:
```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\api-server"
node --enable-source-maps --env-file=.env ./dist/index.mjs
```

#### Terminal 2 — Start Mobile App (Expo):
```powershell
cd "E:\SafeRide-Safety-App (1)\SafeRide-Safety-App\artifacts\saferide"
$env:EXPO_PUBLIC_DOMAIN="http://10.98.18.186:8080"
pnpm exec expo start --lan -c
```
*Scan the QR code with **Expo Go** on your Android phone.*

---

### Viva Demo Simulation Guide:
1. On Step 1, tap **"⚡ 1-Tap Demo: RBU ➔ Railway Station"**.
2. Select the safest route on Step 4 and start the ride on Step 5.
3. In Active Monitoring, expand **"Viva Demo Simulation"**:
   * **Smooth Ride:** Safe route, score 88–96 (LOW RISK / GREEN).
   * **Traffic Stop:** Signal grace whitelisting demo.
   * **Legitimate Detour:** Parallel traffic bypass ($\Delta D_{\text{dest}} < 0$), score remains moderate.
   * **Night Suspicious:** Diversion into Seminary Hills crime zone $\to$ Threat spikes $\to$ 30s Check-in $\to$ Auto SMS Dispatch.

---

## 11. Flagship Demo: RBU ➔ Nagpur Railway Station — Verified Square-by-Square Analysis

SafeRide's primary presentation corridor. Selecting **"⚡ 1-Tap Demo: RBU ➔ Railway Station"** auto-loads these 3 genuine, physically verified routes with exact square GPS coordinates.

### Route 1 — Safest: via Sadar Flyover ➔ RBI Square
**Distance: 5.3 km · Duration: ~11 min · Safety Score: 96/100 (LOW RISK / GREEN)**

| # | Square Name | GPS (Lat, Lon) | Lighting | CCTV | Police Proximity |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | RBU Main Gate (Origin) | `(21.1764, 79.0612)` | 💡 Well Lit | 📹 Smart CCTV | Gittikhadan PS (180m) |
| 2 | Gittikhadan Police Station Square | `(21.1737, 79.0609)` | 💡 Well Lit | 📹 Smart CCTV | Gittikhadan PS (50m) |
| 3 | Old Katol Naka Chowk (KT Nagar) | `(21.1685, 79.0645)` | 💡 Well Lit | 📹 Smart CCTV | Gittikhadan PS (420m) |
| 4 | Sadar Flyover Entrance | `(21.1635, 79.0710)` | 💡 Well Lit | 📹 Smart CCTV | Sadar PS (380m) |
| 5 | Sadar Flyover Midspan (Elevated) | `(21.1575, 79.0780)` | 💡 Well Lit | 📹 Smart CCTV | Sadar PS (190m) |
| 6 | RBI Square Descent | `(21.1526, 79.0809)` | 💡 Well Lit | 📹 Smart CCTV | RBI PS Outpost (80m) |
| 7 | Zero Mile / Variety Square Metro | `(21.1467, 79.0806)` | 💡 Well Lit | 🚇 Metro CCTV | GRP Police (350m) |
| 8 | Nagpur Railway Station (Dest) | `(21.1523, 79.0882)` | 💡 Well Lit | 📹 RPF CCTV | GRP Station (20m) |

---

### Route 2 — Alternate: via Sadar Market ➔ Kasturchand Park
**Distance: 5.9 km · Duration: ~14 min · Safety Score: 90/100 (LOW RISK / GREEN)**

| # | Square Name | GPS (Lat, Lon) | Via Road |
| :---: | :--- | :---: | :--- |
| 1 | RBU Main Gate | `(21.1764, 79.0612)` | Katol Road |
| 2 | Gittikhadan PS Square | `(21.1737, 79.0609)` | Katol Road |
| 3 | Old Katol Naka Chowk | `(21.1685, 79.0645)` | Katol Road |
| 4 | Liberty Cinema Square / Sadar | `(21.1571, 79.0797)` | Residency Road |
| 5 | Kasturchand Park / Metro Station | `(21.1543, 79.0814)` | Kingsway |
| 6 | LIC Square | `(21.1556, 79.0817)` | Kingsway |
| 7 | Nagpur Railway Station | `(21.1523, 79.0882)` | Station Road |

---

### Route 3 — Caution: via Seminary Hills ➔ Civil Lines (NOT Recommended at Night)
**Distance: 6.3 km · Duration: ~16 min · Safety Score: 52/100 (HIGH RISK / ORANGE)**

| # | Square Name | GPS (Lat, Lon) | Threat Factor |
| :---: | :--- | :---: | :--- |
| 1 | RBU Main Gate | `(21.1764, 79.0612)` | Normal |
| 2 | TV Tower Square | `(21.1670, 79.0538)` | Partially Lit |
| 3 | Seminary Hills Wooded Rear | `(21.1620, 79.0510)` | **UNLIT · Crime Hotspot · No CCTV** |
| 4 | CP Club Square | `(21.1549, 79.0560)` | Re-lit |
| 5 | GPO Square / High Court | `(21.1536, 79.0683)` | Civil Lines — Lit with CCTV |
| 6 | Nagpur Railway Station | `(21.1523, 79.0882)` | Safe |

### Summary Comparison Table:
| Criteria | Route 1 (Flyover + RBI) | Route 2 (Sadar Market) | Route 3 (Seminary Hills) |
| :--- | :---: | :---: | :---: |
| Distance | **5.3 km** | 5.9 km | 6.3 km |
| 100m Checkpoints | **54** | 60 | 64 |
| Lighting | **100% Well Lit** | 95% Well Lit | 58% Lit (42% Dark) |
| CCTV Coverage | **100% Covered** | 92% Covered | 35% Covered |
| Nearest Police | **50m (PS Square)** | 180m (Sadar PS) | 1.3 km (During Wooded Section) |
| Crime Hotspots | **0** | **0** | **1 (Seminary Hills)** |
| **Safety Score** | 🛡️ **96/100** | 🛡️ **90/100** | ⚠️ **52/100** |
| **Recommendation** | **SAFEST — TAKE THIS** | SAFE ALTERNATE | NOT AT NIGHT |
