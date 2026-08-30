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
};

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function MapPreview({ pickup, destination, currentLocation, routes = [], selectedRouteId, height = 300 }: Props) {
  const colors = useColors();
  const html = useMemo(() => {
    const points = [
      ...(pickup ? [{ ...pickup, kind: "pickup" }] : []),
      ...(destination ? [{ ...destination, kind: "destination" }] : []),
      ...(currentLocation ? [{ ...currentLocation, kind: "current" }] : []),
    ];
    const mapRoutes = routes.map((route) => ({
      id: route.routeId,
      selected: route.routeId === selectedRouteId,
      points: route.points.map((point) => [point.longitude, point.latitude]),
    }));
    const fallbackCenter = points[0] ? [points[0].longitude, points[0].latitude] : [0, 0];
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIINfQ3gQ7Qa7+0sJ4yP4Y5q5e4h2Y4b4vY=" crossorigin=""><style>html,body,#map{height:100%;margin:0;background:${colors.background};font-family:Arial,sans-serif}.leaflet-control-zoom a{color:${colors.foreground}!important}.leaflet-control-attribution{font-size:9px}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const pts=${escapeJson(points)};const routes=${escapeJson(mapRoutes)};const map=L.map('map',{zoomControl:true}).setView(${escapeJson(fallbackCenter)},13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);const bounds=[];const icon=(color,label)=>L.divIcon({className:'pin',html:'<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:'+color+';border:3px solid white;box-shadow:0 2px 5px #0004"><span style="display:block;transform:rotate(45deg);text-align:center;color:white;font-weight:bold;font-size:12px;padding-top:3px">'+label+'</span></div>',iconSize:[26,26],iconAnchor:[13,26]});pts.forEach(p=>{const color=p.kind==='pickup'?'${colors.primary}':p.kind==='destination'?'#d45d5d':'#4576d6';const label=p.kind==='pickup'?'A':p.kind==='destination'?'B':'•';const marker=L.marker([p.latitude,p.longitude],{icon:icon(color,label)}).addTo(map);marker.bindPopup(p.formattedAddress||'Current location');bounds.push([p.latitude,p.longitude])});routes.forEach(r=>{const latlngs=r.points.map(p=>[p[1],p[0]]);L.polyline(latlngs,{color:r.selected?'${colors.primary}':'#9bb5a5',weight:r.selected?6:4,opacity:r.selected?1:.72,lineCap:'round'}).addTo(map);latlngs.forEach(x=>bounds.push(x))});if(bounds.length>1)map.fitBounds(bounds,{padding:[28,28]});</script></body></html>`;
  }, [colors.background, colors.foreground, colors.primary, currentLocation, destination, pickup, routes, selectedRouteId]);

  if (!pickup && !destination && !currentLocation) {
    return (
      <View style={[styles.empty, { height, backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your map will appear here</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add pickup and destination to see the real OpenStreetMap route.</Text>
      </View>
    );
  }
  return <View style={[styles.wrapper, { height, borderColor: colors.border }]}><WebView originWhitelist={["*"]} source={{ html }} javaScriptEnabled domStorageEnabled startInLoadingState renderLoading={() => <ActivityIndicator color={colors.primary} style={StyleSheet.absoluteFill} />} /></View>;
}

const styles = StyleSheet.create({
  wrapper: { overflow: "hidden", borderWidth: 1, borderRadius: 18, backgroundColor: "transparent" },
  empty: { borderWidth: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 8 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", lineHeight: 20 },
});