/**
 * NAGPUR THREAT SCORE ENGINE — Deterministic Rule-Based Safety Scoring
 *
 * Three permanent algorithms (as per synopsis):
 *   Algorithm 1 (A1): Spatial Safety Scorer — rates coordinates against Nagpur POI dataset
 *   Algorithm 2 (A2): Trajectory / Deviation Classifier
 *   Algorithm 3 (A3): Multi-Factor Threat Fusion → Safety Score + Tier
 *
 * NO machine learning. All weights and thresholds are configurable here.
 *
 * Formula:
 *   T (Threat Score 0–100) = Σ(w_i × p_i) / Σ(w_i) × 100
 *   S (Safety Score 0–100) = 100 - T
 */

import {
  NAGPUR_POLICE_STATIONS,
  NAGPUR_HOSPITALS,
  NAGPUR_TRAFFIC_SIGNALS,
  NAGPUR_ACCIDENT_BLACKSPOTS,
  NAGPUR_CCTV_ZONES,
  NAGPUR_LIGHTING_CORRIDORS,
  THREAT_WEIGHTS,
  THREAT_TIERS,
  type ThreatTier,
} from "./nagpur-safety-data";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LatLon = { lat: number; lon: number };

export type RoutePoint = { lat: number; lon: number; sequence?: number };

/** Deviation classification from Stage 2 Algorithm */
export type DeviationClass =
  | "ON_ROUTE"           // p = 0.00 — within 50m of planned route
  | "MINOR"              // p = 0.20 — 50–150m, brief GPS stray
  | "LEGITIMATE_REROUTE" // p = 0.15 — matches alternative route / moving toward dest
  | "TRAFFIC_BYPASS"     // p = 0.20 — parallel movement toward destination
  | "SUSPICIOUS"         // p = 0.85 — away from destination, no matching route
  | "UNKNOWN";           // p = 0.10 — GPS unavailable or first fix

/** Stationary classification from Stage 2 Algorithm */
export type StationaryClass =
  | "MOVING"              // v > 5 km/h → p = 0.00
  | "TRAFFIC_STOP"        // at signal ≤ graceSeconds → p = 0.00
  | "BRIEF_HALT"          // < 90s, not at signal → p = 0.20
  | "STATIONARY"          // 90–180s → p = 0.50
  | "PROLONGED"           // 180–300s → p = 0.75
  | "CRITICAL_STAGNATION" // > 300s → p = 1.00

/** One factor's contribution to the threat score */
export type ThreatFactor = {
  id: string;
  label: string;
  state: string;
  penalty: number;        // 0.0–1.0
  weight: number;
  contribution: number;   // penalty × weight (before normalization)
  source: "LIVE" | "SPATIAL" | "TEMPORAL" | "TEST" | "UNAVAILABLE";
  detail?: string;        // human-readable explanation
};

/** Full threat analysis result */
export type ThreatAnalysis = {
  threatScore: number;      // 0–100 (higher = more dangerous)
  safetyScore: number;      // 0–100 (higher = safer)
  tier: ThreatTier;
  tierLabel: string;
  action: string;
  factors: ThreatFactor[];
  generatedAt: string;
  nagpurContextActive: boolean;
  // Deviation & stationary state for UI
  deviationClass: DeviationClass;
  stationaryClass: StationaryClass;
  stationaryDurationSeconds: number;
  deviationMeters: number | null;
  nearestPoliceMeters: number | null;
  nearestHospitalMeters: number | null;
  insideCctvCoverage: boolean;
  lightingStatus: string;
  nearBlackspot: boolean;
};

/** Inputs required for a full threat analysis */
export type ThreatInputs = {
  position: LatLon | null;
  routePoints: RoutePoint[];
  alternativeRoutePoints: RoutePoint[][];
  destinationPoint: LatLon | null;
  stationaryDurationSeconds: number;
  speedMetersPerSecond: number | null;
  windowPositions: Array<{ pos: LatLon; ts: number }>; // last 5 GPS readings
  testOverrides?: Partial<Record<string, string>>;      // manual test controls
};

// ─── A1: Spatial Safety Functions ────────────────────────────────────────────

/** Haversine great-circle distance in meters */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Find distance to nearest police station from a coordinate */
function nearestPoliceMeters(pos: LatLon): { meters: number; name: string } {
  let best = { meters: Infinity, name: "" };
  for (const ps of NAGPUR_POLICE_STATIONS) {
    const d = haversineMeters(pos, ps.coord);
    if (d < best.meters) best = { meters: d, name: ps.name };
  }
  return best;
}

/** Find distance to nearest hospital from a coordinate */
function nearestHospitalMeters(pos: LatLon): { meters: number; name: string } {
  let best = { meters: Infinity, name: "" };
  for (const h of NAGPUR_HOSPITALS) {
    const d = haversineMeters(pos, h.coord);
    if (d < best.meters) best = { meters: d, name: h.name };
  }
  return best;
}

/** Check if inside any CCTV surveillance zone bubble */
function isInsideCctvZone(pos: LatLon): { covered: boolean; zoneName: string } {
  for (const z of NAGPUR_CCTV_ZONES) {
    if (haversineMeters(pos, z.coord) <= z.radiusMeters) {
      return { covered: true, zoneName: z.description };
    }
  }
  return { covered: false, zoneName: "" };
}

/** Check if near any accident blackspot */
function nearestBlackspot(pos: LatLon): { near: boolean; penalty: number; description: string } {
  for (const b of NAGPUR_ACCIDENT_BLACKSPOTS) {
    if (haversineMeters(pos, b.coord) <= b.bufferMeters) {
      return { near: true, penalty: b.severityPenalty, description: b.description };
    }
  }
  return { near: false, penalty: 0, description: "" };
}

/** Determine lighting penalty from lighting corridor bounding boxes */
function lightingPenalty(pos: LatLon): { penalty: number; label: string; roadName: string } {
  for (const c of NAGPUR_LIGHTING_CORRIDORS) {
    const bb = c.bbox;
    if (
      pos.lat >= bb.minLat && pos.lat <= bb.maxLat &&
      pos.lon >= bb.minLon && pos.lon <= bb.maxLon
    ) {
      return { penalty: c.penalty, label: c.litStatus.replace("_", " ").toUpperCase(), roadName: c.roadName };
    }
  }
  // Default: outside defined corridors — treat as partial
  return { penalty: 0.30, label: "PARTIAL", roadName: "Unknown segment" };
}

/** CCTV / Security penalty from police + CCTV proximity */
function cctvSecurityPenalty(pos: LatLon): { penalty: number; detail: string } {
  const police = nearestPoliceMeters(pos);
  const cctv = isInsideCctvZone(pos);
  if (cctv.covered) return { penalty: 0.00, detail: `CCTV: ${cctv.zoneName}` };
  if (police.meters <= 300) return { penalty: 0.05, detail: `Police station within ${Math.round(police.meters)}m: ${police.name}` };
  if (police.meters <= 800) return { penalty: 0.30, detail: `Police station ${Math.round(police.meters)}m away` };
  if (police.meters <= 1500) return { penalty: 0.55, detail: `Nearest police ~${Math.round(police.meters / 1000 * 10) / 10}km` };
  return { penalty: 0.85, detail: `Isolated — nearest help > 1.5km (${police.name})` };
}

/** Time-of-day context penalty (IST) */
function timeContextPenalty(): { penalty: number; label: string } {
  const istHour = (new Date().getUTCHours() + 5.5) % 24; // IST = UTC+5:30
  if (istHour >= 6 && istHour < 20) return { penalty: 0.00, label: "DAYTIME" };
  if (istHour >= 20 && istHour < 22.5) return { penalty: 0.25, label: "EVENING" };
  return { penalty: 0.75, label: "LATE NIGHT" };          // 22:30 – 05:59
}

/** Road hierarchy penalty (inferred from position relative to known arterials) */
function roadHierarchyPenalty(pos: LatLon): { penalty: number; label: string } {
  // Check if on a well-lit arterial (proxy for road hierarchy)
  const lit = lightingPenalty(pos);
  if (lit.label === "WELL LIT") return { penalty: 0.00, label: "PRIMARY ARTERIAL" };
  if (lit.label === "PARTIAL") return { penalty: 0.25, label: "SECONDARY STREET" };
  return { penalty: 0.75, label: "ISOLATED / LANE" };
}

// ─── A2: Stationary Detection ─────────────────────────────────────────────────

/** Check if position is within grace distance of a known traffic signal */
function nearTrafficSignal(pos: LatLon): { near: boolean; graceSeconds: number; name: string } {
  for (const s of NAGPUR_TRAFFIC_SIGNALS) {
    if (haversineMeters(pos, s.coord) <= 60) { // 60m radius of signal
      return { near: true, graceSeconds: s.graceSeconds, name: s.name };
    }
  }
  return { near: false, graceSeconds: 0, name: "" };
}

/** Classify and penalize stationary condition */
export function classifyStationary(
  pos: LatLon | null,
  stationarySeconds: number,
  speedMps: number | null,
): { class: StationaryClass; penalty: number; detail: string } {
  const speedKmh = speedMps != null ? speedMps * 3.6 : null;

  if (pos === null || speedMps === null) {
    return { class: "MOVING", penalty: 0.0, detail: "GPS not yet available" };
  }

  if (speedKmh !== null && speedKmh > 5) {
    return { class: "MOVING", penalty: 0.0, detail: `Moving at ${speedKmh.toFixed(1)} km/h` };
  }

  // Not moving — check if at a known signal
  const signal = nearTrafficSignal(pos);
  if (signal.near && stationarySeconds <= signal.graceSeconds) {
    return {
      class: "TRAFFIC_STOP",
      penalty: 0.00,
      detail: `Normal signal stop at ${signal.name} (${stationarySeconds}s / max ${signal.graceSeconds}s)`,
    };
  }

  // Not at signal — penalize by duration
  if (stationarySeconds < 90) {
    return { class: "BRIEF_HALT", penalty: 0.20, detail: `Brief stop for ${stationarySeconds}s` };
  }
  if (stationarySeconds < 180) {
    return { class: "STATIONARY", penalty: 0.50, detail: `Stationary for ${stationarySeconds}s — monitoring` };
  }
  if (stationarySeconds < 300) {
    return { class: "PROLONGED", penalty: 0.75, detail: `Prolonged stop: ${Math.round(stationarySeconds / 60)} min — alert imminent` };
  }
  return {
    class: "CRITICAL_STAGNATION",
    penalty: 1.00,
    detail: `Critical stagnation: ${Math.round(stationarySeconds / 60)} min with no movement`,
  };
}

// ─── A2: Deviation Classifier ─────────────────────────────────────────────────

/** Perpendicular distance (meters) from point to a route polyline segment */
function pointToSegmentMeters(p: LatLon, a: LatLon, b: LatLon): number {
  const latScale = 111_320;
  const lonScale = Math.cos((p.lat * Math.PI) / 180) * latScale;
  const px = p.lon * lonScale; const py = p.lat * latScale;
  const ax = a.lon * lonScale; const ay = a.lat * latScale;
  const bx = b.lon * lonScale; const by = b.lat * latScale;
  const dx = bx - ax; const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum perpendicular distance from a point to any segment of a route */
function minDistToRoute(pos: LatLon, route: RoutePoint[]): number {
  if (route.length < 2) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const d = pointToSegmentMeters(pos, route[i], route[i + 1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/** Check if rider is making progress toward destination */
function movingTowardDestination(
  window: Array<{ pos: LatLon; ts: number }>,
  dest: LatLon,
): boolean {
  if (window.length < 2) return true; // assume yes if insufficient data
  const oldest = window[0].pos;
  const newest = window[window.length - 1].pos;
  const dOld = haversineMeters(oldest, dest);
  const dNew = haversineMeters(newest, dest);
  return dNew < dOld - 10; // must be at least 10m closer
}

/**
 * A2: Classify deviation state
 * Returns the class and penalty for the route deviation factor
 */
export function classifyDeviation(
  pos: LatLon | null,
  routePoints: RoutePoint[],
  alternativeRoutes: RoutePoint[][],
  destination: LatLon | null,
  window: Array<{ pos: LatLon; ts: number }>,
): { class: DeviationClass; penalty: number; deviationMeters: number | null; detail: string } {
  if (pos === null) return { class: "UNKNOWN", penalty: 0.10, deviationMeters: null, detail: "Waiting for GPS fix" };
  if (routePoints.length < 2) return { class: "UNKNOWN", penalty: 0.10, deviationMeters: null, detail: "Route not loaded" };

  const d = minDistToRoute(pos, routePoints);

  // On planned route
  if (d <= 50) return { class: "ON_ROUTE", penalty: 0.00, deviationMeters: Math.round(d), detail: `On planned route (${Math.round(d)}m from path)` };

  // Check if matches an alternative route
  for (const alt of alternativeRoutes) {
    if (minDistToRoute(pos, alt) <= 60) {
      return {
        class: "LEGITIMATE_REROUTE",
        penalty: 0.15,
        deviationMeters: Math.round(d),
        detail: `Following alternative route (${Math.round(d)}m from original)`,
      };
    }
  }

  // Minor deviation (50–150m) — check if moving toward destination
  if (d <= 150) {
    if (destination && movingTowardDestination(window, destination)) {
      return {
        class: "TRAFFIC_BYPASS",
        penalty: 0.20,
        deviationMeters: Math.round(d),
        detail: `Traffic bypass — heading toward destination (${Math.round(d)}m off route)`,
      };
    }
    return { class: "MINOR", penalty: 0.30, deviationMeters: Math.round(d), detail: `Minor deviation ${Math.round(d)}m — monitoring` };
  }

  // Significant deviation (> 150m)
  if (destination && movingTowardDestination(window, destination)) {
    return {
      class: "TRAFFIC_BYPASS",
      penalty: 0.30,
      deviationMeters: Math.round(d),
      detail: `Large bypass (${Math.round(d)}m) but progressing toward destination`,
    };
  }

  return {
    class: "SUSPICIOUS",
    penalty: 0.90,
    deviationMeters: Math.round(d),
    detail: `Suspicious — ${Math.round(d)}m off route, not heading to destination`,
  };
}

// ─── A3: Multi-Factor Threat Fusion ──────────────────────────────────────────

const PENALTY_OVERRIDES: Record<string, number> = {
  // Deviation overrides
  on_route: 0.00, minor: 0.30, legitimate_reroute: 0.15, traffic_bypass: 0.20, suspicious: 0.90,
  // Stationary overrides
  moving: 0.00, traffic_stop: 0.00, brief_halt: 0.20, stationary: 0.50, prolonged: 0.75, critical_stagnation: 1.00,
  // Environment overrides
  well_lit: 0.00, partial: 0.35, unlit: 0.85,
  covered: 0.00, available: 0.30, unavailable: 0.85,
  normal: 0.00, low: 0.00, medium: 0.45, high: 0.85, critical: 1.00,
  safe: 0.00, unsafe: 0.85,
  daytime: 0.00, evening: 0.25, late_night: 0.75,
};

function penaltyFromOverride(value: string): number {
  const key = value.toLowerCase().replace(/\s+/g, "_");
  return PENALTY_OVERRIDES[key] ?? 0.30;
}

/** A3: Compute the complete threat analysis */
export function computeThreatAnalysis(inputs: ThreatInputs): ThreatAnalysis {
  const { position, routePoints, alternativeRoutePoints, destinationPoint,
    stationaryDurationSeconds, speedMetersPerSecond, windowPositions, testOverrides = {} } = inputs;

  // ── Compute algorithmic states ──────────────────────────────────────────────
  const deviationResult = classifyDeviation(position, routePoints, alternativeRoutePoints, destinationPoint, windowPositions);
  const stationaryResult = classifyStationary(position, stationaryDurationSeconds, speedMetersPerSecond);
  const timeResult = timeContextPenalty();

  const spatialResults = position ? {
    police: nearestPoliceMeters(position),
    hospital: nearestHospitalMeters(position),
    cctv: cctvSecurityPenalty(position),
    lighting: lightingPenalty(position),
    blackspot: nearestBlackspot(position),
    roadClass: roadHierarchyPenalty(position),
  } : null;

  // ── Build factor list ───────────────────────────────────────────────────────
  const factors: ThreatFactor[] = [];

  // Factor 1: Route Deviation
  const devOverride = testOverrides["routeDeviation"];
  const devPenalty = devOverride ? penaltyFromOverride(devOverride) : deviationResult.penalty;
  factors.push({
    id: "routeDeviation",
    label: "Route Deviation",
    state: devOverride ? devOverride.replace(/_/g, " ").toUpperCase() : deviationResult.class.replace(/_/g, " "),
    penalty: devPenalty,
    weight: THREAT_WEIGHTS.routeDeviation,
    contribution: THREAT_WEIGHTS.routeDeviation * devPenalty,
    source: devOverride ? "TEST" : deviationResult.class === "UNKNOWN" ? "UNAVAILABLE" : "LIVE",
    detail: devOverride ? `TEST override: ${devOverride}` : deviationResult.detail,
  });

  // Factor 2: Stationary Condition
  const statOverride = testOverrides["stationaryCondition"];
  const statPenalty = statOverride ? penaltyFromOverride(statOverride) : stationaryResult.penalty;
  factors.push({
    id: "stationaryCondition",
    label: "Stationary Condition",
    state: statOverride ? statOverride.replace(/_/g, " ").toUpperCase() : stationaryResult.class.replace(/_/g, " "),
    penalty: statPenalty,
    weight: THREAT_WEIGHTS.stationaryCondition,
    contribution: THREAT_WEIGHTS.stationaryCondition * statPenalty,
    source: statOverride ? "TEST" : position ? "LIVE" : "UNAVAILABLE",
    detail: statOverride ? `TEST override: ${statOverride}` : stationaryResult.detail,
  });

  // Factor 3: Street Lighting
  const litOverride = testOverrides["streetLighting"];
  const litData = spatialResults ? spatialResults.lighting : { penalty: 0.30, label: "UNKNOWN", roadName: "" };
  const litPenalty = litOverride ? penaltyFromOverride(litOverride) : litData.penalty;
  factors.push({
    id: "streetLighting",
    label: "Street Lighting",
    state: litOverride ? litOverride.replace(/_/g, " ").toUpperCase() : litData.label,
    penalty: litPenalty,
    weight: THREAT_WEIGHTS.streetLighting,
    contribution: THREAT_WEIGHTS.streetLighting * litPenalty,
    source: litOverride ? "TEST" : spatialResults ? "SPATIAL" : "UNAVAILABLE",
    detail: litData.roadName || undefined,
  });

  // Factor 4: CCTV / Security
  const cctvOverride = testOverrides["cctvSecurity"];
  const cctvData = spatialResults ? spatialResults.cctv : { penalty: 0.60, detail: "Spatial data not loaded" };
  const cctvPenalty = cctvOverride ? penaltyFromOverride(cctvOverride) : cctvData.penalty;
  factors.push({
    id: "cctvSecurity",
    label: "CCTV & Police Coverage",
    state: cctvOverride ? cctvOverride.replace(/_/g, " ").toUpperCase() : cctvPenalty <= 0.05 ? "COVERED" : cctvPenalty <= 0.30 ? "NEARBY" : cctvPenalty <= 0.55 ? "PARTIAL" : "ISOLATED",
    penalty: cctvPenalty,
    weight: THREAT_WEIGHTS.cctvSecurity,
    contribution: THREAT_WEIGHTS.cctvSecurity * cctvPenalty,
    source: cctvOverride ? "TEST" : spatialResults ? "SPATIAL" : "UNAVAILABLE",
    detail: cctvData.detail,
  });

  // Factor 5: Accident Blackspot
  const blackOverride = testOverrides["accidentBlackspot"];
  const blackData = spatialResults ? spatialResults.blackspot : { near: false, penalty: 0.00, description: "" };
  const blackPenalty = blackOverride ? penaltyFromOverride(blackOverride) : blackData.penalty;
  factors.push({
    id: "accidentBlackspot",
    label: "Accident Blackspot Zone",
    state: blackOverride ? blackOverride.replace(/_/g, " ").toUpperCase() : blackData.near ? "BLACKSPOT" : "CLEAR",
    penalty: blackPenalty,
    weight: THREAT_WEIGHTS.accidentBlackspot,
    contribution: THREAT_WEIGHTS.accidentBlackspot * blackPenalty,
    source: blackOverride ? "TEST" : spatialResults ? "SPATIAL" : "UNAVAILABLE",
    detail: blackData.description || (blackData.near ? "Inside accident blackspot buffer" : "No blackspot nearby"),
  });

  // Factor 6: Road Hierarchy
  const roadOverride = testOverrides["roadHierarchy"];
  const roadData = spatialResults ? spatialResults.roadClass : { penalty: 0.25, label: "UNKNOWN" };
  const roadPenalty = roadOverride ? penaltyFromOverride(roadOverride) : roadData.penalty;
  factors.push({
    id: "roadHierarchy",
    label: "Road Class / Environment",
    state: roadOverride ? roadOverride.replace(/_/g, " ").toUpperCase() : roadData.label,
    penalty: roadPenalty,
    weight: THREAT_WEIGHTS.roadHierarchy,
    contribution: THREAT_WEIGHTS.roadHierarchy * roadPenalty,
    source: roadOverride ? "TEST" : spatialResults ? "SPATIAL" : "UNAVAILABLE",
  });

  // Factor 7: Time Context
  const timeOverride = testOverrides["timeContext"];
  const timePenalty = timeOverride ? penaltyFromOverride(timeOverride) : timeResult.penalty;
  factors.push({
    id: "timeContext",
    label: "Time & Night Context",
    state: timeOverride ? timeOverride.replace(/_/g, " ").toUpperCase() : timeResult.label,
    penalty: timePenalty,
    weight: THREAT_WEIGHTS.timeContext,
    contribution: THREAT_WEIGHTS.timeContext * timePenalty,
    source: timeOverride ? "TEST" : "TEMPORAL",
    detail: `IST hour-based multiplier`,
  });

  // ── Compute Threat Score ────────────────────────────────────────────────────
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const weightedPenalty = factors.reduce((s, f) => s + f.contribution, 0);
  const rawThreat = totalWeight === 0 ? 0 : (weightedPenalty / totalWeight) * 100;
  const threatScore = Math.max(0, Math.min(100, Math.round(rawThreat)));
  const safetyScore = 100 - threatScore;

  // ── Determine tier ──────────────────────────────────────────────────────────
  let tier: ThreatTier = "low";
  if (threatScore > 65) tier = "critical";
  else if (threatScore > 40) tier = "high";
  else if (threatScore > 20) tier = "medium";

  const tierConfig = THREAT_TIERS[tier];

  return {
    threatScore,
    safetyScore,
    tier,
    tierLabel: tierConfig.label,
    action: tierConfig.action,
    factors,
    generatedAt: new Date().toISOString(),
    nagpurContextActive: position !== null,
    deviationClass: deviationResult.class,
    stationaryClass: stationaryResult.class,
    stationaryDurationSeconds,
    deviationMeters: deviationResult.deviationMeters,
    nearestPoliceMeters: spatialResults ? Math.round(spatialResults.police.meters) : null,
    nearestHospitalMeters: spatialResults ? Math.round(spatialResults.hospital.meters) : null,
    insideCctvCoverage: spatialResults ? spatialResults.cctv.penalty <= 0.05 : false,
    lightingStatus: litOverride ?? litData.label,
    nearBlackspot: spatialResults ? spatialResults.blackspot.near : false,
  };
}

// ─── Pre-Trip Route Scorer (Stage 1 Algorithm) ────────────────────────────────

export type RouteSegmentScore = {
  segmentIndex: number;
  midpoint: LatLon;
  threatScore: number;
  safetyScore: number;
  lighting: string;
  cctvCovered: boolean;
  nearBlackspot: boolean;
  nearPoliceMeters: number;
};

export type PreTripRouteAssessment = {
  routeId: string;
  overallSafetyScore: number;
  overallThreatScore: number;
  riskLabel: "SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS";
  lightingCoverage: number;     // % of route that is well-lit
  cctvCoverage: number;         // % under CCTV
  blackspotCount: number;
  nearestPoliceMeters: number;
  timeContext: string;
  segments: RouteSegmentScore[];
  explanation: string;
};

/** Score a candidate route's pre-trip safety using only spatial + time data */
export function scorePreTripRoute(routeId: string, points: RoutePoint[]): PreTripRouteAssessment {
  if (points.length < 2) {
    return {
      routeId,
      overallSafetyScore: 50,
      overallThreatScore: 50,
      riskLabel: "MODERATE",
      lightingCoverage: 0,
      cctvCoverage: 0,
      blackspotCount: 0,
      nearestPoliceMeters: 9999,
      timeContext: "UNKNOWN",
      segments: [],
      explanation: "Route too short to assess.",
    };
  }

  const timeCtx = timeContextPenalty();
  const segments: RouteSegmentScore[] = [];

  // Sample midpoints of consecutive segments (every 2 route points)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const mid: LatLon = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };

    const lit = lightingPenalty(mid);
    const cctv = isInsideCctvZone(mid);
    const blackspot = nearestBlackspot(mid);
    const police = nearestPoliceMeters(mid);

    // Segment threat score uses only spatial + time (no GPS movement factors)
    const segThreat =
      (THREAT_WEIGHTS.streetLighting * lit.penalty +
       THREAT_WEIGHTS.cctvSecurity * (cctv.covered ? 0.00 : police.meters <= 800 ? 0.30 : 0.70) +
       THREAT_WEIGHTS.accidentBlackspot * blackspot.penalty +
       THREAT_WEIGHTS.roadHierarchy * (lit.label === "WELL LIT" ? 0.00 : lit.label === "PARTIAL" ? 0.25 : 0.75) +
       THREAT_WEIGHTS.timeContext * timeCtx.penalty) /
      (THREAT_WEIGHTS.streetLighting + THREAT_WEIGHTS.cctvSecurity +
       THREAT_WEIGHTS.accidentBlackspot + THREAT_WEIGHTS.roadHierarchy +
       THREAT_WEIGHTS.timeContext) * 100;

    segments.push({
      segmentIndex: i,
      midpoint: mid,
      threatScore: Math.round(segThreat),
      safetyScore: 100 - Math.round(segThreat),
      lighting: lit.label,
      cctvCovered: cctv.covered,
      nearBlackspot: blackspot.near,
      nearPoliceMeters: Math.round(police.meters),
    });
  }

  const avgThreat = segments.reduce((s, seg) => s + seg.threatScore, 0) / segments.length;
  const overallThreat = Math.round(avgThreat);
  const overallSafety = 100 - overallThreat;

  const litCount = segments.filter(s => s.lighting === "WELL LIT").length;
  const cctvCount = segments.filter(s => s.cctvCovered).length;
  const bsCount = segments.filter(s => s.nearBlackspot).length;
  const minPolice = Math.min(...segments.map(s => s.nearPoliceMeters));

  const riskLabel: PreTripRouteAssessment["riskLabel"] =
    overallThreat <= 20 ? "SAFE" :
    overallThreat <= 40 ? "MODERATE" :
    overallThreat <= 65 ? "HIGH_RISK" : "DANGEROUS";

  const explanationParts: string[] = [];
  if (litCount === segments.length) explanationParts.push("Fully lit route");
  else if (litCount === 0) explanationParts.push("No lighting on route");
  else explanationParts.push(`${Math.round((litCount / segments.length) * 100)}% lit`);
  if (cctvCount > segments.length * 0.5) explanationParts.push("Good CCTV coverage");
  if (bsCount > 0) explanationParts.push(`${bsCount} accident blackspot${bsCount > 1 ? "s" : ""} on path`);
  if (minPolice < 500) explanationParts.push("Police station nearby");
  explanationParts.push(timeCtx.label);

  return {
    routeId,
    overallSafetyScore: overallSafety,
    overallThreatScore: overallThreat,
    riskLabel,
    lightingCoverage: Math.round((litCount / segments.length) * 100),
    cctvCoverage: Math.round((cctvCount / segments.length) * 100),
    blackspotCount: bsCount,
    nearestPoliceMeters: minPolice,
    timeContext: timeCtx.label,
    segments,
    explanation: explanationParts.join(" · "),
  };
}
