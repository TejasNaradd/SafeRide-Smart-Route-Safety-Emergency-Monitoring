import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MapPreview } from "./MapPreview";
import { getJourney, type Journey } from "@workspace/api-client-react";
import { formatDistance, formatDuration } from "@/lib/geo";

type JourneyDetail = Journey & {
  routePoints?: Array<{ latitude: number; longitude: number; sequence: number }>;
  locationPoints?: Array<{ latitude: number; longitude: number; recordedAt: string; accuracyMeters?: number; speedMetersPerSecond?: number }>;
  emergencyEvents?: Array<{ id: string; type: string; message: string; coordinate?: { latitude: number; longitude: number }; createdAt: string }>;
};

type Props = {
  journeyId: string;
  visible: boolean;
  onClose: () => void;
};

export function JourneyDetailModal({ journeyId, visible, onClose }: Props) {
  const colors = useColors();
  const [journey, setJourney] = useState<JourneyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible || !journeyId) return;
    
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getJourney(journeyId) as JourneyDetail;
        setJourney(data);
      } catch {
        setError("Unable to load journey details. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [journeyId, visible]);

  const statusColor = (status: string) => {
    if (status === "COMPLETED") return "#16a34a";
    if (status === "ACTIVE") return colors.primary;
    if (status === "CANCELLED") return "#dc2626";
    return colors.mutedForeground;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading journey details...</Text>
        </View>
      );
    }

    if (error || !journey) {
      return (
        <View style={styles.centerContent}>
          <Feather name="alert-circle" size={48} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error || "Journey not found"}</Text>
          <Pressable onPress={onClose} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Close</Text>
          </Pressable>
        </View>
      );
    }

    const pickup = { latitude: journey.pickupCoordinate.latitude, longitude: journey.pickupCoordinate.longitude, placeId: journey.pickupPlaceId || "pickup", name: journey.pickup, formattedAddress: journey.pickup };
    const destination = { latitude: journey.destinationCoordinate.latitude, longitude: journey.destinationCoordinate.longitude, placeId: journey.destinationPlaceId || "dest", name: journey.destination, formattedAddress: journey.destination };
    const breadcrumbs = journey.locationPoints || [];
    const routes = journey.routePoints ? [{ routeId: journey.selectedRouteId || "main", points: journey.routePoints, distance: journey.routeDistanceMeters, duration: journey.routeDurationSeconds, safetyStatus: "PENDING" as const, safetyScore: null, riskLevel: "UNKNOWN" as const }] : [];

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Journey Details</Text>
            <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
              {new Date(journey.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(journey.status) + "20", borderColor: statusColor(journey.status) }]}>
            <Text style={[styles.statusText, { color: statusColor(journey.status) }]}>{journey.status}</Text>
          </View>
        </View>

        {/* Map */}
        <MapPreview pickup={pickup} destination={destination} routes={routes} selectedRouteId={journey.selectedRouteId} height={320} />

        {/* Route Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <InfoRow icon="map-pin" label="Pickup" value={journey.pickup} colors={colors} />
          <InfoRow icon="flag" label="Destination" value={journey.destination} colors={colors} />
          <InfoRow icon="navigation" label="Distance" value={formatDistance(journey.routeDistanceMeters)} colors={colors} />
          <InfoRow icon="clock" label="Duration" value={formatDuration(journey.routeDurationSeconds)} colors={colors} last />
        </View>

        {/* GPS Tracking Summary */}
        {breadcrumbs.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.secondary }]}>
            <View style={styles.sectionHeader}>
              <Feather name="activity" size={18} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>GPS Tracking</Text>
            </View>
            <Text style={[styles.sectionBody, { color: colors.mutedForeground }]}>
              {breadcrumbs.length} location points recorded during this journey.
            </Text>
          </View>
        )}

        {/* Emergency Events */}
        {journey.emergencyEvents && journey.emergencyEvents.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.destructive + "10", borderColor: colors.destructive }]}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-triangle" size={18} color={colors.destructive} />
              <Text style={[styles.sectionTitle, { color: colors.destructive }]}>Emergency Events</Text>
            </View>
            {journey.emergencyEvents.map((ev) => (
              <View key={ev.id} style={[styles.eventRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.eventIcon, { backgroundColor: colors.destructive + "20" }]}>
                  <Feather name={ev.type === "SOS" ? "alert-octagon" : "alert-circle"} size={14} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventType, { color: colors.foreground }]}>{ev.type}</Text>
                  <Text style={[styles.eventMessage, { color: colors.mutedForeground }]}>{ev.message}</Text>
                  <Text style={[styles.eventTime, { color: colors.mutedForeground }]}>
                    {new Date(ev.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Close Button */}
        <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.closeBtnText, { color: colors.primaryForeground }]}>Close</Text>
        </Pressable>
      </ScrollView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backButton}>
            <Feather name="x" size={24} color={colors.foreground} />
          </Pressable>
        </View>
        {renderContent()}
      </View>
    </Modal>
  );
}

function InfoRow({ icon, label, value, colors, last }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; colors: ReturnType<typeof useColors>; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
      <Feather name={icon} size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 20, gap: 16, paddingBottom: 40 },
  centerContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 16 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 15 },
  errorText: { fontFamily: "Inter_600SemiBold", fontSize: 16, textAlign: "center" },
  retryBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 24 },
  dateText: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  statusText: { fontFamily: "Inter_700Bold", fontSize: 12, textTransform: "uppercase" },
  infoCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  infoLabel: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 2 },
  infoValue: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  section: { padding: 16, borderRadius: 14, gap: 8, borderWidth: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sectionBody: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  eventRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1 },
  eventIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  eventType: { fontFamily: "Inter_700Bold", fontSize: 13, textTransform: "uppercase" },
  eventMessage: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  eventTime: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 },
  closeBtn: { marginTop: 8, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  closeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
});
