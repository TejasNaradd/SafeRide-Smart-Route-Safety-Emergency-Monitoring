import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useColors } from "@/hooks/useColors";
import type { CandidateRoute, Place } from "@/lib/geo";
import type { Coordinate } from "@workspace/api-client-react";

type Props = {
  pickup?: Place | null;
  destination?: Place | null;
  currentLocation?: Coordinate | null;
  routes?: CandidateRoute[];
  selectedRouteId?: string | null;
  height?: number;
  showSafetyLayers?: boolean;
};

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function MapPreview({
  pickup,
  destination,
  currentLocation,
  routes = [],
  selectedRouteId,
  height = 300,
  showSafetyLayers = true,
}: Props) {
  const colors = useColors();
  const html = useMemo(() => {
    // Mapbox GL JS uses [lng, lat] coordinate format
    const selectedRoute = routes.find((r) => r.routeId === selectedRouteId) ?? routes[0];
    const activeRouteCoordinates = selectedRoute
      ? selectedRoute.points.map((p) => [p.longitude, p.latitude])
      : [];

    // Alternative routes (if in route selection mode)
    const altRoutesCoordinates = routes
      .filter((r) => r.routeId !== selectedRoute?.routeId)
      .map((r) => r.points.map((p) => [p.longitude, p.latitude]));

    const pickupCoord = pickup ? [pickup.longitude, pickup.latitude] : null;
    const destCoord = destination ? [destination.longitude, destination.latitude] : null;
    const liveCoord = currentLocation ? [currentLocation.longitude, currentLocation.latitude] : null;

    const fallbackCenter = liveCoord ?? pickupCoord ?? destCoord ?? [79.0882, 21.1458];

    // ── Verified Nagpur Police Stations (23 stations — OSM Overpass 2025) ──
    const policeStations = [
      { name: "Sitabuldi PS", lng: 79.08034, lat: 21.14430, is24x7: true },
      { name: "Sadar PS (Seminary Hills Rd)", lng: 79.07140, lat: 21.16177, is24x7: true },
      { name: "Police Control Room (City HQ)", lng: 79.07252, lat: 21.15459, is24x7: true },
      { name: "Dhantoli PS (Ajni Road)", lng: 79.08535, lat: 21.13739, is24x7: true },
      { name: "Ganeshpeth PS (Bus Stand)", lng: 79.10080, lat: 21.14271, is24x7: true },
      { name: "Gittikhadan PS (Katol Road)", lng: 79.06092, lat: 21.17367, is24x7: true },
      { name: "Ambazari PS (Amravati Road)", lng: 79.05538, lat: 21.14859, is24x7: true },
      { name: "Bajaj Nagar PS", lng: 79.06877, lat: 21.12587, is24x7: false },
      { name: "Rana Pratap Nagar PS", lng: 79.03983, lat: 21.11554, is24x7: false },
      { name: "Wadi PS (Amravati Road)", lng: 78.99149, lat: 21.14736, is24x7: false },
      { name: "MIDC Hingna PS", lng: 79.01103, lat: 21.12476, is24x7: true },
      { name: "Ajni PS (Chunabhatti)", lng: 79.08543, lat: 21.12340, is24x7: true },
      { name: "Sonegaon PS (Airport / Wardha Rd)", lng: 79.06436, lat: 21.09054, is24x7: true },
      { name: "Sakkardara PS (Umred Road)", lng: 79.11407, lat: 21.12942, is24x7: true },
      { name: "Nandanvan PS (Hasanbagh Road)", lng: 79.12210, lat: 21.13045, is24x7: false },
      { name: "Lakadganj PS (Central Ave)", lng: 79.11283, lat: 21.14777, is24x7: false },
      { name: "Pachpaoli PS (Kamal Chowk)", lng: 79.10279, lat: 21.16424, is24x7: false },
      { name: "Jaripatka PS (Nara Road)", lng: 79.09188, lat: 21.18869, is24x7: false },
      { name: "Yashodhara Nagar PS", lng: 79.12559, lat: 21.18133, is24x7: false },
      { name: "Kalamna PS (Chikhali)", lng: 79.14559, lat: 21.16280, is24x7: true },
      { name: "Hudkeshwar PS", lng: 79.11719, lat: 21.10580, is24x7: false },
      { name: "Nagpur Railway Station Police (GRP)", lng: 79.08824, lat: 21.15237, is24x7: true },
      { name: "Kamptee PS", lng: 79.19180, lat: 21.21549, is24x7: false },
    ];

    // ── Nagpur Metro Stations — 36 Verified Safe Havens (Aqua + Orange Line) ──
    const metroStations = [
      // Orange Line
      { name: "Automotive Square Metro", lng: 79.11951, lat: 21.18579 },
      { name: "Nari Road Metro", lng: 79.10978, lat: 21.17950 },
      { name: "Indora Square Metro", lng: 79.10073, lat: 21.17369 },
      { name: "Kadvi Square Metro", lng: 79.09242, lat: 21.16867 },
      { name: "Gaddi Godam Square Metro", lng: 79.08373, lat: 21.16163 },
      { name: "Kasturchand Park Metro", lng: 79.08148, lat: 21.15436 },
      { name: "Zero Mile Freedom Park Metro", lng: 79.08063, lat: 21.14669 },
      { name: "Sitabuldi Interchange Metro", lng: 79.08716, lat: 21.14023 },
      { name: "Congress Nagar Metro", lng: 79.08255, lat: 21.12820 },
      { name: "Rahate Colony Metro", lng: 79.07540, lat: 21.12738 },
      { name: "Ajni Square Metro", lng: 79.07211, lat: 21.11821 },
      { name: "Chhatrapati Square Metro", lng: 79.06961, lat: 21.10914 },
      { name: "Jaiprakash Nagar Metro", lng: 79.06818, lat: 21.10364 },
      { name: "Ujjwal Nagar Metro", lng: 79.06632, lat: 21.09635 },
      { name: "Airport Metro", lng: 79.06379, lat: 21.08622 },
      { name: "Airport South Metro", lng: 79.06053, lat: 21.07906 },
      { name: "New Airport Metro (Khapri)", lng: 79.05583, lat: 21.06604 },
      // Aqua Line
      { name: "Prajapati Nagar Metro", lng: 79.14882, lat: 21.15015 },
      { name: "Vaishnodevi Square Metro", lng: 79.13641, lat: 21.14803 },
      { name: "Ambedkar Square Metro", lng: 79.12949, lat: 21.14832 },
      { name: "Telephone Exchange Metro", lng: 79.11824, lat: 21.14881 },
      { name: "Chitaroli Square Metro", lng: 79.11039, lat: 21.14965 },
      { name: "Agrasen Square Metro", lng: 79.10291, lat: 21.15105 },
      { name: "Dosar Vaisya Square Metro", lng: 79.09492, lat: 21.15297 },
      { name: "Nagpur Railway Station Metro", lng: 79.09044, lat: 21.15138 },
      { name: "Cotton Market Metro", lng: 79.08977, lat: 21.14599 },
      { name: "Jhansi Rani Square Metro", lng: 79.07783, lat: 21.14072 },
      { name: "Institute of Engineers Metro", lng: 79.07009, lat: 21.13831 },
      { name: "Shankar Nagar Square Metro", lng: 79.06164, lat: 21.13621 },
      { name: "LAD College Metro", lng: 79.05480, lat: 21.13292 },
      { name: "Dharampeth / Ambazari Metro", lng: 79.04574, lat: 21.12869 },
      { name: "Subhash Nagar Metro", lng: 79.04205, lat: 21.12332 },
      { name: "Rachna Ring Road Metro", lng: 79.02941, lat: 21.12152 },
      { name: "Vasudev Nagar Metro", lng: 79.01947, lat: 21.11879 },
      { name: "Bansi Nagar Metro", lng: 79.01260, lat: 21.11620 },
      { name: "Lokmanya Nagar Metro", lng: 79.00175, lat: 21.11080 },
    ];

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.css" rel="stylesheet">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; width: 100%; height: 100%; background: #f8fafc; }
    
    @keyframes pulse-ring {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .pulse-radar {
      position: relative;
      width: 22px;
      height: 22px;
      background: #2563eb;
      border-radius: 50%;
      border: 3px solid #ffffff;
      box-shadow: 0 2px 8px rgba(37,99,235,0.6);
    }
    .pulse-radar::after {
      content: '';
      position: absolute;
      top: -6px;
      left: -6px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(37,99,235,0.4);
      animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
    }
    .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left { display: none !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.js"></script>
  <script>
    const mapboxToken = 'pk.eyJ1IjoibmFyYWR0eSIsImEiOiJjbXVpN3NjbHIwZGQ5MndzOWpuZmgydGllIn0.9_B6Jyrzs_4xXbKc340u_Q';
    mapboxgl.accessToken = mapboxToken;

    const fallbackCenter = ${escapeJson(fallbackCenter)};
    const activeRoute = ${escapeJson(activeRouteCoordinates)};
    const altRoutes = ${escapeJson(altRoutesCoordinates)};
    const pickup = ${escapeJson(pickupCoord)};
    const dest = ${escapeJson(destCoord)};
    const live = ${escapeJson(liveCoord)};
    const police = ${escapeJson(policeStations)};
    const metro = ${escapeJson(metroStations)};
    const showLayers = ${showSafetyLayers ? "true" : "false"};

    // Pure Mapbox GL JS 3D Vector Map Initialization
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: fallbackCenter,
      zoom: 13.5,
      pitch: live ? 30 : 0,
      attributionControl: false
    });

    map.on('load', () => {
      // 1. Alternative Routes (subtle gray dashed lines)
      altRoutes.forEach((altCoords, idx) => {
        map.addSource('alt-route-' + idx, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: altCoords } }
        });
        map.addLayer({
          id: 'alt-route-line-' + idx,
          type: 'line',
          source: 'alt-route-' + idx,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.65, 'line-dasharray': [2, 2] }
        });
      });

      // 2. Single Clean Navigation Route (Vivid Emerald Green — Forward path only)
      if (activeRoute.length > 0) {
        map.addSource('active-route', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: activeRoute } }
        });
        // Drop-shadow casing
        map.addLayer({
          id: 'active-route-casing',
          type: 'line',
          source: 'active-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#047857', 'line-width': 8, 'line-opacity': 0.35 }
        });
        // Main vivid emerald green stroke
        map.addLayer({
          id: 'active-route-line',
          type: 'line',
          source: 'active-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#10b981', 'line-width': 5, 'line-opacity': 0.98 }
        });
      }

      // 3. Police Station Pins (23 Verified OSM Stations)
      if (showLayers) {
        police.forEach(p => {
          const el = document.createElement('div');
          const bg = p.is24x7 ? '#1e3a8a' : '#475569';
          el.innerHTML = '<div style="width:22px;height:22px;border-radius:50%;background:' + bg + ';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;cursor:pointer;"><span style="color:#fff;font-size:11px;">👮</span></div>';
          new mapboxgl.Marker({ element: el })
            .setLngLat([p.lng, p.lat])
            .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML('🚔 <b>' + p.name + '</b><br><span style="color:' + (p.is24x7 ? '#059669' : '#94a3b8') + ';font-size:11px;font-weight:bold;">' + (p.is24x7 ? '● Open 24×7' : '● Limited Hours') + '</span>'))
            .addTo(map);
        });

        // 4. Metro Station Pins (36 Verified Safe Havens with CCTV)
        metro.forEach(m => {
          const el = document.createElement('div');
          el.innerHTML = '<div style="width:20px;height:20px;border-radius:50%;background:#0ea5e9;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;"><span style="color:#fff;font-size:10px;">🚇</span></div>';
          new mapboxgl.Marker({ element: el })
            .setLngLat([m.lng, m.lat])
            .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML('🚇 <b>' + m.name + '</b><br><span style="color:#0ea5e9;font-size:11px;font-weight:bold;">● 24×7 CCTV Safe Haven</span>'))
            .addTo(map);
        });
      }

      // 5. Pickup Pin (A)
      if (pickup) {
        const el = document.createElement('div');
        el.innerHTML = '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#10b981;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:#fff;font-weight:900;font-size:14px;line-height:1;">A</span></div>';
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(pickup)
          .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML('🚩 <b>Pickup Point</b>'))
          .addTo(map);
      }

      // 6. Destination Pin (B)
      if (dest) {
        const el = document.createElement('div');
        el.innerHTML = '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#dc2626;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:#fff;font-weight:900;font-size:14px;line-height:1;">B</span></div>';
        new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(dest)
          .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML('🏁 <b>Drop-off Point</b>'))
          .addTo(map);
      }

      // 7. Add Live Moving Car Cursor with Radar Pulse
      if (live) {
        const el = document.createElement('div');
        el.className = 'pulse-radar';
        new mapboxgl.Marker({ element: el })
          .setLngLat(live)
          .addTo(map);

        // Smooth 3D Camera Follow on vehicle position
        map.easeTo({
          center: live,
          zoom: 15.2,
          pitch: 30,
          duration: 800
        });
      } else if (activeRoute.length > 1) {
        // Fit camera bounds around the route
        const bounds = activeRoute.reduce(
          (b, coord) => b.extend(coord),
          new mapboxgl.LngLatBounds(activeRoute[0], activeRoute[0])
        );
        map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
      }
    });
  </script>
</body>
</html>`;
  }, [colors.primary, currentLocation, destination, pickup, routes, selectedRouteId, showSafetyLayers]);

  if (!pickup && !destination && !currentLocation) {
    return (
      <View style={[styles.empty, { height, backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your map will appear here</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add pickup and destination to see the real Mapbox 3D route.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, { height, borderColor: colors.border }]}>
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, width: "100%", height: "100%" }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        androidLayerType="hardware"
        mixedContentMode="always"
        renderLoading={() => <ActivityIndicator color={colors.primary} style={StyleSheet.absoluteFill} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { overflow: "hidden", borderWidth: 1, borderRadius: 18, backgroundColor: "#f8fafc" },
  empty: { borderWidth: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 8 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", lineHeight: 20 },
});
