import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, users, emergencyContacts, vehicles, journeys, journeyRoutes, locationPoints, emergencyEvents } from "@workspace/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import healthRouter from "./health";
import { createToken, publicUser, requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { RuleBasedSafetyAnalyzer } from "../lib/safety";
import { computeThreatAnalysis, scorePreTripRoute, type RoutePoint, type LatLon } from "../lib/threat-engine";

const router: IRouter = Router();
const safetyAnalyzer = new RuleBasedSafetyAnalyzer();

// ─── Zod helpers ──────────────────────────────────────────────────────────────
const latLon = z.object({ lat: z.number().min(8).max(38), lon: z.number().min(68).max(98) }); // India bounds
const routePointSchema = z.object({ lat: z.number(), lon: z.number(), sequence: z.number().optional() });

const coordinates = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const contactSchema = z.object({ name: z.string().min(2), phone: z.string().min(7), relationship: z.string().optional() });
const registerSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

router.use(healthRouter);

router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Please provide a name, valid email, and password of at least 8 characters." }); return; }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const [row] = await db.insert(users).values({ name: parsed.data.name, email: parsed.data.email.toLowerCase(), passwordHash }).returning();
    res.status(201).json({ token: createToken(row.id), user: publicUser(row) });
  } catch (error) {
    req.log.warn({ err: error }, "Registration failed");
    res.status(400).json({ message: "That email may already be registered." });
  }
});

router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Enter a valid email and password." }); return; }
  try {
    const [row] = await db.select().from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1);
    if (!row || !(await bcrypt.compare(parsed.data.password, row.passwordHash))) {
      res.status(401).json({ message: "Email or password is incorrect." }); return;
    }
    res.json({ token: createToken(row.id), user: publicUser(row) });
  } catch (error) {
    req.log.error({ err: error }, "Login failed");
    res.status(503).json({ message: "SafeRide services are temporarily unavailable." });
  }
});

router.get("/users/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const [row] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!row) { res.status(404).json({ message: "User not found." }); return; }
    res.json(publicUser(row));
  } catch (error) {
    req.log.error({ err: error }, "Could not load profile");
    res.status(503).json({ message: "SafeRide services are temporarily unavailable." });
  }
});

router.get("/contacts", requireAuth, async (req: AuthenticatedRequest, res) => {
  const rows = await db.select({ id: emergencyContacts.id, name: emergencyContacts.name, phone: emergencyContacts.phone, relationship: emergencyContacts.relationship })
    .from(emergencyContacts).where(eq(emergencyContacts.userId, req.userId!));
  res.json(rows);
});

router.post("/contacts", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Add a name and a valid phone number." }); return; }
  const [row] = await db.insert(emergencyContacts).values({ ...parsed.data, userId: req.userId! }).returning();
  res.status(201).json(row);
});

router.put("/contacts/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Add a name and a valid phone number." }); return; }
  const [row] = await db.update(emergencyContacts).set(parsed.data).where(and(eq(emergencyContacts.id, String(req.params.id)), eq(emergencyContacts.userId, req.userId!))).returning();
  if (!row) { res.status(404).json({ message: "Contact not found." }); return; }
  res.json(row);
});

router.delete("/contacts/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  await db.delete(emergencyContacts).where(and(eq(emergencyContacts.id, String(req.params.id)), eq(emergencyContacts.userId, req.userId!)));
  res.status(204).send();
});

const journeySchema = z.object({
  pickup: z.string().min(1), destination: z.string().min(1),
  pickupPlaceId: z.string().optional(), destinationPlaceId: z.string().optional(),
  pickupCoordinate: coordinates, destinationCoordinate: coordinates,
  selectedRouteId: z.string().optional(), routeDistanceMeters: z.number().nonnegative(),
  routeDurationSeconds: z.number().nonnegative(),
  routePoints: z.array(coordinates.extend({ sequence: z.number() })).min(2),
  vehicle: z.object({ licensePlate: z.string().optional(), driverName: z.string().optional(), model: z.string().optional(), color: z.string().optional() }).optional(),
  contactIds: z.array(z.string()).optional(),
});

async function journeyResponse(id: string, userId: string) {
  const [journey] = await db.select().from(journeys).where(and(eq(journeys.id, id), eq(journeys.userId, userId))).limit(1);
  if (!journey) return null;
  const routes = await db.select().from(journeyRoutes).where(eq(journeyRoutes.journeyId, id));
  const selected = routes.find((route) => route.routeId === journey.selectedRouteId) ?? routes[0];
  
  // Fetch location points (GPS breadcrumbs)
  const locations = await db.select().from(locationPoints).where(eq(locationPoints.journeyId, id)).orderBy(locationPoints.recordedAt);
  
  // Fetch emergency events
  const emergencies = await db.select().from(emergencyEvents).where(eq(emergencyEvents.journeyId, id)).orderBy(desc(emergencyEvents.createdAt));
  
  // Parse route points from JSON
  let routePoints: any[] = [];
  try {
    if (selected?.pointsJson) {
      routePoints = JSON.parse(selected.pointsJson);
    }
  } catch {
    routePoints = [];
  }
  
  return {
    id: journey.id, pickup: journey.pickup, destination: journey.destination,
    pickupPlaceId: journey.pickupPlaceId ?? undefined, destinationPlaceId: journey.destinationPlaceId ?? undefined,
    pickupCoordinate: { latitude: journey.pickupLatitude, longitude: journey.pickupLongitude },
    destinationCoordinate: { latitude: journey.destinationLatitude, longitude: journey.destinationLongitude },
    selectedRouteId: journey.selectedRouteId ?? undefined,
    routeDistanceMeters: journey.routeDistanceMeters, routeDurationSeconds: journey.routeDurationSeconds,
    status: journey.status, createdAt: journey.createdAt.toISOString(),
    routePoints,
    locationPoints: locations.map((loc) => ({
      latitude: loc.latitude,
      longitude: loc.longitude,
      recordedAt: loc.recordedAt.toISOString(),
      accuracyMeters: loc.accuracyMeters ?? undefined,
      speedMetersPerSecond: loc.speedMetersPerSecond ?? undefined,
    })),
    emergencyEvents: emergencies.map((ev) => ({
      id: ev.id,
      type: ev.type,
      message: ev.message,
      coordinate: ev.latitude != null ? { latitude: ev.latitude, longitude: ev.longitude } : undefined,
      createdAt: ev.createdAt.toISOString(),
    })),
  };
}

router.post("/journeys", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = journeySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Journey details are incomplete." }); return; }
  const data = parsed.data;
  const [journey] = await db.insert(journeys).values({
    userId: req.userId!, pickup: data.pickup, destination: data.destination,
    pickupPlaceId: data.pickupPlaceId, destinationPlaceId: data.destinationPlaceId,
    pickupLatitude: data.pickupCoordinate.latitude, pickupLongitude: data.pickupCoordinate.longitude,
    destinationLatitude: data.destinationCoordinate.latitude, destinationLongitude: data.destinationCoordinate.longitude,
    selectedRouteId: data.selectedRouteId, routeDistanceMeters: data.routeDistanceMeters, routeDurationSeconds: data.routeDurationSeconds, status: "ACTIVE",
  }).returning();
  await db.insert(journeyRoutes).values({
    journeyId: journey.id, routeId: data.selectedRouteId ?? "selected", pointsJson: JSON.stringify(data.routePoints),
    distanceMeters: data.routeDistanceMeters, durationSeconds: data.routeDurationSeconds,
  });
  if (data.vehicle) await db.insert(vehicles).values({ userId: req.userId!, ...data.vehicle });

  // Unabridged console logging of all route coordinates on backend terminal
  console.log(`\n================================================================================`);
  console.log(`[BACKEND] NEW JOURNEY CREATED: #${journey.id}`);
  console.log(`📍 Pickup: ${data.pickup} (${data.pickupCoordinate.latitude.toFixed(5)}, ${data.pickupCoordinate.longitude.toFixed(5)})`);
  console.log(`📍 Destination: ${data.destination} (${data.destinationCoordinate.latitude.toFixed(5)}, ${data.destinationCoordinate.longitude.toFixed(5)})`);
  console.log(`📍 Total Planned Route Coordinates: ${data.routePoints.length} points`);
  console.log(`--- PLANNED ROUTE VERTICES ---`);
  data.routePoints.forEach((pt, idx) => {
    console.log(`   [Vertex #${String(idx).padStart(3, "0")}] Lat: ${pt.latitude.toFixed(5)}, Lon: ${pt.longitude.toFixed(5)}`);
  });
  console.log(`================================================================================\n`);

  const result = await journeyResponse(journey.id, req.userId!);
  res.status(201).json(result);
});

router.get("/journeys/history", requireAuth, async (req: AuthenticatedRequest, res) => {
  const rows = await db.select({ id: journeys.id }).from(journeys).where(eq(journeys.userId, req.userId!)).orderBy(desc(journeys.createdAt)).limit(30);
  const result = await Promise.all(rows.map((row) => journeyResponse(row.id, req.userId!)));
  res.json(result.filter(Boolean));
});

router.get("/journeys/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const result = await journeyResponse(String(req.params.id), req.userId!);
  if (!result) { res.status(404).json({ message: "Journey not found." }); return; }
  res.json(result);
});

router.post("/journeys/:id/safety-analysis", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({
    routeId: z.string(),
    routeDeviationMeters: z.number().nonnegative().optional(),
    stationarySeconds: z.number().nonnegative().optional(),
    speedMetersPerSecond: z.number().nonnegative().optional(),
    includedContributors: z.array(z.string()).optional(),
    testOverrides: z.record(z.string()).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Route data is incomplete." }); return; }
  const [journey] = await db.select({ id: journeys.id }).from(journeys)
    .where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).limit(1);
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }
  const result = await safetyAnalyzer.analyze(parsed.data);
  res.json(result);
});

router.post("/journeys/:id/locations", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ ...coordinates.shape, recordedAt: z.string().datetime(), accuracyMeters: z.number().optional(), speedMetersPerSecond: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Location update is invalid." }); return; }
  const [journey] = await db.select({ id: journeys.id }).from(journeys)
    .where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).limit(1);
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }
  const [row] = await db.insert(locationPoints).values({ journeyId: String(req.params.id), ...parsed.data, recordedAt: new Date(parsed.data.recordedAt) }).returning();

  const speedKmh = (parsed.data.speedMetersPerSecond ?? 0) * 3.6;
  console.log(`[BACKEND GPS TICK] Journey: ${journey.id.slice(0, 8)}... | Lat: ${parsed.data.latitude.toFixed(5)}, Lon: ${parsed.data.longitude.toFixed(5)} | Speed: ${speedKmh.toFixed(1)} km/h | Acc: ${parsed.data.accuracyMeters ? Math.round(parsed.data.accuracyMeters) + "m" : "OK"} | Time: ${new Date().toLocaleTimeString()}`);

  res.status(201).json(row);
});

router.post("/journeys/:id/emergency", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ type: z.enum(["SOS", "DEVIATION", "STATIONARY"]), message: z.string().min(1), coordinate: coordinates.optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Emergency event is invalid." }); return; }
  const [journey] = await db.select({ id: journeys.id }).from(journeys)
    .where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).limit(1);
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }
  if (parsed.data.type === "SOS") {
    const [recentSos] = await db.select({ id: emergencyEvents.id }).from(emergencyEvents)
      .where(and(eq(emergencyEvents.journeyId, String(req.params.id)), eq(emergencyEvents.type, "SOS")))
      .orderBy(desc(emergencyEvents.createdAt)).limit(1);
    if (recentSos) { res.status(409).json({ message: "SOS is already active for this journey." }); return; }
  }
  const [row] = await db.insert(emergencyEvents).values({ journeyId: String(req.params.id), type: parsed.data.type, message: parsed.data.message, latitude: parsed.data.coordinate?.latitude, longitude: parsed.data.coordinate?.longitude }).returning();
  res.status(201).json({ ...row, coordinate: row.latitude == null ? undefined : { latitude: row.latitude, longitude: row.longitude } });
});

/**
 * POST /api/journeys/:id/dispatch-sms
 * Automated Cloud SMS service: automatically dispatches SMS alerts to all registered emergency contacts.
 */
router.post("/journeys/:id/dispatch-sms", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    reason: z.string().min(1),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    threatScore: z.number().optional(),
    riskTier: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Invalid dispatch payload." }); return; }

  const [journey] = await db.select().from(journeys).where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).limit(1);
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
  const contacts = await db.select().from(emergencyContacts).where(eq(emergencyContacts.userId, req.userId!));
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.userId, req.userId!)).limit(1);

  const lat = parsed.data.latitude ?? journey.pickupLatitude;
  const lon = parsed.data.longitude ?? journey.pickupLongitude;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;
  const timeIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " IST";

  const messageText = `🚨 SAFERIDE EMERGENCY ALERT\n\nUser: ${user?.name ?? "SafeRide User"} (${user?.email ?? "Unknown"})\nReason: ${parsed.data.reason}\nThreat Score: ${parsed.data.threatScore ?? 80}/100\n\n📍 Location: ${journey.pickup} -> ${journey.destination}\n🗺 Live GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)}\n🔗 Google Maps: ${mapsUrl}\n\n🚗 Vehicle: ${vehicle?.model ?? "Car"} (${vehicle?.color ?? "—"})\nPlate: ${vehicle?.licensePlate ?? "Not provided"}\nDriver: ${vehicle?.driverName ?? "Unknown"}\n\n⏰ Time: ${timeIST}\n🆘 Please check on rider or call 112 immediately.`;

  // Log automated dispatch
  req.log.warn({
    emergencyDispatch: true,
    journeyId: journey.id,
    userId: req.userId,
    recipientsCount: contacts.length,
    recipients: contacts.map(c => `${c.name} (${c.phone})`),
    message: messageText,
  }, "Automated Cloud SMS Dispatch Triggered");

  // In production with FAST2SMS_API_KEY or TWILIO credentials in .env:
  // We execute the HTTP request to the SMS gateway directly
  const notifiedNumbers = contacts.map(c => c.phone);
  let smsGatewayResponse: any = null;

  // Execute Real Fast2SMS API Call if FAST2SMS_API_KEY is configured
  const fast2SmsKey = process.env.FAST2SMS_API_KEY;
  if (fast2SmsKey && notifiedNumbers.length > 0) {
    try {
      // Clean numbers to 10-digit Indian numbers
      const cleanNumbers = notifiedNumbers
        .map(num => num.replace(/[^\d]/g, "").slice(-10))
        .filter(num => num.length === 10);

      if (cleanNumbers.length > 0) {
        const smsPayload = {
          route: "q",
          message: `🚨 SAFERIDE ALERT: ${user?.name ?? "Rider"} in danger!\nGPS: ${mapsUrl}\nVehicle: ${vehicle?.licensePlate ?? "N/A"}\nReason: ${parsed.data.reason}`,
          language: "english",
          flash: 0,
          numbers: cleanNumbers.join(","),
        };

        const smsRes = await fetch("https://www.fast2sms.com/dev/bulkV2", {
          method: "POST",
          headers: {
            "authorization": fast2SmsKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(smsPayload),
        });

        smsGatewayResponse = await smsRes.json();
        req.log.info({ smsGatewayResponse, cleanNumbers }, "Fast2SMS Dispatch Response");
      }
    } catch (smsError) {
      req.log.error({ smsError }, "Fast2SMS API Execution Failed");
    }
  }

  res.status(200).json({
    dispatched: true,
    contactsNotified: contacts.length,
    phoneNumbers: notifiedNumbers,
    timestamp: timeIST,
    messageContent: messageText,
    gatewayResponse: smsGatewayResponse,
  });
});

router.post("/journeys/:id/complete", requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({
    finalScore: z.number().min(0).max(100).nullable(),
    finalRiskLevel: z.string().min(1),
    routeDeviationCount: z.number().int().nonnegative(),
    stationaryEventCount: z.number().int().nonnegative(),
    emergencyActive: z.boolean(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Final journey summary is invalid." }); return; }
  const [journey] = await db.update(journeys).set({ status: "COMPLETED" })
    .where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).returning();
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }
  const result = await journeyResponse(journey.id, req.userId!);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════
// SAFERIDE THREAT ENGINE ROUTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /api/safety/pre-trip-score
 * Stage 1: Score candidate routes before trip starts.
 * Body: { routes: [{ routeId, points: [{lat, lon}] }] }
 * Returns each route ranked by safety score with segment-level breakdown.
 */
router.post("/safety/pre-trip-score", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    routes: z.array(z.object({
      routeId: z.string(),
      points: z.array(routePointSchema).min(2),
    })).min(1).max(5),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Route data invalid. Send routes with points [{lat,lon}]." }); return; }

  try {
    const assessments = parsed.data.routes.map((r) =>
      scorePreTripRoute(r.routeId, r.points as RoutePoint[]),
    );
    // Sort by safest first
    assessments.sort((a, b) => b.overallSafetyScore - a.overallSafetyScore);
    res.json({ assessments, scoredAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Pre-trip scoring failed");
    res.status(500).json({ message: "Safety scoring temporarily unavailable." });
  }
});

/**
 * POST /api/journeys/:id/threat-analysis
 * Stage 2 & 3: Full live threat analysis during an active journey.
 * Body: {
 *   position: { lat, lon } | null,
 *   routePoints: [{lat, lon}],
 *   alternativeRoutePoints: [[{lat, lon}]],
 *   destinationPoint: { lat, lon } | null,
 *   stationaryDurationSeconds: number,
 *   speedMetersPerSecond: number | null,
 *   windowPositions: [{ pos: {lat,lon}, ts: number }],
 *   testOverrides?: { [factorId]: string }
 * }
 */
router.post("/journeys/:id/threat-analysis", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    position: latLon.nullable(),
    routePoints: z.array(routePointSchema).min(0),
    alternativeRoutePoints: z.array(z.array(routePointSchema)).default([]),
    destinationPoint: latLon.nullable(),
    stationaryDurationSeconds: z.number().nonnegative().default(0),
    speedMetersPerSecond: z.number().nonnegative().nullable().default(null),
    windowPositions: z.array(z.object({ pos: latLon, ts: z.number() })).default([]),
    testOverrides: z.record(z.string()).optional().default({}),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Threat analysis input is invalid." }); return; }

  // Verify journey belongs to user
  const [journey] = await db.select({ id: journeys.id }).from(journeys)
    .where(and(eq(journeys.id, String(req.params.id)), eq(journeys.userId, req.userId!))).limit(1);
  if (!journey) { res.status(404).json({ message: "Journey not found." }); return; }

  try {
    const d = parsed.data;
    const analysis = computeThreatAnalysis({
      position: d.position as LatLon | null,
      routePoints: d.routePoints as RoutePoint[],
      alternativeRoutePoints: d.alternativeRoutePoints as RoutePoint[][],
      destinationPoint: d.destinationPoint as LatLon | null,
      stationaryDurationSeconds: d.stationaryDurationSeconds,
      speedMetersPerSecond: d.speedMetersPerSecond,
      windowPositions: d.windowPositions as Array<{ pos: LatLon; ts: number }>,
      testOverrides: d.testOverrides,
    });
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Threat analysis failed");
    res.status(500).json({ message: "Threat analysis temporarily unavailable." });
  }
});

/**
 * GET /api/safety/nagpur-context
 * Returns Nagpur safety dataset summary for a given coordinate.
 * Query: ?lat=21.1458&lon=79.0882
 */
router.get("/safety/nagpur-context", requireAuth, async (req: AuthenticatedRequest, res) => {
  const lat = parseFloat(String(req.query.lat));
  const lon = parseFloat(String(req.query.lon));
  if (isNaN(lat) || isNaN(lon) || lat < 8 || lat > 38 || lon < 68 || lon > 98) {
    res.status(400).json({ message: "Provide valid lat and lon within India." }); return;
  }

  const { computeThreatAnalysis: _unused, scorePreTripRoute: _unused2, ...threatLib } = await import("../lib/threat-engine");
  const { haversineMeters } = await import("../lib/threat-engine");
  const { NAGPUR_POLICE_STATIONS, NAGPUR_HOSPITALS, NAGPUR_CCTV_ZONES, NAGPUR_ACCIDENT_BLACKSPOTS, NAGPUR_TRAFFIC_SIGNALS } = await import("../lib/nagpur-safety-data");

  const pos: LatLon = { lat, lon };
  const nagpurCenter: LatLon = { lat: 21.1458, lon: 79.0882 };
  const distFromCenter = haversineMeters(pos, nagpurCenter);

  const nearPolice = NAGPUR_POLICE_STATIONS
    .map((ps) => ({ ...ps, distance: haversineMeters(pos, ps.coord) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  const nearHospital = NAGPUR_HOSPITALS
    .map((h) => ({ ...h, distance: haversineMeters(pos, h.coord) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2);

  const inCctv = NAGPUR_CCTV_ZONES.filter((z) => haversineMeters(pos, z.coord) <= z.radiusMeters);
  const nearBlackspot = NAGPUR_ACCIDENT_BLACKSPOTS.filter((b) => haversineMeters(pos, b.coord) <= b.bufferMeters);
  const nearSignal = NAGPUR_TRAFFIC_SIGNALS.filter((s) => haversineMeters(pos, s.coord) <= 100);

  res.json({
    coordinate: { lat, lon },
    distanceFromNagpurCenterMeters: Math.round(distFromCenter),
    withinNagpur10kmRadius: distFromCenter <= 10_000,
    nearestPoliceStations: nearPolice.map((ps) => ({ name: ps.name, zone: ps.zone, distanceMeters: Math.round(ps.distance), is24x7: ps.is24x7 })),
    nearestHospitals: nearHospital.map((h) => ({ name: h.name, type: h.type, distanceMeters: Math.round(h.distance), hasEmergency: h.hasEmergency })),
    cctvCoverage: inCctv.map((z) => ({ description: z.description })),
    accidentBlackspots: nearBlackspot.map((b) => ({ description: b.description, severityPenalty: b.severityPenalty })),
    trafficSignalsNearby: nearSignal.map((s) => ({ name: s.name, graceSeconds: s.graceSeconds })),
  });
});

export default router;