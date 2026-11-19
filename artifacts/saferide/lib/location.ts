import * as Location from "expo-location";
import { Platform, Alert, Linking } from "react-native";

export type LocationStatus =
  | "GRANTED"
  | "SERVICES_DISABLED"
  | "DENIED"
  | "BLOCKED";

export type LocationPermissionResult = {
  status: LocationStatus;
  message?: string;
};

/**
 * Comprehensive location permission & service checker
 * - Checks if GPS/Location Services are enabled on device
 * - Requests foreground location permission if not granted
 * - Returns actionable status codes
 */
export async function ensureLocationPermission(): Promise<LocationPermissionResult> {
  try {
    // Step 1: Check if location services (GPS toggle) are enabled on device
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return {
        status: "SERVICES_DISABLED",
        message: "Location services are turned off. Please enable GPS in device settings.",
      };
    }

    // Step 2: Check current permission status
    const { status: currentStatus } = await Location.getForegroundPermissionsAsync();
    
    if (currentStatus === "granted") {
      return { status: "GRANTED" };
    }

    // Step 3: Request permission if not granted
    const { status: requestedStatus, canAskAgain } = await Location.requestForegroundPermissionsAsync();

    if (requestedStatus === "granted") {
      return { status: "GRANTED" };
    }

    // Permission denied
    if (!canAskAgain) {
      return {
        status: "BLOCKED",
        message: "Location permission was permanently denied. Please enable it in device settings.",
      };
    }

    return {
      status: "DENIED",
      message: "Location permission is required for journey tracking and safety monitoring.",
    };
  } catch (error) {
    return {
      status: "DENIED",
      message: "Unable to access location services. Please check device settings.",
    };
  }
}

/**
 * Open device settings for the user to manually enable location permission
 */
export function openLocationSettings() {
  if (Platform.OS === "ios") {
    Linking.openURL("app-settings:");
  } else if (Platform.OS === "android") {
    Linking.openSettings();
  }
}

/**
 * Show a user-friendly alert prompting to enable GPS/Location Services
 */
export function showLocationServicesAlert() {
  Alert.alert(
    "GPS is turned off",
    "SafeRide requires GPS to track your journey and provide safety monitoring. Please turn on Location Services in your device settings.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: openLocationSettings },
    ]
  );
}

/**
 * Show alert prompting user to grant location permission in settings
 */
export function showPermissionBlockedAlert() {
  Alert.alert(
    "Location Permission Required",
    "SafeRide needs location permission to track your journey. Please enable location access in device settings.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: openLocationSettings },
    ]
  );
}
