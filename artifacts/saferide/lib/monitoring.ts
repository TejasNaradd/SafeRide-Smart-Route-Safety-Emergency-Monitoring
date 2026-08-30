import type { Coordinate, SafetyAnalysis } from "@workspace/api-client-react";
import type { CandidateRoute } from "./geo";

export type ContributorId =
  | "routeDeviation"
  | "stationaryCondition"
  | "streetLighting"
  | "cctvSecurity"
  | "traffic"
  | "areaRisk"
  | "roadEnvironment"
  | "timeContext"
  | "locationRisk";

export type TestOverrides = Partial<Record<ContributorId, string>>;
export type IncludedContributors = Record<ContributorId, boolean>;

export const CONTRIBUTOR_IDS: ContributorId[] = [
  "routeDeviation",
  "stationaryCondition",
  "streetLighting",
  "cctvSecurity",
  "traffic",
  "areaRisk",
  "roadEnvironment",
  "timeContext",
  "locationRisk",
];

export const CONTRIBUTOR_LABELS: Record<ContributorId, string> = {
  routeDeviation: "Route deviation",
  stationaryCondition: "Stationary condition",
  streetLighting: "Street lighting",
  cctvSecurity: "CCTV / security",
  traffic: "Traffic",
  areaRisk: "Area risk",
  roadEnvironment: "Road / environment",
  timeContext: "Time / context",
  locationRisk: "Overall location risk",
};

export const MONITORING_CONFIG = {
  weights: {
    routeDeviation: 0.35,
    stationaryCondition: 0.2,
    streetLighting: 0.08,
    cctvSecurity: 0.08,
    traffic: 0.09,
    areaRisk: 0.08,
    roadEnvironment: 0.06,
    timeContext: 0.03,
    locationRisk: 0.03,
  } satisfies Record<ContributorId, number>,
  thresholds: {
    minorDeviationMeters: 50,
    significantDeviationMeters: 150,
    stationarySeconds: 120,
    prolongedStationarySeconds: 300,
    lowRiskScore: 80,
    mediumRiskScore: 60,
    highRiskScore: 35,
  },
} as const;

type LocalContributor = {
  id: ContributorId;
  label: string;
  state: string;
  impact: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "NOT_ASSESSED";
  penalty: number;
  included: boolean;
  assessed: boolean;
  source: "LIVE" | "TEST" | "UNAVAILABLE";
};

export type LocalAnalysis = Omit<SafetyAnalysis, "contributors"> & {
  contributors: LocalContributor[];
};

function pointToSegmentDistance(point: Coordinate, a: Coordinate, b: Coordinate) {
  const latitudeScale = 111_320;
  const longitudeScale = Math.cos((point.latitude * Math.PI) / 180) * latitudeScale;
  const px = point.longitude * longitudeScale;
  const py = point.latitude * latitudeScale;
  const ax = a.longitude * longitudeScale;
  const ay = a.latitude * latitudeScale;
  const bx = b.longitude * longitudeScale;
  const by = b.latitude * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const nearestX = ax + ratio * dx;
  const nearestY = ay + ratio * dy;
  return { distance: Math.hypot(px - nearestX, py - nearestY), ratio };
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const latitudeScale = 111_320;
  const longitudeScale = Math.cos((a.latitude * Math.PI) / 180) * latitudeScale;
  return Math.hypot((a.longitude - b.longitude) * longitudeScale, (a.latitude - b.latitude) * latitudeScale);
}

export function routePosition(point: Coordinate | null, route: CandidateRoute | null) {
  if (!point || !route || route.points.length < 2) return { deviationMeters: null, progress: 0, remainingMeters: route?.distance ?? 0 };
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestProgress = 0;
  let travelledAlong = 0;
  let totalGeometry = 0;
  const segmentLengths = route.points.slice(1).map((next, index) => {
    const length = distanceMeters(route.points[index], next);
    totalGeometry += length;
    return length;
  });
  route.points.slice(1).forEach((next, index) => {
    const segment = pointToSegmentDistance(point, route.points[index], next);
    if (segment.distance < nearestDistance) {
      nearestDistance = segment.distance;
      nearestProgress = totalGeometry === 0 ? 0 : (travelledAlong + segmentLengths[index] * segment.ratio) / totalGeometry;
    }
    travelledAlong += segmentLengths[index];
  });
  const progress = Math.max(0, Math.min(1, nearestProgress));
  return { deviationMeters: nearestDistance, progress, remainingMeters: Math.max(0, route.distance * (1 - progress)) };
}

function normalized(value: string | undefined) {
  return value?.toLowerCase().replace(/\s+/g, "_") ?? "";
}

function testPenalty(value: string) {
  const penalties: Record<string, number> = {
    normal: 0, on_route: 0, moving: 0, adequate: 0, available: 0, safe: 0, low: 0,
    moderate: 0.35, minor: 0.3, stationary: 0.35, medium: 0.45,
    poor: 0.75, unavailable: 0.85, heavy: 0.85, high: 0.85, unsafe: 0.85,
    significant: 1, prolonged: 1, critical: 1,
  };
  return penalties[normalized(value)] ?? 0;
}

function impact(penalty: number, assessed: boolean): LocalContributor["impact"] {
  if (!assessed) return "NOT_ASSESSED";
  if (penalty >= 0.8) return "CRITICAL";
  if (penalty >= 0.45) return "HIGH";
  if (penalty > 0) return "MEDIUM";
  return "LOW";
}

function riskForScore(score: number): LocalAnalysis["riskLevel"] {
  if (score < MONITORING_CONFIG.thresholds.highRiskScore) return "CRITICAL";
  if (score < MONITORING_CONFIG.thresholds.mediumRiskScore) return "HIGH";
  if (score < MONITORING_CONFIG.thresholds.lowRiskScore) return "MEDIUM";
  return "LOW";
}

export function computeLocalAnalysis({
  current,
  route,
  stationarySeconds,
  overrides,
  included,
}: {
  current: Coordinate | null;
  route: CandidateRoute | null;
  stationarySeconds: number | null;
  overrides: TestOverrides;
  included: IncludedContributors;
}): LocalAnalysis {
  const position = routePosition(current, route);
  const derived: Record<ContributorId, { state: string; penalty: number; assessed: boolean; source: LocalContributor["source"] }> = {
    routeDeviation: position.deviationMeters == null
      ? { state: "WAITING FOR GPS", penalty: 0, assessed: false, source: "UNAVAILABLE" }
      : position.deviationMeters >= MONITORING_CONFIG.thresholds.significantDeviationMeters
        ? { state: "SIGNIFICANT DEVIATION", penalty: 1, assessed: true, source: "LIVE" }
        : position.deviationMeters >= MONITORING_CONFIG.thresholds.minorDeviationMeters
          ? { state: "MINOR DEVIATION", penalty: 0.3, assessed: true, source: "LIVE" }
          : { state: "ON ROUTE", penalty: 0, assessed: true, source: "LIVE" },
    stationaryCondition: stationarySeconds == null
      ? { state: "WAITING FOR GPS", penalty: 0, assessed: false, source: "UNAVAILABLE" }
      : stationarySeconds >= MONITORING_CONFIG.thresholds.prolongedStationarySeconds
        ? { state: "PROLONGED STATIONARY", penalty: 1, assessed: true, source: "LIVE" }
        : stationarySeconds >= MONITORING_CONFIG.thresholds.stationarySeconds
          ? { state: "STATIONARY", penalty: 0.35, assessed: true, source: "LIVE" }
          : { state: "MOVING", penalty: 0, assessed: true, source: "LIVE" },
    streetLighting: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    cctvSecurity: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    traffic: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    areaRisk: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    roadEnvironment: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    timeContext: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
    locationRisk: { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" },
  };

  for (const id of CONTRIBUTOR_IDS) {
    const override = overrides[id];
    if (override) derived[id] = { state: override.replace(/_/g, " ").toUpperCase(), penalty: testPenalty(override), assessed: true, source: "TEST" };
  }

  const contributors = CONTRIBUTOR_IDS.map((id) => ({
    id,
    label: CONTRIBUTOR_LABELS[id],
    state: derived[id].state,
    impact: impact(derived[id].penalty, derived[id].assessed && included[id]),
    penalty: derived[id].penalty,
    included: included[id],
    assessed: derived[id].assessed,
    source: derived[id].source,
  }));
  const scored = contributors.filter((item) => item.assessed && item.included);
  const score = scored.length === 0 ? null : Math.max(0, Math.min(100, Math.round((1 - scored.reduce((sum, item) => sum + MONITORING_CONFIG.weights[item.id] * item.penalty, 0) / scored.reduce((sum, item) => sum + MONITORING_CONFIG.weights[item.id], 0)) * 100)));
  const riskLevel = score == null ? "UNKNOWN" : riskForScore(score);
  return {
    status: "AVAILABLE",
    score,
    riskLevel,
    message: score == null ? "Waiting for live GPS or an assessed safety signal." : riskLevel === "LOW" ? "Current assessed conditions are low risk." : `${riskLevel} risk condition detected from assessed contributors.`,
    contributors,
    algorithms: ["route-deviation-rules", "stationary-condition-rules", "safety-context-rules"],
    generatedAt: new Date().toISOString(),
  };
}

export function defaultIncluded(): IncludedContributors {
  return Object.fromEntries(CONTRIBUTOR_IDS.map((id) => [id, true])) as IncludedContributors;
}