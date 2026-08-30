import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Location from "expo-location";
import { Feather } from "@expo/vector-icons";
import { analyzeJourneySafety, completeJourney, createEmergencyEvent, addJourneyLocation } from "@workspace/api-client-react";
import type { Coordinate, SafetyAnalysis } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MapPreview } from "@/components/MapPreview";
import { formatDistance, formatDuration, type CandidateRoute, type Place } from "@/lib/geo";
import {
  CONTRIBUTOR_IDS,
  CONTRIBUTOR_LABELS,
  MONITORING_CONFIG,
  computeLocalAnalysis,
  defaultIncluded,
  routePosition,
  type ContributorId,
  type IncludedContributors,
  type LocalAnalysis,
  type TestOverrides,
} from "@/lib/monitoring";

type ActiveDraft = {
  pickup: Place | null;
  destination: Place | null;
  currentLocation: Place | null;
  routes: CandidateRoute[];
  selectedRoute: CandidateRoute | null;
  journeyId: string | null;
  vehicle?: { licensePlate?: string; driverName?: string; model?: string; color?: string };
};

export type JourneySummaryData = {
  pickup: string;
  destination: string;
  distanceMeters: number;
  durationSeconds: number;
  elapsedSeconds: number;
  analysis: LocalAnalysis;
  routeDeviationCount: number;
  stationaryEventCount: number;
  emergencyActive: boolean;
  events: MonitoringEvent[];
};

type MonitoringEvent = {
  id: string;
  timestamp: number;
  label: string;
  kind: "info" | "warning" | "danger";
};

const CONTROL_OPTIONS: Array<{ id: ContributorId; options: Array<{ label: string; value: string }> }> = [
  { id: "routeDeviation", options: [{ label: "Normal", value: "on_route" }, { label: "Minor", value: "minor" }, { label: "Significant", value: "significant" }] },
  { id: "stationaryCondition", options: [{ label: "Moving", value: "moving" }, { label: "Stationary", value: "stationary" }, { label: "Prolonged", value: "prolonged" }] },
  { id: "streetLighting", options: [{ label: "Normal", value: "adequate" }, { label: "Poor", value: "poor" }] },
  { id: "cctvSecurity", options: [{ label: "Available", value: "available" }, { label: "Low / none", value: "unavailable" }] },
  { id: "traffic", options: [{ label: "Normal", value: "normal" }, { label: "Moderate", value: "moderate" }, { label: "Heavy", value: "heavy" }] },
  { id: "areaRisk", options: [{ label: "Low", value: "low" }, { label: "Medium", value: "medium" }, { label: "High", value: "high" }] },
  { id: "roadEnvironment", options: [{ label: "Safe", value: "safe" }, { label: "Unsafe", value: "unsafe" }] },
  { id: "timeContext", options: [{ label: "Normal", value: "normal" }, { label: "High risk", value: "high" }] },
  { id: "locationRisk", options: [{ label: "Low", value: "low" }, { label: "High", value: "high" }] },
];

function clockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function elapsedLabel(seconds: number) {
  return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function riskColor(risk: LocalAnalysis["riskLevel"], colors: ReturnType<typeof useColors>) {
  if (risk === "CRITICAL" || risk === "HIGH") return colors.destructive;
  if (risk === "MEDIUM") return "#b7791f";
  return colors.primary;
}

export function ActiveMonitoring({ draft, onEnded }: { draft: ActiveDraft; onEnded: (summary: JourneySummaryData) => void }) {
  const colors = useColors();
  const startedAt = useRef(Date.now());
  const lastPoint = useRef<Coordinate | null>(draft.currentLocation);
  const stationaryStartedAt = useRef<number | null>(null);
  const previousAnalysis = useRef<LocalAnalysis | null>(null);
  const [current, setCurrent] = useState<Coordinate | null>(draft.currentLocation);
  const [track, setTrack] = useState<Coordinate[]>(draft.currentLocation ? [draft.currentLocation] : []);
  const [elapsed, setElapsed] = useState(0);
  const [stationarySeconds, setStationarySeconds] = useState<number | null>(draft.currentLocation ? 0 : null);
  const [gpsStatus, setGpsStatus] = useState<"WAITING" | "ACTIVE" | "PERMISSION" | "ERROR">("WAITING");
  const [overrides, setOverrides] = useState<TestOverrides>({});
  const [included, setIncluded] = useState<IncludedContributors>(defaultIncluded());
  const [events, setEvents] = useState<MonitoringEvent[]>([{ id: "started", timestamp: startedAt.current, label: "Journey started", kind: "info" }]);
  const [backendAnalysis, setBackendAnalysis] = useState<SafetyAnalysis | null>(null);
  const [sosActive, setSosActive] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [monitoringExpanded, setMonitoringExpanded] = useState(false);

  const analysis = useMemo(() => computeLocalAnalysis({
    current,
    route: draft.selectedRoute,
    stationarySeconds,
    overrides,
    included,
  }), [current, draft.selectedRoute, included, overrides, stationarySeconds]);
  const position = useMemo(() => routePosition(current, draft.selectedRoute), [current, draft.selectedRoute]);
  const testIds = Object.keys(overrides) as ContributorId[];
  const testMode = testIds.length > 0;

  const syncSafety = async (point: Coordinate | null = current, stationary = stationarySeconds) => {
    if (!draft.journeyId || !draft.selectedRoute) return;
    try {
      const result = await analyzeJourneySafety(draft.journeyId, {
        routeId: draft.selectedRoute.routeId,
        routeDeviationMeters: point ? routePosition(point, draft.selectedRoute).deviationMeters ?? undefined : undefined,
        stationarySeconds: stationary ?? undefined,
        speedMetersPerSecond: undefined,
        includedContributors: CONTRIBUTOR_IDS.filter((id) => included[id]),
        testOverrides: overrides,
      });
      setBackendAnalysis(result);
    } catch {
      // Live UI remains local and transparent if a sync tick is unavailable.
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
      if (stationaryStartedAt.current) setStationarySeconds(Math.floor((Date.now() - stationaryStartedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!cancelled) setGpsStatus("PERMISSION");
          return;
        }
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const point = { latitude: location.coords.latitude, longitude: location.coords.longitude };
        const previous = lastPoint.current;
        const movedMeters = previous ? Math.hypot((point.latitude - previous.latitude) * 111_320, (point.longitude - previous.longitude) * 111_320) : 100;
        const speed = Math.max(0, location.coords.speed ?? 0);
        if (movedMeters < 18 && speed < 1.5) {
          if (!stationaryStartedAt.current) stationaryStartedAt.current = Date.now();
          setStationarySeconds(Math.floor((Date.now() - stationaryStartedAt.current) / 1000));
        } else {
          stationaryStartedAt.current = null;
          setStationarySeconds(0);
        }
        lastPoint.current = point;
        setCurrent(point);
        setTrack((points) => [...points.slice(-99), point]);
        setGpsStatus("ACTIVE");
        await addJourneyLocation(draft.journeyId!, {
          ...point,
          recordedAt: new Date().toISOString(),
          accuracyMeters: location.coords.accuracy ?? undefined,
          speedMetersPerSecond: speed,
        });
        await syncSafety(point, stationaryStartedAt.current ? Math.floor((Date.now() - stationaryStartedAt.current) / 1000) : 0);
      } catch {
        if (!cancelled) setGpsStatus("ERROR");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [draft.journeyId]);

  useEffect(() => {
    void syncSafety();
  }, [overrides, included]);

  useEffect(() => {
    const previous = previousAnalysis.current;
    if (!previous) {
      previousAnalysis.current = analysis;
      return;
    }
    const changed: MonitoringEvent | null =
      previous.contributors.find((item) => item.id === "routeDeviation")?.state !== analysis.contributors.find((item) => item.id === "routeDeviation")?.state
        ? { id: `route-${Date.now()}`, timestamp: Date.now(), label: `${analysis.contributors.find((item) => item.id === "routeDeviation")?.state ?? "Route status"} detected`, kind: "warning" }
        : previous.contributors.find((item) => item.id === "stationaryCondition")?.state !== analysis.contributors.find((item) => item.id === "stationaryCondition")?.state
          ? { id: `stationary-${Date.now()}`, timestamp: Date.now(), label: `${analysis.contributors.find((item) => item.id === "stationaryCondition")?.state ?? "Stationary condition"} detected`, kind: "warning" }
          : previous.riskLevel !== analysis.riskLevel && analysis.riskLevel !== "LOW"
            ? { id: `risk-${Date.now()}`, timestamp: Date.now(), label: `${analysis.riskLevel} safety condition detected`, kind: "danger" }
            : null;
    if (changed) {
      setEvents((items) => [changed!, ...items].slice(0, 20));
      const type = changed.id.startsWith("route") ? "DEVIATION" : changed.id.startsWith("stationary") ? "STATIONARY" : null;
      if (type && draft.journeyId && current && !changed.label.includes("ON ROUTE") && !changed.label.includes("MOVING")) {
        void createEmergencyEvent(draft.journeyId, { type, message: changed.label, coordinate: current });
      }
    }
    previousAnalysis.current = analysis;
  }, [analysis, current, draft.journeyId]);

  const chooseTest = (id: ContributorId, value: string) => {
    setOverrides((currentOverrides) => ({ ...currentOverrides, [id]: value }));
    setEvents((items) => [{ id: `test-${id}-${Date.now()}`, timestamp: Date.now(), label: `Test condition: ${CONTRIBUTOR_LABELS[id]} → ${value.replace(/_/g, " ")}`, kind: "info" as const }, ...items].slice(0, 20));
  };
  const resetTests = () => {
    setOverrides({});
    setEvents((items) => [{ id: `reset-${Date.now()}`, timestamp: Date.now(), label: "Test conditions reset to live values", kind: "info" as const }, ...items].slice(0, 20));
  };

  const triggerSos = () => {
    if (sosActive || sosBusy || !draft.journeyId) return;
    Alert.alert("Send emergency SOS?", "This creates a real emergency event for your current journey. Normal safety warnings never send SOS automatically.", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm SOS", style: "destructive", onPress: () => void sendSos() },
    ]);
  };
  const sendSos = async () => {
    if (!draft.journeyId || sosBusy || sosActive) return;
    setSosBusy(true);
    try {
      await createEmergencyEvent(draft.journeyId, { type: "SOS", message: "SOS activated from SafeRide active journey.", coordinate: current ?? undefined });
      setSosActive(true);
      setEvents((items) => [{ id: `sos-${Date.now()}`, timestamp: Date.now(), label: "Emergency SOS activated", kind: "danger" }, ...items]);
    } catch (error) {
      Alert.alert("Unable to send SOS", error instanceof Error && error.message.includes("already") ? "SOS is already active for this journey." : "Please try again or contact local emergency services.");
    } finally {
      setSosBusy(false);
    }
  };

  const endJourney = () => {
    if (ending) return;
    Alert.alert("End SafeRide?", "This stops GPS monitoring and saves the final journey summary.", [
      { text: "Keep monitoring", style: "cancel" },
      { text: "End SafeRide", style: "destructive", onPress: () => void finishJourney() },
    ]);
  };
  const finishJourney = async () => {
    if (!draft.journeyId) return;
    setEnding(true);
    try {
      await completeJourney(draft.journeyId, {
        finalScore: analysis.score,
        finalRiskLevel: analysis.riskLevel,
        routeDeviationCount: events.filter((event) => event.label.toLowerCase().includes("deviation")).length,
        stationaryEventCount: events.filter((event) => event.label.toLowerCase().includes("stationary")).length,
        emergencyActive: sosActive,
      });
    } catch {
      Alert.alert("Unable to end SafeRide", "The final summary could not be saved. Your live monitoring remains active.");
      return;
    } finally {
      setEnding(false);
    }
    onEnded({
      pickup: draft.pickup?.formattedAddress ?? "Current location",
      destination: draft.destination?.formattedAddress ?? "Destination",
      distanceMeters: draft.selectedRoute?.distance ?? 0,
      durationSeconds: draft.selectedRoute?.duration ?? 0,
      elapsedSeconds: elapsed,
      analysis,
      routeDeviationCount: events.filter((event) => event.label.toLowerCase().includes("deviation")).length,
      stationaryEventCount: events.filter((event) => event.label.toLowerCase().includes("stationary")).length,
      emergencyActive: sosActive,
      events,
    });
  };

  const routeContributor = analysis.contributors.find((item) => item.id === "routeDeviation");
  const stationaryContributor = analysis.contributors.find((item) => item.id === "stationaryCondition");
  const scoreColor = riskColor(analysis.riskLevel, colors);

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><View><Text style={[styles.eyebrow, { color: colors.primary }]}>SAFERIDE MONITORING</Text><Text style={[styles.title, { color: colors.foreground }]}>Active journey</Text></View><View style={[styles.modeBadge, { backgroundColor: testMode ? "#fff4d6" : colors.secondary }]}><View style={[styles.modeDot, { backgroundColor: testMode ? "#b7791f" : colors.primary }]} /><Text style={[styles.modeText, { color: testMode ? "#8a5b10" : colors.primary }]}>{testMode ? "TEST MODE" : "LIVE"}</Text></View></View>
      {testMode ? <View style={[styles.testBanner, { backgroundColor: "#fff7df", borderColor: "#edc66d" }]}><Feather name="tool" size={16} color="#8a5b10" /><Text style={[styles.testBannerText, { color: "#8a5b10" }]}>Simulated conditions active: {testIds.map((id) => CONTRIBUTOR_LABELS[id]).join(", ")}. No SOS is sent by testing.</Text></View> : null}
      <MapPreview pickup={draft.pickup} destination={draft.destination} currentLocation={current} routes={draft.routes} selectedRouteId={draft.selectedRoute?.routeId} height={360} />
      <View style={[styles.liveStrip, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.liveItem}><Text style={[styles.liveLabel, { color: colors.mutedForeground }]}>LIVE STATUS</Text><Text style={[styles.liveValue, { color: colors.primary }]}>MONITORING</Text></View><View style={styles.liveItem}><Text style={[styles.liveLabel, { color: colors.mutedForeground }]}>GPS STATUS</Text><Text style={[styles.liveValue, { color: gpsStatus === "ACTIVE" ? colors.primary : "#b7791f" }]}>{gpsStatus === "ACTIVE" ? "ACTIVE" : gpsStatus === "PERMISSION" ? "PERMISSION NEEDED" : gpsStatus}</Text></View><View style={styles.liveItem}><Text style={[styles.liveLabel, { color: colors.mutedForeground }]}>ROUTE STATUS</Text><Text style={[styles.liveValue, { color: routeContributor?.penalty ? colors.destructive : colors.primary }]}>{routeContributor?.state ?? "WAITING"}</Text></View></View>
      <View style={[styles.scoreCard, { backgroundColor: colors.card, borderColor: scoreColor }]}><View style={styles.scoreHeader}><View><Text style={[styles.scoreEyebrow, { color: colors.mutedForeground }]}>SAFETY SCORE</Text><Text style={[styles.scoreValue, { color: scoreColor }]}>{analysis.score == null ? "—" : `${analysis.score}`}<Text style={styles.scoreMax}> / 100</Text></Text></View><View style={[styles.riskBadge, { backgroundColor: `${scoreColor}18` }]}><Feather name={analysis.riskLevel === "LOW" ? "shield" : "alert-triangle"} size={16} color={scoreColor} /><Text style={[styles.riskText, { color: scoreColor }]}>{analysis.riskLevel} RISK</Text></View></View><Text style={[styles.scoreMessage, { color: colors.mutedForeground }]}>{analysis.message}</Text><View style={[styles.scoreBar, { backgroundColor: colors.muted }]}><View style={[styles.scoreFill, { backgroundColor: scoreColor, width: `${analysis.score ?? 0}%` }]} /></View></View>
      <View style={[styles.metricsCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Metric icon="navigation" label="Distance travelled" value={formatDistance(Math.max(0, (draft.selectedRoute?.distance ?? 0) - (position.remainingMeters ?? 0)))} colors={colors} /><Metric icon="flag" label="Distance remaining" value={formatDistance(position.remainingMeters)} colors={colors} /><Metric icon="clock" label="ETA" value={draft.selectedRoute ? formatDuration(draft.selectedRoute.duration) : "—"} colors={colors} /><Metric icon="activity" label="Elapsed journey time" value={elapsedLabel(elapsed)} colors={colors} /></View>
      <View style={[styles.statusRow, { backgroundColor: colors.card, borderColor: colors.border }]}><StatusPill label={routeContributor?.state ?? "WAITING FOR GPS"} icon="map-pin" colors={colors} danger={Boolean(routeContributor?.penalty)} /><StatusPill label={stationaryContributor?.state ?? "WAITING FOR GPS"} icon="pause-circle" colors={colors} danger={Boolean(stationaryContributor?.penalty)} /><Text style={[styles.backendSync, { color: colors.mutedForeground }]}>{backendAnalysis ? "Backend rules synced" : "Syncing rules…"}</Text></View>
      <SectionTitle title="Safety analysis" subtitle="Each assessed factor explains its current impact." colors={colors} />
      <View style={styles.contributorGrid}>{analysis.contributors.map((item) => <ContributorCard key={item.id} item={item} colors={colors} onToggle={(value) => setIncluded((currentIncluded) => ({ ...currentIncluded, [item.id]: value }))} />)}</View>
      <Pressable onPress={() => setMonitoringExpanded((value) => !value)} style={[styles.sectionToggle, { borderColor: colors.border, backgroundColor: colors.card }]}><View><Text style={[styles.sectionToggleTitle, { color: colors.foreground }]}>Manual contributor testing</Text><Text style={[styles.sectionToggleBody, { color: colors.mutedForeground }]}>Simulate every condition without creating a real SOS.</Text></View><Feather name={monitoringExpanded ? "chevron-up" : "chevron-down"} size={20} color={colors.mutedForeground} /></Pressable>
      {monitoringExpanded ? <View style={[styles.testingCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.testingHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Test controls</Text><Pressable onPress={resetTests}><Text style={[styles.resetText, { color: colors.primary }]}>Reset test conditions</Text></Pressable></View>{CONTROL_OPTIONS.map((control) => <TestControl key={control.id} id={control.id} options={control.options} selected={overrides[control.id]} onChoose={chooseTest} colors={colors} />)}</View> : null}
      <SectionTitle title="Recent events" subtitle="Only meaningful state changes are recorded." colors={colors} />
      <View style={[styles.eventsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>{events.slice(0, 8).map((event) => <View key={event.id} style={styles.eventRow}><View style={[styles.eventDot, { backgroundColor: event.kind === "danger" ? colors.destructive : event.kind === "warning" ? "#b7791f" : colors.primary }]} /><Text style={[styles.eventTime, { color: colors.mutedForeground }]}>{clockTime(event.timestamp)}</Text><Text style={[styles.eventLabel, { color: colors.foreground }]}>{event.label}</Text></View>)}</View>
      <Pressable onPress={triggerSos} disabled={sosBusy || sosActive} style={[styles.sosButton, { backgroundColor: sosActive ? "#6b7d73" : colors.destructive, opacity: sosBusy ? 0.7 : 1 }]}><Feather name={sosActive ? "check-circle" : "alert-triangle"} size={20} color={colors.destructiveForeground} /><Text style={[styles.sosText, { color: colors.destructiveForeground }]}>{sosBusy ? "Sending emergency…" : sosActive ? "Emergency active" : "Emergency SOS"}</Text></Pressable>
      {sosActive ? <View style={[styles.emergencyCard, { backgroundColor: "#fff1f1", borderColor: colors.destructive }]}><Feather name="alert-circle" size={18} color={colors.destructive} /><View style={{ flex: 1 }}><Text style={[styles.emergencyTitle, { color: colors.destructive }]}>Emergency Active</Text><Text style={[styles.emergencyText, { color: colors.foreground }]}>Latest location captured and associated with this journey at {clockTime(Date.now())}.</Text></View></View> : null}
      <Pressable onPress={endJourney} disabled={ending} style={[styles.endButton, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[styles.endButtonText, { color: colors.foreground }]}>{ending ? "Saving journey…" : "End SafeRide"}</Text></Pressable>
      {gpsStatus === "PERMISSION" ? <Text style={[styles.permissionNote, { color: colors.mutedForeground }]}>Allow foreground location access to enable live GPS, route deviation, and stationary monitoring.</Text> : null}
    </ScrollView>
  );
}

function Metric({ icon, label, value, colors }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.metric}><Feather name={icon} size={17} color={colors.primary} /><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text></View>;
}

function StatusPill({ label, icon, colors, danger }: { label: string; icon: keyof typeof Feather.glyphMap; colors: ReturnType<typeof useColors>; danger: boolean }) {
  return <View style={[styles.statusPill, { backgroundColor: danger ? "#fff1f1" : colors.secondary }]}><Feather name={icon} size={14} color={danger ? colors.destructive : colors.primary} /><Text numberOfLines={1} style={[styles.statusPillText, { color: danger ? colors.destructive : colors.primary }]}>{label}</Text></View>;
}

function SectionTitle({ title, subtitle, colors }: { title: string; subtitle: string; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text></View>;
}

function ContributorCard({ item, colors, onToggle }: { item: LocalAnalysis["contributors"][number]; colors: ReturnType<typeof useColors>; onToggle: (included: boolean) => void }) {
  const color = item.impact === "CRITICAL" || item.impact === "HIGH" ? colors.destructive : item.impact === "MEDIUM" ? "#b7791f" : colors.primary;
  return <View style={[styles.contributorCard, { backgroundColor: colors.card, borderColor: item.source === "TEST" ? "#edc66d" : colors.border }]}><View style={styles.contributorTop}><View style={{ flex: 1 }}><Text style={[styles.contributorLabel, { color: colors.foreground }]}>{item.label}</Text><Text style={[styles.contributorState, { color }]}>{item.state}</Text></View><View style={[styles.impactBadge, { backgroundColor: item.impact === "NOT_ASSESSED" ? colors.muted : `${color}18` }]}><Text style={[styles.impactText, { color: item.impact === "NOT_ASSESSED" ? colors.mutedForeground : color }]}>{item.impact === "NOT_ASSESSED" ? "NOT ASSESSED" : `${item.impact} IMPACT`}</Text></View></View><View style={styles.contributorBottom}><Text style={[styles.contributorSource, { color: colors.mutedForeground }]}>{item.source === "TEST" ? "TEST CONDITION" : item.source === "LIVE" ? "LIVE SIGNAL" : "LIVE DATA UNAVAILABLE"}</Text><View style={styles.includeToggle}><Text style={[styles.includeLabel, { color: colors.mutedForeground }]}>Include</Text><Switch value={item.included} onValueChange={onToggle} trackColor={{ false: colors.border, true: colors.secondary }} thumbColor={item.included ? colors.primary : colors.mutedForeground} /></View></View></View>;
}

function TestControl({ id, options, selected, onChoose, colors }: { id: ContributorId; options: Array<{ label: string; value: string }>; selected?: string; onChoose: (id: ContributorId, value: string) => void; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.control}><Text style={[styles.controlLabel, { color: colors.foreground }]}>{CONTRIBUTOR_LABELS[id]}</Text><View style={styles.controlOptions}>{options.map((option) => <Pressable key={option.value} onPress={() => onChoose(id, option.value)} style={[styles.option, { backgroundColor: selected === option.value ? "#fff4d6" : colors.secondary, borderColor: selected === option.value ? "#edc66d" : colors.border }]}><Text style={[styles.optionText, { color: selected === option.value ? "#8a5b10" : colors.foreground }]}>{option.label}</Text></Pressable>)}</View></View>;
}

export function JourneySummaryScreen({ summary, onDone }: { summary: JourneySummaryData; onDone: () => void }) {
  const colors = useColors();
  const scoreColor = riskColor(summary.analysis.riskLevel, colors);
  return <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}><View style={styles.summaryHero}><View style={[styles.summaryCheck, { backgroundColor: colors.secondary }]}><Feather name="check" size={29} color={colors.primary} /></View><Text style={[styles.summaryTitle, { color: colors.foreground }]}>Journey completed</Text><Text style={[styles.summarySub, { color: colors.mutedForeground }]}>Your SafeRide monitoring session has been saved.</Text></View><View style={[styles.finalScore, { backgroundColor: colors.card, borderColor: scoreColor }]}><Text style={[styles.scoreEyebrow, { color: colors.mutedForeground }]}>FINAL SAFETY SCORE</Text><Text style={[styles.finalScoreValue, { color: scoreColor }]}>{summary.analysis.score == null ? "—" : summary.analysis.score}<Text style={styles.scoreMax}> / 100</Text></Text><Text style={[styles.finalRisk, { color: scoreColor }]}>{summary.analysis.riskLevel} RISK</Text></View><View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}><SummaryLine label="Source" value={summary.pickup} colors={colors} /><SummaryLine label="Destination" value={summary.destination} colors={colors} /><SummaryLine label="Planned distance" value={formatDistance(summary.distanceMeters)} colors={colors} /><SummaryLine label="Elapsed journey time" value={elapsedLabel(summary.elapsedSeconds)} colors={colors} /><SummaryLine label="Route deviations" value={String(summary.routeDeviationCount)} colors={colors} /><SummaryLine label="Stationary events" value={String(summary.stationaryEventCount)} colors={colors} /><SummaryLine label="Emergency status" value={summary.emergencyActive ? "Emergency active" : "No SOS activated"} colors={colors} last /></View><SectionTitle title="Safety analysis summary" subtitle="The contributors captured at the moment SafeRide ended." colors={colors} /><View style={[styles.eventsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>{summary.analysis.contributors.map((item) => <View key={item.id} style={styles.finalContributor}><Text style={[styles.eventLabel, { color: colors.foreground }]}>{item.label}</Text><Text style={[styles.finalContributorValue, { color: item.impact === "HIGH" || item.impact === "CRITICAL" ? colors.destructive : colors.mutedForeground }]}>{item.state} · {item.impact === "NOT_ASSESSED" ? "Not assessed" : `${item.impact} impact`}</Text></View>)}</View><Pressable onPress={onDone} style={[styles.doneButton, { backgroundColor: colors.primary }]}><Text style={[styles.doneText, { color: colors.primaryForeground }]}>Back to dashboard</Text></Pressable></ScrollView>;
}

function SummaryLine({ label, value, colors, last }: { label: string; value: string; colors: ReturnType<typeof useColors>; last?: boolean }) {
  return <View style={[styles.summaryLine, !last && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}><Text style={[styles.summaryLineLabel, { color: colors.mutedForeground }]}>{label}</Text><Text numberOfLines={2} style={[styles.summaryLineValue, { color: colors.foreground }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, marginTop: 5 },
  modeBadge: { borderRadius: 30, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  modeDot: { width: 8, height: 8, borderRadius: 4 },
  modeText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.7 },
  testBanner: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: "row", gap: 8, alignItems: "center" },
  testBannerText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  liveStrip: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", justifyContent: "space-between" },
  liveItem: { flex: 1, gap: 3 },
  liveLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.6 },
  liveValue: { fontFamily: "Inter_700Bold", fontSize: 10 },
  scoreCard: { borderWidth: 1.5, borderRadius: 19, padding: 16, gap: 10 },
  scoreHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  scoreEyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.8 },
  scoreValue: { fontFamily: "Inter_700Bold", fontSize: 45, lineHeight: 52, marginTop: 3 },
  scoreMax: { fontFamily: "Inter_500Medium", fontSize: 17, color: "#6b7d73" },
  riskBadge: { borderRadius: 30, paddingVertical: 9, paddingHorizontal: 11, flexDirection: "row", gap: 6, alignItems: "center" },
  riskText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  scoreMessage: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  scoreBar: { height: 7, borderRadius: 5, overflow: "hidden" },
  scoreFill: { height: 7, borderRadius: 5 },
  metricsCard: { borderWidth: 1, borderRadius: 17, padding: 13, flexDirection: "row", flexWrap: "wrap" },
  metric: { width: "50%", padding: 7, gap: 4 },
  metricLabel: { fontFamily: "Inter_400Regular", fontSize: 10 },
  metricValue: { fontFamily: "Inter_700Bold", fontSize: 15 },
  statusRow: { borderWidth: 1, borderRadius: 16, padding: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  statusPill: { maxWidth: "35%", borderRadius: 30, paddingVertical: 7, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  statusPillText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  backendSync: { flex: 1, textAlign: "right", fontFamily: "Inter_400Regular", fontSize: 10 },
  sectionHeader: { gap: 3, marginTop: 4 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  sectionSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12 },
  contributorGrid: { gap: 9 },
  contributorCard: { borderWidth: 1, borderRadius: 15, padding: 13, gap: 10 },
  contributorTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  contributorLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  contributorState: { fontFamily: "Inter_700Bold", fontSize: 11, marginTop: 4 },
  impactBadge: { borderRadius: 20, paddingVertical: 6, paddingHorizontal: 7 },
  impactText: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.35 },
  contributorBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  contributorSource: { fontFamily: "Inter_500Medium", fontSize: 9, letterSpacing: 0.4 },
  includeToggle: { flexDirection: "row", alignItems: "center", gap: 3 },
  includeLabel: { fontFamily: "Inter_400Regular", fontSize: 10 },
  sectionToggle: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionToggleTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sectionToggleBody: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 },
  testingCard: { borderWidth: 1, borderRadius: 17, padding: 14, gap: 14 },
  testingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resetText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  control: { gap: 7 },
  controlLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  controlOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: { borderWidth: 1, borderRadius: 11, paddingVertical: 7, paddingHorizontal: 9 },
  optionText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  eventsCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 13 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#edf2ee" },
  eventDot: { width: 7, height: 7, borderRadius: 4 },
  eventTime: { fontFamily: "Inter_500Medium", fontSize: 10, width: 43 },
  eventLabel: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12 },
  sosButton: { minHeight: 57, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  sosText: { fontFamily: "Inter_700Bold", fontSize: 15 },
  emergencyCard: { borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: "row", gap: 9 },
  emergencyTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  emergencyText: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 4 },
  endButton: { borderWidth: 1, minHeight: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  endButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  permissionNote: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", lineHeight: 17 },
  summaryHero: { alignItems: "center", paddingVertical: 13, gap: 7 },
  summaryCheck: { width: 62, height: 62, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontFamily: "Inter_700Bold", fontSize: 24 },
  summarySub: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
  finalScore: { borderWidth: 1.5, borderRadius: 19, padding: 18, alignItems: "center" },
  finalScoreValue: { fontFamily: "Inter_700Bold", fontSize: 47, marginTop: 5 },
  finalRisk: { fontFamily: "Inter_700Bold", fontSize: 12, marginTop: 3, letterSpacing: 0.8 },
  summaryCard: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14 },
  summaryLine: { paddingVertical: 13, gap: 4 },
  summaryLineLabel: { fontFamily: "Inter_500Medium", fontSize: 10 },
  summaryLineValue: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
  finalContributor: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#edf2ee", gap: 4 },
  finalContributorValue: { fontFamily: "Inter_500Medium", fontSize: 11 },
  doneButton: { minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  doneText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});