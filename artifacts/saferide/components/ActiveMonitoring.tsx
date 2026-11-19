/**
 * ActiveMonitoring.tsx — Complete SafeRide live monitoring dashboard
 *
 * Uses the deterministic Nagpur threat engine (lib/threat.ts):
 *  - A1: Pre-trip route scored (done in RoutesStep)
 *  - A2: Stationary + deviation classifiers with Nagpur signal whitelisting
 *  - A3: 7-factor threat score fusion → 4-tier escalation
 *  - 30s Safety Check-in Modal with auto-escalation
 *  - Emergency payload to contacts
 *  - Viva demo GPS simulation mode (4 scenarios)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import { Feather } from "@expo/vector-icons";
import {
  analyzeJourneySafety,
  completeJourney,
  createEmergencyEvent,
  addJourneyLocation,
} from "@workspace/api-client-react";
import type { Coordinate } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MapPreview } from "@/components/MapPreview";
import { SafetyCheckinModal } from "@/components/SafetyCheckinModal";
import { formatDistance, formatDuration, calculateRoutes, type CandidateRoute, type Place } from "@/lib/geo";
import { ensureLocationPermission, showLocationServicesAlert, showPermissionBlockedAlert, openLocationSettings, type LocationStatus } from "@/lib/location";
import { dispatchEmergencySms, dispatchEmergencyWhatsApp, callEmergencyServices, dispatchEmergencySmsBackend } from "@/lib/dispatch";
import {
  THREAT_WEIGHTS,
  THREAT_TIER_CONFIG,
  classifyStationary,
  classifyDeviation,
  computeThreatScore,
  buildEmergencyPayload,
  formatEmergencyMessage,
  getSimulationFrames,
  timeContextPenalty,
  type ThreatAnalysis,
  type ThreatFactor,
  type ThreatTier,
  type GpsEntry,
  type LatLon,
  type SimScenario,
  type SimFrame,
  type EmergencyPayload,
} from "@/lib/threat";

// ─── Props / shared types ─────────────────────────────────────────────────────

type Vehicle = { licensePlate?: string; driverName?: string; model?: string; color?: string };

type ActiveDraft = {
  pickup: Place | null;
  destination: Place | null;
  currentLocation: Place | null;
  routes: CandidateRoute[];
  selectedRoute: CandidateRoute | null;
  journeyId: string | null;
  vehicle?: Vehicle;
  userName?: string;
  userPhone?: string;
  contactPhones?: string[];
  contactNames?: string[];
};

export type JourneySummaryData = {
  pickup: string;
  destination: string;
  distanceMeters: number;
  durationSeconds: number;
  elapsedSeconds: number;
  finalThreatScore: number;
  finalSafetyScore: number;
  finalTier: ThreatTier;
  routeDeviationCount: number;
  stationaryEventCount: number;
  emergencyActive: boolean;
  events: MonitoringEvent[];
  factors: ThreatFactor[];
};

type MonitoringEvent = {
  id: string;
  timestamp: number;
  label: string;
  kind: "info" | "warning" | "danger";
  tier: ThreatTier;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clockTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function elapsedLabel(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

function tierColor(tier: ThreatTier, colors: ReturnType<typeof useColors>) {
  if (tier === "critical" || tier === "high") return colors.destructive;
  if (tier === "medium") return "#c05621";
  return colors.primary;
}

function tierBg(tier: ThreatTier) {
  if (tier === "critical") return "#fff5f5";
  if (tier === "high") return "#fffaf0";
  if (tier === "medium") return "#fffff0";
  return "#f0fff4";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ActiveMonitoring({
  draft,
  onEnded,
}: {
  draft: ActiveDraft;
  onEnded: (summary: JourneySummaryData) => void;
}) {
  const colors = useColors();
  const startedAt = useRef(Date.now());

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeRoute, setActiveRoute] = useState<CandidateRoute | null>(draft.selectedRoute);
  const [breadcrumbs, setBreadcrumbs] = useState<Coordinate[]>([]);
  const isRerouting = useRef<boolean>(false);
  const offRouteCount = useRef<number>(0);
  const lastAnchorPos = useRef<Coordinate | null>(null);

  const [current, setCurrent] = useState<Coordinate | null>(draft.currentLocation);
  const [gpsWindow, setGpsWindow] = useState<GpsEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [stationaryStartAt, setStationaryStartAt] = useState<number | null>(null);
  const [stationarySeconds, setStationarySeconds] = useState(0);
  const [gpsStatus, setGpsStatus] = useState<"WAITING" | "ACTIVE" | "PERMISSION" | "ERROR">("WAITING");
  const [testOverrides, setTestOverrides] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<MonitoringEvent[]>([
    { id: "start", timestamp: Date.now(), label: "SafeRide monitoring started", kind: "info" as const, tier: "low" as const } as MonitoringEvent,
  ]);
  const [sosActive, setSosActive] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [lastEmergencyPayload, setLastEmergencyPayload] = useState<EmergencyPayload | null>(null);
  const [ending, setEnding] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinReason, setCheckinReason] = useState("");
  const [expandSafety, setExpandSafety] = useState(false);
  const [expandTest, setExpandTest] = useState(false);
  const [expandEvents, setExpandEvents] = useState(true);

  // Previous analysis for change detection (event log)
  const prevThreat = useRef<ThreatAnalysis | null>(null);
  // Escalation guard — only show checkin once per tier elevation
  const checkinShownForTier = useRef<ThreatTier | null>(null);

  // ── Route data ────────────────────────────────────────────────────────────
  const routeCoords = useMemo(
    () => (activeRoute?.points ?? draft.selectedRoute?.points ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    [activeRoute, draft.selectedRoute],
  );
  const altRouteCoords = useMemo(
    () => draft.routes
      .filter((r) => r.routeId !== activeRoute?.routeId)
      .map((r) => r.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))),
    [draft.routes, activeRoute],
  );
  const destCoord: LatLon | null = draft.destination
    ? { lat: draft.destination.latitude, lon: draft.destination.longitude }
    : null;

  // ── Threat analysis (computed every render cycle) ─────────────────────────
  const posLatLon: LatLon | null = current
    ? { lat: current.latitude, lon: current.longitude }
    : null;

  const deviationResult = useMemo(
    () => classifyDeviation(posLatLon, routeCoords, altRouteCoords, destCoord, gpsWindow),
    [posLatLon, routeCoords, altRouteCoords, destCoord, gpsWindow],
  );

  // ── Real Speedometer Calculation (km/h) ───────────────────────────────────
  const liveSpeedKmh = useMemo(() => {
    if (gpsWindow.length === 0) return 0;
    const latest = gpsWindow[gpsWindow.length - 1];
    if (latest.speedMps && latest.speedMps > 0) {
      return Math.round(latest.speedMps * 3.6);
    }
    if (gpsWindow.length >= 2) {
      const oldest = gpsWindow[0].pos;
      const newest = gpsWindow[gpsWindow.length - 1].pos;
      const dist = Math.hypot(
        (newest.latitude - oldest.latitude) * 111_320,
        (newest.longitude - oldest.longitude) * 111_320 * Math.cos((oldest.latitude * Math.PI) / 180)
      );
      const dt = (gpsWindow[gpsWindow.length - 1].ts - gpsWindow[0].ts) / 1000;
      return dt > 0 ? Math.round((dist / dt) * 3.6) : 0;
    }
    return 0;
  }, [gpsWindow]);

  const stationaryResult = useMemo(
    () => classifyStationary(posLatLon, stationarySeconds, liveSpeedKmh / 3.6, gpsWindow),
    [posLatLon, stationarySeconds, liveSpeedKmh, gpsWindow],
  );

  const analysis: ThreatAnalysis = useMemo(() => {
    const a = computeThreatScore(posLatLon, deviationResult, stationaryResult, testOverrides);
    return { ...a, stationaryDurationSeconds: stationarySeconds };
  }, [posLatLon, deviationResult, stationaryResult, testOverrides, stationarySeconds]);

  // ── In-Flight Turn-Missed Auto-Rerouting (Ola/Uber Style) ──────────────────
  useEffect(() => {
    if (!current || !draft.destination || isRerouting.current) return;

    const devM = deviationResult.deviationMeters ?? 0;
    if (devM > 85 && deviationResult.class !== "ON_ROUTE" && deviationResult.class !== "LEGITIMATE_REROUTE") {
      offRouteCount.current += 1;
    } else {
      offRouteCount.current = 0;
    }

    if (offRouteCount.current >= 2) {
      isRerouting.current = true;
      (async () => {
        try {
          console.log(`[AUTO-REROUTE] Missed turn detected (${devM}m off). Recalculating path to destination...`);
          const newRoutes = await calculateRoutes(current, draft.destination!);
          if (newRoutes.length > 0) {
            setActiveRoute(newRoutes[0]);
            offRouteCount.current = 0;
            setEvents((e) => [{
              id: `reroute-${Date.now()}`,
              timestamp: Date.now(),
              label: `🔄 Rerouting: New path calculated (${(newRoutes[0].distance / 1000).toFixed(1)} km remaining)`,
              kind: "info" as const,
              tier: "low" as const,
            } as MonitoringEvent, ...e].slice(0, 30));
          }
        } catch (err) {
          console.warn("Auto-reroute error:", err);
        } finally {
          isRerouting.current = false;
        }
      })();
    }
  }, [current, deviationResult, draft.destination]);

  // ── Dynamic Forward Route Polyline (Starts at current car location -> dest) ──
  const activeForwardRoute = useMemo(() => {
    const curRoute = activeRoute ?? draft.selectedRoute;
    if (!current || !curRoute || routeCoords.length < 2) return curRoute ? [curRoute] : [];

    let minD = Infinity;
    let closestIndex = 0;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = Math.hypot(
        (current.latitude - routeCoords[i].latitude) * 111_320,
        (current.longitude - routeCoords[i].longitude) * 111_320 * Math.cos((current.latitude * Math.PI) / 180)
      );
      if (d < minD) {
        minD = d;
        closestIndex = i;
      }
    }

    const remainingVertices = curRoute.points.slice(closestIndex + 1);
    const forwardRoute: CandidateRoute = {
      ...curRoute,
      points: [
        { latitude: current.latitude, longitude: current.longitude, sequence: 0 },
        ...remainingVertices.map((p, idx) => ({ ...p, sequence: idx + 1 })),
      ],
    };

    return [forwardRoute];
  }, [current, activeRoute, draft.selectedRoute, routeCoords]);

  // ── Exact Polyline Distance Tracing (Travelled vs Remaining) ───────────────
  const routeProgress = useMemo(() => {
    const totalDist = draft.selectedRoute?.distance ?? 0;
    if (!current || routeCoords.length < 2) {
      return { progress: 0, remainingMeters: totalDist, travelledMeters: 0 };
    }

    // Check if at Pickup (within 45m)
    if (draft.pickup) {
      const distToPickup = Math.hypot(
        (current.latitude - draft.pickup.latitude) * 111_320,
        (current.longitude - draft.pickup.longitude) * 111_320 * Math.cos((current.latitude * Math.PI) / 180)
      );
      if (distToPickup <= 45) {
        return { progress: 0, remainingMeters: totalDist, travelledMeters: 0 };
      }
    }

    // Check if at Destination (within 45m)
    if (draft.destination) {
      const distToDest = Math.hypot(
        (current.latitude - draft.destination.latitude) * 111_320,
        (current.longitude - draft.destination.longitude) * 111_320 * Math.cos((current.latitude * Math.PI) / 180)
      );
      if (distToDest <= 45) {
        return { progress: 1.0, remainingMeters: 0, travelledMeters: totalDist };
      }
    }

    // Find closest route vertex
    let minD = Infinity;
    let closestIndex = 0;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = Math.hypot(
        (current.latitude - routeCoords[i].latitude) * 111_320,
        (current.longitude - routeCoords[i].longitude) * 111_320 * Math.cos((current.latitude * Math.PI) / 180)
      );
      if (d < minD) {
        minD = d;
        closestIndex = i;
      }
    }

    // Sum remaining forward polyline distance from closest vertex to destination
    let remainingM = 0;
    for (let j = closestIndex; j < routeCoords.length - 1; j++) {
      remainingM += Math.hypot(
        (routeCoords[j + 1].latitude - routeCoords[j].latitude) * 111_320,
        (routeCoords[j + 1].longitude - routeCoords[j].longitude) * 111_320 * Math.cos((routeCoords[j].latitude * Math.PI) / 180)
      );
    }

    const roundedRemaining = Math.max(0, Math.min(totalDist, Math.round(remainingM)));
    const roundedTravelled = Math.max(0, totalDist - roundedRemaining);
    const progressFraction = totalDist > 0 ? roundedTravelled / totalDist : 0;

    return {
      progress: progressFraction,
      remainingMeters: roundedRemaining,
      travelledMeters: roundedTravelled,
    };
  }, [current, routeCoords, draft.selectedRoute, draft.pickup, draft.destination]);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Stationary timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!stationaryStartAt) { setStationarySeconds(0); return; }
    const t = setInterval(() => setStationarySeconds(Math.floor((Date.now() - stationaryStartAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [stationaryStartAt]);

  // ── GPS polling (real device) ─────────────────────────────────────────────
  const applyGpsPoint = useCallback((coord: Coordinate, speedMps: number, accM: number | null) => {
    // 1. Indoor Accuracy & Jitter Filter
    const isCoarse = accM != null && accM > 35;
    let effectiveCoord = coord;
    let effectiveSpeedKmh = isCoarse ? 0 : Math.max(0, speedMps * 3.6);

    // 2. Stationary Dead-Band Anchor (Suppresses false indoor jitter when sitting in room)
    if (lastAnchorPos.current) {
      const deltaM = Math.hypot(
        (coord.latitude - lastAnchorPos.current.latitude) * 111_320,
        (coord.longitude - lastAnchorPos.current.longitude) * 111_320 * Math.cos((coord.latitude * Math.PI) / 180)
      );
      if (deltaM < 8 && effectiveSpeedKmh < 1.8) {
        // Stationary lock: keep previous anchor coordinate and 0 speed
        effectiveCoord = lastAnchorPos.current;
        effectiveSpeedKmh = 0.0;
      } else {
        lastAnchorPos.current = coord;
      }
    } else {
      lastAnchorPos.current = coord;
    }

    console.log(
      `[LIVE GPS] Lat: ${effectiveCoord.latitude.toFixed(5)}, Lon: ${effectiveCoord.longitude.toFixed(5)} | Speed: ${effectiveSpeedKmh.toFixed(1)} km/h | Acc: ${accM ? `${Math.round(accM)}m` : "±5m"} | Time: ${new Date().toLocaleTimeString()}`
    );

    const effectiveSpeedMps = effectiveSpeedKmh / 3.6;
    const entry: GpsEntry = { pos: effectiveCoord, ts: Date.now(), speedMps: effectiveSpeedMps };
    setGpsWindow((w) => [...w.slice(-4), entry]);
    setCurrent(effectiveCoord);
    setBreadcrumbs((b) => [...b.slice(-60), effectiveCoord]);
    setGpsStatus("ACTIVE");

    // Stationary & Traffic Crawl Detection (Accuracy-Gated for Indoor vs Outdoor testing)
    const movedM = (w: GpsEntry[]) => {
      if (w.length < 2) return 999;
      const a = w[0].pos, b = w[w.length - 1].pos;
      return Math.hypot((b.latitude - a.latitude) * 111_320, (b.longitude - a.longitude) * 111_320 * Math.cos(a.latitude * Math.PI / 180));
    };
    setGpsWindow((w) => {
      const updated = [...w.slice(-4), entry];
      const disp = movedM(updated);
      const isIndoorOrCoarse = accM != null && accM > 35;

      if (isIndoorOrCoarse) {
        // Indoor testing mode: allow stationary timer to accumulate naturally when sitting in a room
        if (effectiveSpeedMps < 0.8) {
          setStationaryStartAt((s) => s ?? Date.now());
        } else {
          setStationaryStartAt(null);
        }
      } else {
        // Outdoor production mode: strict traffic-crawl filtering
        if (disp < 6 && effectiveSpeedMps < 0.2) {
          setStationaryStartAt((s) => s ?? Date.now());
        } else {
          setStationaryStartAt(null);
        }
      }
      return updated;
    });

    if (draft.journeyId) {
      void addJourneyLocation(draft.journeyId, {
        ...effectiveCoord,
        recordedAt: new Date().toISOString(),
        accuracyMeters: accM ?? undefined,
        speedMetersPerSecond: effectiveSpeedMps,
      });
    }
  }, [draft.journeyId]);

  // ── Request location permission on mount ──────────────────────────────────
  useEffect(() => {
    (async () => {
      const result = await ensureLocationPermission();
      if (result.status === "GRANTED") {
        setGpsStatus("ACTIVE");
      } else if (result.status === "SERVICES_DISABLED") {
        setGpsStatus("PERMISSION");
      } else {
        setGpsStatus("PERMISSION");
      }
    })();
  }, []);

  // ── Continuous GPS hardware & permission health-checker ───────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          setGpsStatus((prev) => {
            if (prev === "ACTIVE") {
              // GPS was turned OFF mid-ride — trigger urgent safety check-in!
              setCheckinReason("⚠️ GPS Signal Lost / Turned Off — Please confirm your safety or enable GPS");
              setShowCheckin(true);
              setEvents((e) => [{
                id: `gps-off-${Date.now()}`, timestamp: Date.now(),
                label: "🚨 GPS Hardware Turned Off — Threat Check-in Triggered", kind: "danger" as const, tier: "high" as const,
              } as MonitoringEvent, ...e].slice(0, 30));
            }
            return "PERMISSION";
          });
        }
      } catch {}
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;
    
    const startWatching = async () => {
      try {
        const result = await ensureLocationPermission();
        if (result.status !== "GRANTED") {
          if (!cancelled) setGpsStatus("PERMISSION");
          return;
        }
        
        // Use watchPositionAsync for real-time updates
        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 5,
            timeInterval: 4000,
          },
          (loc) => {
            if (cancelled) return;
            setGpsStatus("ACTIVE");
            applyGpsPoint(
              { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              Math.max(0, loc.coords.speed ?? 0),
              loc.coords.accuracy ?? null,
            );
          }
        );
      } catch (err) {
        if (!cancelled) {
          console.warn("GPS watch failed:", err);
          setGpsStatus("ERROR");
        }
      }
    };
    
    void startWatching();
    
    return () => {
      cancelled = true;
      if (watcher) watcher.remove();
    };
  }, [applyGpsPoint]);

  const safeCooldownUntil = useRef<number>(0);

  // ── Event log & escalation engine ────────────────────────────────────────
  useEffect(() => {
    const prev = prevThreat.current;
    prevThreat.current = analysis;
    if (!prev) return;

    const newEvents: MonitoringEvent[] = [];

    // Route deviation state change
    if (prev.deviationClass !== analysis.deviationClass) {
      const isBad = ["SUSPICIOUS", "MINOR"].includes(analysis.deviationClass);
      newEvents.push({
        id: `dev-${Date.now()}`,
        timestamp: Date.now(),
        label: `Route: ${analysis.deviationClass.replace(/_/g, " ")} (${analysis.deviationMeters ?? "?"}m off route)`,
        kind: isBad ? "warning" : "info",
        tier: isBad ? "medium" : "low",
      });
      // Backend emergency event for suspicious deviation
      if (analysis.deviationClass === "SUSPICIOUS" && draft.journeyId && current) {
        void createEmergencyEvent(draft.journeyId, {
          type: "DEVIATION",
          message: `Suspicious deviation detected: ${analysis.deviationMeters}m off route`,
          coordinate: current,
        });
      }
    }

    // Stationary state change
    if (prev.stationaryClass !== analysis.stationaryClass) {
      const isBad = ["STATIONARY", "PROLONGED", "CRITICAL_STAGNATION"].includes(analysis.stationaryClass);
      newEvents.push({
        id: `stat-${Date.now()}`,
        timestamp: Date.now(),
        label: `Movement: ${analysis.stationaryClass.replace(/_/g, " ")} (${stationarySeconds}s)`,
        kind: analysis.stationaryClass === "CRITICAL_STAGNATION" ? "danger" : isBad ? "warning" : "info",
        tier: analysis.stationaryClass === "CRITICAL_STAGNATION" ? "critical" : isBad ? "medium" : "low",
      });
      if (isBad && draft.journeyId && current) {
        void createEmergencyEvent(draft.journeyId, {
          type: "STATIONARY",
          message: `${analysis.stationaryClass}: ${stationarySeconds}s stationary`,
          coordinate: current,
        });
      }
    }

    // Tier escalation
    if (analysis.tier !== prev.tier && analysis.tier !== "low") {
      newEvents.push({
        id: `tier-${Date.now()}`,
        timestamp: Date.now(),
        label: `Safety tier: ${analysis.tierLabel} (Threat: ${analysis.threatScore}/100)`,
        kind: analysis.tier === "critical" ? "danger" : "warning",
        tier: analysis.tier,
      });
    }

    if (newEvents.length > 0) setEvents((e) => [...newEvents.reverse(), ...e].slice(0, 30));

    // Check if within 3-minute "I am Safe" grace period (unless escalated to critical)
    if (Date.now() < safeCooldownUntil.current && analysis.tier !== "critical") {
      return;
    }

    // Trigger check-in modal (HIGH tier)
    if (
      analysis.needsCheckin &&
      !showCheckin &&
      !sosActive &&
      checkinShownForTier.current !== analysis.tier
    ) {
      const reason = analysis.factors
        .filter((f) => f.penalty >= 0.5)
        .map((f) => `${f.label}: ${f.state}`)
        .join(", ") || "Multiple risk factors elevated";
      setCheckinReason(reason);
      setShowCheckin(true);
      checkinShownForTier.current = analysis.tier;
    }

    // Auto emergency if critical without already active SOS
    if (analysis.needsDispatch && !sosActive && checkinShownForTier.current !== "critical") {
      checkinShownForTier.current = "critical";
      const reason = `CRITICAL risk auto-detected: ${analysis.threatScore}/100 threat score`;
      setCheckinReason(reason);
      setShowCheckin(true);
    }
  }, [analysis]);

  // ── Check-in modal handlers ────────────────────────────────────────────────
  const handleSafe = () => {
    setShowCheckin(false);
    // Apply 3-minute (180s) grace period cooldown
    safeCooldownUntil.current = Date.now() + 180_000;
    setEvents((e) => [{
      id: `safe-${Date.now()}`, timestamp: Date.now(),
      label: "✅ User confirmed safe — 3-minute grace cooldown active", kind: "info" as const, tier: "low" as const,
    } as MonitoringEvent, ...e].slice(0, 30));
  };

  const handleCheckinSos = () => {
    setShowCheckin(false);
    void sendSos("User requested SOS from safety check-in");
  };

  const handleCheckinTimeout = () => {
    setShowCheckin(false);
    if (!sosActive) void sendSos("No response to safety check-in after 30 seconds");
  };

  // ── SOS ───────────────────────────────────────────────────────────────────
  const triggerManualSos = () => {
    if (sosActive || sosBusy || !draft.journeyId) return;
    Alert.alert(
      "Send Emergency SOS?",
      "This creates a real emergency event. All registered contacts will be alerted with your location.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm SOS", style: "destructive", onPress: () => void sendSos("User manually triggered Emergency SOS") },
      ],
    );
  };

  const sendSos = async (reason: string) => {
    if (!draft.journeyId || sosBusy || sosActive) return;
    setSosBusy(true);
    try {
      await createEmergencyEvent(draft.journeyId, {
        type: "SOS",
        message: reason,
        coordinate: current ?? undefined,
      });
      setSosActive(true);
      setEvents((e) => [{
        id: `sos-${Date.now()}`, timestamp: Date.now(),
        label: `🚨 SOS ACTIVATED — ${reason}`, kind: "danger" as const, tier: "critical" as const,
      } as MonitoringEvent, ...e].slice(0, 30));

      // Build real emergency dispatch payload with live Google Maps link & vehicle details
      const activePosition = current ?? draft.pickup ?? { latitude: 21.1458, longitude: 79.0882 };
      const payload = buildEmergencyPayload({
        userName: draft.userName ?? "SafeRide User",
        userPhone: draft.userPhone ?? "Unknown",
        vehicle: draft.vehicle ?? {},
        position: activePosition,
        locationLabel: draft.pickup?.formattedAddress ?? "Nagpur, Maharashtra",
        journeyId: draft.journeyId,
        analysis,
        triggerReason: reason,
      });

      setLastEmergencyPayload(payload);
      console.log("=== EMERGENCY DISPATCH ===\n", formatEmergencyMessage(payload));

      // 1. Automated Background Cloud SMS Dispatch (Sent automatically via server)
      void dispatchEmergencySmsBackend(draft.journeyId, reason, payload);

      // 2. Native SMS app intent fallback
      const phones = draft.contactPhones ?? [];
      void dispatchEmergencySms(phones, payload);
    } catch (err) {
      Alert.alert(
        "Unable to record SOS on server",
        err instanceof Error && err.message.includes("already")
          ? "SOS is already active for this journey."
          : "Please send SMS or call 112 directly.",
      );
    } finally {
      setSosBusy(false);
    }
  };

  // ── End journey ───────────────────────────────────────────────────────────
  const endJourney = () => {
    Alert.alert("End SafeRide?", "GPS monitoring will stop and journey will be saved.", [
      { text: "Keep monitoring", style: "cancel" },
      { text: "End SafeRide", style: "destructive", onPress: () => void finishJourney() },
    ]);
  };

  const finishJourney = async () => {
    if (!draft.journeyId) return;
    setEnding(true);
    try {
      await completeJourney(draft.journeyId, {
        finalScore: analysis.safetyScore,
        finalRiskLevel: analysis.tierLabel,
        routeDeviationCount: events.filter((e) => e.label.toLowerCase().includes("route:")).length,
        stationaryEventCount: events.filter((e) => e.label.toLowerCase().includes("movement:")).length,
        emergencyActive: sosActive,
      });
    } catch {
      Alert.alert("Unable to save", "End journey data could not be saved. Monitoring stays active.");
      setEnding(false);
      return;
    }
    onEnded({
      pickup: draft.pickup?.formattedAddress ?? "Pickup",
      destination: draft.destination?.formattedAddress ?? "Destination",
      distanceMeters: draft.selectedRoute?.distance ?? 0,
      durationSeconds: draft.selectedRoute?.duration ?? 0,
      elapsedSeconds: elapsed,
      finalThreatScore: analysis.threatScore,
      finalSafetyScore: analysis.safetyScore,
      finalTier: analysis.tier,
      routeDeviationCount: events.filter((e) => e.label.toLowerCase().includes("route:")).length,
      stationaryEventCount: events.filter((e) => e.label.toLowerCase().includes("movement:")).length,
      emergencyActive: sosActive,
      events,
      factors: analysis.factors,
    });
  };

  // ── Derived UI values ─────────────────────────────────────────────────────
  const scoreColor = tierColor(analysis.tier, colors);
  const testActive = Object.keys(testOverrides).length > 0;

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <>
      <SafetyCheckinModal
        visible={showCheckin}
        tier={analysis.tier === "critical" || analysis.tier === "high" ? analysis.tier : "high"}
        threatScore={analysis.threatScore}
        triggerReason={checkinReason}
        countdownSeconds={30}
        onSafe={handleSafe}
        onSos={handleCheckinSos}
        onTimeout={handleCheckinTimeout}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>SAFERIDE MONITORING</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Active Journey</Text>
          </View>
          <View style={[styles.modeBadge, {
            backgroundColor: testActive ? "#fff0f0" : colors.secondary,
          }]}>
            <View style={[styles.modeDot, {
              backgroundColor: testActive ? colors.destructive : colors.primary,
            }]} />
            <Text style={[styles.modeLabel, {
              color: testActive ? colors.destructive : colors.primary,
            }]}>
              {testActive ? "TEST" : "LIVE"}
            </Text>
          </View>
        </View>

        {/* ── Test override banner ── */}
        {testActive && (
          <View style={[styles.simBanner, { backgroundColor: "#fff0f0", borderColor: colors.destructive + "55" }]}>
            <Feather name="tool" size={14} color={colors.destructive} />
            <Text style={[styles.simBannerText, { color: colors.destructive }]}>
              TEST MODE: {Object.keys(testOverrides).length} override(s) active. No real SOS is sent.
            </Text>
          </View>
        )}

        {/* ── Dynamic Forward Route Trimming Map (Ola / Uber Style) ── */}
        <MapPreview
          pickup={draft.pickup}
          destination={draft.destination}
          currentLocation={current}
          routes={activeForwardRoute}
          selectedRouteId={activeForwardRoute[0]?.routeId}
          height={300}
        />

        {/* ── Live status strip & Speedometer ── */}
        <View style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StripItem label="GPS" value={gpsStatus === "ACTIVE" ? "ACTIVE" : gpsStatus} warn={gpsStatus !== "ACTIVE"} colors={colors} />
          <StripItem label="SPEED" value={liveSpeedKmh > 10 ? `${liveSpeedKmh} km/h` : liveSpeedKmh > 0 ? `Crawl ${liveSpeedKmh} km/h` : `Halted (0 km/h)`} warn={liveSpeedKmh === 0 && stationarySeconds > 60} colors={colors} />
          <StripItem label="ROUTE" value={analysis.deviationClass.replace(/_/g, " ")} warn={["SUSPICIOUS", "MINOR"].includes(analysis.deviationClass)} colors={colors} />
          <StripItem label="STATUS" value={analysis.stationaryClass.replace(/_/g, " ")} warn={["STATIONARY", "PROLONGED", "CRITICAL_STAGNATION"].includes(analysis.stationaryClass)} colors={colors} />
        </View>

        {/* ── 3 Core Live Safety Pillars (Active Threat Drivers) ── */}
        <View style={[styles.pillarsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.pillarsTitle, { color: colors.foreground }]}>🛡️ Live Safety Factors (Real-Time)</Text>
          
          {/* Factor 1: Deviation */}
          <View style={[styles.pillarRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
            <View style={[styles.pillarIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="navigation" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pillarLabel, { color: colors.mutedForeground }]}>1. Route Deviation</Text>
              <Text style={[styles.pillarVal, { color: ["SUSPICIOUS", "MINOR"].includes(analysis.deviationClass) ? "#c05621" : colors.foreground }]}>
                {analysis.deviationClass === "ON_ROUTE" ? "Aligned with planned route" : `${analysis.deviationMeters ?? 0}m off route (${analysis.deviationClass.replace(/_/g, " ")})`}
              </Text>
            </View>
          </View>

          {/* Factor 2: Stationary Stoppage */}
          <View style={[styles.pillarRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
            <View style={[styles.pillarIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="pause-circle" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pillarLabel, { color: colors.mutedForeground }]}>2. Vehicle Stoppage / Movement</Text>
              <Text style={[styles.pillarVal, { color: ["STATIONARY", "PROLONGED", "CRITICAL_STAGNATION"].includes(analysis.stationaryClass) ? "#c05621" : colors.foreground }]}>
                {analysis.stationaryClass === "MOVING" ? "Vehicle in transit" : `${analysis.stationaryClass.replace(/_/g, " ")} (${stationarySeconds}s elapsed)`}
              </Text>
            </View>
          </View>

          {/* Factor 3: Nearby Infrastructure */}
          <View style={styles.pillarRow}>
            <View style={[styles.pillarIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="map-pin" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pillarLabel, { color: colors.mutedForeground }]}>3. Nearby Area Infrastructure</Text>
              <Text style={[styles.pillarVal, { color: colors.foreground }]}>
                {analysis.factors.find(f => f.id === "streetLighting")?.detail ?? "Lighting assessed"} · {analysis.factors.find(f => f.id === "cctvSecurity")?.detail ?? "Police/CCTV monitored"}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Threat / Safety Score Card ── */}
        <View style={[styles.scoreCard, { backgroundColor: tierBg(analysis.tier), borderColor: scoreColor }]}>
          <View style={styles.scoreRow}>
            <View>
              <Text style={[styles.scoreEyebrow, { color: colors.mutedForeground }]}>SAFETY SCORE</Text>
              <Text style={[styles.scoreNum, { color: scoreColor }]}>
                {analysis.safetyScore}
                <Text style={styles.scoreMax}> / 100</Text>
              </Text>
            </View>
            <View style={[styles.tierBadge, { backgroundColor: scoreColor + "18" }]}>
              <Feather name={analysis.tier === "low" ? "shield" : "alert-triangle"} size={16} color={scoreColor} />
              <Text style={[styles.tierLabel, { color: scoreColor }]}>{analysis.tierLabel} RISK</Text>
            </View>
          </View>
          <View style={styles.threatRow}>
            <Text style={[styles.threatLabel, { color: colors.mutedForeground }]}>Threat Score:</Text>
            <Text style={[styles.threatNum, { color: scoreColor }]}>{analysis.threatScore}/100</Text>
          </View>
          {/* Bar */}
          <View style={[styles.barBg, { backgroundColor: colors.muted }]}>
            <View style={[styles.barFill, { width: `${analysis.threatScore}%`, backgroundColor: scoreColor }]} />
          </View>
          <Text style={[styles.scoreMsg, { color: colors.mutedForeground }]}>
            {analysis.tier === "low" ? "All assessed conditions normal." :
             analysis.tier === "medium" ? "Moderate risk — monitoring closely." :
             analysis.tier === "high" ? "High risk — safety check-in may trigger." :
             "CRITICAL — emergency response may be dispatched."}
          </Text>
        </View>

        {/* ── Journey metrics ── */}
        <View style={[styles.metricsGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Metric icon="navigation" label="Travelled" value={formatDistance(routeProgress.travelledMeters)} colors={colors} />
          <Metric icon="flag" label="Remaining" value={formatDistance(routeProgress.remainingMeters)} colors={colors} />
          <Metric icon="zap" label="Live Speed" value={`${liveSpeedKmh} km/h`} colors={colors} />
          <Metric icon="activity" label="Elapsed" value={elapsedLabel(elapsed)} colors={colors} />
        </View>

        {/* ── Safety analysis breakdown ── */}
        <CollapsibleSection
          title="Safety Analysis"
          subtitle="Each factor's contribution to the threat score."
          expanded={expandSafety}
          onToggle={() => setExpandSafety((v) => !v)}
          colors={colors}
        >
          <View style={styles.factorGrid}>
            {analysis.factors.map((f) => (
              <FactorCard key={f.id} factor={f} colors={colors} />
            ))}
          </View>
        </CollapsibleSection>

        {/* ── Manual test controls ── */}
        <CollapsibleSection
          title="Manual Contributor Testing"
          subtitle="Simulate any condition without sending a real SOS."
          expanded={expandTest}
          onToggle={() => setExpandTest((v) => !v)}
          colors={colors}
        >
          <View style={[styles.testCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.testHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Test Controls</Text>
              <Pressable onPress={() => {
                setTestOverrides({});
                setEvents((e) => [{ id: `reset-${Date.now()}`, timestamp: Date.now(), label: "Test conditions reset to live values", kind: "info" as const, tier: "low" as const } as MonitoringEvent, ...e].slice(0, 30));
              }}>
                <Text style={[styles.resetBtn, { color: colors.primary }]}>Reset All</Text>
              </Pressable>
            </View>
            {CONTROL_OPTIONS.map((ctrl) => (
              <TestControl
                key={ctrl.id}
                id={ctrl.id}
                label={ctrl.label}
                options={ctrl.options}
                selected={testOverrides[ctrl.id]}
                onChoose={(id, val) => {
                  setTestOverrides((o) => ({ ...o, [id]: val }));
                  setEvents((e) => [{ id: `test-${Date.now()}`, timestamp: Date.now(), label: `Test: ${ctrl.label} → ${val.replace(/_/g, " ")}`, kind: "info" as const, tier: "low" as const } as MonitoringEvent, ...e].slice(0, 30));
                }}
                colors={colors}
              />
            ))}
          </View>
        </CollapsibleSection>

        {/* ── Event log ── */}
        <CollapsibleSection
          title="Monitoring Events"
          subtitle="Meaningful state changes only — no GPS spam."
          expanded={expandEvents}
          onToggle={() => setExpandEvents((v) => !v)}
          colors={colors}
        >
          <View style={[styles.eventsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {events.slice(0, 12).map((ev) => (
              <View key={ev.id} style={styles.evtRow}>
                <View style={[styles.evtDot, {
                  backgroundColor: ev.kind === "danger" ? colors.destructive : ev.kind === "warning" ? "#c05621" : colors.primary,
                }]} />
                <Text style={[styles.evtTime, { color: colors.mutedForeground }]}>{clockTime(ev.timestamp)}</Text>
                <Text style={[styles.evtLabel, { color: colors.foreground }]}>{ev.label}</Text>
              </View>
            ))}
          </View>
        </CollapsibleSection>

        {/* ── Emergency SOS ── */}
        <Pressable
          onPress={triggerManualSos}
          disabled={sosBusy || sosActive}
          style={[styles.sosBtn, {
            backgroundColor: sosActive ? "#6b7d73" : colors.destructive,
            opacity: sosBusy ? 0.75 : 1,
          }]}
        >
          <Feather name={sosActive ? "check-circle" : "alert-octagon"} size={22} color="#fff" />
          <Text style={styles.sosBtnText}>
            {sosBusy ? "Sending SOS…" : sosActive ? "Emergency Active — SOS Sent" : "EMERGENCY SOS"}
          </Text>
        </Pressable>

        {sosActive && (
          <View style={[styles.emergencyActive, { backgroundColor: "#fff5f5", borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={22} color={colors.destructive} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={[styles.emergTitle, { color: colors.destructive }]}>Emergency SOS Active</Text>
              <Text style={[styles.emergBody, { color: colors.foreground }]}>
                Live GPS position and vehicle details prepared for emergency contacts.
              </Text>
              
              {/* Action Buttons for Direct Emergency Dispatch */}
              <View style={styles.emergencyActionsRow}>
                <Pressable
                  onPress={() => {
                    if (lastEmergencyPayload) {
                      void dispatchEmergencySms(draft.contactPhones ?? [], lastEmergencyPayload);
                    }
                  }}
                  style={[styles.emergActionBtn, { backgroundColor: colors.destructive }]}
                >
                  <Feather name="message-square" size={15} color="#fff" />
                  <Text style={styles.emergActionBtnText}>Send SMS</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (lastEmergencyPayload) {
                      void dispatchEmergencyWhatsApp(lastEmergencyPayload);
                    }
                  }}
                  style={[styles.emergActionBtn, { backgroundColor: "#25D366" }]}
                >
                  <Feather name="share-2" size={15} color="#fff" />
                  <Text style={styles.emergActionBtnText}>WhatsApp</Text>
                </Pressable>

                <Pressable
                  onPress={() => void callEmergencyServices("112")}
                  style={[styles.emergActionBtn, { backgroundColor: "#1e293b" }]}
                >
                  <Feather name="phone-call" size={15} color="#fff" />
                  <Text style={styles.emergActionBtnText}>Call 112</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ── GPS Status Banner ── */}
        {gpsStatus !== "ACTIVE" && (
          <View style={[styles.gpsWarningCard, { backgroundColor: "#fffbeb", borderColor: "#f59e0b" }]}>
            <Feather name="alert-triangle" size={20} color="#b45309" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#92400e" }}>
                {gpsStatus === "PERMISSION" ? "GPS Permission or Location Disabled" : "GPS Signal Lost"}
              </Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#78350f", lineHeight: 17 }}>
                Turn on Location Services and allow permission to keep live threat tracking active.
              </Text>
              <Pressable
                onPress={async () => {
                  const res = await ensureLocationPermission();
                  if (res.status === "SERVICES_DISABLED") {
                    showLocationServicesAlert();
                  } else if (res.status === "BLOCKED" || res.status === "DENIED") {
                    showPermissionBlockedAlert();
                  } else {
                    setGpsStatus("ACTIVE");
                  }
                }}
                style={styles.gpsRetryBtn}
              >
                <Text style={styles.gpsRetryBtnText}>Enable GPS / Retry</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Nearest help display ── */}
        {current && (
          <View style={[styles.helpCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.helpTitle, { color: colors.foreground }]}>Nearest Safe Points (Nagpur)</Text>
            <Text style={[styles.helpRow, { color: colors.mutedForeground }]}>
              🚔  Nearest police station: {analysis.factors.find(f => f.id === "cctvSecurity")?.detail ?? "Calculating…"}
            </Text>
            <Text style={[styles.helpRow, { color: colors.mutedForeground }]}>
              🏥  Emergency: 112 (Police) · 108 (Ambulance) · 101 (Fire)
            </Text>
          </View>
        )}

        {/* ── End SafeRide ── */}
        <Pressable
          onPress={endJourney}
          disabled={ending}
          style={[styles.endBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.endBtnText, { color: colors.foreground }]}>
            {ending ? "Saving journey…" : "End SafeRide"}
          </Text>
        </Pressable>

        {gpsStatus === "PERMISSION" && (
          <Text style={[styles.permissionNote, { color: colors.mutedForeground }]}>
            Allow foreground location access to enable live GPS tracking, deviation detection, and stationary monitoring.
          </Text>
        )}
      </ScrollView>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StripItem({ label, value, warn, colors }: { label: string; value: string; warn: boolean; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.stripItem}>
      <Text style={[styles.stripLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.stripValue, { color: warn ? "#c05621" : colors.primary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Metric({ icon, label, value, colors }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.metric}>
      <Feather name={icon} size={15} color={colors.primary} />
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function FactorCard({ factor, colors }: { factor: ThreatFactor; colors: ReturnType<typeof useColors> }) {
  const c = factor.penalty >= 0.8 ? colors.destructive : factor.penalty >= 0.4 ? "#c05621" : colors.primary;
  const isTest = factor.source === "TEST";
  return (
    <View style={[styles.factorCard, { backgroundColor: colors.card, borderColor: isTest ? "#edc66d" : colors.border }]}>
      <View style={styles.factorTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.factorLabel, { color: colors.foreground }]}>{factor.label}</Text>
          <Text style={[styles.factorState, { color: c }]}>{factor.state}</Text>
          {factor.detail ? <Text style={[styles.factorDetail, { color: colors.mutedForeground }]}>{factor.detail}</Text> : null}
        </View>
        <View style={[styles.penaltyBadge, { backgroundColor: c + "18" }]}>
          <Text style={[styles.penaltyText, { color: c }]}>p={factor.penalty.toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.factorBottom}>
        <Text style={[styles.factorSource, { color: isTest ? "#8a5b10" : colors.mutedForeground }]}>
          {isTest ? "TEST" : factor.source} · w={factor.weight.toFixed(2)}
        </Text>
        <View style={[styles.penaltyBar, { backgroundColor: colors.muted }]}>
          <View style={[styles.penaltyFill, { width: `${factor.penalty * 100}%`, backgroundColor: c }]} />
        </View>
      </View>
    </View>
  );
}

function CollapsibleSection({ title, subtitle, expanded, onToggle, colors, children }: {
  title: string; subtitle: string; expanded: boolean;
  onToggle: () => void; colors: ReturnType<typeof useColors>; children: React.ReactNode;
}) {
  return (
    <View>
      <Pressable onPress={onToggle} style={[styles.collapsible, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.collapsibleTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.collapsibleSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={19} color={colors.mutedForeground} />
      </Pressable>
      {expanded && children}
    </View>
  );
}

function TestControl({ id, label, options, selected, onChoose, colors }: {
  id: string; label: string;
  options: { label: string; value: string }[];
  selected?: string;
  onChoose: (id: string, val: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.testControl}>
      <Text style={[styles.testCtrlLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.testCtrlOptions}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChoose(id, o.value)}
            style={[styles.testOption, {
              backgroundColor: selected === o.value ? "#fffbeb" : colors.secondary,
              borderColor: selected === o.value ? "#edc66d" : colors.border,
            }]}
          >
            <Text style={[styles.testOptionText, { color: selected === o.value ? "#8a5b10" : colors.foreground }]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Test control options ─────────────────────────────────────────────────────
const CONTROL_OPTIONS: Array<{ id: string; label: string; options: { label: string; value: string }[] }> = [
  { id: "routeDeviation", label: "Route Deviation", options: [{ label: "On Route", value: "on_route" }, { label: "Minor", value: "minor" }, { label: "Suspicious", value: "suspicious" }] },
  { id: "stationaryCondition", label: "Stationary", options: [{ label: "Moving", value: "moving" }, { label: "Stationary", value: "stationary" }, { label: "Prolonged", value: "prolonged" }, { label: "Critical", value: "critical_stagnation" }] },
  { id: "streetLighting", label: "Street Lighting", options: [{ label: "Well Lit", value: "well_lit" }, { label: "Partial", value: "partial" }, { label: "Unlit", value: "unlit" }] },
  { id: "cctvSecurity", label: "CCTV / Security", options: [{ label: "Covered", value: "covered" }, { label: "Partial", value: "nearby" }, { label: "Isolated", value: "isolated" }] },
  { id: "accidentBlackspot", label: "Accident Blackspot", options: [{ label: "Clear", value: "low" }, { label: "Blackspot", value: "blackspot" }] },
  { id: "roadHierarchy", label: "Road Class", options: [{ label: "Arterial", value: "safe" }, { label: "Lane", value: "unsafe" }] },
  { id: "timeContext", label: "Time Context", options: [{ label: "Daytime", value: "daytime" }, { label: "Evening", value: "evening" }, { label: "Late Night", value: "late_night" }] },
];

// ─── Journey Summary Screen ───────────────────────────────────────────────────

export function JourneySummaryScreen({
  summary,
  onDone,
}: {
  summary: JourneySummaryData;
  onDone: () => void;
}) {
  const colors = useColors();
  const sc = tierColor(summary.finalTier, colors);
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.summaryHero}>
        <View style={[styles.summaryIcon, { backgroundColor: colors.secondary }]}>
          <Feather name="check" size={28} color={colors.primary} />
        </View>
        <Text style={[styles.summaryTitle, { color: colors.foreground }]}>Journey Completed</Text>
        <Text style={[styles.summarySub, { color: colors.mutedForeground }]}>SafeRide monitoring session saved.</Text>
      </View>

      <View style={[styles.finalScoreCard, { backgroundColor: tierBg(summary.finalTier), borderColor: sc }]}>
        <Text style={[styles.scoreEyebrow, { color: colors.mutedForeground }]}>FINAL SAFETY SCORE</Text>
        <Text style={[styles.scoreNum, { color: sc }]}>
          {summary.finalSafetyScore}<Text style={styles.scoreMax}> / 100</Text>
        </Text>
        <Text style={[styles.tierLabel, { color: sc }]}>{summary.finalTier.toUpperCase()} RISK · Threat: {summary.finalThreatScore}/100</Text>
      </View>

      <View style={[styles.summaryLines, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <SumLine label="From" value={summary.pickup} colors={colors} />
        <SumLine label="To" value={summary.destination} colors={colors} />
        <SumLine label="Distance" value={formatDistance(summary.distanceMeters)} colors={colors} />
        <SumLine label="Duration" value={elapsedLabel(summary.elapsedSeconds)} colors={colors} />
        <SumLine label="Route Deviations" value={String(summary.routeDeviationCount)} colors={colors} />
        <SumLine label="Stationary Events" value={String(summary.stationaryEventCount)} colors={colors} />
        <SumLine label="Emergency Status" value={summary.emergencyActive ? "SOS Activated" : "No emergency"} colors={colors} last />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 6 }]}>Safety Factor Breakdown</Text>
      {summary.factors.map((f) => (
        <FactorCard key={f.id} factor={f} colors={colors} />
      ))}

      <Pressable onPress={onDone} style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
        <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>Back to Dashboard</Text>
      </Pressable>
    </ScrollView>
  );
}

function SumLine({ label, value, colors, last }: { label: string; value: string; colors: ReturnType<typeof useColors>; last?: boolean }) {
  return (
    <View style={[styles.sumLine, !last && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
      <Text style={[styles.sumLineLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.sumLineValue, { color: colors.foreground }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 24, marginTop: 3 },
  modeBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 30, paddingHorizontal: 10, paddingVertical: 7 },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  modeLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.7 },
  simBanner: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 12, padding: 9 },
  simBannerText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15 },
  strip: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 10 },
  stripItem: { flex: 1, gap: 2 },
  stripLabel: { fontFamily: "Inter_700Bold", fontSize: 8, letterSpacing: 0.8 },
  stripValue: { fontFamily: "Inter_700Bold", fontSize: 9 },
  pillarsCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  pillarsTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  pillarRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  pillarIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pillarLabel: { fontFamily: "Inter_700Bold", fontSize: 11, marginBottom: 2 },
  pillarVal: { fontFamily: "Inter_500Medium", fontSize: 12 },
  scoreCard: { borderWidth: 2, borderRadius: 18, padding: 14, gap: 8 },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  scoreEyebrow: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.8 },
  scoreNum: { fontFamily: "Inter_700Bold", fontSize: 42, lineHeight: 48, marginTop: 2 },
  scoreMax: { fontFamily: "Inter_500Medium", fontSize: 16, color: "#6b7d73" },
  tierBadge: { borderRadius: 30, paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  tierLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.4 },
  threatRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  threatLabel: { fontFamily: "Inter_400Regular", fontSize: 11 },
  threatNum: { fontFamily: "Inter_700Bold", fontSize: 13 },
  barBg: { height: 6, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 4 },
  scoreMsg: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  metricsGrid: { borderWidth: 1, borderRadius: 15, padding: 10, flexDirection: "row", flexWrap: "wrap" },
  metric: { width: "50%", padding: 6, gap: 3 },
  metricLabel: { fontFamily: "Inter_400Regular", fontSize: 9 },
  metricValue: { fontFamily: "Inter_700Bold", fontSize: 14 },
  collapsible: { borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  collapsibleTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  collapsibleSub: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  factorGrid: { gap: 7, marginTop: 2 },
  factorCard: { borderWidth: 1, borderRadius: 13, padding: 11, gap: 7 },
  factorTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  factorLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  factorState: { fontFamily: "Inter_700Bold", fontSize: 10, marginTop: 2, letterSpacing: 0.3 },
  factorDetail: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 2, lineHeight: 13 },
  penaltyBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5 },
  penaltyText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  factorBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  factorSource: { fontFamily: "Inter_500Medium", fontSize: 8, letterSpacing: 0.3 },
  penaltyBar: { flex: 1, height: 4, borderRadius: 3, overflow: "hidden" },
  penaltyFill: { height: 4, borderRadius: 3 },
  testCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 12 },
  testHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sectionSub: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  resetBtn: { fontFamily: "Inter_700Bold", fontSize: 11 },
  testControl: { gap: 5 },
  testCtrlLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  testCtrlOptions: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  testOption: { borderWidth: 1, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 9 },
  testOptionText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  sectionCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  simButtons: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  simBtn: { borderWidth: 1, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10 },
  simBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 9 },
  stopSimBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 10, padding: 9 },
  stopSimText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  eventsCard: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  evtRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#edf2ee" },
  evtDot: { width: 6, height: 6, borderRadius: 3 },
  evtTime: { fontFamily: "Inter_500Medium", fontSize: 9, width: 40 },
  evtLabel: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15 },
  sosBtn: { minHeight: 58, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  sosBtnText: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  emergencyActive: { borderWidth: 1.5, borderRadius: 14, padding: 14, flexDirection: "row", gap: 11 },
  emergTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  emergBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  emergencyActionsRow: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  emergActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  emergActionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#fff" },
  gpsWarningCard: { borderWidth: 1.5, borderRadius: 14, padding: 14, flexDirection: "row", gap: 11 },
  gpsRetryBtn: { backgroundColor: "#d97706", paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, alignSelf: "flex-start", marginTop: 2 },
  gpsRetryBtnText: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" },
  helpCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 5 },
  helpTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  helpRow: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17 },
  endBtn: { borderWidth: 1, minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  endBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  permissionNote: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", lineHeight: 17 },
  // Summary
  summaryHero: { alignItems: "center", paddingVertical: 12, gap: 6 },
  summaryIcon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  summarySub: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
  finalScoreCard: { borderWidth: 2, borderRadius: 18, padding: 16, alignItems: "center", gap: 4 },
  summaryLines: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 13 },
  sumLine: { paddingVertical: 11, gap: 3 },
  sumLineLabel: { fontFamily: "Inter_500Medium", fontSize: 10 },
  sumLineValue: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
  doneBtn: { minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
