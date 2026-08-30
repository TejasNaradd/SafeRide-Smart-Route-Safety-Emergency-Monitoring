export type RoutePoint = { latitude: number; longitude: number; sequence: number };

export type SafetyResult = {
  status: "PENDING" | "AVAILABLE" | "UNAVAILABLE";
  score: number | null;
  riskLevel: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  message: string;
};

export interface SafetyAnalyzer {
  analyze(routePoints: RoutePoint[]): Promise<SafetyResult>;
}

/**
 * SafeRide deliberately does not invent a safety score. This integration point
 * is ready for the assigned algorithms/data sources and reports a transparent
 * pending state until those are configured.
 */
export class PendingSafetyAnalyzer implements SafetyAnalyzer {
  async analyze(_routePoints: RoutePoint[]): Promise<SafetyResult> {
    return {
      status: "PENDING",
      score: null,
      riskLevel: "UNKNOWN",
      message: "Safety analysis pending. SafeRide will show a result when the safety data service is connected.",
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