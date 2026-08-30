import type { Coordinate, RoutePoint } from "@workspace/api-client-react";

export type Place = Coordinate & {
  placeId: string;
  name: string;
  formattedAddress: string;
};

export type CandidateRoute = {
  routeId: string;
  points: RoutePoint[];
  distance: number;
  duration: number;
  traffic?: string;
  safetyStatus: "PENDING" | "AVAILABLE" | "UNAVAILABLE";
  safetyScore?: number | null;
  riskLevel: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
};

type NominatimItem = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: { city?: string; town?: string; village?: string; state?: string; country?: string };
};

const headers = {
  Accept: "application/json",
  "User-Agent": "SafeRide/1.0 (journey safety app)",
};

export async function searchLocations(query: string): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("location-search");
  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => ({
    placeId: String(item.place_id),
    name: item.name ?? item.display_name.split(",")[0],
    formattedAddress: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  }));
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<Place> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("reverse-geocode");
  const item = (await response.json()) as NominatimItem;
  return {
    placeId: String(item.place_id),
    name: item.name ?? item.address?.city ?? item.address?.town ?? "Current location",
    formattedAddress: item.display_name,
    latitude,
    longitude,
  };
}

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
};

export async function calculateRoutes(origin: Coordinate, destination: Coordinate): Promise<CandidateRoute[]> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?alternatives=true&steps=false&overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("routing");
  const data = (await response.json()) as { code: string; routes?: OsrmRoute[] };
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("routing-empty");
  return data.routes.map((route, index) => ({
    routeId: `osrm-${index + 1}`,
    points: route.geometry.coordinates.map(([longitude, latitude], sequence) => ({ latitude, longitude, sequence })),
    distance: route.distance,
    duration: route.duration,
    safetyStatus: "PENDING",
    safetyScore: null,
    riskLevel: "UNKNOWN",
  }));
}

export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}