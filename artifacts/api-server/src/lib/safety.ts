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

export type ContributorOverride = string;

export type SafetySignals = {
  routeId: string;
  routeDeviationMeters?: number;
  stationarySeconds?: number;
  speedMetersPerSecond?: number;
  includedContributors?: string[];
  testOverrides?: Record<string, ContributorOverride>;
};

export type SafetyContributor = {
  id: ContributorId;
  label: string;
  state: string;
  impact: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "NOT_ASSESSED";
  penalty: number;
  included: boolean;
  assessed: boolean;
  source: "LIVE" | "TEST" | "UNAVAILABLE";
};

export type SafetyResult = {
  status: "AVAILABLE" | "UNAVAILABLE";
  score: number | null;
  riskLevel: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  contributors: SafetyContributor[];
  algorithms: string[];
  generatedAt: string;
};

/**
 * All temporary rule-based weights and thresholds live here so they can be
 * replaced by the agreed production algorithms without being scattered across
 * routes or clients.
 */
export const SAFETY_CONFIG = {
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

const LABELS: Record<ContributorId, string> = {
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

const ALL_IDS = Object.keys(LABELS) as ContributorId[];

const TEST_PENALTIES: Record<string, number> = {
  normal: 0,
  on_route: 0,
  moving: 0,
  adequate: 0,
  available: 0,
  safe: 0,
  low: 0,
  moderate: 0.35,
  minor: 0.3,
  stationary: 0.35,
  poor: 0.75,
  unavailable: 0.85,
  heavy: 0.85,
  medium: 0.45,
  high: 0.85,
  unsafe: 0.85,
  significant: 1,
  prolonged: 1,
  critical: 1,
};

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, "_");
}

function impactForPenalty(penalty: number, assessed: boolean): SafetyContributor["impact"] {
  if (!assessed) return "NOT_ASSESSED";
  if (penalty >= 0.8) return "CRITICAL";
  if (penalty >= 0.45) return "HIGH";
  if (penalty > 0) return "MEDIUM";
  return "LOW";
}

function stateFromSignals(id: ContributorId, signals: SafetySignals) {
  const override = signals.testOverrides?.[id];
  if (override) {
    return { state: override.replace(/_/g, " ").toUpperCase(), penalty: TEST_PENALTIES[normalize(override) ?? ""] ?? 0, assessed: true, source: "TEST" as const };
  }

  if (id === "routeDeviation") {
    if (signals.routeDeviationMeters == null) return { state: "WAITING FOR GPS", penalty: 0, assessed: false, source: "UNAVAILABLE" as const };
    const meters = signals.routeDeviationMeters;
    if (meters >= SAFETY_CONFIG.thresholds.significantDeviationMeters) return { state: "SIGNIFICANT DEVIATION", penalty: 1, assessed: true, source: "LIVE" as const };
    if (meters >= SAFETY_CONFIG.thresholds.minorDeviationMeters) return { state: "MINOR DEVIATION", penalty: 0.3, assessed: true, source: "LIVE" as const };
    return { state: "ON ROUTE", penalty: 0, assessed: true, source: "LIVE" as const };
  }

  if (id === "stationaryCondition") {
    if (signals.stationarySeconds == null) return { state: "WAITING FOR GPS", penalty: 0, assessed: false, source: "UNAVAILABLE" as const };
    if (signals.stationarySeconds >= SAFETY_CONFIG.thresholds.prolongedStationarySeconds) return { state: "PROLONGED STATIONARY", penalty: 1, assessed: true, source: "LIVE" as const };
    if (signals.stationarySeconds >= SAFETY_CONFIG.thresholds.stationarySeconds) return { state: "STATIONARY", penalty: 0.35, assessed: true, source: "LIVE" as const };
    return { state: "MOVING", penalty: 0, assessed: true, source: "LIVE" as const };
  }

  return { state: "NOT ASSESSED", penalty: 0, assessed: false, source: "UNAVAILABLE" as const };
}

function riskForScore(score: number): SafetyResult["riskLevel"] {
  if (score < SAFETY_CONFIG.thresholds.highRiskScore) return "CRITICAL";
  if (score < SAFETY_CONFIG.thresholds.mediumRiskScore) return "HIGH";
  if (score < SAFETY_CONFIG.thresholds.lowRiskScore) return "MEDIUM";
  return "LOW";
}

export interface SafetyAnalyzer {
  analyze(signals: SafetySignals): Promise<SafetyResult>;
}

/**
 * Three temporary rule-based algorithms are intentionally explicit:
 * route deviation, stationary condition, and a configurable safety-context
 * ruleset for environmental inputs when those inputs are available or tested.
 */
export class RuleBasedSafetyAnalyzer implements SafetyAnalyzer {
  async analyze(signals: SafetySignals): Promise<SafetyResult> {
    const included = new Set(signals.includedContributors ?? ALL_IDS);
    const contributors = ALL_IDS.map((id) => {
      const current = stateFromSignals(id, signals);
      const isIncluded = included.has(id);
      return {
        id,
        label: LABELS[id],
        state: current.state,
        impact: impactForPenalty(current.penalty, current.assessed && isIncluded),
        penalty: current.penalty,
        included: isIncluded,
        assessed: current.assessed,
        source: current.source,
      };
    });

    const scored = contributors.filter((item) => item.assessed && item.included);
    if (scored.length === 0) {
      return {
        status: "AVAILABLE",
        score: null,
        riskLevel: "UNKNOWN",
        message: "Waiting for live GPS or an assessed safety signal.",
        contributors,
        algorithms: ["route-deviation-rules", "stationary-condition-rules", "safety-context-rules"],
        generatedAt: new Date().toISOString(),
      };
    }

    const totalWeight = scored.reduce((sum, item) => sum + SAFETY_CONFIG.weights[item.id], 0);
    const weightedPenalty = scored.reduce((sum, item) => sum + SAFETY_CONFIG.weights[item.id] * item.penalty, 0);
    const score = Math.max(0, Math.min(100, Math.round((1 - weightedPenalty / totalWeight) * 100)));
    const riskLevel = riskForScore(score);
    return {
      status: "AVAILABLE",
      score,
      riskLevel,
      message: riskLevel === "LOW" ? "Current assessed conditions are low risk." : `${riskLevel} risk condition detected from assessed contributors.`,
      contributors,
      algorithms: ["route-deviation-rules", "stationary-condition-rules", "safety-context-rules"],
      generatedAt: new Date().toISOString(),
    };
  }
}

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const radius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}