import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emergencyContacts = pgTable("emergency_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  relationship: text("relationship"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vehicles = pgTable("vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  licensePlate: text("license_plate"),
  driverName: text("driver_name"),
  model: text("model"),
  color: text("color"),
});

export const journeys = pgTable("journeys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  pickup: text("pickup").notNull(),
  destination: text("destination").notNull(),
  pickupPlaceId: text("pickup_place_id"),
  destinationPlaceId: text("destination_place_id"),
  pickupLatitude: doublePrecision("pickup_latitude").notNull(),
  pickupLongitude: doublePrecision("pickup_longitude").notNull(),
  destinationLatitude: doublePrecision("destination_latitude").notNull(),
  destinationLongitude: doublePrecision("destination_longitude").notNull(),
  selectedRouteId: text("selected_route_id"),
  routeDistanceMeters: doublePrecision("route_distance_meters").notNull(),
  routeDurationSeconds: doublePrecision("route_duration_seconds").notNull(),
  status: text("status").notNull().default("PLANNED"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const journeyRoutes = pgTable("journey_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" }).notNull(),
  routeId: text("route_id").notNull(),
  pointsJson: text("points_json").notNull(),
  distanceMeters: doublePrecision("distance_meters").notNull(),
  durationSeconds: doublePrecision("duration_seconds").notNull(),
  traffic: text("traffic"),
  safetyStatus: text("safety_status").notNull().default("PENDING"),
  safetyScore: doublePrecision("safety_score"),
  riskLevel: text("risk_level").notNull().default("UNKNOWN"),
});

export const locationPoints = pgTable("location_points", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" }).notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  accuracyMeters: doublePrecision("accuracy_meters"),
  speedMetersPerSecond: doublePrecision("speed_meters_per_second"),
});

export const emergencyEvents = pgTable("emergency_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const routeDeviationEvents = pgTable("route_deviation_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" }).notNull(),
  classification: text("classification").notNull(),
  distanceMeters: doublePrecision("distance_meters").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stationaryEvents = pgTable("stationary_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "cascade" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  classification: text("classification").notNull(),
  isEmergency: boolean("is_emergency").notNull().default(false),
});