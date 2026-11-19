import { Linking, Platform, Alert } from "react-native";
import type { EmergencyPayload } from "./threat";
import { formatEmergencyMessage } from "./threat";
import { getToken } from "./session";

export type DispatchResult = {
  success: boolean;
  channel: "sms" | "whatsapp" | "phone";
  message?: string;
};

/**
 * Automated Cloud SMS Service
 * Dispatches automated SMS alerts via the backend server to all contacts without user interaction.
 */
export async function dispatchEmergencySmsBackend(
  journeyId: string,
  reason: string,
  payload: EmergencyPayload
): Promise<boolean> {
  try {
    const token = await getToken();
    const baseUrl = process.env.EXPO_PUBLIC_DOMAIN || "http://localhost:8080";
    const res = await fetch(`${baseUrl}/api/journeys/${journeyId}/dispatch-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        reason,
        latitude: payload.latitude,
        longitude: payload.longitude,
        threatScore: payload.threatScore,
        riskTier: payload.tier,
      }),
    });
    return res.ok;
  } catch (error) {
    console.warn("Backend automated SMS dispatch error:", error);
    return false;
  }
}

/**
 * Dispatch emergency SMS to one or multiple contact phone numbers
 * Opens native messaging client with pre-populated phone numbers & SOS body
 */
export async function dispatchEmergencySms(
  phones: string[],
  payload: EmergencyPayload
): Promise<DispatchResult> {
  const body = formatEmergencyMessage(payload);
  const cleanPhones = phones.map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.length >= 7);

  if (cleanPhones.length === 0) {
    // If no specific contact phone, open SMS composer with just the body
    const fallbackUrl = Platform.OS === "ios"
      ? `sms:&body=${encodeURIComponent(body)}`
      : `sms:?body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(fallbackUrl);
      return { success: true, channel: "sms" };
    } catch {
      return { success: false, channel: "sms", message: "Could not open SMS application." };
    }
  }

  // Formatting for multiple recipients:
  // iOS uses ';' separator: sms:1234;5678&body=...
  // Android uses ',' separator: sms:1234,5678?body=...
  const phoneSeparator = Platform.OS === "ios" ? ";" : ",";
  const recipients = cleanPhones.join(phoneSeparator);
  const prefix = Platform.OS === "ios" ? `sms:${recipients}&body=` : `sms:${recipients}?body=`;
  const url = `${prefix}${encodeURIComponent(body)}`;

  try {
    const supported = await Linking.canOpenURL(url).catch(() => true);
    if (supported) {
      await Linking.openURL(url);
      return { success: true, channel: "sms" };
    } else {
      // Try generic SMS fallback
      await Linking.openURL(`sms:?body=${encodeURIComponent(body)}`);
      return { success: true, channel: "sms" };
    }
  } catch (error) {
    console.warn("SMS dispatch failed:", error);
    return {
      success: false,
      channel: "sms",
      message: "Unable to launch SMS composer. Please send alert manually.",
    };
  }
}

/**
 * Share emergency alert via WhatsApp to a specific number or general WhatsApp broadcast
 */
export async function dispatchEmergencyWhatsApp(
  payload: EmergencyPayload,
  phone?: string
): Promise<DispatchResult> {
  const body = formatEmergencyMessage(payload);
  const cleanPhone = phone ? phone.replace(/[^\d]/g, "") : "";

  // If phone provided: https://wa.me/{phone}?text=...
  // Else: https://api.whatsapp.com/send?text=...
  const url = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(body)}`;

  try {
    await Linking.openURL(url);
    return { success: true, channel: "whatsapp" };
  } catch (error) {
    console.warn("WhatsApp dispatch failed:", error);
    return {
      success: false,
      channel: "whatsapp",
      message: "WhatsApp is not installed on this device.",
    };
  }
}

/**
 * Direct phone call trigger to emergency services (112 / Police)
 */
export async function callEmergencyServices(number = "112"): Promise<void> {
  const url = `tel:${number}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Call failed", `Please dial ${number} manually on your phone.`);
  }
}
