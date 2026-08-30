import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, users, emergencyContacts, vehicles, journeys, journeyRoutes, locationPoints, emergencyEvents } from "@workspace/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import healthRouter from "./health";
import { createToken, publicUser, requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { RuleBasedSafetyAnalyzer } from "../lib/safety";

const router: IRouter = Router();
const safetyAnalyzer = new RuleBasedSafetyAnalyzer();

const coordinates = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const contactSchema = z.object({ name: z.string().min(2), phone: z.string().min(7), relationship: z.string().optional() });
const registerSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

router.use(healthRouter);

router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Please provide a name, valid email, and password of at least 8 characters." }); return; }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
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
  return {
    id: journey.id, pickup: journey.pickup, destination: journey.destination,
    pickupPlaceId: journey.pickupPlaceId ?? undefined, destinationPlaceId: journey.destinationPlaceId ?? undefined,
    pickupCoordinate: { latitude: journey.pickupLatitude, longitude: journey.pickupLongitude },
    destinationCoordinate: { latitude: journey.destinationLatitude, longitude: journey.destinationLongitude },
     selectedRouteId: journey.selectedRouteId ?? undefined,
     routeDistanceMeters: journey.routeDistanceMeters, routeDurationSeconds: journey.routeDurationSeconds,
     status: journey.status, createdAt: journey.createdAt.toISOString(),
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

export default router;