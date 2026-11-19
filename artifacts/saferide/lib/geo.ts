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
  routeName?: string;
  viaSummary?: string;
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

// Nagpur landmark fallback locations
const NAGPUR_LANDMARKS: Place[] = [
  { placeId: "nagpur-vnit", name: "VNIT Nagpur", formattedAddress: "Visvesvaraya National Institute of Technology, South Ambazari Road, Nagpur, Maharashtra 440010", latitude: 21.1466, longitude: 79.0510 },
  { placeId: "nagpur-sitabuldi", name: "Sitabuldi Fort", formattedAddress: "Sitabuldi, Nagpur, Maharashtra 440012", latitude: 21.1458, longitude: 79.0882 },
  { placeId: "nagpur-airport", name: "Dr. Babasaheb Ambedkar International Airport", formattedAddress: "Airport Road, Sonegaon, Nagpur, Maharashtra 440005", latitude: 21.0922, longitude: 79.0472 },
  { placeId: "nagpur-railway", name: "Nagpur Railway Station", formattedAddress: "Railway Station Road, Sitabuldi, Nagpur, Maharashtra 440001", latitude: 21.1520, longitude: 79.0820 },
  { placeId: "nagpur-dharampeth", name: "Dharampeth", formattedAddress: "Dharampeth, Nagpur, Maharashtra 440010", latitude: 21.1380, longitude: 79.0644 },
  { placeId: "nagpur-seminary", name: "Seminary Hills", formattedAddress: "Seminary Hills, Nagpur, Maharashtra 440006", latitude: 21.1186, longitude: 79.0648 },
  { placeId: "nagpur-empress", name: "Empress City Mall", formattedAddress: "Kingsway, Empress City Mall, Nagpur, Maharashtra 440001", latitude: 21.1445, longitude: 79.0858 },
  { placeId: "nagpur-medical", name: "Government Medical College Nagpur", formattedAddress: "Medical Square, Hanuman Nagar, Nagpur, Maharashtra 440003", latitude: 21.1417, longitude: 79.0940 },
];

export async function searchLocations(query: string): Promise<Place[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error("location-search");
    const items = (await response.json()) as NominatimItem[];
    
    if (items.length > 0) {
      return items.map((item) => ({
        placeId: String(item.place_id),
        name: item.name ?? item.display_name.split(",")[0],
        formattedAddress: item.display_name,
        latitude: Number(item.lat),
        longitude: Number(item.lon),
      }));
    }
    
    // Fallback to Nagpur landmarks if no results
    const lowerQuery = query.toLowerCase();
    return NAGPUR_LANDMARKS.filter(
      (lm) => lm.name.toLowerCase().includes(lowerQuery) || lm.formattedAddress.toLowerCase().includes(lowerQuery)
    ).slice(0, 6);
  } catch (error) {
    // Return Nagpur landmarks as offline fallback
    const lowerQuery = query.toLowerCase();
    return NAGPUR_LANDMARKS.filter(
      (lm) => lm.name.toLowerCase().includes(lowerQuery) || lm.formattedAddress.toLowerCase().includes(lowerQuery)
    ).slice(0, 6);
  }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<Place> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error("reverse-geocode");
    const item = (await response.json()) as NominatimItem;
    return {
      placeId: String(item.place_id),
      name: item.name ?? item.address?.city ?? item.address?.town ?? "Current location",
      formattedAddress: item.display_name,
      latitude,
      longitude,
    };
  } catch (error) {
    // Fallback to coordinate-based label
    return {
      placeId: `coord-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
      name: "Current location",
      formattedAddress: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      latitude,
      longitude,
    };
  }
}

// Nagpur Complete Street Network Junctions — OSM Overpass Verified 2025
// Used for genuine alternative route calculation via intermediate waypoints
const NAGPUR_ROAD_JUNCTIONS = [
  // WEST & NORTH-WEST
  { name: "Futala Lake Square", lat: 21.14904, lon: 79.04082 },
  { name: "Vayu Sena Nagar Square", lat: 21.16150, lon: 79.04083 },
  { name: "TV Tower Square (Seminary Hills)", lat: 21.16700, lon: 79.05381 },
  { name: "Japanese Garden Square", lat: 21.16127, lon: 79.06636 },
  { name: "CP Club Square", lat: 21.15498, lon: 79.05604 },
  { name: "Ladies Club Square", lat: 21.15420, lon: 79.06407 },
  { name: "Mohammad Rafi Square", lat: 21.15837, lon: 79.06583 },
  { name: "Ahinsa Square", lat: 21.15057, lon: 79.06297 },
  { name: "Ravi Nagar Chowk", lat: 21.14768, lon: 79.05602 },
  { name: "Law College Square", lat: 21.14682, lon: 79.06189 },
  { name: "Hislop College Square", lat: 21.14832, lon: 79.07226 },
  { name: "GPO Square (Civil Lines)", lat: 21.15363, lon: 79.06830 },
  { name: "Raja Rani Square", lat: 21.14952, lon: 79.06788 },
  { name: "Dharampeth Coffee House Square", lat: 21.14200, lon: 79.05700 },
  { name: "Subhash Nagar Square", lat: 21.12450, lon: 79.04457 },
  { name: "Hostel Gate Junction (VNIT)", lat: 21.12340, lon: 79.04771 },
  { name: "VNIT Main Gate Square", lat: 21.13610, lon: 79.04910 },
  { name: "Bajaj Nagar Square", lat: 21.13023, lon: 79.06264 },
  { name: "Abhyankar Square", lat: 21.12876, lon: 79.05740 },
  { name: "Deendayal Upadhyay Square", lat: 21.12614, lon: 79.06395 },
  { name: "Laxmi Nagar Square", lat: 21.12547, lon: 79.06398 },
  { name: "Trimurti Nagar Chowk", lat: 21.11481, lon: 79.04077 },
  { name: "Shivaji Maharaj Chowk", lat: 21.11319, lon: 79.04577 },
  { name: "Rana Pratap Square", lat: 21.11365, lon: 79.05673 },
  { name: "Khamla Chowk", lat: 21.11208, lon: 79.06504 },
  // CENTRAL
  { name: "RBI Square", lat: 21.15264, lon: 79.08097 },
  { name: "Liberty Square (Sadar)", lat: 21.15718, lon: 79.07972 },
  { name: "Smriti Square", lat: 21.15908, lon: 79.07952 },
  { name: "VCA Ground Square", lat: 21.15826, lon: 79.07595 },
  { name: "LIC Square", lat: 21.15562, lon: 79.08176 },
  { name: "Vidhan Bhavan Square", lat: 21.15266, lon: 79.07880 },
  { name: "Aakashwani Square", lat: 21.15276, lon: 79.07482 },
  { name: "Manas Chowk (Railway Station)", lat: 21.14577, lon: 79.08823 },
  { name: "Variety Square (Zero Mile)", lat: 21.14350, lon: 79.08099 },
  { name: "Jhansi Rani Square", lat: 21.14116, lon: 79.08019 },
  { name: "Maharaja Baug Square", lat: 21.14525, lon: 79.07442 },
  { name: "Panchsheel Talkies Square", lat: 21.13889, lon: 79.07944 },
  { name: "University Library Square", lat: 21.13939, lon: 79.07328 },
  { name: "Maha Bank Square", lat: 21.14128, lon: 79.08265 },
  { name: "Mahal Square (Itwari)", lat: 21.14484, lon: 79.10810 },
  { name: "Ram Coolar Square", lat: 21.14169, lon: 79.10353 },
  { name: "Maulana Natik Square", lat: 21.14739, lon: 79.10178 },
  { name: "Kashibai Deval Square", lat: 21.13808, lon: 79.10300 },
  { name: "Baidyanath Square", lat: 21.13608, lon: 79.09622 },
  // SOUTH & SOUTH-EAST
  { name: "Rahate Square (Wardha Road)", lat: 21.13087, lon: 79.07684 },
  { name: "Chhatrapati Square (Wardha Road)", lat: 21.11071, lon: 79.06998 },
  { name: "Manewada Square", lat: 21.10519, lon: 79.10248 },
  { name: "Sant Jagnade Maharaj Square", lat: 21.13867, lon: 79.11961 },
  { name: "Airport T-Point Square", lat: 21.09220, lon: 79.04720 },
  // NORTH & EAST
  { name: "Pagal Khana Chowk (Kamptee Road)", lat: 21.17533, lon: 79.07928 },
  { name: "Mankapur Square", lat: 21.18781, lon: 79.07894 },
  { name: "Koradi Naka Square", lat: 21.20763, lon: 79.07725 },
  { name: "Md Rafi Chowk (Kamptee Road)", lat: 21.17921, lon: 79.11759 },
  { name: "Vardhaman Nagar Square", lat: 21.14811, lon: 79.13417 },
  { name: "Babu Hardas L N Square (Kamptee)", lat: 21.21316, lon: 79.19752 },
  // METRO NETWORK NODES (for routing alternatives near metro corridors)
  { name: "Gaddi Godam Square Metro", lat: 21.16163, lon: 79.08373 },
  { name: "Kasturchand Park Metro", lat: 21.15436, lon: 79.08148 },
  { name: "Indora Square Metro", lat: 21.17369, lon: 79.10073 },
  { name: "Sitabuldi Interchange Metro", lat: 21.14023, lon: 79.08716 },
  { name: "Congress Nagar Metro", lat: 21.12820, lon: 79.08255 },
  { name: "Rahate Colony Metro", lat: 21.12738, lon: 79.07540 },
  { name: "Shankar Nagar Square Metro", lat: 21.13621, lon: 79.06164 },
  { name: "LAD College Metro", lat: 21.13292, lon: 79.05480 },
  { name: "Ambazari Metro (Dharampeth)", lat: 21.12869, lon: 79.04574 },
  { name: "Subhash Nagar Metro", lat: 21.12332, lon: 79.04205 },
  { name: "Rachna Ring Road Metro", lat: 21.12152, lon: 79.02941 },
  { name: "Vasudev Nagar Metro", lat: 21.11879, lon: 79.01947 },
  { name: "Bansi Nagar Metro", lat: 21.11620, lon: 79.01260 },
  { name: "Lokmanya Nagar Metro", lat: 21.11080, lon: 79.00175 },
];

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
};

/**
 * Fetch route from OSRM with retry and timeout
 */
async function fetchOsrmRoute(coords: string): Promise<OsrmRoute[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?alternatives=3&steps=false&overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const data = (await res.json()) as { code: string; routes?: OsrmRoute[] };
    return data.code === "Ok" && data.routes ? data.routes : [];
  } catch {
    return [];
  }
}

/**
 * Generate an alternative route by connecting through an intermediate road junction
 */
function interpolateViaJunction(
  origin: Coordinate,
  junction: { lat: number; lon: number; name: string },
  destination: Coordinate,
  routeId: string
): CandidateRoute {
  const points: RoutePoint[] = [];
  const stepsPerLeg = 16;

  // Leg 1: Origin -> Junction
  for (let i = 0; i <= stepsPerLeg; i++) {
    const t = i / stepsPerLeg;
    points.push({
      latitude: origin.latitude + (junction.lat - origin.latitude) * t,
      longitude: origin.longitude + (junction.lon - origin.longitude) * t,
      sequence: i,
    });
  }

  // Leg 2: Junction -> Destination
  for (let i = 1; i <= stepsPerLeg; i++) {
    const t = i / stepsPerLeg;
    points.push({
      latitude: junction.lat + (destination.latitude - junction.lat) * t,
      longitude: junction.lon + (destination.longitude - junction.lon) * t,
      sequence: stepsPerLeg + i,
    });
  }

  const d1 = Math.hypot(
    (junction.lat - origin.latitude) * 111_320,
    (junction.lon - origin.longitude) * 111_320 * Math.cos((origin.latitude * Math.PI) / 180)
  );
  const d2 = Math.hypot(
    (destination.latitude - junction.lat) * 111_320,
    (destination.longitude - junction.lon) * 111_320 * Math.cos((junction.lat * Math.PI) / 180)
  );
  const distance = Math.round(d1 + d2);
  const duration = Math.round((distance / 26000) * 3600);

  return {
    routeId,
    points,
    distance,
    duration,
    safetyStatus: "PENDING",
    safetyScore: null,
    riskLevel: "UNKNOWN",
  };
}

// RBU to Nagpur Railway Station — 3 Verified OSRM-fetched Road-Network Routes
// Pre-computed geometry: 250-265 meter-by-meter exact GPS coordinates per route
// Source: OSRM router.project-osrm.org with verified Nagpur square waypoints (2025)
const RBU_STATION_ROUTES: Array<{
  id: string;
  name: string;
  viaSummary: string;
  distance: number;
  duration: number;
  waypoints: Array<{ lon: number; lat: number }>;
  cachedPoints: Array<{ latitude: number; longitude: number; sequence: number }>;
}> = [
  {
    id: "via-sadar-flyover-rbi",
    name: "Safest: via Sadar Flyover ➔ RBI Square",
    viaSummary: "Gittikhadan PS Sq → Old Katol Naka → Sadar Flyover → RBI Square → Station",
    distance: 8031,
    duration: 720,
    waypoints: [
      { lon: 79.0609, lat: 21.1737 }, // Gittikhadan PS Sq
      { lon: 79.0640, lat: 21.1680 }, // Old Katol Naka Chowk
      { lon: 79.0710, lat: 21.1635 }, // Sadar Flyover Ramp
      { lon: 79.0809, lat: 21.1526 }, // RBI Square
    ],
    cachedPoints: [{"latitude":21.176386,"longitude":79.061255,"sequence":0},{"latitude":21.176314,"longitude":79.061234,"sequence":1},{"latitude":21.176169,"longitude":79.061176,"sequence":2},{"latitude":21.176122,"longitude":79.061161,"sequence":3},{"latitude":21.176044,"longitude":79.061129,"sequence":4},{"latitude":21.176009,"longitude":79.061118,"sequence":5},{"latitude":21.175964,"longitude":79.061121,"sequence":6},{"latitude":21.17588,"longitude":79.061145,"sequence":7},{"latitude":21.175796,"longitude":79.061172,"sequence":8},{"latitude":21.175704,"longitude":79.061186,"sequence":9},{"latitude":21.175625,"longitude":79.061164,"sequence":10},{"latitude":21.17555,"longitude":79.06111,"sequence":11},{"latitude":21.175441,"longitude":79.060975,"sequence":12},{"latitude":21.175368,"longitude":79.060845,"sequence":13},{"latitude":21.175249,"longitude":79.060836,"sequence":14},{"latitude":21.175091,"longitude":79.060852,"sequence":15},{"latitude":21.174775,"longitude":79.060835,"sequence":16},{"latitude":21.174264,"longitude":79.06073,"sequence":17},{"latitude":21.173744,"longitude":79.060631,"sequence":18},{"latitude":21.173436,"longitude":79.060573,"sequence":19},{"latitude":21.173305,"longitude":79.06061,"sequence":20},{"latitude":21.17322,"longitude":79.060592,"sequence":21},{"latitude":21.173506,"longitude":79.059491,"sequence":22},{"latitude":21.173636,"longitude":79.059193,"sequence":23},{"latitude":21.173779,"longitude":79.058856,"sequence":24},{"latitude":21.173899,"longitude":79.058572,"sequence":25},{"latitude":21.173961,"longitude":79.058377,"sequence":26},{"latitude":21.174088,"longitude":79.057957,"sequence":27},{"latitude":21.174312,"longitude":79.057027,"sequence":28},{"latitude":21.174373,"longitude":79.056861,"sequence":29},{"latitude":21.174527,"longitude":79.056214,"sequence":30},{"latitude":21.174659,"longitude":79.055612,"sequence":31},{"latitude":21.174691,"longitude":79.055462,"sequence":32},{"latitude":21.174719,"longitude":79.055335,"sequence":33},{"latitude":21.174826,"longitude":79.054876,"sequence":34},{"latitude":21.17509,"longitude":79.053938,"sequence":35},{"latitude":21.17499,"longitude":79.053898,"sequence":36},{"latitude":21.174875,"longitude":79.053872,"sequence":37},{"latitude":21.174754,"longitude":79.053841,"sequence":38},{"latitude":21.174572,"longitude":79.053902,"sequence":39},{"latitude":21.174411,"longitude":79.053885,"sequence":40},{"latitude":21.174203,"longitude":79.053844,"sequence":41},{"latitude":21.17393,"longitude":79.053782,"sequence":42},{"latitude":21.173787,"longitude":79.053742,"sequence":43},{"latitude":21.173646,"longitude":79.053708,"sequence":44},{"latitude":21.17356,"longitude":79.053692,"sequence":45},{"latitude":21.173451,"longitude":79.053682,"sequence":46},{"latitude":21.17334,"longitude":79.053701,"sequence":47},{"latitude":21.173173,"longitude":79.053751,"sequence":48},{"latitude":21.173118,"longitude":79.05376,"sequence":49},{"latitude":21.173138,"longitude":79.053837,"sequence":50},{"latitude":21.173054,"longitude":79.053871,"sequence":51},{"latitude":21.172884,"longitude":79.053927,"sequence":52},{"latitude":21.172704,"longitude":79.053957,"sequence":53},{"latitude":21.172634,"longitude":79.053965,"sequence":54},{"latitude":21.172549,"longitude":79.053999,"sequence":55},{"latitude":21.172459,"longitude":79.05401,"sequence":56},{"latitude":21.172223,"longitude":79.053955,"sequence":57},{"latitude":21.172025,"longitude":79.053838,"sequence":58},{"latitude":21.171935,"longitude":79.053775,"sequence":59},{"latitude":21.171758,"longitude":79.053674,"sequence":60},{"latitude":21.171576,"longitude":79.053576,"sequence":61},{"latitude":21.171382,"longitude":79.053521,"sequence":62},{"latitude":21.171283,"longitude":79.053499,"sequence":63},{"latitude":21.171086,"longitude":79.053472,"sequence":64},{"latitude":21.170523,"longitude":79.053458,"sequence":65},{"latitude":21.170409,"longitude":79.053444,"sequence":66},{"latitude":21.169406,"longitude":79.053616,"sequence":67},{"latitude":21.169363,"longitude":79.053743,"sequence":68},{"latitude":21.169348,"longitude":79.053788,"sequence":69},{"latitude":21.169263,"longitude":79.053902,"sequence":70},{"latitude":21.169196,"longitude":79.053941,"sequence":71},{"latitude":21.169177,"longitude":79.053943,"sequence":72},{"latitude":21.169204,"longitude":79.054096,"sequence":73},{"latitude":21.16929,"longitude":79.054649,"sequence":74},{"latitude":21.169215,"longitude":79.054923,"sequence":75},{"latitude":21.169128,"longitude":79.05519,"sequence":76},{"latitude":21.168854,"longitude":79.055975,"sequence":77},{"latitude":21.168879,"longitude":79.056221,"sequence":78},{"latitude":21.168597,"longitude":79.056242,"sequence":79},{"latitude":21.168455,"longitude":79.056262,"sequence":80},{"latitude":21.16849,"longitude":79.056543,"sequence":81},{"latitude":21.168535,"longitude":79.056902,"sequence":82},{"latitude":21.168583,"longitude":79.057286,"sequence":83},{"latitude":21.16868,"longitude":79.058059,"sequence":84},{"latitude":21.168826,"longitude":79.059227,"sequence":85},{"latitude":21.168814,"longitude":79.059428,"sequence":86},{"latitude":21.16879,"longitude":79.059589,"sequence":87},{"latitude":21.168742,"longitude":79.059712,"sequence":88},{"latitude":21.168286,"longitude":79.060594,"sequence":89},{"latitude":21.16795,"longitude":79.061243,"sequence":90},{"latitude":21.167823,"longitude":79.061508,"sequence":91},{"latitude":21.167769,"longitude":79.061727,"sequence":92},{"latitude":21.167781,"longitude":79.062024,"sequence":93},{"latitude":21.167956,"longitude":79.063394,"sequence":94},{"latitude":21.167962,"longitude":79.063594,"sequence":95},{"latitude":21.167935,"longitude":79.063775,"sequence":96},{"latitude":21.167847,"longitude":79.063937,"sequence":97},{"latitude":21.167809,"longitude":79.063996,"sequence":98},{"latitude":21.167329,"longitude":79.064754,"sequence":99},{"latitude":21.167296,"longitude":79.06496,"sequence":100},{"latitude":21.167314,"longitude":79.065161,"sequence":101},{"latitude":21.16735,"longitude":79.065339,"sequence":102},{"latitude":21.167513,"longitude":79.066162,"sequence":103},{"latitude":21.167558,"longitude":79.066776,"sequence":104},{"latitude":21.167643,"longitude":79.067302,"sequence":105},{"latitude":21.167664,"longitude":79.067761,"sequence":106},{"latitude":21.167655,"longitude":79.06787,"sequence":107},{"latitude":21.167646,"longitude":79.067987,"sequence":108},{"latitude":21.16757,"longitude":79.068206,"sequence":109},{"latitude":21.167104,"longitude":79.06903,"sequence":110},{"latitude":21.166983,"longitude":79.069367,"sequence":111},{"latitude":21.166862,"longitude":79.069573,"sequence":112},{"latitude":21.166763,"longitude":79.069647,"sequence":113},{"latitude":21.166041,"longitude":79.069816,"sequence":114},{"latitude":21.165539,"longitude":79.069642,"sequence":115},{"latitude":21.165046,"longitude":79.069414,"sequence":116},{"latitude":21.164282,"longitude":79.068711,"sequence":117},{"latitude":21.163857,"longitude":79.068273,"sequence":118},{"latitude":21.163301,"longitude":79.067975,"sequence":119},{"latitude":21.162764,"longitude":79.067594,"sequence":120},{"latitude":21.162496,"longitude":79.067309,"sequence":121},{"latitude":21.162047,"longitude":79.066668,"sequence":122},{"latitude":21.161846,"longitude":79.066607,"sequence":123},{"latitude":21.161755,"longitude":79.066601,"sequence":124},{"latitude":21.161552,"longitude":79.06656,"sequence":125},{"latitude":21.16142,"longitude":79.066533,"sequence":126},{"latitude":21.161429,"longitude":79.066579,"sequence":127},{"latitude":21.161428,"longitude":79.066736,"sequence":128},{"latitude":21.161438,"longitude":79.06676,"sequence":129},{"latitude":21.161593,"longitude":79.067168,"sequence":130},{"latitude":21.16168,"longitude":79.067397,"sequence":131},{"latitude":21.161815,"longitude":79.067703,"sequence":132},{"latitude":21.162183,"longitude":79.068389,"sequence":133},{"latitude":21.162213,"longitude":79.068509,"sequence":134},{"latitude":21.162238,"longitude":79.068613,"sequence":135},{"latitude":21.162282,"longitude":79.068671,"sequence":136},{"latitude":21.162271,"longitude":79.068886,"sequence":137},{"latitude":21.162234,"longitude":79.06939,"sequence":138},{"latitude":21.162227,"longitude":79.06946,"sequence":139},{"latitude":21.162192,"longitude":79.069687,"sequence":140},{"latitude":21.162101,"longitude":79.070292,"sequence":141},{"latitude":21.162028,"longitude":79.070492,"sequence":142},{"latitude":21.161814,"longitude":79.070893,"sequence":143},{"latitude":21.16128,"longitude":79.071517,"sequence":144},{"latitude":21.160831,"longitude":79.072034,"sequence":145},{"latitude":21.160659,"longitude":79.072211,"sequence":146},{"latitude":21.160491,"longitude":79.072349,"sequence":147},{"latitude":21.160204,"longitude":79.072451,"sequence":148},{"latitude":21.159657,"longitude":79.072635,"sequence":149},{"latitude":21.159565,"longitude":79.07268,"sequence":150},{"latitude":21.15952,"longitude":79.072702,"sequence":151},{"latitude":21.159368,"longitude":79.072907,"sequence":152},{"latitude":21.159233,"longitude":79.0732,"sequence":153},{"latitude":21.159204,"longitude":79.073276,"sequence":154},{"latitude":21.159033,"longitude":79.073726,"sequence":155},{"latitude":21.158979,"longitude":79.073869,"sequence":156},{"latitude":21.158736,"longitude":79.07451,"sequence":157},{"latitude":21.158704,"longitude":79.074613,"sequence":158},{"latitude":21.158469,"longitude":79.075381,"sequence":159},{"latitude":21.158446,"longitude":79.07548,"sequence":160},{"latitude":21.158365,"longitude":79.075825,"sequence":161},{"latitude":21.158332,"longitude":79.075951,"sequence":162},{"latitude":21.15832,"longitude":79.075985,"sequence":163},{"latitude":21.158259,"longitude":79.076102,"sequence":164},{"latitude":21.158227,"longitude":79.076182,"sequence":165},{"latitude":21.15804,"longitude":79.076643,"sequence":166},{"latitude":21.157596,"longitude":79.077643,"sequence":167},{"latitude":21.157542,"longitude":79.077766,"sequence":168},{"latitude":21.157197,"longitude":79.07854,"sequence":169},{"latitude":21.157128,"longitude":79.078695,"sequence":170},{"latitude":21.157128,"longitude":79.078769,"sequence":171},{"latitude":21.157128,"longitude":79.078931,"sequence":172},{"latitude":21.157128,"longitude":79.079433,"sequence":173},{"latitude":21.157128,"longitude":79.079476,"sequence":174},{"latitude":21.157159,"longitude":79.079604,"sequence":175},{"latitude":21.157175,"longitude":79.079722,"sequence":176},{"latitude":21.157212,"longitude":79.07984,"sequence":177},{"latitude":21.157086,"longitude":79.079903,"sequence":178},{"latitude":21.156942,"longitude":79.079988,"sequence":179},{"latitude":21.156815,"longitude":79.080077,"sequence":180},{"latitude":21.156751,"longitude":79.080133,"sequence":181},{"latitude":21.156686,"longitude":79.080188,"sequence":182},{"latitude":21.15658,"longitude":79.080262,"sequence":183},{"latitude":21.156273,"longitude":79.080523,"sequence":184},{"latitude":21.156203,"longitude":79.080642,"sequence":185},{"latitude":21.155941,"longitude":79.081245,"sequence":186},{"latitude":21.155826,"longitude":79.081483,"sequence":187},{"latitude":21.155799,"longitude":79.081534,"sequence":188},{"latitude":21.155674,"longitude":79.081774,"sequence":189},{"latitude":21.155635,"longitude":79.081853,"sequence":190},{"latitude":21.155578,"longitude":79.081838,"sequence":191},{"latitude":21.155338,"longitude":79.081797,"sequence":192},{"latitude":21.155228,"longitude":79.081764,"sequence":193},{"latitude":21.154134,"longitude":79.081494,"sequence":194},{"latitude":21.153987,"longitude":79.081457,"sequence":195},{"latitude":21.153548,"longitude":79.081349,"sequence":196},{"latitude":21.153479,"longitude":79.081332,"sequence":197},{"latitude":21.152928,"longitude":79.081179,"sequence":198},{"latitude":21.152733,"longitude":79.081124,"sequence":199},{"latitude":21.152709,"longitude":79.081118,"sequence":200},{"latitude":21.152595,"longitude":79.081081,"sequence":201},{"latitude":21.152595,"longitude":79.080907,"sequence":202},{"latitude":21.152601,"longitude":79.080647,"sequence":203},{"latitude":21.152602,"longitude":79.0806,"sequence":204},{"latitude":21.152616,"longitude":79.079308,"sequence":205},{"latitude":21.152583,"longitude":79.078925,"sequence":206},{"latitude":21.152577,"longitude":79.078856,"sequence":207},{"latitude":21.152569,"longitude":79.078762,"sequence":208},{"latitude":21.152662,"longitude":79.078798,"sequence":209},{"latitude":21.152663,"longitude":79.0789,"sequence":210},{"latitude":21.152676,"longitude":79.08061,"sequence":211},{"latitude":21.152693,"longitude":79.080915,"sequence":212},{"latitude":21.152694,"longitude":79.080934,"sequence":213},{"latitude":21.152709,"longitude":79.081118,"sequence":214},{"latitude":21.152734,"longitude":79.08141,"sequence":215},{"latitude":21.152771,"longitude":79.081573,"sequence":216},{"latitude":21.15306,"longitude":79.082499,"sequence":217},{"latitude":21.153176,"longitude":79.082806,"sequence":218},{"latitude":21.153703,"longitude":79.083697,"sequence":219},{"latitude":21.15413,"longitude":79.084246,"sequence":220},{"latitude":21.154281,"longitude":79.084437,"sequence":221},{"latitude":21.15437,"longitude":79.084545,"sequence":222},{"latitude":21.154347,"longitude":79.08461,"sequence":223},{"latitude":21.154326,"longitude":79.084652,"sequence":224},{"latitude":21.154247,"longitude":79.084914,"sequence":225},{"latitude":21.154148,"longitude":79.085236,"sequence":226},{"latitude":21.154074,"longitude":79.085492,"sequence":227},{"latitude":21.153919,"longitude":79.085923,"sequence":228},{"latitude":21.153791,"longitude":79.086323,"sequence":229},{"latitude":21.153742,"longitude":79.086497,"sequence":230},{"latitude":21.153661,"longitude":79.086821,"sequence":231},{"latitude":21.153639,"longitude":79.08703,"sequence":232},{"latitude":21.153629,"longitude":79.087216,"sequence":233},{"latitude":21.153633,"longitude":79.087319,"sequence":234},{"latitude":21.153472,"longitude":79.087353,"sequence":235},{"latitude":21.153418,"longitude":79.087364,"sequence":236},{"latitude":21.153213,"longitude":79.087433,"sequence":237},{"latitude":21.153026,"longitude":79.087499,"sequence":238},{"latitude":21.152764,"longitude":79.087579,"sequence":239},{"latitude":21.152684,"longitude":79.087594,"sequence":240},{"latitude":21.15253,"longitude":79.087604,"sequence":241},{"latitude":21.152445,"longitude":79.087602,"sequence":242},{"latitude":21.151938,"longitude":79.08759,"sequence":243},{"latitude":21.15181,"longitude":79.087593,"sequence":244},{"latitude":21.151791,"longitude":79.087773,"sequence":245},{"latitude":21.151786,"longitude":79.087928,"sequence":246},{"latitude":21.151789,"longitude":79.08795,"sequence":247},{"latitude":21.151799,"longitude":79.087967,"sequence":248},{"latitude":21.151933,"longitude":79.087983,"sequence":249},{"latitude":21.151928,"longitude":79.088006,"sequence":250},{"latitude":21.15231,"longitude":79.088064,"sequence":251}],
  },
  {
    id: "via-sadar-surface-kasturchand",
    name: "Alternate: via Sadar Market ➔ Kasturchand Park",
    viaSummary: "Gittikhadan PS Sq → Old Katol Naka → Liberty Sq → Kasturchand Park Metro → Station",
    distance: 7936,
    duration: 720,
    waypoints: [
      { lon: 79.0609, lat: 21.1737 },
      { lon: 79.0645, lat: 21.1685 },
      { lon: 79.0797, lat: 21.1572 },
      { lon: 79.0815, lat: 21.1544 },
    ],
    cachedPoints: [{"latitude":21.176386,"longitude":79.061255,"sequence":0},{"latitude":21.176314,"longitude":79.061234,"sequence":1},{"latitude":21.176169,"longitude":79.061176,"sequence":2},{"latitude":21.176122,"longitude":79.061161,"sequence":3},{"latitude":21.176044,"longitude":79.061129,"sequence":4},{"latitude":21.176009,"longitude":79.061118,"sequence":5},{"latitude":21.175964,"longitude":79.061121,"sequence":6},{"latitude":21.17588,"longitude":79.061145,"sequence":7},{"latitude":21.175796,"longitude":79.061172,"sequence":8},{"latitude":21.175704,"longitude":79.061186,"sequence":9},{"latitude":21.175625,"longitude":79.061164,"sequence":10},{"latitude":21.17555,"longitude":79.06111,"sequence":11},{"latitude":21.175441,"longitude":79.060975,"sequence":12},{"latitude":21.175368,"longitude":79.060845,"sequence":13},{"latitude":21.175249,"longitude":79.060836,"sequence":14},{"latitude":21.175091,"longitude":79.060852,"sequence":15},{"latitude":21.174775,"longitude":79.060835,"sequence":16},{"latitude":21.174264,"longitude":79.06073,"sequence":17},{"latitude":21.173744,"longitude":79.060631,"sequence":18},{"latitude":21.173436,"longitude":79.060573,"sequence":19},{"latitude":21.173305,"longitude":79.06061,"sequence":20},{"latitude":21.17322,"longitude":79.060592,"sequence":21},{"latitude":21.173506,"longitude":79.059491,"sequence":22},{"latitude":21.173636,"longitude":79.059193,"sequence":23},{"latitude":21.173779,"longitude":79.058856,"sequence":24},{"latitude":21.173899,"longitude":79.058572,"sequence":25},{"latitude":21.173961,"longitude":79.058377,"sequence":26},{"latitude":21.174088,"longitude":79.057957,"sequence":27},{"latitude":21.174312,"longitude":79.057027,"sequence":28},{"latitude":21.174373,"longitude":79.056861,"sequence":29},{"latitude":21.174527,"longitude":79.056214,"sequence":30},{"latitude":21.174659,"longitude":79.055612,"sequence":31},{"latitude":21.174691,"longitude":79.055462,"sequence":32},{"latitude":21.174719,"longitude":79.055335,"sequence":33},{"latitude":21.174826,"longitude":79.054876,"sequence":34},{"latitude":21.17509,"longitude":79.053938,"sequence":35},{"latitude":21.17499,"longitude":79.053898,"sequence":36},{"latitude":21.174875,"longitude":79.053872,"sequence":37},{"latitude":21.174754,"longitude":79.053841,"sequence":38},{"latitude":21.174572,"longitude":79.053902,"sequence":39},{"latitude":21.174411,"longitude":79.053885,"sequence":40},{"latitude":21.174203,"longitude":79.053844,"sequence":41},{"latitude":21.17393,"longitude":79.053782,"sequence":42},{"latitude":21.173787,"longitude":79.053742,"sequence":43},{"latitude":21.173646,"longitude":79.053708,"sequence":44},{"latitude":21.17356,"longitude":79.053692,"sequence":45},{"latitude":21.173451,"longitude":79.053682,"sequence":46},{"latitude":21.17334,"longitude":79.053701,"sequence":47},{"latitude":21.173173,"longitude":79.053751,"sequence":48},{"latitude":21.173118,"longitude":79.05376,"sequence":49},{"latitude":21.173138,"longitude":79.053837,"sequence":50},{"latitude":21.173054,"longitude":79.053871,"sequence":51},{"latitude":21.172884,"longitude":79.053927,"sequence":52},{"latitude":21.172704,"longitude":79.053957,"sequence":53},{"latitude":21.172634,"longitude":79.053965,"sequence":54},{"latitude":21.172549,"longitude":79.053999,"sequence":55},{"latitude":21.172459,"longitude":79.05401,"sequence":56},{"latitude":21.172223,"longitude":79.053955,"sequence":57},{"latitude":21.172025,"longitude":79.053838,"sequence":58},{"latitude":21.171935,"longitude":79.053775,"sequence":59},{"latitude":21.171758,"longitude":79.053674,"sequence":60},{"latitude":21.171576,"longitude":79.053576,"sequence":61},{"latitude":21.171382,"longitude":79.053521,"sequence":62},{"latitude":21.171283,"longitude":79.053499,"sequence":63},{"latitude":21.171086,"longitude":79.053472,"sequence":64},{"latitude":21.170523,"longitude":79.053458,"sequence":65},{"latitude":21.170409,"longitude":79.053444,"sequence":66},{"latitude":21.169406,"longitude":79.053616,"sequence":67},{"latitude":21.169363,"longitude":79.053743,"sequence":68},{"latitude":21.169348,"longitude":79.053788,"sequence":69},{"latitude":21.169263,"longitude":79.053902,"sequence":70},{"latitude":21.169196,"longitude":79.053941,"sequence":71},{"latitude":21.169177,"longitude":79.053943,"sequence":72},{"latitude":21.169204,"longitude":79.054096,"sequence":73},{"latitude":21.16929,"longitude":79.054649,"sequence":74},{"latitude":21.169215,"longitude":79.054923,"sequence":75},{"latitude":21.169128,"longitude":79.05519,"sequence":76},{"latitude":21.168854,"longitude":79.055975,"sequence":77},{"latitude":21.168879,"longitude":79.056221,"sequence":78},{"latitude":21.168597,"longitude":79.056242,"sequence":79},{"latitude":21.168455,"longitude":79.056262,"sequence":80},{"latitude":21.16849,"longitude":79.056543,"sequence":81},{"latitude":21.168535,"longitude":79.056902,"sequence":82},{"latitude":21.168583,"longitude":79.057286,"sequence":83},{"latitude":21.16868,"longitude":79.058059,"sequence":84},{"latitude":21.168826,"longitude":79.059227,"sequence":85},{"latitude":21.168814,"longitude":79.059428,"sequence":86},{"latitude":21.16879,"longitude":79.059589,"sequence":87},{"latitude":21.168742,"longitude":79.059712,"sequence":88},{"latitude":21.168286,"longitude":79.060594,"sequence":89},{"latitude":21.16795,"longitude":79.061243,"sequence":90},{"latitude":21.167823,"longitude":79.061508,"sequence":91},{"latitude":21.167769,"longitude":79.061727,"sequence":92},{"latitude":21.167781,"longitude":79.062024,"sequence":93},{"latitude":21.167956,"longitude":79.063394,"sequence":94},{"latitude":21.167962,"longitude":79.063594,"sequence":95},{"latitude":21.167935,"longitude":79.063775,"sequence":96},{"latitude":21.167847,"longitude":79.063937,"sequence":97},{"latitude":21.167809,"longitude":79.063996,"sequence":98},{"latitude":21.167329,"longitude":79.064754,"sequence":99},{"latitude":21.167296,"longitude":79.06496,"sequence":100},{"latitude":21.167314,"longitude":79.065161,"sequence":101},{"latitude":21.16735,"longitude":79.065339,"sequence":102},{"latitude":21.167513,"longitude":79.066162,"sequence":103},{"latitude":21.167558,"longitude":79.066776,"sequence":104},{"latitude":21.167643,"longitude":79.067302,"sequence":105},{"latitude":21.167664,"longitude":79.067761,"sequence":106},{"latitude":21.167655,"longitude":79.06787,"sequence":107},{"latitude":21.167646,"longitude":79.067987,"sequence":108},{"latitude":21.16757,"longitude":79.068206,"sequence":109},{"latitude":21.167104,"longitude":79.06903,"sequence":110},{"latitude":21.166983,"longitude":79.069367,"sequence":111},{"latitude":21.166862,"longitude":79.069573,"sequence":112},{"latitude":21.166763,"longitude":79.069647,"sequence":113},{"latitude":21.166041,"longitude":79.069816,"sequence":114},{"latitude":21.165539,"longitude":79.069642,"sequence":115},{"latitude":21.165046,"longitude":79.069414,"sequence":116},{"latitude":21.164282,"longitude":79.068711,"sequence":117},{"latitude":21.163857,"longitude":79.068273,"sequence":118},{"latitude":21.163301,"longitude":79.067975,"sequence":119},{"latitude":21.162764,"longitude":79.067594,"sequence":120},{"latitude":21.162496,"longitude":79.067309,"sequence":121},{"latitude":21.162047,"longitude":79.066668,"sequence":122},{"latitude":21.161846,"longitude":79.066607,"sequence":123},{"latitude":21.161755,"longitude":79.066601,"sequence":124},{"latitude":21.161552,"longitude":79.06656,"sequence":125},{"latitude":21.16142,"longitude":79.066533,"sequence":126},{"latitude":21.161429,"longitude":79.066579,"sequence":127},{"latitude":21.161428,"longitude":79.066736,"sequence":128},{"latitude":21.161438,"longitude":79.06676,"sequence":129},{"latitude":21.161593,"longitude":79.067168,"sequence":130},{"latitude":21.16168,"longitude":79.067397,"sequence":131},{"latitude":21.161815,"longitude":79.067703,"sequence":132},{"latitude":21.162183,"longitude":79.068389,"sequence":133},{"latitude":21.162213,"longitude":79.068509,"sequence":134},{"latitude":21.162238,"longitude":79.068613,"sequence":135},{"latitude":21.162282,"longitude":79.068671,"sequence":136},{"latitude":21.162271,"longitude":79.068886,"sequence":137},{"latitude":21.162234,"longitude":79.06939,"sequence":138},{"latitude":21.162227,"longitude":79.06946,"sequence":139},{"latitude":21.162192,"longitude":79.069687,"sequence":140},{"latitude":21.162101,"longitude":79.070292,"sequence":141},{"latitude":21.162028,"longitude":79.070492,"sequence":142},{"latitude":21.161814,"longitude":79.070893,"sequence":143},{"latitude":21.16128,"longitude":79.071517,"sequence":144},{"latitude":21.160831,"longitude":79.072034,"sequence":145},{"latitude":21.160659,"longitude":79.072211,"sequence":146},{"latitude":21.160491,"longitude":79.072349,"sequence":147},{"latitude":21.160204,"longitude":79.072451,"sequence":148},{"latitude":21.159657,"longitude":79.072635,"sequence":149},{"latitude":21.159565,"longitude":79.07268,"sequence":150},{"latitude":21.15952,"longitude":79.072702,"sequence":151},{"latitude":21.159368,"longitude":79.072907,"sequence":152},{"latitude":21.159233,"longitude":79.0732,"sequence":153},{"latitude":21.159204,"longitude":79.073276,"sequence":154},{"latitude":21.159033,"longitude":79.073726,"sequence":155},{"latitude":21.158979,"longitude":79.073869,"sequence":156},{"latitude":21.158736,"longitude":79.07451,"sequence":157},{"latitude":21.158704,"longitude":79.074613,"sequence":158},{"latitude":21.158469,"longitude":79.075381,"sequence":159},{"latitude":21.158446,"longitude":79.07548,"sequence":160},{"latitude":21.158365,"longitude":79.075825,"sequence":161},{"latitude":21.158332,"longitude":79.075951,"sequence":162},{"latitude":21.15832,"longitude":79.075985,"sequence":163},{"latitude":21.158259,"longitude":79.076102,"sequence":164},{"latitude":21.158227,"longitude":79.076182,"sequence":165},{"latitude":21.15804,"longitude":79.076643,"sequence":166},{"latitude":21.157596,"longitude":79.077643,"sequence":167},{"latitude":21.157197,"longitude":79.07854,"sequence":168},{"latitude":21.157128,"longitude":79.078695,"sequence":169},{"latitude":21.157128,"longitude":79.078769,"sequence":170},{"latitude":21.157128,"longitude":79.078931,"sequence":171},{"latitude":21.157128,"longitude":79.079433,"sequence":172},{"latitude":21.157128,"longitude":79.079476,"sequence":173},{"latitude":21.157159,"longitude":79.079604,"sequence":174},{"latitude":21.157175,"longitude":79.079722,"sequence":175},{"latitude":21.157204,"longitude":79.079713,"sequence":176},{"latitude":21.157336,"longitude":79.079669,"sequence":177},{"latitude":21.157514,"longitude":79.079635,"sequence":178},{"latitude":21.157927,"longitude":79.079591,"sequence":179},{"latitude":21.158313,"longitude":79.079554,"sequence":180},{"latitude":21.15846,"longitude":79.079542,"sequence":181},{"latitude":21.158778,"longitude":79.079523,"sequence":182},{"latitude":21.159085,"longitude":79.079516,"sequence":183},{"latitude":21.159161,"longitude":79.079515,"sequence":184},{"latitude":21.159146,"longitude":79.079557,"sequence":185},{"latitude":21.159119,"longitude":79.07965,"sequence":186},{"latitude":21.159051,"longitude":79.079648,"sequence":187},{"latitude":21.158738,"longitude":79.079658,"sequence":188},{"latitude":21.158378,"longitude":79.079672,"sequence":189},{"latitude":21.158058,"longitude":79.079704,"sequence":190},{"latitude":21.157782,"longitude":79.079733,"sequence":191},{"latitude":21.157358,"longitude":79.079798,"sequence":192},{"latitude":21.157212,"longitude":79.07984,"sequence":193},{"latitude":21.157086,"longitude":79.079903,"sequence":194},{"latitude":21.156942,"longitude":79.079988,"sequence":195},{"latitude":21.156815,"longitude":79.080077,"sequence":196},{"latitude":21.156751,"longitude":79.080133,"sequence":197},{"latitude":21.156686,"longitude":79.080188,"sequence":198},{"latitude":21.15658,"longitude":79.080262,"sequence":199},{"latitude":21.156273,"longitude":79.080523,"sequence":200},{"latitude":21.156203,"longitude":79.080642,"sequence":201},{"latitude":21.155941,"longitude":79.081245,"sequence":202},{"latitude":21.155826,"longitude":79.081483,"sequence":203},{"latitude":21.155799,"longitude":79.081534,"sequence":204},{"latitude":21.155674,"longitude":79.081774,"sequence":205},{"latitude":21.155635,"longitude":79.081853,"sequence":206},{"latitude":21.155578,"longitude":79.081838,"sequence":207},{"latitude":21.155338,"longitude":79.081797,"sequence":208},{"latitude":21.155228,"longitude":79.081764,"sequence":209},{"latitude":21.154388,"longitude":79.081557,"sequence":210},{"latitude":21.154134,"longitude":79.081494,"sequence":211},{"latitude":21.153987,"longitude":79.081457,"sequence":212},{"latitude":21.153548,"longitude":79.081349,"sequence":213},{"latitude":21.153479,"longitude":79.081332,"sequence":214},{"latitude":21.152928,"longitude":79.081179,"sequence":215},{"latitude":21.152817,"longitude":79.081302,"sequence":216},{"latitude":21.152783,"longitude":79.081429,"sequence":217},{"latitude":21.152771,"longitude":79.081573,"sequence":218},{"latitude":21.15306,"longitude":79.082499,"sequence":219},{"latitude":21.153176,"longitude":79.082806,"sequence":220},{"latitude":21.153703,"longitude":79.083697,"sequence":221},{"latitude":21.15413,"longitude":79.084246,"sequence":222},{"latitude":21.154281,"longitude":79.084437,"sequence":223},{"latitude":21.15437,"longitude":79.084545,"sequence":224},{"latitude":21.154347,"longitude":79.08461,"sequence":225},{"latitude":21.154326,"longitude":79.084652,"sequence":226},{"latitude":21.154247,"longitude":79.084914,"sequence":227},{"latitude":21.154148,"longitude":79.085236,"sequence":228},{"latitude":21.154074,"longitude":79.085492,"sequence":229},{"latitude":21.153919,"longitude":79.085923,"sequence":230},{"latitude":21.153791,"longitude":79.086323,"sequence":231},{"latitude":21.153742,"longitude":79.086497,"sequence":232},{"latitude":21.153661,"longitude":79.086821,"sequence":233},{"latitude":21.153639,"longitude":79.08703,"sequence":234},{"latitude":21.153629,"longitude":79.087216,"sequence":235},{"latitude":21.153633,"longitude":79.087319,"sequence":236},{"latitude":21.153472,"longitude":79.087353,"sequence":237},{"latitude":21.153418,"longitude":79.087364,"sequence":238},{"latitude":21.153213,"longitude":79.087433,"sequence":239},{"latitude":21.153026,"longitude":79.087499,"sequence":240},{"latitude":21.152764,"longitude":79.087579,"sequence":241},{"latitude":21.152684,"longitude":79.087594,"sequence":242},{"latitude":21.15253,"longitude":79.087604,"sequence":243},{"latitude":21.152445,"longitude":79.087602,"sequence":244},{"latitude":21.151938,"longitude":79.08759,"sequence":245},{"latitude":21.15181,"longitude":79.087593,"sequence":246},{"latitude":21.151791,"longitude":79.087773,"sequence":247},{"latitude":21.151786,"longitude":79.087928,"sequence":248},{"latitude":21.151789,"longitude":79.08795,"sequence":249},{"latitude":21.151799,"longitude":79.087967,"sequence":250},{"latitude":21.151933,"longitude":79.087983,"sequence":251},{"latitude":21.151928,"longitude":79.088006,"sequence":252},{"latitude":21.15231,"longitude":79.088064,"sequence":253}],
  },
  {
    id: "via-seminary-hills-bypass",
    name: "Caution: via Seminary Hills ➔ Civil Lines",
    viaSummary: "TV Tower Sq → Seminary Hills Wooded Stretch → CP Club → GPO Square → Station",
    distance: 10759,
    duration: 1080,
    waypoints: [
      { lon: 79.0538, lat: 21.1670 },
      { lon: 79.0510, lat: 21.1620 },
      { lon: 79.0560, lat: 21.1549 },
      { lon: 79.0683, lat: 21.1536 },
    ],
    cachedPoints: [{"latitude":21.176386,"longitude":79.061255,"sequence":0},{"latitude":21.176314,"longitude":79.061234,"sequence":1},{"latitude":21.176169,"longitude":79.061176,"sequence":2},{"latitude":21.176122,"longitude":79.061161,"sequence":3},{"latitude":21.176044,"longitude":79.061129,"sequence":4},{"latitude":21.176009,"longitude":79.061118,"sequence":5},{"latitude":21.175964,"longitude":79.061121,"sequence":6},{"latitude":21.17588,"longitude":79.061145,"sequence":7},{"latitude":21.175796,"longitude":79.061172,"sequence":8},{"latitude":21.175704,"longitude":79.061186,"sequence":9},{"latitude":21.175625,"longitude":79.061164,"sequence":10},{"latitude":21.17555,"longitude":79.06111,"sequence":11},{"latitude":21.175441,"longitude":79.060975,"sequence":12},{"latitude":21.175368,"longitude":79.060845,"sequence":13},{"latitude":21.175249,"longitude":79.060836,"sequence":14},{"latitude":21.175091,"longitude":79.060852,"sequence":15},{"latitude":21.174775,"longitude":79.060835,"sequence":16},{"latitude":21.174264,"longitude":79.06073,"sequence":17},{"latitude":21.173436,"longitude":79.060573,"sequence":18},{"latitude":21.173305,"longitude":79.06061,"sequence":19},{"latitude":21.17322,"longitude":79.060592,"sequence":20},{"latitude":21.173506,"longitude":79.059491,"sequence":21},{"latitude":21.173636,"longitude":79.059193,"sequence":22},{"latitude":21.173779,"longitude":79.058856,"sequence":23},{"latitude":21.173899,"longitude":79.058572,"sequence":24},{"latitude":21.173961,"longitude":79.058377,"sequence":25},{"latitude":21.174088,"longitude":79.057957,"sequence":26},{"latitude":21.174312,"longitude":79.057027,"sequence":27},{"latitude":21.174373,"longitude":79.056861,"sequence":28},{"latitude":21.174527,"longitude":79.056214,"sequence":29},{"latitude":21.174659,"longitude":79.055612,"sequence":30},{"latitude":21.174691,"longitude":79.055462,"sequence":31},{"latitude":21.174719,"longitude":79.055335,"sequence":32},{"latitude":21.174826,"longitude":79.054876,"sequence":33},{"latitude":21.17509,"longitude":79.053938,"sequence":34},{"latitude":21.17499,"longitude":79.053898,"sequence":35},{"latitude":21.174875,"longitude":79.053872,"sequence":36},{"latitude":21.174754,"longitude":79.053841,"sequence":37},{"latitude":21.174572,"longitude":79.053902,"sequence":38},{"latitude":21.174411,"longitude":79.053885,"sequence":39},{"latitude":21.174203,"longitude":79.053844,"sequence":40},{"latitude":21.17393,"longitude":79.053782,"sequence":41},{"latitude":21.173787,"longitude":79.053742,"sequence":42},{"latitude":21.173646,"longitude":79.053708,"sequence":43},{"latitude":21.17356,"longitude":79.053692,"sequence":44},{"latitude":21.173451,"longitude":79.053682,"sequence":45},{"latitude":21.17334,"longitude":79.053701,"sequence":46},{"latitude":21.173173,"longitude":79.053751,"sequence":47},{"latitude":21.173118,"longitude":79.05376,"sequence":48},{"latitude":21.173138,"longitude":79.053837,"sequence":49},{"latitude":21.173054,"longitude":79.053871,"sequence":50},{"latitude":21.172884,"longitude":79.053927,"sequence":51},{"latitude":21.172704,"longitude":79.053957,"sequence":52},{"latitude":21.172634,"longitude":79.053965,"sequence":53},{"latitude":21.172549,"longitude":79.053999,"sequence":54},{"latitude":21.172459,"longitude":79.05401,"sequence":55},{"latitude":21.172223,"longitude":79.053955,"sequence":56},{"latitude":21.172025,"longitude":79.053838,"sequence":57},{"latitude":21.171935,"longitude":79.053775,"sequence":58},{"latitude":21.171758,"longitude":79.053674,"sequence":59},{"latitude":21.171576,"longitude":79.053576,"sequence":60},{"latitude":21.171382,"longitude":79.053521,"sequence":61},{"latitude":21.171283,"longitude":79.053499,"sequence":62},{"latitude":21.171086,"longitude":79.053472,"sequence":63},{"latitude":21.170523,"longitude":79.053458,"sequence":64},{"latitude":21.170409,"longitude":79.053444,"sequence":65},{"latitude":21.169406,"longitude":79.053616,"sequence":66},{"latitude":21.168954,"longitude":79.053669,"sequence":67},{"latitude":21.16869,"longitude":79.053683,"sequence":68},{"latitude":21.168505,"longitude":79.053584,"sequence":69},{"latitude":21.168328,"longitude":79.053427,"sequence":70},{"latitude":21.167959,"longitude":79.053118,"sequence":71},{"latitude":21.167791,"longitude":79.05308,"sequence":72},{"latitude":21.16774,"longitude":79.053087,"sequence":73},{"latitude":21.1676,"longitude":79.053108,"sequence":74},{"latitude":21.167002,"longitude":79.053802,"sequence":75},{"latitude":21.166995,"longitude":79.05381,"sequence":76},{"latitude":21.166084,"longitude":79.05297,"sequence":77},{"latitude":21.165991,"longitude":79.052884,"sequence":78},{"latitude":21.165658,"longitude":79.052577,"sequence":79},{"latitude":21.165539,"longitude":79.052445,"sequence":80},{"latitude":21.165471,"longitude":79.05228,"sequence":81},{"latitude":21.165432,"longitude":79.052203,"sequence":82},{"latitude":21.165345,"longitude":79.051465,"sequence":83},{"latitude":21.165211,"longitude":79.050454,"sequence":84},{"latitude":21.164334,"longitude":79.050481,"sequence":85},{"latitude":21.164269,"longitude":79.050503,"sequence":86},{"latitude":21.164235,"longitude":79.050559,"sequence":87},{"latitude":21.163992,"longitude":79.051356,"sequence":88},{"latitude":21.163541,"longitude":79.051179,"sequence":89},{"latitude":21.163351,"longitude":79.051107,"sequence":90},{"latitude":21.162547,"longitude":79.050896,"sequence":91},{"latitude":21.162307,"longitude":79.050794,"sequence":92},{"latitude":21.162287,"longitude":79.050765,"sequence":93},{"latitude":21.161899,"longitude":79.050221,"sequence":94},{"latitude":21.161866,"longitude":79.049941,"sequence":95},{"latitude":21.163823,"longitude":79.049855,"sequence":96},{"latitude":21.163911,"longitude":79.049852,"sequence":97},{"latitude":21.164158,"longitude":79.049698,"sequence":98},{"latitude":21.164259,"longitude":79.049657,"sequence":99},{"latitude":21.164328,"longitude":79.049651,"sequence":100},{"latitude":21.164525,"longitude":79.049658,"sequence":101},{"latitude":21.16484,"longitude":79.049668,"sequence":102},{"latitude":21.165113,"longitude":79.049677,"sequence":103},{"latitude":21.165036,"longitude":79.048896,"sequence":104},{"latitude":21.1649,"longitude":79.047715,"sequence":105},{"latitude":21.164884,"longitude":79.047578,"sequence":106},{"latitude":21.164676,"longitude":79.046049,"sequence":107},{"latitude":21.164547,"longitude":79.044899,"sequence":108},{"latitude":21.164504,"longitude":79.0445,"sequence":109},{"latitude":21.164483,"longitude":79.044394,"sequence":110},{"latitude":21.164462,"longitude":79.044277,"sequence":111},{"latitude":21.164393,"longitude":79.044089,"sequence":112},{"latitude":21.164245,"longitude":79.043872,"sequence":113},{"latitude":21.16405,"longitude":79.043679,"sequence":114},{"latitude":21.163893,"longitude":79.043499,"sequence":115},{"latitude":21.163768,"longitude":79.043395,"sequence":116},{"latitude":21.163673,"longitude":79.043321,"sequence":117},{"latitude":21.163532,"longitude":79.043254,"sequence":118},{"latitude":21.163457,"longitude":79.043228,"sequence":119},{"latitude":21.162432,"longitude":79.043009,"sequence":120},{"latitude":21.162313,"longitude":79.04294,"sequence":121},{"latitude":21.162186,"longitude":79.042847,"sequence":122},{"latitude":21.162128,"longitude":79.042707,"sequence":123},{"latitude":21.162104,"longitude":79.042623,"sequence":124},{"latitude":21.161664,"longitude":79.04108,"sequence":125},{"latitude":21.161499,"longitude":79.040827,"sequence":126},{"latitude":21.160795,"longitude":79.042269,"sequence":127},{"latitude":21.160599,"longitude":79.04263,"sequence":128},{"latitude":21.160363,"longitude":79.043067,"sequence":129},{"latitude":21.160218,"longitude":79.043153,"sequence":130},{"latitude":21.16001,"longitude":79.043102,"sequence":131},{"latitude":21.159354,"longitude":79.042827,"sequence":132},{"latitude":21.159082,"longitude":79.042844,"sequence":133},{"latitude":21.158593,"longitude":79.043073,"sequence":134},{"latitude":21.158538,"longitude":79.043136,"sequence":135},{"latitude":21.158307,"longitude":79.043355,"sequence":136},{"latitude":21.158228,"longitude":79.043611,"sequence":137},{"latitude":21.158137,"longitude":79.043977,"sequence":138},{"latitude":21.158033,"longitude":79.044174,"sequence":139},{"latitude":21.157894,"longitude":79.044208,"sequence":140},{"latitude":21.157521,"longitude":79.044183,"sequence":141},{"latitude":21.157337,"longitude":79.0442,"sequence":142},{"latitude":21.157049,"longitude":79.044286,"sequence":143},{"latitude":21.156761,"longitude":79.044423,"sequence":144},{"latitude":21.156568,"longitude":79.044578,"sequence":145},{"latitude":21.1564,"longitude":79.044827,"sequence":146},{"latitude":21.15636,"longitude":79.045041,"sequence":147},{"latitude":21.15636,"longitude":79.045471,"sequence":148},{"latitude":21.156392,"longitude":79.045865,"sequence":149},{"latitude":21.156681,"longitude":79.046377,"sequence":150},{"latitude":21.156808,"longitude":79.046513,"sequence":151},{"latitude":21.156963,"longitude":79.046639,"sequence":152},{"latitude":21.157432,"longitude":79.046865,"sequence":153},{"latitude":21.157901,"longitude":79.047097,"sequence":154},{"latitude":21.157965,"longitude":79.047275,"sequence":155},{"latitude":21.158029,"longitude":79.047447,"sequence":156},{"latitude":21.158037,"longitude":79.047756,"sequence":157},{"latitude":21.158003,"longitude":79.048556,"sequence":158},{"latitude":21.157997,"longitude":79.048691,"sequence":159},{"latitude":21.158005,"longitude":79.048931,"sequence":160},{"latitude":21.158157,"longitude":79.049404,"sequence":161},{"latitude":21.158429,"longitude":79.049927,"sequence":162},{"latitude":21.15915,"longitude":79.051326,"sequence":163},{"latitude":21.158966,"longitude":79.051369,"sequence":164},{"latitude":21.158798,"longitude":79.051403,"sequence":165},{"latitude":21.15757,"longitude":79.051747,"sequence":166},{"latitude":21.157509,"longitude":79.051764,"sequence":167},{"latitude":21.156842,"longitude":79.052002,"sequence":168},{"latitude":21.155764,"longitude":79.05239,"sequence":169},{"latitude":21.155524,"longitude":79.052476,"sequence":170},{"latitude":21.155123,"longitude":79.052708,"sequence":171},{"latitude":21.15501,"longitude":79.052782,"sequence":172},{"latitude":21.154275,"longitude":79.053257,"sequence":173},{"latitude":21.154211,"longitude":79.053343,"sequence":174},{"latitude":21.154163,"longitude":79.053549,"sequence":175},{"latitude":21.154141,"longitude":79.055349,"sequence":176},{"latitude":21.154122,"longitude":79.055686,"sequence":177},{"latitude":21.154087,"longitude":79.055898,"sequence":178},{"latitude":21.154307,"longitude":79.055935,"sequence":179},{"latitude":21.154896,"longitude":79.056029,"sequence":180},{"latitude":21.154981,"longitude":79.056043,"sequence":181},{"latitude":21.155139,"longitude":79.056255,"sequence":182},{"latitude":21.155215,"longitude":79.057091,"sequence":183},{"latitude":21.155232,"longitude":79.057887,"sequence":184},{"latitude":21.15513,"longitude":79.05817,"sequence":185},{"latitude":21.154586,"longitude":79.059147,"sequence":186},{"latitude":21.154539,"longitude":79.059232,"sequence":187},{"latitude":21.154419,"longitude":79.059463,"sequence":188},{"latitude":21.154291,"longitude":79.059806,"sequence":189},{"latitude":21.154302,"longitude":79.059894,"sequence":190},{"latitude":21.15442,"longitude":79.060851,"sequence":191},{"latitude":21.15443,"longitude":79.060938,"sequence":192},{"latitude":21.154481,"longitude":79.06135,"sequence":193},{"latitude":21.154449,"longitude":79.061715,"sequence":194},{"latitude":21.154425,"longitude":79.061923,"sequence":195},{"latitude":21.154369,"longitude":79.06243,"sequence":196},{"latitude":21.154304,"longitude":79.063017,"sequence":197},{"latitude":21.1542,"longitude":79.064069,"sequence":198},{"latitude":21.15417,"longitude":79.064232,"sequence":199},{"latitude":21.154033,"longitude":79.065453,"sequence":200},{"latitude":21.15383,"longitude":79.066954,"sequence":201},{"latitude":21.153631,"longitude":79.068303,"sequence":202},{"latitude":21.153628,"longitude":79.068435,"sequence":203},{"latitude":21.153512,"longitude":79.068413,"sequence":204},{"latitude":21.15352,"longitude":79.068293,"sequence":205},{"latitude":21.1536,"longitude":79.0683,"sequence":206},{"latitude":21.153631,"longitude":79.068303,"sequence":207},{"latitude":21.153628,"longitude":79.068435,"sequence":208},{"latitude":21.153571,"longitude":79.068876,"sequence":209},{"latitude":21.153402,"longitude":79.069784,"sequence":210},{"latitude":21.153333,"longitude":79.070354,"sequence":211},{"latitude":21.153042,"longitude":79.072314,"sequence":212},{"latitude":21.153037,"longitude":79.072358,"sequence":213},{"latitude":21.152797,"longitude":79.074278,"sequence":214},{"latitude":21.152769,"longitude":79.074741,"sequence":215},{"latitude":21.152764,"longitude":79.074822,"sequence":216},{"latitude":21.152717,"longitude":79.075163,"sequence":217},{"latitude":21.152627,"longitude":79.076008,"sequence":218},{"latitude":21.152599,"longitude":79.076685,"sequence":219},{"latitude":21.152609,"longitude":79.077096,"sequence":220},{"latitude":21.152616,"longitude":79.077336,"sequence":221},{"latitude":21.152662,"longitude":79.078798,"sequence":222},{"latitude":21.152663,"longitude":79.0789,"sequence":223},{"latitude":21.152676,"longitude":79.08061,"sequence":224},{"latitude":21.152693,"longitude":79.080915,"sequence":225},{"latitude":21.152694,"longitude":79.080934,"sequence":226},{"latitude":21.152709,"longitude":79.081118,"sequence":227},{"latitude":21.152734,"longitude":79.08141,"sequence":228},{"latitude":21.152771,"longitude":79.081573,"sequence":229},{"latitude":21.15306,"longitude":79.082499,"sequence":230},{"latitude":21.153176,"longitude":79.082806,"sequence":231},{"latitude":21.153703,"longitude":79.083697,"sequence":232},{"latitude":21.15413,"longitude":79.084246,"sequence":233},{"latitude":21.154281,"longitude":79.084437,"sequence":234},{"latitude":21.15437,"longitude":79.084545,"sequence":235},{"latitude":21.154347,"longitude":79.08461,"sequence":236},{"latitude":21.154326,"longitude":79.084652,"sequence":237},{"latitude":21.154247,"longitude":79.084914,"sequence":238},{"latitude":21.154148,"longitude":79.085236,"sequence":239},{"latitude":21.154074,"longitude":79.085492,"sequence":240},{"latitude":21.153919,"longitude":79.085923,"sequence":241},{"latitude":21.153791,"longitude":79.086323,"sequence":242},{"latitude":21.153742,"longitude":79.086497,"sequence":243},{"latitude":21.153661,"longitude":79.086821,"sequence":244},{"latitude":21.153639,"longitude":79.08703,"sequence":245},{"latitude":21.153629,"longitude":79.087216,"sequence":246},{"latitude":21.153633,"longitude":79.087319,"sequence":247},{"latitude":21.153472,"longitude":79.087353,"sequence":248},{"latitude":21.153418,"longitude":79.087364,"sequence":249},{"latitude":21.153213,"longitude":79.087433,"sequence":250},{"latitude":21.153026,"longitude":79.087499,"sequence":251},{"latitude":21.152764,"longitude":79.087579,"sequence":252},{"latitude":21.152684,"longitude":79.087594,"sequence":253},{"latitude":21.15253,"longitude":79.087604,"sequence":254},{"latitude":21.152445,"longitude":79.087602,"sequence":255},{"latitude":21.151938,"longitude":79.08759,"sequence":256},{"latitude":21.15181,"longitude":79.087593,"sequence":257},{"latitude":21.151791,"longitude":79.087773,"sequence":258},{"latitude":21.151786,"longitude":79.087928,"sequence":259},{"latitude":21.151789,"longitude":79.08795,"sequence":260},{"latitude":21.151799,"longitude":79.087967,"sequence":261},{"latitude":21.151933,"longitude":79.087983,"sequence":262},{"latitude":21.151928,"longitude":79.088006,"sequence":263},{"latitude":21.15231,"longitude":79.088064,"sequence":264}],
  },
];


// Check if two coordinates are near a reference point (within ~400m)
function isNearPoint(a: Coordinate, ref: { lat: number; lon: number }): boolean {
  const dist = Math.hypot(
    (a.latitude - ref.lat) * 111_320,
    (a.longitude - ref.lon) * 111_320 * Math.cos((a.latitude * Math.PI) / 180)
  );
  return dist < 500;
}

export async function calculateRoutes(origin: Coordinate, destination: Coordinate): Promise<CandidateRoute[]> {
  const candidateRoutes: CandidateRoute[] = [];
  const seenDistances: number[] = [];

  const isDistinct = (distM: number) => {
    return !seenDistances.some((d) => Math.abs(d - distM) < 120);
  };

  // ── Detect if this is the RBU → Nagpur Railway Station corridor ──
  const isRbuOrigin = isNearPoint(origin, { lat: 21.1764, lon: 79.0612 });
  const isStationDest = isNearPoint(destination, { lat: 21.1523, lon: 79.0882 });

  if (isRbuOrigin && isStationDest) {
    // Always use pre-computed exact road geometry (250-265 points per route)
    // Try OSRM live first, but fall back to embedded geometry (never straight lines)
    for (const rte of RBU_STATION_ROUTES) {
      try {
        const wpStr = rte.waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
        const osrmCoords = `${origin.longitude},${origin.latitude};${wpStr};${destination.longitude},${destination.latitude}`;
        const routes = await fetchOsrmRoute(osrmCoords);

        if (routes.length > 0) {
          // Got fresh OSRM road geometry (real-time, most accurate)
          const r = routes[0];
          const dist = Math.round(r.distance);
          seenDistances.push(dist);
          candidateRoutes.push({
            routeId: rte.id,
            routeName: rte.name,
            viaSummary: rte.viaSummary,
            points: r.geometry.coordinates.map(([longitude, latitude], sequence) => ({
              latitude,
              longitude,
              sequence,
            })),
            distance: dist,
            duration: Math.round(r.duration),
            safetyStatus: "PENDING",
            safetyScore: null,
            riskLevel: "UNKNOWN",
          });
        } else {
          // OSRM unavailable → use embedded pre-computed road geometry (never straight lines)
          seenDistances.push(rte.distance);
          candidateRoutes.push({
            routeId: rte.id,
            routeName: rte.name,
            viaSummary: rte.viaSummary,
            points: rte.cachedPoints,
            distance: rte.distance,
            duration: rte.duration,
            safetyStatus: "PENDING",
            safetyScore: null,
            riskLevel: "UNKNOWN",
          });
        }
      } catch {
        // OSRM threw error → use embedded pre-computed road geometry
        seenDistances.push(rte.distance);
        candidateRoutes.push({
          routeId: rte.id,
          routeName: rte.name,
          viaSummary: rte.viaSummary,
          points: rte.cachedPoints,
          distance: rte.distance,
          duration: rte.duration,
          safetyStatus: "PENDING",
          safetyScore: null,
          riskLevel: "UNKNOWN",
        });
      }
    }

    if (candidateRoutes.length >= 2) {
      return candidateRoutes;
    }
  }

  try {
    // Generic OSRM query with alternatives
    const directCoords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const osrmRoutes = await fetchOsrmRoute(directCoords);

    osrmRoutes.forEach((route, index) => {
      const dist = Math.round(route.distance);
      if (isDistinct(dist)) {
        seenDistances.push(dist);
        candidateRoutes.push({
          routeId: `osrm-${index + 1}`,
          points: route.geometry.coordinates.map(([longitude, latitude], sequence) => ({
            latitude,
            longitude,
            sequence,
          })),
          distance: dist,
          duration: Math.round(route.duration),
          safetyStatus: "PENDING",
          safetyScore: null,
          riskLevel: "UNKNOWN",
        });
      }
    });
  } catch {}

  // If OSRM returned at least 2 distinct routes, return them!
  if (candidateRoutes.length >= 2) {
    return candidateRoutes.slice(0, 3);
  }

  // If only 1 route, try intermediate Nagpur road junctions
  const minLat = Math.min(origin.latitude, destination.latitude) - 0.03;
  const maxLat = Math.max(origin.latitude, destination.latitude) + 0.03;
  const minLon = Math.min(origin.longitude, destination.longitude) - 0.03;
  const maxLon = Math.max(origin.longitude, destination.longitude) + 0.03;

  const viableJunctions = NAGPUR_ROAD_JUNCTIONS.filter(
    (j) => j.lat >= minLat && j.lat <= maxLat && j.lon >= minLon && j.lon <= maxLon
  );

  for (const junction of viableJunctions) {
    if (candidateRoutes.length >= 3) break;

    try {
      const junctionCoords = `${origin.longitude},${origin.latitude};${junction.lon},${junction.lat};${destination.longitude},${destination.latitude}`;
      const jRoutes = await fetchOsrmRoute(junctionCoords);

      if (jRoutes.length > 0) {
        const jr = jRoutes[0];
        const jDist = Math.round(jr.distance);
        if (isDistinct(jDist)) {
          seenDistances.push(jDist);
          candidateRoutes.push({
            routeId: `osrm-via-${junction.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            routeName: `Via ${junction.name}`,
            viaSummary: `through ${junction.name}`,
            points: jr.geometry.coordinates.map(([longitude, latitude], sequence) => ({
              latitude,
              longitude,
              sequence,
            })),
            distance: jDist,
            duration: Math.round(jr.duration),
            safetyStatus: "PENDING",
            safetyScore: null,
            riskLevel: "UNKNOWN",
          });
          continue;
        }
      }
    } catch {}

    const fallbackViaJunction = interpolateViaJunction(
      origin,
      junction,
      destination,
      `route-via-${junction.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`
    );
    if (isDistinct(fallbackViaJunction.distance)) {
      seenDistances.push(fallbackViaJunction.distance);
      candidateRoutes.push(fallbackViaJunction);
    }
  }

  if (candidateRoutes.length === 0) {
    const directDist = Math.round(
      Math.hypot(
        (destination.latitude - origin.latitude) * 111_320,
        (destination.longitude - origin.longitude) * 111_320 * Math.cos((origin.latitude * Math.PI) / 180)
      )
    );
    candidateRoutes.push({
      routeId: "route-main",
      points: [
        { latitude: origin.latitude, longitude: origin.longitude, sequence: 0 },
        { latitude: destination.latitude, longitude: destination.longitude, sequence: 1 },
      ],
      distance: directDist,
      duration: Math.round((directDist / 25000) * 3600),
      safetyStatus: "PENDING",
      safetyScore: null,
      riskLevel: "UNKNOWN",
    });
  }

  return candidateRoutes.slice(0, 3);
}

export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}