import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { ThreatTier } from "@/lib/threat";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  tier: ThreatTier;                   // "high" or "critical"
  threatScore: number;
  triggerReason: string;              // human-readable reason for the check-in
  countdownSeconds?: number;          // default 30
  onSafe: () => void;                 // user says they are safe
  onSos: () => void;                  // user requests SOS
  onTimeout: () => void;              // no response → auto-escalate
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SafetyCheckinModal({
  visible,
  tier,
  threatScore,
  triggerReason,
  countdownSeconds = 30,
  onSafe,
  onSos,
  onTimeout,
}: Props) {
  const colors = useColors();
  const [remaining, setRemaining] = useState(countdownSeconds);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulsRef = useRef<Animated.CompositeAnimation | null>(null);

  // Reset countdown every time modal becomes visible
  useEffect(() => {
    if (!visible) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pulsRef.current) pulsRef.current.stop();
      setRemaining(countdownSeconds);
      return;
    }

    setRemaining(countdownSeconds);

    // Pulse animation on the border/ring
    pulsRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    pulsRef.current.start();

    // Vibrate immediately + at 15s mark
    Vibration.vibrate([0, 400, 200, 400]);

    // Countdown
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timerRef.current!);
          Vibration.vibrate([0, 600, 200, 600, 200, 600]); // triple burst = urgent
          return 0;
        }
        // Vibrate at 15s remaining as second warning
        if (r === 16) Vibration.vibrate([0, 300, 150, 300]);
        return r - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pulsRef.current) pulsRef.current.stop();
    };
  }, [visible, countdownSeconds]);

  // Auto-escalate when timer hits 0
  useEffect(() => {
    if (visible && remaining === 0) {
      onTimeout();
    }
  }, [remaining, visible]);

  const isCritical = tier === "critical";
  const accentColor = isCritical ? "#e53e3e" : "#c05621";
  const bgColor = isCritical ? "#fff5f5" : "#fffaf0";

  // Progress for countdown ring (0→1)
  const progress = remaining / countdownSeconds;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: bgColor, borderColor: accentColor },
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          {/* Header */}
          <View style={[styles.iconRow, { backgroundColor: `${accentColor}18` }]}>
            <Feather name="alert-triangle" size={30} color={accentColor} />
          </View>
          <Text style={[styles.heading, { color: accentColor }]}>
            {isCritical ? "CRITICAL SAFETY ALERT" : "SAFETY CHECK-IN"}
          </Text>
          <Text style={[styles.score, { color: accentColor }]}>
            Threat Score: <Text style={styles.scoreBold}>{threatScore}/100</Text>
          </Text>

          {/* Reason */}
          <View style={[styles.reasonBox, { borderColor: accentColor + "44", backgroundColor: accentColor + "0d" }]}>
            <Feather name="info" size={14} color={accentColor} />
            <Text style={[styles.reason, { color: accentColor }]}>{triggerReason}</Text>
          </View>

          {/* Countdown ring */}
          <View style={styles.countdownContainer}>
            <CountdownRing
              progress={progress}
              remaining={remaining}
              total={countdownSeconds}
              color={accentColor}
            />
          </View>

          <Text style={[styles.countdownLabel, { color: colors.mutedForeground }]}>
            {remaining > 0
              ? "No response = automatic emergency alert sent"
              : "Alerting your emergency contacts…"}
          </Text>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Pressable
              onPress={onSafe}
              style={[styles.safeButton, { backgroundColor: "#276749" }]}
            >
              <Feather name="check-circle" size={19} color="#fff" />
              <Text style={styles.safeButtonText}>I am Safe</Text>
            </Pressable>

            <Pressable
              onPress={onSos}
              style={[styles.sosButton, { backgroundColor: accentColor }]}
            >
              <Feather name="alert-octagon" size={19} color="#fff" />
              <Text style={styles.sosButtonText}>Send SOS Now</Text>
            </Pressable>
          </View>

          {/* Reassurance note */}
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Tapping "I am Safe" stops all alerts immediately.{"\n"}
            No SOS is sent until you confirm or the timer expires.
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Countdown Ring (SVG-free circular timer) ─────────────────────────────────

function CountdownRing({
  progress,
  remaining,
  total,
  color,
}: {
  progress: number;
  remaining: number;
  total: number;
  color: string;
}) {
  // Simple text-based ring using border trick
  const SIZE = 88;
  const urgentColor = progress < 0.35 ? "#e53e3e" : progress < 0.6 ? "#c05621" : color;

  return (
    <View style={[styles.ring, { borderColor: urgentColor, width: SIZE, height: SIZE, borderRadius: SIZE / 2 }]}>
      <Text style={[styles.ringNumber, { color: urgentColor }]}>{remaining}</Text>
      <Text style={[styles.ringLabel, { color: urgentColor }]}>sec</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#00000088",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 22,
    borderWidth: 2,
    padding: 22,
    gap: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  iconRow: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    letterSpacing: 0.6,
    textAlign: "center",
  },
  score: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  scoreBold: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  reasonBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: 11,
    padding: 10,
    width: "100%",
  },
  reason: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 17,
  },
  countdownContainer: {
    alignItems: "center",
    marginVertical: 4,
  },
  ring: {
    borderWidth: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  ringNumber: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    lineHeight: 30,
  },
  ringLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  countdownLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  safeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 50,
    borderRadius: 14,
  },
  safeButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#fff",
  },
  sosButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 50,
    borderRadius: 14,
  },
  sosButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#fff",
  },
  note: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    textAlign: "center",
    lineHeight: 14,
  },
});
