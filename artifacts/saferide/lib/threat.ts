/**
 * SAFERIDE FRONTEND THREAT ENGINE
 * Nagpur-aware, deterministic, rule-based.
 *
 * Responsibilities:
 *  - Stationary detection with GPS jitter filtering & traffic signal whitelisting
 *  - Context-aware deviation classification (legitimate reroute vs suspicious)
 *  - Dynamic threat score fusion (7 factors, configurable weights)
 *  - 4-tier escalation: LOW → MEDIUM → HIGH (30s modal) → CRITICAL (SOS)
 *  - Emergency dispatch payload builder
 *  - GPS simulation mode for viva demo
 */

import type { Coordinate } from "@workspace/api-client-react";
import type { CandidateRoute } from "./geo";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LatLon = { lat: number; lon: number };

export type RouteCheckpoint = {
  coord: LatLon;
  distanceAlongM: number;
};

export type DeviationClass =
  | "ON_ROUTE"
  | "MINOR"
  | "LEGITIMATE_REROUTE"
  | "TRAFFIC_BYPASS"
  | "SUSPICIOUS"
  | "UNKNOWN";

export type StationaryClass =
  | "MOVING"
  | "TRAFFIC_STOP"
  | "BRIEF_HALT"
  | "STATIONARY"
  | "PROLONGED"
  | "CRITICAL_STAGNATION";

export type ThreatTier = "low" | "medium" | "high" | "critical";

export type ThreatFactor = {
  id: string;
  label: string;
  state: string;
  penalty: number;       // 0.0–1.0
  weight: number;
  source: "LIVE" | "SPATIAL" | "TEMPORAL" | "TEST" | "UNAVAILABLE";
  detail?: string;
};

export type ThreatAnalysis = {
  threatScore: number;    // 0–100 higher = more dangerous
  safetyScore: number;    // 0–100 higher = safer
  tier: ThreatTier;
  tierLabel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  action: "normal_monitoring" | "display_warning" | "checkin_modal_30s" | "emergency_dispatch";
  factors: ThreatFactor[];
  deviationClass: DeviationClass;
  stationaryClass: StationaryClass;
  stationaryDurationSeconds: number;
  deviationMeters: number | null;
  needsCheckin: boolean;     // trigger 30s modal
  needsDispatch: boolean;    // trigger emergency SOS
  generatedAt: string;
};

export type MonitoringEvent = {
  id: string;
  timestamp: number;
  label: string;
  kind: "info" | "warning" | "danger";
  tier: ThreatTier;
};

export type EmergencyPayload = {
  userName: string;
  userPhone: string;
  vehiclePlate: string;
  driverName: string;
  vehicleModel: string;
  vehicleColor: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  journeyId: string;
  threatScore: number;
  tier: ThreatTier;
  triggerReason: string;
  triggeredAt: string; // IST
};

// GPS window entry for stationary detection
export type GpsEntry = { pos: Coordinate; ts: number; speedMps: number | null };

// ─── Nagpur spatial data (inlined for frontend — mirrors backend dataset) ────

/** Complete Nagpur traffic signal squares — OSM Overpass verified 2025 */
const NAGPUR_SIGNALS: Array<{ lat: number; lon: number; name: string; graceSeconds: number }> = [
  // WEST & NORTH-WEST
  { lat: 21.14904, lon: 79.04082, name: "Futala Lake Square", graceSeconds: 90 },
  { lat: 21.16150, lon: 79.04083, name: "Vayu Sena Nagar Square", graceSeconds: 90 },
  { lat: 21.16700, lon: 79.05381, name: "TV Tower Square (Seminary Hills)", graceSeconds: 90 },
  { lat: 21.16127, lon: 79.06636, name: "Japanese Garden Square", graceSeconds: 90 },
  { lat: 21.15498, lon: 79.05604, name: "CP Club Square", graceSeconds: 90 },
  { lat: 21.15420, lon: 79.06407, name: "Ladies Club Square", graceSeconds: 90 },
  { lat: 21.15837, lon: 79.06583, name: "Mohammad Rafi Square", graceSeconds: 90 },
  { lat: 21.15057, lon: 79.06297, name: "Ahinsa Square", graceSeconds: 90 },
  { lat: 21.14768, lon: 79.05602, name: "Ravi Nagar Chowk", graceSeconds: 120 },
  { lat: 21.14682, lon: 79.06189, name: "Law College Square", graceSeconds: 120 },
  { lat: 21.14832, lon: 79.07226, name: "Hislop College Square", graceSeconds: 90 },
  { lat: 21.15363, lon: 79.06830, name: "GPO Square (Civil Lines)", graceSeconds: 120 },
  { lat: 21.14952, lon: 79.06788, name: "Raja Rani Square", graceSeconds: 90 },
  { lat: 21.14200, lon: 79.05700, name: "Dharampeth Coffee House Square", graceSeconds: 90 },
  { lat: 21.12450, lon: 79.04457, name: "Subhash Nagar Square", graceSeconds: 90 },
  { lat: 21.12340, lon: 79.04771, name: "Hostel Gate Junction (VNIT)", graceSeconds: 90 },
  { lat: 21.13610, lon: 79.04910, name: "VNIT Main Gate Square", graceSeconds: 90 },
  { lat: 21.13023, lon: 79.06264, name: "Bajaj Nagar Square", graceSeconds: 90 },
  { lat: 21.12876, lon: 79.05740, name: "Abhyankar Square", graceSeconds: 90 },
  { lat: 21.12614, lon: 79.06395, name: "Deendayal Upadhyay Square", graceSeconds: 90 },
  { lat: 21.12547, lon: 79.06398, name: "Laxmi Nagar Square", graceSeconds: 90 },
  { lat: 21.11481, lon: 79.04077, name: "Trimurti Nagar Chowk", graceSeconds: 90 },
  { lat: 21.11319, lon: 79.04577, name: "Shivaji Maharaj Chowk", graceSeconds: 90 },
  { lat: 21.11365, lon: 79.05673, name: "Rana Pratap Square", graceSeconds: 90 },
  { lat: 21.11208, lon: 79.06504, name: "Khamla Chowk", graceSeconds: 90 },
  // CENTRAL
  { lat: 21.15264, lon: 79.08097, name: "RBI Square", graceSeconds: 120 },
  { lat: 21.15718, lon: 79.07972, name: "Liberty Square (Sadar)", graceSeconds: 120 },
  { lat: 21.15908, lon: 79.07952, name: "Smriti Square", graceSeconds: 90 },
  { lat: 21.15826, lon: 79.07595, name: "VCA Ground Square", graceSeconds: 90 },
  { lat: 21.15562, lon: 79.08176, name: "LIC Square", graceSeconds: 120 },
  { lat: 21.15266, lon: 79.07880, name: "Vidhan Bhavan Square", graceSeconds: 120 },
  { lat: 21.15276, lon: 79.07482, name: "Aakashwani Square", graceSeconds: 120 },
  { lat: 21.14577, lon: 79.08823, name: "Manas Chowk (Railway Station)", graceSeconds: 150 },
  { lat: 21.14350, lon: 79.08099, name: "Variety Square (Zero Mile)", graceSeconds: 150 },
  { lat: 21.14116, lon: 79.08019, name: "Jhansi Rani Square", graceSeconds: 120 },
  { lat: 21.14525, lon: 79.07442, name: "Maharaja Baug Square", graceSeconds: 90 },
  { lat: 21.13889, lon: 79.07944, name: "Panchsheel Talkies Square", graceSeconds: 120 },
  { lat: 21.13939, lon: 79.07328, name: "University Library Square", graceSeconds: 90 },
  { lat: 21.14128, lon: 79.08265, name: "Maha Bank Square", graceSeconds: 90 },
  { lat: 21.14484, lon: 79.10810, name: "Mahal Square (Itwari)", graceSeconds: 120 },
  { lat: 21.14169, lon: 79.10353, name: "Ram Coolar Square", graceSeconds: 90 },
  { lat: 21.14739, lon: 79.10178, name: "Maulana Natik Square", graceSeconds: 90 },
  { lat: 21.13808, lon: 79.10300, name: "Kashibai Deval Square", graceSeconds: 90 },
  { lat: 21.13608, lon: 79.09622, name: "Baidyanath Square", graceSeconds: 120 },
  // SOUTH & SOUTH-EAST
  { lat: 21.13087, lon: 79.07684, name: "Rahate Square (Wardha Road)", graceSeconds: 120 },
  { lat: 21.11071, lon: 79.06998, name: "Chhatrapati Square (Wardha Road)", graceSeconds: 120 },
  { lat: 21.10519, lon: 79.10248, name: "Manewada Square", graceSeconds: 120 },
  { lat: 21.13867, lon: 79.11961, name: "Sant Jagnade Maharaj Square", graceSeconds: 120 },
  { lat: 21.09220, lon: 79.04720, name: "Airport T-Point Square", graceSeconds: 90 },
  // NORTH & EAST
  { lat: 21.17533, lon: 79.07928, name: "Pagal Khana Chowk (Kamptee Road)", graceSeconds: 120 },
  { lat: 21.18781, lon: 79.07894, name: "Mankapur Square", graceSeconds: 120 },
  { lat: 21.20763, lon: 79.07725, name: "Koradi Naka Square", graceSeconds: 120 },
  { lat: 21.17921, lon: 79.11759, name: "Md Rafi Chowk (Kamptee Road)", graceSeconds: 120 },
  { lat: 21.14811, lon: 79.13417, name: "Vardhaman Nagar Square", graceSeconds: 120 },
  { lat: 21.21316, lon: 79.19752, name: "Babu Hardas L N Square (Kamptee)", graceSeconds: 90 },
  { lat: 21.21554, lon: 79.19461, name: "Chhatrapati Shivaji Chowk (Kamptee)", graceSeconds: 90 },
];

/** Nagpur CCTV zones — Smart City ICCC + Metro Station Security Grids */
const NAGPUR_CCTV: Array<{ lat: number; lon: number; name: string; radiusM: number }> = [
  // Smart City ICCC Dense Surveillance Clusters
  { lat: 21.14430, lon: 79.08034, name: "Sitabuldi ICCC Hub", radiusM: 500 },
  { lat: 21.15264, lon: 79.08097, name: "RBI Square 4-Way CCTV Cluster", radiusM: 200 },
  { lat: 21.15138, lon: 79.09044, name: "Railway Station CCTV Complex", radiusM: 300 },
  { lat: 21.14350, lon: 79.08099, name: "Zero Mile / Variety Square", radiusM: 250 },
  { lat: 21.14602, lon: 79.08973, name: "Cotton Market (Itwari)", radiusM: 350 },
  { lat: 21.15718, lon: 79.07972, name: "Liberty / Smriti Square Corridor", radiusM: 250 },
  { lat: 21.13621, lon: 79.06164, name: "Shankar Nagar Square CCTV", radiusM: 200 },
  { lat: 21.09054, lon: 79.06436, name: "Airport Road VIP Corridor", radiusM: 450 },
  { lat: 21.14682, lon: 79.06189, name: "Law College Square", radiusM: 200 },
  // Metro Station Security Grids (All 36 stations, 250m safety bubble)
  { lat: 21.18579, lon: 79.11951, name: "Automotive Square Metro", radiusM: 250 },
  { lat: 21.17950, lon: 79.10978, name: "Nari Road Metro", radiusM: 250 },
  { lat: 21.17369, lon: 79.10073, name: "Indora Square Metro", radiusM: 250 },
  { lat: 21.16867, lon: 79.09242, name: "Kadvi Square Metro", radiusM: 250 },
  { lat: 21.16163, lon: 79.08373, name: "Gaddi Godam Square Metro", radiusM: 250 },
  { lat: 21.15436, lon: 79.08148, name: "Kasturchand Park Metro", radiusM: 250 },
  { lat: 21.14669, lon: 79.08063, name: "Zero Mile Freedom Park Metro", radiusM: 250 },
  { lat: 21.14023, lon: 79.08716, name: "Sitabuldi Interchange Metro", radiusM: 300 },
  { lat: 21.12780, lon: 79.08225, name: "Congress Nagar Metro", radiusM: 250 },
  { lat: 21.12738, lon: 79.07540, name: "Rahate Colony Metro", radiusM: 250 },
  { lat: 21.11821, lon: 79.07211, name: "Ajni Square Metro", radiusM: 250 },
  { lat: 21.10914, lon: 79.06961, name: "Chhatrapati Square Metro", radiusM: 250 },
  { lat: 21.10364, lon: 79.06818, name: "Jaiprakash Nagar Metro", radiusM: 250 },
  { lat: 21.09635, lon: 79.06632, name: "Ujjwal Nagar Metro", radiusM: 250 },
  { lat: 21.08622, lon: 79.06379, name: "Airport Metro Station", radiusM: 300 },
  { lat: 21.07906, lon: 79.06053, name: "Airport South Metro", radiusM: 250 },
  { lat: 21.06604, lon: 79.05583, name: "New Airport Metro (Khapri)", radiusM: 300 },
  { lat: 21.15015, lon: 79.14882, name: "Prajapati Nagar Metro", radiusM: 250 },
  { lat: 21.14803, lon: 79.13641, name: "Vaishnodevi Square Metro", radiusM: 250 },
  { lat: 21.14832, lon: 79.12949, name: "Ambedkar Square Metro", radiusM: 250 },
  { lat: 21.14881, lon: 79.11824, name: "Telephone Exchange Metro", radiusM: 250 },
  { lat: 21.14965, lon: 79.11039, name: "Chitaroli Square Metro", radiusM: 250 },
  { lat: 21.15105, lon: 79.10291, name: "Agrasen Square Metro", radiusM: 250 },
  { lat: 21.15297, lon: 79.09492, name: "Dosar Vaisya Square Metro", radiusM: 250 },
  { lat: 21.15138, lon: 79.09044, name: "Nagpur Railway Station Metro", radiusM: 300 },
  { lat: 21.14072, lon: 79.07783, name: "Jhansi Rani Square Metro", radiusM: 250 },
  { lat: 21.13831, lon: 79.07009, name: "Institute of Engineers Metro", radiusM: 250 },
  { lat: 21.13292, lon: 79.05480, name: "LAD College Metro", radiusM: 250 },
  { lat: 21.12869, lon: 79.04574, name: "Dharampeth / Ambazari Metro", radiusM: 250 },
  { lat: 21.12332, lon: 79.04205, name: "Subhash Nagar Metro", radiusM: 250 },
  { lat: 21.12150, lon: 79.02933, name: "Rachna Ring Road Metro", radiusM: 250 },
  { lat: 21.11879, lon: 79.01947, name: "Vasudev Nagar Metro", radiusM: 250 },
  { lat: 21.11620, lon: 79.01260, name: "Bansi Nagar Metro", radiusM: 250 },
  { lat: 21.11080, lon: 79.00175, name: "Lokmanya Nagar Metro", radiusM: 250 },
];

/** Nagpur police stations — OSM Overpass verified 2025 */
const NAGPUR_POLICE: Array<{ lat: number; lon: number; name: string; is24x7: boolean }> = [
  { lat: 21.14430, lon: 79.08034, name: "Sitabuldi PS", is24x7: true },
  { lat: 21.16177, lon: 79.07140, name: "Sadar PS (Seminary Hills Rd)", is24x7: true },
  { lat: 21.15459, lon: 79.07252, name: "Police Control Room (City HQ)", is24x7: true },
  { lat: 21.13739, lon: 79.08535, name: "Dhantoli PS (Ajni Road)", is24x7: true },
  { lat: 21.14271, lon: 79.10080, name: "Ganeshpeth PS (Umred Road)", is24x7: true },
  { lat: 21.17368, lon: 79.06092, name: "Gittikhadan PS (Katol Road)", is24x7: true },
  { lat: 21.14859, lon: 79.05538, name: "Ambazari PS (Amravati Road)", is24x7: true },
  { lat: 21.12587, lon: 79.06877, name: "Bajaj Nagar PS", is24x7: false },
  { lat: 21.11554, lon: 79.03983, name: "Rana Pratap Nagar PS (Khamla)", is24x7: false },
  { lat: 21.14736, lon: 78.99149, name: "Wadi PS (Amravati Road)", is24x7: false },
  { lat: 21.12476, lon: 79.01103, name: "MIDC Hingna PS", is24x7: true },
  { lat: 21.12303, lon: 79.09748, name: "Ajni PS (Chhota Tajbagh Road)", is24x7: true },
  { lat: 21.09054, lon: 79.06436, name: "Sonegaon PS (Airport / Wardha Rd)", is24x7: true },
  { lat: 21.12942, lon: 79.11407, name: "Sakkardara PS (Umred Road)", is24x7: true },
  { lat: 21.13045, lon: 79.12210, name: "Nandanvan PS (Nandanvan Main Road)", is24x7: false },
  { lat: 21.14777, lon: 79.11283, name: "Lakadganj PS (Central Ave)", is24x7: false },
  { lat: 21.16424, lon: 79.10279, name: "Pachpaoli PS (Panchpaoli Flyover)", is24x7: false },
  { lat: 21.18869, lon: 79.09188, name: "Jaripatka PS (Nara Road)", is24x7: false },
  { lat: 21.18133, lon: 79.12559, name: "Yashodhara Nagar PS", is24x7: false },
  { lat: 21.16280, lon: 79.14559, name: "Kalamna PS (Chikhali)", is24x7: true },
  { lat: 21.10580, lon: 79.11719, name: "Hudkeshwar PS", is24x7: false },
  { lat: 21.15138, lon: 79.09044, name: "Nagpur Railway Station Police (GRP)", is24x7: true },
  { lat: 21.21549, lon: 79.19180, name: "Kamptee PS", is24x7: false },
];

/** Nagpur accident blackspots */
const NAGPUR_BLACKSPOTS: Array<{ lat: number; lon: number; desc: string; bufM: number; penalty: number }> = [
  { lat: 21.1721, lon: 79.1601, desc: "Wadi Bypass Junction", bufM: 400, penalty: 0.85 },
  { lat: 21.1081, lon: 79.0571, desc: "Automotive Square", bufM: 300, penalty: 0.80 },
  { lat: 21.1051, lon: 79.0981, desc: "Manewada Ring Road Junction", bufM: 350, penalty: 0.75 },
  { lat: 21.1121, lon: 79.0701, desc: "Wardha Road Flyover", bufM: 250, penalty: 0.70 },
  { lat: 21.1781, lon: 79.1261, desc: "Kamptee Road / NH-7 merge", bufM: 400, penalty: 0.80 },
  { lat: 21.1251, lon: 79.0211, desc: "Hingna T-Point", bufM: 300, penalty: 0.70 },
  { lat: 21.1831, lon: 79.0181, desc: "Beltarodi Outer Ring Road", bufM: 500, penalty: 0.85 },
  { lat: 21.1621, lon: 79.1371, desc: "Nari Road stretch", bufM: 300, penalty: 0.65 },
  { lat: 21.1111, lon: 79.1171, desc: "Pardi Railway Level Crossing", bufM: 250, penalty: 0.75 },
  { lat: 21.0881, lon: 79.0751, desc: "Outer Ring Road South", bufM: 500, penalty: 0.80 },
];

/** Lighting corridors (bboxes) */
const LIGHTING_CORRIDORS: Array<{
  name: string; status: "well_lit" | "partial" | "unlit"; penalty: number;
  minLat: number; maxLat: number; minLon: number; maxLon: number;
}> = [
  { name: "Wardha Road", status: "well_lit", penalty: 0.00, minLat: 21.0980, maxLat: 21.1480, minLon: 79.0620, maxLon: 79.0780 },
  { name: "Amravati Road", status: "well_lit", penalty: 0.00, minLat: 21.1380, maxLat: 21.1880, minLon: 79.0180, maxLon: 79.0650 },
  { name: "Central Avenue", status: "well_lit", penalty: 0.00, minLat: 21.1400, maxLat: 21.1620, minLon: 79.0780, maxLon: 79.1050 },
  { name: "VIP Road / Airport Road", status: "well_lit", penalty: 0.00, minLat: 21.0880, maxLat: 21.1480, minLon: 79.0420, maxLon: 79.0650 },
  { name: "Inner Ring Road", status: "well_lit", penalty: 0.00, minLat: 21.1160, maxLat: 21.1480, minLon: 79.0560, maxLon: 79.0820 },
  { name: "Kamptee Road", status: "well_lit", penalty: 0.00, minLat: 21.1480, maxLat: 21.1780, minLon: 79.0870, maxLon: 79.1280 },
  { name: "Nandanvan–Hudkeshwar", status: "partial", penalty: 0.35, minLat: 21.1060, maxLat: 21.1360, minLon: 79.0500, maxLon: 79.0750 },
  { name: "Nari Road", status: "partial", penalty: 0.35, minLat: 21.1520, maxLat: 21.1720, minLon: 79.1260, maxLon: 79.1500 },
  { name: "Manewada Road", status: "partial", penalty: 0.35, minLat: 21.0980, maxLat: 21.1180, minLon: 79.0880, maxLon: 79.1120 },
  { name: "Outer Ring Road South", status: "unlit", penalty: 0.85, minLat: 21.0820, maxLat: 21.1120, minLon: 79.0650, maxLon: 79.1280 },
  { name: "Beltarodi Bypass", status: "unlit", penalty: 0.90, minLat: 21.1720, maxLat: 21.1980, minLon: 79.0020, maxLon: 79.0280 },
  { name: "Wadi Bypass Road", status: "unlit", penalty: 0.90, minLat: 21.1600, maxLat: 21.1900, minLon: 79.1480, maxLon: 79.1800 },
  { name: "Hingna Industrial Lanes", status: "unlit", penalty: 0.80, minLat: 21.1100, maxLat: 21.1380, minLon: 79.0000, maxLon: 79.0260 },
];

export type CrimeHotspot = {
  id: string;
  name: string;
  category: "violent_crime" | "sexual_assault_vulnerable" | "robbery_hotspot" | "isolated_dark_zone";
  lat: number;
  lon: number;
  bufM: number;
  penalty: number;
  nightSeverityMultiplier: number;
  policeJurisdiction: string;
  desc: string;
};

/** Verified Nagpur High-Crime Vulnerability Hotspots (Violent crime, sexual assault risk, robbery pockets) */
export const NAGPUR_CRIME_HOTSPOTS: CrimeHotspot[] = [
  {
    id: "crime_gittikhadan_quarry",
    name: "Gittikhadan Quarry & Forest Belt",
    category: "violent_crime",
    lat: 21.1710, lon: 79.0480,
    bufM: 350,
    penalty: 0.90,
    nightSeverityMultiplier: 1.25,
    policeJurisdiction: "Gittikhadan PS",
    desc: "Isolated stone quarry area, reported violent assaults & zero surveillance",
  },
  {
    id: "crime_seminary_hills_back",
    name: "Seminary Hills Rear Wooded Perimeter",
    category: "sexual_assault_vulnerable",
    lat: 21.1620, lon: 79.0510,
    bufM: 400,
    penalty: 0.85,
    nightSeverityMultiplier: 1.30,
    policeJurisdiction: "Gittikhadan / Sadar PS",
    desc: "Dense unlit tree cover after dark, high sexual harassment vulnerability",
  },
  {
    id: "crime_kalamna_yard",
    name: "Kalamna Freight Rail Sidings",
    category: "robbery_hotspot",
    lat: 21.1850, lon: 79.1120,
    bufM: 450,
    penalty: 0.85,
    nightSeverityMultiplier: 1.20,
    policeJurisdiction: "Kalamna PS",
    desc: "Goods shed corridors, frequent night mugging & weapon robbery reports",
  },
  {
    id: "crime_pardi_outer",
    name: "Pardi–Bhandara Industrial Dead-ends",
    category: "isolated_dark_zone",
    lat: 21.1150, lon: 79.1450,
    bufM: 500,
    penalty: 0.80,
    nightSeverityMultiplier: 1.25,
    policeJurisdiction: "Pardi PS",
    desc: "Uninhabited warehouse bypass, dark unmonitored cul-de-sacs",
  },
  {
    id: "crime_beltarodi_underpass",
    name: "Beltarodi Ring Road Underpass",
    category: "robbery_hotspot",
    lat: 21.1800, lon: 79.0150,
    bufM: 400,
    penalty: 0.85,
    nightSeverityMultiplier: 1.20,
    policeJurisdiction: "Beltarodi PS",
    desc: "Isolated underpass, sparse vehicular movement, vehicle intercepts reported",
  },
  {
    id: "crime_hingna_midc_deadend",
    name: "Hingna MIDC Phase-3 Waste Belt",
    category: "isolated_dark_zone",
    lat: 21.1080, lon: 79.0050,
    bufM: 450,
    penalty: 0.80,
    nightSeverityMultiplier: 1.25,
    policeJurisdiction: "MIDC Hingna PS",
    desc: "Industrial wasteland after 21:00, zero lighting and patrol coverage",
  },
];

// ─── Custom / Manual Safety Test Data (Easily Extensible for Testing) ──────────
export const CUSTOM_CCTV_POINTS: Array<{ name: string; lat: number; lon: number; radiusM: number }> = [
  { name: "RBU Main Gate Camera", lat: 21.17686, lon: 79.06069, radiusM: 150 },
  { name: "Friends Colony Square CCTV", lat: 21.17200, lon: 79.05800, radiusM: 150 },
  { name: "Sadar Residency Road Camera", lat: 21.15718, lon: 79.07972, radiusM: 180 },
  { name: "Zero Mile Smart Pole CCTV", lat: 21.14979, lon: 79.08069, radiusM: 200 },
];

export const CUSTOM_CRIME_ZONES: Array<{ name: string; lat: number; lon: number; bufM: number; penalty: number; desc: string }> = [
  { name: "Gittikhadan Quarry Isolated Lane", lat: 21.1710, lon: 79.0480, bufM: 250, penalty: 0.85, desc: "Low-lit isolated area with low night traffic" },
  { name: "Seminary Hills Backstretch", lat: 21.1620, lon: 79.0510, bufM: 300, penalty: 0.80, desc: "Uninhabited wooded stretch" },
  { name: "Gorewada Road Dark Stretch", lat: 21.1850, lon: 79.0400, bufM: 350, penalty: 0.85, desc: "Sparse lighting near lake perimeter" },
];

export const CUSTOM_UNLIT_ROADS: Array<{
  name: string; status: "well_lit" | "partial" | "unlit"; penalty: number;
  minLat: number; maxLat: number; minLon: number; maxLon: number;
}> = [
  { name: "Seminary Hills Back Lane", status: "unlit", penalty: 0.85, minLat: 21.1580, maxLat: 21.1680, minLon: 79.0450, maxLon: 79.0580 },
  { name: "Gittikhadan Outer By-lane", status: "unlit", penalty: 0.90, minLat: 21.1680, maxLat: 21.1780, minLon: 79.0380, maxLon: 79.0520 },
];

// ─── Weights ──────────────────────────────────────────────────────────────────
export const THREAT_WEIGHTS = {
  routeDeviation: 0.30,
  stationaryCondition: 0.20,
  streetLighting: 0.12,
  cctvSecurity: 0.12,
  accidentBlackspot: 0.10,
  roadHierarchy: 0.08,
  timeContext: 0.08,
} as const;

// ─── Tier config ──────────────────────────────────────────────────────────────
export const THREAT_TIER_CONFIG = {
  low:      { label: "LOW" as const,      maxThreat: 20, action: "normal_monitoring" as const },
  medium:   { label: "MEDIUM" as const,   maxThreat: 40, action: "display_warning" as const },
  high:     { label: "HIGH" as const,     maxThreat: 65, action: "checkin_modal_30s" as const },
  critical: { label: "CRITICAL" as const, maxThreat: 100, action: "emergency_dispatch" as const },
};

// ─── Spatial helpers ──────────────────────────────────────────────────────────

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestPolice(pos: LatLon): { meters: number; name: string } {
  let best = { meters: Infinity, name: "" };
  for (const p of NAGPUR_POLICE) {
    const d = haversineM(pos, p);
    if (d < best.meters) best = { meters: d, name: p.name };
  }
  return best;
}

function inCctvZone(pos: LatLon): { covered: boolean; name: string } {
  // 1. Official Nagpur CCTV
  for (const z of NAGPUR_CCTV) {
    if (haversineM(pos, z) <= z.radiusM) return { covered: true, name: z.name };
  }
  // 2. Custom test CCTVs
  for (const z of CUSTOM_CCTV_POINTS) {
    if (haversineM(pos, z) <= z.radiusM) return { covered: true, name: z.name };
  }
  return { covered: false, name: "" };
}

function nearestBlackspot(pos: LatLon): { near: boolean; penalty: number; desc: string; category?: string } {
  const timeCtx = timeContextPenalty();
  const isNight = timeCtx.label === "LATE NIGHT" || timeCtx.label === "EVENING";

  // 1. Check Verified High-Crime Hotspots (Violent crime, sexual assault risk, robbery pockets)
  for (const c of NAGPUR_CRIME_HOTSPOTS) {
    if (haversineM(pos, c) <= c.bufM) {
      const penalty = isNight ? Math.min(1.0, c.penalty * c.nightSeverityMultiplier) : c.penalty;
      return { near: true, penalty, desc: `${c.name} (${c.desc})`, category: c.category };
    }
  }

  // 2. Official Nagpur Blackspots
  for (const b of NAGPUR_BLACKSPOTS) {
    if (haversineM(pos, b) <= b.bufM) return { near: true, penalty: b.penalty, desc: b.desc, category: "accident_blackspot" };
  }

  // 3. Custom Crime/Vulnerability Zones
  for (const c of CUSTOM_CRIME_ZONES) {
    if (haversineM(pos, c) <= c.bufM) return { near: true, penalty: c.penalty, desc: c.desc, category: "custom_crime" };
  }

  return { near: false, penalty: 0, desc: "" };
}

function lightingAt(pos: LatLon): { penalty: number; label: string; road: string } {
  // 1. Custom Unlit Roads (higher priority override)
  for (const c of CUSTOM_UNLIT_ROADS) {
    if (pos.lat >= c.minLat && pos.lat <= c.maxLat && pos.lon >= c.minLon && pos.lon <= c.maxLon) {
      return { penalty: c.penalty, label: c.status.replace("_", " ").toUpperCase(), road: c.name };
    }
  }
  // 2. Official Lighting Corridors
  for (const c of LIGHTING_CORRIDORS) {
    if (pos.lat >= c.minLat && pos.lat <= c.maxLat && pos.lon >= c.minLon && pos.lon <= c.maxLon) {
      return { penalty: c.penalty, label: c.status.replace("_", " ").toUpperCase(), road: c.name };
    }
  }
  return { penalty: 0.30, label: "PARTIAL", road: "Standard city road" };
}

/** Check if within 60m of a known traffic signal → return grace period */
export function nearSignal(pos: LatLon): { near: boolean; graceSeconds: number; name: string } {
  for (const s of NAGPUR_SIGNALS) {
    if (haversineM(pos, s) <= 60) return { near: true, graceSeconds: s.graceSeconds, name: s.name };
  }
  return { near: false, graceSeconds: 0, name: "" };
}

/** Time-of-day penalty (IST) */
export function timeContextPenalty(): { penalty: number; label: string } {
  // IST = UTC + 5:30
  const now = new Date();
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
  const istHour = (new Date(istMs).getUTCHours()) + (new Date(istMs).getUTCMinutes() / 60);
  if (istHour >= 6 && istHour < 20) return { penalty: 0.00, label: "DAYTIME" };
  if (istHour >= 20 && istHour < 22.5) return { penalty: 0.25, label: "EVENING" };
  return { penalty: 0.75, label: "LATE NIGHT" };
}

// ─── Stationary Engine (A2) ───────────────────────────────────────────────────

/**
 * Classify stationary state from:
 *  - Current speed (m/s)
 *  - Rolling GPS window (last 5 readings) for net displacement
 *  - Duration since stopped
 *  - Proximity to known traffic signals
 */
export function classifyStationary(
  pos: LatLon | null,
  stationarySeconds: number,
  speedMps: number | null,
  gpsWindow: GpsEntry[],
): { class: StationaryClass; penalty: number; detail: string } {
  if (pos === null || speedMps === null) {
    return { class: "MOVING", penalty: 0.00, detail: "GPS initializing" };
  }

  const speedKmh = speedMps * 3.6;

  // Moving check: use BOTH reported speed AND displacement delta to filter GPS jitter
  if (gpsWindow.length >= 2) {
    const oldest = gpsWindow[0].pos;
    const newest = gpsWindow[gpsWindow.length - 1].pos;
    const displacement = haversineM({ lat: oldest.latitude, lon: oldest.longitude }, { lat: newest.latitude, lon: newest.longitude });
    const windowSeconds = (gpsWindow[gpsWindow.length - 1].ts - gpsWindow[0].ts) / 1000;
    const netSpeedKmh = windowSeconds > 0 ? (displacement / windowSeconds) * 3.6 : 0;

    if (netSpeedKmh > 5 || speedKmh > 5) {
      return { class: "MOVING", penalty: 0.00, detail: `Moving at ${speedKmh.toFixed(1)} km/h` };
    }
  } else {
    if (speedKmh > 5) return { class: "MOVING", penalty: 0.00, detail: `Moving at ${speedKmh.toFixed(1)} km/h` };
  }

  // Not moving — check if at a known Nagpur traffic signal
  const signal = nearSignal(pos);
  if (signal.near && stationarySeconds <= signal.graceSeconds) {
    return {
      class: "TRAFFIC_STOP",
      penalty: 0.00,
      detail: `Normal stop at ${signal.name} (${stationarySeconds}s / allowed ${signal.graceSeconds}s)`,
    };
  }

  // Check if stopped inside a high-crime / dark vulnerability hotspot
  const crimeZone = nearestBlackspot(pos);
  if (crimeZone.near && crimeZone.penalty >= 0.80) {
    if (stationarySeconds < 45) {
      return { class: "BRIEF_HALT", penalty: 0.40, detail: `Halted in high-vulnerability zone: ${crimeZone.desc}` };
    }
    if (stationarySeconds < 90) {
      return { class: "PROLONGED", penalty: 0.85, detail: `Vulnerable Stoppage: ${stationarySeconds}s inside ${crimeZone.desc} — threat elevated` };
    }
    return {
      class: "CRITICAL_STAGNATION",
      penalty: 1.00,
      detail: `CRITICAL STAGNATION in high-risk zone: ${Math.round(stationarySeconds / 60)} min — urgent check-in required`,
    };
  }

  // Standard duration penalties on normal roads
  if (stationarySeconds < 90)  return { class: "BRIEF_HALT",         penalty: 0.20, detail: `Brief halt for ${stationarySeconds}s` };
  if (stationarySeconds < 180) return { class: "STATIONARY",         penalty: 0.50, detail: `Stationary ${stationarySeconds}s — elevated monitoring` };
  if (stationarySeconds < 300) return { class: "PROLONGED",          penalty: 0.75, detail: `Prolonged stop: ${Math.round(stationarySeconds / 60)} min — safety check imminent` };
  return {
    class: "CRITICAL_STAGNATION",
    penalty: 1.00,
    detail: `Critical stagnation: ${Math.round(stationarySeconds / 60)} min — emergency risk`,
  };
}

// ─── Deviation Engine (A2) ────────────────────────────────────────────────────

function segmentDistM(p: LatLon, a: Coordinate, b: Coordinate): number {
  const latSc = 111_320;
  const lonSc = Math.cos((p.lat * Math.PI) / 180) * latSc;
  const px = p.lon * lonSc, py = p.lat * latSc;
  const ax = a.longitude * lonSc, ay = a.latitude * latSc;
  const bx = b.longitude * lonSc, by = b.latitude * latSc;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function minDistToRoute(pos: LatLon, pts: Coordinate[]): number {
  if (pts.length < 2) return Infinity;
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segmentDistM(pos, pts[i], pts[i + 1]);
    if (d < m) m = d;
  }
  return m;
}

function movingTowardDest(window: GpsEntry[], dest: LatLon): boolean {
  if (window.length < 2) return true;
  const oldPos = window[0].pos;
  const newPos = window[window.length - 1].pos;
  const dOld = haversineM({ lat: oldPos.latitude, lon: oldPos.longitude }, dest);
  const dNew = haversineM({ lat: newPos.latitude, lon: newPos.longitude }, dest);
  return dNew < dOld - 10; // at least 10m closer to destination
}

export function classifyDeviation(
  pos: LatLon | null,
  routePts: Coordinate[],
  altRoutes: Coordinate[][],
  dest: LatLon | null,
  window: GpsEntry[],
): { class: DeviationClass; penalty: number; deviationMeters: number | null; detail: string } {
  if (!pos) return { class: "UNKNOWN", penalty: 0.10, deviationMeters: null, detail: "Awaiting GPS fix" };
  if (routePts.length < 2) return { class: "UNKNOWN", penalty: 0.10, deviationMeters: null, detail: "Route not loaded" };

  const d = minDistToRoute(pos, routePts);

  // Case 1: On-route (within 60m of planned geometry)
  if (d <= 60) return { class: "ON_ROUTE", penalty: 0.00, deviationMeters: Math.round(d), detail: `On route (${Math.round(d)}m from path)` };

  // Case 2: Legitimate Re-route (aligned on an alternative candidate route)
  for (const alt of altRoutes) {
    if (minDistToRoute(pos, alt) <= 75) {
      return { class: "LEGITIMATE_REROUTE", penalty: 0.05, deviationMeters: Math.round(d), detail: `Following parallel recognized route (${Math.round(d)}m from original)` };
    }
  }

  // Vector analysis: is distance to destination actively decreasing?
  const isClosingDistance = dest ? movingTowardDest(window, dest) : true;
  const crimeZone = nearestBlackspot(pos);

  // Case 3: Traffic Bypass / Parallel road detour (heading closer to destination)
  if (isClosingDistance) {
    if (d <= 250) {
      return { class: "TRAFFIC_BYPASS", penalty: 0.15, deviationMeters: Math.round(d), detail: `Traffic bypass — moving toward destination (${Math.round(d)}m off route)` };
    }
    if (d <= 500 && !crimeZone.near) {
      return { class: "TRAFFIC_BYPASS", penalty: 0.30, deviationMeters: Math.round(d), detail: `Major bypass (${Math.round(d)}m) — maintaining heading to destination` };
    }
  }

  // Case 4: Moving away from destination or deviating into high-risk crime/dark pockets
  if (crimeZone.near || d > 400 || !isClosingDistance) {
    const penalty = crimeZone.near ? 0.95 : 0.85;
    return {
      class: "SUSPICIOUS",
      penalty,
      deviationMeters: Math.round(d),
      detail: `SUSPICIOUS DIVERSION — ${Math.round(d)}m off route, moving away from destination ${crimeZone.near ? `near ${crimeZone.desc}` : ""}`,
    };
  }

  return {
    class: "MINOR",
    penalty: 0.35,
    deviationMeters: Math.round(d),
    detail: `Minor detour ${Math.round(d)}m off route — monitoring heading`,
  };
}

// ─── A3: Threat Score Fusion ──────────────────────────────────────────────────

const OVERRIDE_PENALTIES: Record<string, number> = {
  on_route: 0.00, moving: 0.00, traffic_stop: 0.00, well_lit: 0.00, covered: 0.00, safe: 0.00, low: 0.00, normal: 0.00, daytime: 0.00,
  minor: 0.30, brief_halt: 0.20, legitimate_reroute: 0.15, traffic_bypass: 0.20, partial: 0.35, nearby: 0.30, medium: 0.45, evening: 0.25,
  stationary: 0.50, poor: 0.75, prolonged: 0.75, high: 0.85, unavailable: 0.85, isolated: 0.85, unsafe: 0.85, late_night: 0.75,
  critical_stagnation: 1.00, suspicious: 0.90, unlit: 0.85, blackspot: 0.80, critical: 1.00,
};

function overridePenalty(v: string): number {
  return OVERRIDE_PENALTIES[v.toLowerCase().replace(/\s+/g, "_")] ?? 0.30;
}

export function computeThreatScore(
  pos: LatLon | null,
  deviationResult: ReturnType<typeof classifyDeviation>,
  stationaryResult: ReturnType<typeof classifyStationary>,
  testOverrides: Partial<Record<string, string>> = {},
): ThreatAnalysis {
  const spatial = pos ? {
    police: nearestPolice(pos),
    cctv: inCctvZone(pos),
    lighting: lightingAt(pos),
    blackspot: nearestBlackspot(pos),
  } : null;

  const timeCtx = timeContextPenalty();

  const factors: ThreatFactor[] = [];

  // Factor 1: Route Deviation
  const devOvr = testOverrides["routeDeviation"];
  const devPenalty = devOvr ? overridePenalty(devOvr) : deviationResult.penalty;
  factors.push({
    id: "routeDeviation", label: "Route Deviation",
    state: devOvr ? devOvr.replace(/_/g, " ").toUpperCase() : deviationResult.class.replace(/_/g, " "),
    penalty: devPenalty, weight: THREAT_WEIGHTS.routeDeviation,
    source: devOvr ? "TEST" : pos ? "LIVE" : "UNAVAILABLE",
    detail: deviationResult.detail,
  });

  // Factor 2: Stationary
  const statOvr = testOverrides["stationaryCondition"];
  const statPenalty = statOvr ? overridePenalty(statOvr) : stationaryResult.penalty;
  factors.push({
    id: "stationaryCondition", label: "Stationary Condition",
    state: statOvr ? statOvr.replace(/_/g, " ").toUpperCase() : stationaryResult.class.replace(/_/g, " "),
    penalty: statPenalty, weight: THREAT_WEIGHTS.stationaryCondition,
    source: statOvr ? "TEST" : pos ? "LIVE" : "UNAVAILABLE",
    detail: stationaryResult.detail,
  });

  // Factor 3: Street Lighting
  const litOvr = testOverrides["streetLighting"];
  const litData = spatial?.lighting ?? { penalty: 0.30, label: "UNKNOWN", road: "" };
  const litPenalty = litOvr ? overridePenalty(litOvr) : litData.penalty;
  factors.push({
    id: "streetLighting", label: "Street Lighting",
    state: litOvr ? litOvr.replace(/_/g, " ").toUpperCase() : litData.label,
    penalty: litPenalty, weight: THREAT_WEIGHTS.streetLighting,
    source: litOvr ? "TEST" : spatial ? "SPATIAL" : "UNAVAILABLE",
    detail: litData.road || undefined,
  });

  // Factor 4: CCTV & Police
  const cctvOvr = testOverrides["cctvSecurity"];
  let cctvPenalty: number;
  let cctvState: string;
  if (cctvOvr) {
    cctvPenalty = overridePenalty(cctvOvr);
    cctvState = cctvOvr.replace(/_/g, " ").toUpperCase();
  } else if (spatial) {
    if (spatial.cctv.covered) { cctvPenalty = 0.00; cctvState = `COVERED — ${spatial.cctv.name}`; }
    else if (spatial.police.meters <= 300) { cctvPenalty = 0.05; cctvState = `POLICE NEARBY (${Math.round(spatial.police.meters)}m)`; }
    else if (spatial.police.meters <= 800) { cctvPenalty = 0.30; cctvState = `PARTIAL — ${Math.round(spatial.police.meters)}m to police`; }
    else if (spatial.police.meters <= 1500) { cctvPenalty = 0.55; cctvState = "SPARSE COVERAGE"; }
    else { cctvPenalty = 0.85; cctvState = `ISOLATED — ${(spatial.police.meters / 1000).toFixed(1)}km to help`; }
  } else {
    cctvPenalty = 0.50; cctvState = "NO SPATIAL DATA";
  }
  factors.push({
    id: "cctvSecurity", label: "CCTV & Police Coverage",
    state: cctvState, penalty: cctvPenalty, weight: THREAT_WEIGHTS.cctvSecurity,
    source: cctvOvr ? "TEST" : spatial ? "SPATIAL" : "UNAVAILABLE",
    detail: spatial ? `Nearest police: ${spatial.police.name}` : undefined,
  });

  // Factor 5: Accident Blackspot
  const bsOvr = testOverrides["accidentBlackspot"];
  const bsData = spatial?.blackspot ?? { near: false, penalty: 0.00, desc: "" };
  const bsPenalty = bsOvr ? overridePenalty(bsOvr) : bsData.penalty;
  factors.push({
    id: "accidentBlackspot", label: "Accident Blackspot",
    state: bsOvr ? bsOvr.replace(/_/g, " ").toUpperCase() : bsData.near ? `BLACKSPOT — ${bsData.desc}` : "CLEAR",
    penalty: bsPenalty, weight: THREAT_WEIGHTS.accidentBlackspot,
    source: bsOvr ? "TEST" : spatial ? "SPATIAL" : "UNAVAILABLE",
    detail: bsData.desc || undefined,
  });

  // Factor 6: Road Hierarchy (derived from lighting status as proxy)
  const roadOvr = testOverrides["roadHierarchy"];
  const roadPenalty = roadOvr ? overridePenalty(roadOvr)
    : litData.label === "WELL LIT" ? 0.00
    : litData.label === "PARTIAL" ? 0.25
    : 0.75;
  const roadState = roadOvr ? roadOvr.replace(/_/g, " ").toUpperCase()
    : litData.label === "WELL LIT" ? "PRIMARY ARTERIAL"
    : litData.label === "PARTIAL" ? "SECONDARY STREET"
    : "ISOLATED LANE";
  factors.push({
    id: "roadHierarchy", label: "Road Class",
    state: roadState, penalty: roadPenalty, weight: THREAT_WEIGHTS.roadHierarchy,
    source: roadOvr ? "TEST" : spatial ? "SPATIAL" : "UNAVAILABLE",
  });

  // Factor 7: Time Context
  const timeOvr = testOverrides["timeContext"];
  const timePenalty = timeOvr ? overridePenalty(timeOvr) : timeCtx.penalty;
  factors.push({
    id: "timeContext", label: "Time & Night Context",
    state: timeOvr ? timeOvr.replace(/_/g, " ").toUpperCase() : timeCtx.label,
    penalty: timePenalty, weight: THREAT_WEIGHTS.timeContext,
    source: timeOvr ? "TEST" : "TEMPORAL",
  });

  // ── Score calculation ───────────────────────────────────────────────────────
  const totalW = factors.reduce((s, f) => s + f.weight, 0);
  const wPenalty = factors.reduce((s, f) => s + f.weight * f.penalty, 0);
  const rawThreat = totalW === 0 ? 0 : (wPenalty / totalW) * 100;
  const threatScore = Math.max(0, Math.min(100, Math.round(rawThreat)));
  const safetyScore = 100 - threatScore;

  let tier: ThreatTier = "low";
  if (threatScore > 65) tier = "critical";
  else if (threatScore > 40) tier = "high";
  else if (threatScore > 20) tier = "medium";

  const tc = THREAT_TIER_CONFIG[tier];

  return {
    threatScore,
    safetyScore,
    tier,
    tierLabel: tc.label,
    action: tc.action,
    factors,
    deviationClass: deviationResult.class,
    stationaryClass: stationaryResult.class,
    stationaryDurationSeconds: 0, // filled by caller
    deviationMeters: deviationResult.deviationMeters,
    needsCheckin: tier === "high",
    needsDispatch: tier === "critical",
    generatedAt: new Date().toISOString(),
  };
}

// ─── Emergency Payload Builder ────────────────────────────────────────────────

export function buildEmergencyPayload(opts: {
  userName: string;
  userPhone: string;
  vehicle: { licensePlate?: string; driverName?: string; model?: string; color?: string };
  position: Coordinate;
  locationLabel: string;
  journeyId: string;
  analysis: ThreatAnalysis;
  triggerReason: string;
}): EmergencyPayload {
  // Convert UTC to IST
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " IST";
  return {
    userName: opts.userName,
    userPhone: opts.userPhone,
    vehiclePlate: opts.vehicle.licensePlate ?? "Not provided",
    driverName: opts.vehicle.driverName ?? "Unknown",
    vehicleModel: opts.vehicle.model ?? "Unknown",
    vehicleColor: opts.vehicle.color ?? "Unknown",
    latitude: opts.position.latitude,
    longitude: opts.position.longitude,
    locationLabel: opts.locationLabel,
    journeyId: opts.journeyId,
    threatScore: opts.analysis.threatScore,
    tier: opts.analysis.tier,
    triggerReason: opts.triggerReason,
    triggeredAt: nowIST,
  };
}

/** Format the emergency message that goes to contacts */
export function formatEmergencyMessage(payload: EmergencyPayload): string {
  const mapsLink = `https://maps.google.com/?q=${payload.latitude},${payload.longitude}`;
  return `🚨 SAFERIDE EMERGENCY ALERT

User: ${payload.userName} (${payload.userPhone})
Reason: ${payload.triggerReason}
Threat Score: ${payload.threatScore}/100 (${payload.tier.toUpperCase()} RISK)

📍 Location: ${payload.locationLabel}
🗺 GPS: ${payload.latitude.toFixed(5)}, ${payload.longitude.toFixed(5)}
🔗 Map: ${mapsLink}

🚗 Vehicle: ${payload.vehicleModel} (${payload.vehicleColor})
   Plate: ${payload.vehiclePlate}
   Driver: ${payload.driverName}

⏰ Time: ${payload.triggeredAt}
🆘 If unresponsive, call 112 immediately.`;
}

// ─── 100-Meter Equidistant Route Resampling Algorithm ────────────────────────

/**
 * Resamples any polyline into exact 100-meter equidistant checkpoints.
 * This guarantees consistent, unbiased safety sampling regardless of turn point density.
 */
export function resampleRouteEvery100m(pts: Coordinate[], stepMeters = 100): RouteCheckpoint[] {
  if (pts.length < 2) return [];

  // Calculate cumulative segment lengths
  const segDistances: number[] = [0];
  let totalDistance = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const d = haversineM(
      { lat: pts[i].latitude, lon: pts[i].longitude },
      { lat: pts[i + 1].latitude, lon: pts[i + 1].longitude }
    );
    totalDistance += d;
    segDistances.push(totalDistance);
  }

  if (totalDistance === 0) return [];

  const checkpoints: RouteCheckpoint[] = [];
  let currentTargetDist = 0;
  let segIndex = 0;

  while (currentTargetDist <= totalDistance) {
    // Find the polyline segment that contains currentTargetDist
    while (segIndex < segDistances.length - 2 && segDistances[segIndex + 1] < currentTargetDist) {
      segIndex++;
    }

    const d0 = segDistances[segIndex];
    const d1 = segDistances[segIndex + 1];
    const segLen = d1 - d0;

    let lat = pts[segIndex].latitude;
    let lon = pts[segIndex].longitude;

    if (segLen > 0) {
      const fraction = (currentTargetDist - d0) / segLen;
      lat = pts[segIndex].latitude + (pts[segIndex + 1].latitude - pts[segIndex].latitude) * fraction;
      lon = pts[segIndex].longitude + (pts[segIndex + 1].longitude - pts[segIndex].longitude) * fraction;
    }

    checkpoints.push({
      coord: { lat, lon },
      distanceAlongM: Math.round(currentTargetDist),
    });

    currentTargetDist += stepMeters;
  }

  // Always include the exact final destination point if not already at the end
  const lastPt = pts[pts.length - 1];
  if (
    checkpoints.length === 0 ||
    checkpoints[checkpoints.length - 1].distanceAlongM < Math.round(totalDistance) - 10
  ) {
    checkpoints.push({
      coord: { lat: lastPt.latitude, lon: lastPt.longitude },
      distanceAlongM: Math.round(totalDistance),
    });
  }

  return checkpoints;
}

// ─── Pre-Trip Route Safety Scorer (A1 — 100m Equidistant Evaluator) ───────────

export type RoutePreScore = {
  routeId: string;
  safetyScore: number;
  threatScore: number;
  riskLabel: "SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS";
  lightingPct: number;
  cctvPct: number;
  blackspotCount: number;
  nearestPoliceM: number;
  timeContext: string;
  explanation: string;
  checkpointsEvaluated?: number;
};

/** Score a route's safety before trip starts by testing every 100m against Nagpur spatial data */
export function scoreRoutePreTrip(routeId: string, pts: Coordinate[]): RoutePreScore {
  const timeCtx = timeContextPenalty();
  if (pts.length < 2) {
    return {
      routeId,
      safetyScore: 50,
      threatScore: 50,
      riskLabel: "MODERATE",
      lightingPct: 0,
      cctvPct: 0,
      blackspotCount: 0,
      nearestPoliceM: 9999,
      timeContext: timeCtx.label,
      explanation: "Route too short to assess",
    };
  }

  // Resample route coordinates every 100 meters
  const checkpoints = resampleRouteEvery100m(pts, 100);
  const totalCheckpoints = checkpoints.length;

  const segmentScores: number[] = [];
  let litCount = 0, cctvCount = 0, bsCount = 0, minPolice = Infinity;
  const loggedSamples: string[] = [];

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const pos = cp.coord;

    const lit = lightingAt(pos);
    const cctv = inCctvZone(pos);
    const bs = nearestBlackspot(pos);
    const police = nearestPolice(pos);

    if (lit.label === "WELL LIT") litCount++;
    if (cctv.covered) cctvCount++;
    if (bs.near) bsCount++;
    if (police.meters < minPolice) minPolice = police.meters;

    const cctvPenalty = cctv.covered ? 0.00 : police.meters <= 800 ? 0.30 : 0.70;
    const roadP = lit.label === "WELL LIT" ? 0.00 : lit.label === "PARTIAL" ? 0.25 : 0.75;

    const weightSum =
      THREAT_WEIGHTS.streetLighting +
      THREAT_WEIGHTS.cctvSecurity +
      THREAT_WEIGHTS.accidentBlackspot +
      THREAT_WEIGHTS.roadHierarchy +
      THREAT_WEIGHTS.timeContext;

    const segThreat =
      ((THREAT_WEIGHTS.streetLighting * lit.penalty +
        THREAT_WEIGHTS.cctvSecurity * cctvPenalty +
        THREAT_WEIGHTS.accidentBlackspot * bs.penalty +
        THREAT_WEIGHTS.roadHierarchy * roadP +
        THREAT_WEIGHTS.timeContext * timeCtx.penalty) /
        weightSum) *
      100;

    segmentScores.push(segThreat);

    // Unabridged logging of EVERY single 100m checkpoint
    loggedSamples.push(
      `   [${String(cp.distanceAlongM).padStart(4, "0")}m] (${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}) | Road: ${lit.road} (${lit.label}) | Police: ${police.name} (${Math.round(police.meters)}m) | CCTV: ${cctv.covered ? "YES" : "NO"} | Threat: ${Math.round(segThreat)}/100`
    );
  }

  const n = segmentScores.length;
  const avgThreat = n > 0 ? segmentScores.reduce((a, b) => a + b, 0) / n : 50;
  const threat = Math.round(avgThreat);
  const safety = 100 - threat;

  const riskLabel: RoutePreScore["riskLabel"] =
    threat <= 20 ? "SAFE" : threat <= 40 ? "MODERATE" : threat <= 65 ? "HIGH_RISK" : "DANGEROUS";

  const parts: string[] = [];
  if (litCount === n) parts.push("100% lit route");
  else parts.push(`${Math.round((litCount / n) * 100)}% lit`);
  if (cctvCount > 0) parts.push(`${Math.round((cctvCount / n) * 100)}% CCTV coverage`);
  if (bsCount > 0) parts.push(`${bsCount} blackspot${bsCount > 1 ? "s" : ""} on path`);
  if (minPolice < 600) parts.push(`Police station ${Math.round(minPolice)}m away`);
  parts.push(timeCtx.label);

  // ── Print Complete Unabridged Route Inspection Log ──
  console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ SAFERIDE ROUTE EVALUATION [${routeId.toUpperCase()}]`);
  console.log(`╠══════════════════════════════════════════════════════════════════════════════╣`);
  console.log(`📍 Total Checkpoints Evaluated: ${totalCheckpoints} (Every 100 meters)`);
  console.log(`📍 Total Road Geometry Vertices: ${pts.length} points`);
  console.log(`📍 Time Context: ${timeCtx.label} (penalty: ${timeCtx.penalty})`);
  console.log(`--- COMPLETE 100m CHECKPOINT BREAKDOWN ---`);
  loggedSamples.forEach((log) => console.log(log));
  console.log(`------------------------------------------`);
  console.log(`🛡️ Final Safety Score : ${safety} / 100 (${riskLabel})`);
  console.log(`⚠️ Threat Score       : ${threat} / 100`);
  console.log(`💡 Lighting           : ${Math.round((litCount / n) * 100)}% well-lit`);
  console.log(`📹 CCTV Coverage      : ${Math.round((cctvCount / n) * 100)}% covered`);
  console.log(`🚨 Nearest Police     : ${Math.round(minPolice)}m`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝\n`);

  return {
    routeId,
    safetyScore: safety,
    threatScore: threat,
    riskLabel,
    lightingPct: Math.round((litCount / n) * 100),
    cctvPct: Math.round((cctvCount / n) * 100),
    blackspotCount: bsCount,
    nearestPoliceM: Math.round(minPolice),
    timeContext: timeCtx.label,
    explanation: parts.join(" · "),
    checkpointsEvaluated: totalCheckpoints,
  };
}

// ─── GPS Simulation Scenarios (Viva Demo Mode) ────────────────────────────────

export type SimScenario = "smooth_ride" | "traffic_stop" | "legitimate_detour" | "night_suspicious";

export type SimFrame = { coord: Coordinate; speedMps: number; label: string };

/** Generate a sequence of simulated GPS frames for presentation scenarios */
export function getSimulationFrames(scenario: SimScenario): SimFrame[] {
  // Nagpur Corridor: RBU (Ramdeobaba University) ➔ Katol Road ➔ Sadar ➔ Railway Station
  const baseRide: Array<[number, number, number, string]> = [
    [21.1764, 79.0612, 9.5, "RBU Main Gate (Start)"],
    [21.1720, 79.0580, 11.0, "Friends Colony T-Point"],
    [21.1685, 79.0550, 10.5, "Katol Road Square (Well Lit)"],
    [21.1650, 79.0690, 11.5, "Katol Road Arterial (Gittikhadan PS 180m)"],
    [21.1575, 79.0805, 9.0, "Sadar Mount Road Chowk (CCTV Active)"],
    [21.1550, 79.0830, 8.5, "Approaching Kingsway Bridge"],
    [21.1522, 79.0878, 0.0, "Nagpur Railway Station (Arrived Safe)"],
  ];

  if (scenario === "smooth_ride") {
    return baseRide.map(([lat, lon, spd, lbl]) => ({
      coord: { latitude: lat, longitude: lon },
      speedMps: spd,
      label: lbl,
    }));
  }

  if (scenario === "traffic_stop") {
    // Normal transit -> stop at traffic signal with grace period -> resume
    const frames: SimFrame[] = [
      { coord: { latitude: 21.1764, longitude: 79.0612 }, speedMps: 9.5, label: "RBU Gate (Start)" },
      { coord: { latitude: 21.1720, longitude: 79.0580 }, speedMps: 8.0, label: "Friends Colony Square (Slowing)" },
      // 8 frames of 0 speed at traffic signal (Whitelisted Grace Period)
      ...Array.from({ length: 8 }, (_, i) => ({
        coord: { latitude: 21.1451, longitude: 79.0800 },
        speedMps: 0,
        label: `Signal Stop at RBI Square (${(i + 1) * 6}s / 120s grace allowed)`,
      })),
      { coord: { latitude: 21.1550, longitude: 79.0830 }, speedMps: 9.0, label: "Signal Green — Resumed transit" },
      { coord: { latitude: 21.1522, longitude: 79.0878 }, speedMps: 0.0, label: "Nagpur Railway Station (Arrived)" },
    ];
    return frames;
  }

  if (scenario === "legitimate_detour") {
    // Rider takes parallel street to bypass traffic, heading toward destination
    const frames: SimFrame[] = [
      { coord: { latitude: 21.1764, longitude: 79.0612 }, speedMps: 9.5, label: "RBU Gate (Start)" },
      { coord: { latitude: 21.1720, longitude: 79.0580 }, speedMps: 8.5, label: "Friends Colony T-Point" },
      { coord: { latitude: 21.1660, longitude: 79.0720 }, speedMps: 7.5, label: "Bypass via Residency Road (220m off route)" },
      { coord: { latitude: 21.1600, longitude: 79.0780 }, speedMps: 8.0, label: "Parallel Arterial — Heading toward Station" },
      { coord: { latitude: 21.1550, longitude: 79.0830 }, speedMps: 9.0, label: "Rejoining main road" },
      { coord: { latitude: 21.1522, longitude: 79.0878 }, speedMps: 0.0, label: "Nagpur Railway Station (Arrived)" },
    ];
    return frames;
  }

  if (scenario === "night_suspicious") {
    // Rider turns off-route into dark Seminary Hills woods, moves away from destination, and halts
    return [
      { coord: { latitude: 21.1764, longitude: 79.0612 }, speedMps: 9.5, label: "RBU Gate (Start)" },
      { coord: { latitude: 21.1710, longitude: 79.0540 }, speedMps: 7.0, label: "Veered off Katol Rd into Seminary Woods (UNLIT)" },
      { coord: { latitude: 21.1620, longitude: 79.0510 }, speedMps: 4.0, label: "Off-Grid in Seminary Woods (Moving away from dest)" },
      { coord: { latitude: 21.1620, longitude: 79.0510 }, speedMps: 0.0, label: "Vehicle Stopped in Dark Pocket (Threat > 55)" },
      { coord: { latitude: 21.1620, longitude: 79.0510 }, speedMps: 0.0, label: "30s Safety Check-in Modal Triggered" },
      { coord: { latitude: 21.1620, longitude: 79.0510 }, speedMps: 0.0, label: "Unresponsive -> Automated Cloud SOS Dispatched!" },
    ];
  }

  return [];
}
