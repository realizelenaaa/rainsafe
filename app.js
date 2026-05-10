"use strict";

const API_BASE = "";

const STORAGE_KEY_USER_TAB = "rainsafe.userTab";
const STORAGE_KEY_ADMIN_TAB = "rainsafe.adminTab";
const VALID_USER_TABS = ["submit", "reports", "activity", "map"];
const VALID_ADMIN_TABS = ["reports", "analytics", "activity"];

let csrfToken = null;

function readStoredUserTab() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY_USER_TAB);
    if (v && VALID_USER_TABS.includes(v)) return v;
  } catch (e) {
    /* ignore */
  }
  return "submit";
}

function readStoredAdminTab() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY_ADMIN_TAB);
    if (v && VALID_ADMIN_TABS.includes(v)) return v;
  } catch (e) {
    /* ignore */
  }
  return "reports";
}

function clearDashboardTabStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_USER_TAB);
    sessionStorage.removeItem(STORAGE_KEY_ADMIN_TAB);
  } catch (e) {
    /* ignore */
  }
}

// Global map objects
let userSubmitMap = null;
let userReportsMap = null;
let adminReportsMap = null;
let currentMarker = null;
let userMarkers = [];
let adminMarkers = [];
let campusPolygon = null;

/** Per-map campus overlay bundles (parcel outline + zone layers); keys userSubmit / userReports / admin. */
const campusMapOverlays = {
  userSubmit: null,
  userReports: null,
  admin: null,
};

/** Latest user reports for the map tab (markers applied when the map is created). */
let cachedUserReports = [];

/** Cached GeoJSON geometries + parcel outline (lat/lng) after turf processing. */
let cachedCampusZonePayload = null;

/** Bump when zone logic changes so cached geometry is recomputed after refresh. */
const RAINSAFE_MAP_BUILD = 20260226;

/** One tint for every campus subdivision (invisible divider look). Zone names unchanged for tooltips. */
const CAMPUS_UNIFIED_ZONE_FILL = "#93c5fd";

/**
 * Grow each zone slightly from centroid (guides only). Lower = less overlap before
 * exclusive clip. Optional: window.RAINSAFE_ZONE_EXPAND_RATIO
 */
const CAMPUS_ZONE_EXPAND_RATIO = 0.06;

/** Stop merging when unassigned parcel area is below this (m²). */
const CAMPUS_GAP_MIN_SQM = 0.12;

/** Max passes to absorb “missing” parcel into zones (union can need several rounds). */
const CAMPUS_GAP_ABSORB_MAX_ITER = 18;

/** Parcel + zone rings: edit `campus-map-template.js` (loaded before this file). */
const NBSC_PARCEL_LATLNG =
  typeof window !== "undefined" && window.RAINSAFE_CAMPUS_PARCEL_LATLNG
    ? window.RAINSAFE_CAMPUS_PARCEL_LATLNG
    : [];
const NBSC_ZONE_DEFS =
  typeof window !== "undefined" && window.RAINSAFE_CAMPUS_ZONE_DEFS
    ? window.RAINSAFE_CAMPUS_ZONE_DEFS
    : [];

if (
  typeof window !== "undefined" &&
  (!Array.isArray(NBSC_PARCEL_LATLNG) ||
    NBSC_PARCEL_LATLNG.length < 3 ||
    !Array.isArray(NBSC_ZONE_DEFS) ||
    NBSC_ZONE_DEFS.length === 0)
) {
  console.warn(
    "RainSafe: load campus-map-template.js before app.js, or fill RAINSAFE_CAMPUS_PARCEL_LATLNG / RAINSAFE_CAMPUS_ZONE_DEFS."
  );
}

// Center of NBSC Campus (updated when parcel GeoJSON is built)
let campusCenter = [8.36006193862642, 124.86840879895996];

function closeLatLngRing(ringLatLng) {
  const ring = ringLatLng.map(([lat, lng]) => [lat, lng]);
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function getZoneExpandRatio() {
  if (
    typeof window !== "undefined" &&
    typeof window.RAINSAFE_ZONE_EXPAND_RATIO === "number" &&
    Number.isFinite(window.RAINSAFE_ZONE_EXPAND_RATIO) &&
    window.RAINSAFE_ZONE_EXPAND_RATIO >= 0 &&
    window.RAINSAFE_ZONE_EXPAND_RATIO < 0.5
  ) {
    return window.RAINSAFE_ZONE_EXPAND_RATIO;
  }
  return CAMPUS_ZONE_EXPAND_RATIO;
}

/**
 * Adjust the lat/lng you provided: each corner moves outward from the shape’s
 * center so the area expands a little — then we clip to campus & split overlaps.
 */
function expandGuideRingLatLng(ringLatLng) {
  const pts = [];
  if (!Array.isArray(ringLatLng)) {
    return null;
  }
  ringLatLng.forEach((p) => {
    if (!Array.isArray(p) || p.length < 2) {
      return;
    }
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      pts.push([lat, lng]);
    }
  });
  if (pts.length < 3) {
    return null;
  }
  const r = getZoneExpandRatio();
  let sumLat = 0;
  let sumLng = 0;
  pts.forEach(([la, ln]) => {
    sumLat += la;
    sumLng += ln;
  });
  const cLat = sumLat / pts.length;
  const cLng = sumLng / pts.length;
  return pts.map(([la, ln]) => {
    const dLat = la - cLat;
    const dLng = ln - cLng;
    return [cLat + dLat * (1 + r), cLng + dLng * (1 + r)];
  });
}

/** GeoJSON Polygon Feature from ring in Leaflet order [lat, lng]. */
function latLngRingToPolygonFeature(ringLatLng) {
  const closed = closeLatLngRing(ringLatLng);
  const coords = closed.map(([lat, lng]) => [lng, lat]);
  if (typeof turf === "undefined") {
    return null;
  }
  return turf.polygon([coords]);
}

/** Normalize ring winding so Turf intersect/difference behave reliably. */
function rewindPolygonFeature(feat) {
  if (
    !feat ||
    typeof turf === "undefined" ||
    typeof turf.rewind !== "function"
  ) {
    return feat;
  }
  try {
    return turf.rewind(feat, { reverse: false });
  } catch (e) {
    return feat;
  }
}

function zoneUnionFeatureCollection(zones) {
  if (typeof turf === "undefined" || !zones || zones.length === 0) {
    return null;
  }
  let u = null;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z || !z.geometry) {
      continue;
    }
    const f = { type: "Feature", geometry: z.geometry };
    try {
      u = u ? turf.union(u, f) : f;
    } catch (e) {
      return null;
    }
  }
  return u;
}

function parcelGapAfterZones(parcelFeat, zones) {
  if (
    typeof turf === "undefined" ||
    !parcelFeat ||
    !zones ||
    zones.length === 0
  ) {
    return null;
  }
  const u = zoneUnionFeatureCollection(zones);
  if (!u) {
    return null;
  }
  try {
    return turf.difference(parcelFeat, u);
  } catch (e) {
    return null;
  }
}

function gapAreaSqm(gapFeat) {
  if (!gapFeat || !gapFeat.geometry || typeof turf === "undefined") {
    return 0;
  }
  try {
    return turf.area(gapFeat);
  } catch (e) {
    return 0;
  }
}

/**
 * Merge one gap fragment into zones: try union in order of proximity (gap
 * representative point → zone), so thin “missing” strips attach to the right neighbor.
 */
function mergeGapFragmentIntoZones(gPiece, zones) {
  if (
    typeof turf === "undefined" ||
    !gPiece ||
    !gPiece.geometry ||
    !zones ||
    zones.length === 0
  ) {
    return false;
  }
  let refPt = null;
  try {
    refPt =
      typeof turf.centerOfMass === "function"
        ? turf.centerOfMass(gPiece)
        : turf.centroid(gPiece);
  } catch (e) {
    refPt = null;
  }
  if (!refPt || !refPt.geometry) {
    return false;
  }

  const ranked = zones
    .map((z, idx) => {
      if (!z.geometry) {
        return { idx, dkm: Infinity };
      }
      let zpt = null;
      try {
        zpt =
          typeof turf.pointOnFeature === "function"
            ? turf.pointOnFeature(z.geometry)
            : turf.centroid(z.geometry);
      } catch (e) {
        zpt = null;
      }
      if (!zpt) {
        return { idx, dkm: Infinity };
      }
      let dkm = Infinity;
      try {
        dkm = turf.distance(refPt, zpt, { units: "kilometers" });
      } catch (e) {
        dkm = Infinity;
      }
      return { idx, dkm };
    })
    .sort((a, b) => a.dkm - b.dkm);

  for (let r = 0; r < ranked.length; r++) {
    const idx = ranked[r].idx;
    const z = zones[idx];
    if (!z.geometry) {
      continue;
    }
    try {
      const zf = { type: "Feature", geometry: z.geometry };
      const merged = turf.union(zf, gPiece);
      if (merged && merged.geometry) {
        zones[idx].geometry = merged.geometry;
        return true;
      }
    } catch (e) {
      /* try next zone */
    }
  }
  return false;
}

/**
 * Assign all unclaimed parcel interior into existing zones (no blank “missing”
 * patches). Runs multiple passes because each union can unlock new adjacency.
 */
function absorbParcelGapsIntoZones(parcelFeat, zones) {
  if (
    typeof turf === "undefined" ||
    !parcelFeat ||
    !zones ||
    zones.length === 0
  ) {
    return;
  }

  for (let iter = 0; iter < CAMPUS_GAP_ABSORB_MAX_ITER; iter++) {
    const gap = parcelGapAfterZones(parcelFeat, zones);
    const sq = gapAreaSqm(gap);
    if (!gap || !gap.geometry || sq < CAMPUS_GAP_MIN_SQM) {
      return;
    }

    let flat = null;
    try {
      flat = turf.flatten(gap);
    } catch (e) {
      flat = null;
    }
    if (!flat || !Array.isArray(flat.features) || flat.features.length === 0) {
      return;
    }

    let progressed = false;
    flat.features.forEach((gPiece) => {
      if (!gPiece || !gPiece.geometry) {
        return;
      }
      if (gapAreaSqm(gPiece) < CAMPUS_GAP_MIN_SQM) {
        return;
      }
      if (mergeGapFragmentIntoZones(gPiece, zones)) {
        progressed = true;
      }
    });

    if (!progressed) {
      break;
    }
  }

  const tail = parcelGapAfterZones(parcelFeat, zones);
  const tailSq = gapAreaSqm(tail);
  if (!tail || !tail.geometry || tailSq < CAMPUS_GAP_MIN_SQM) {
    return;
  }

  if (!mergeGapFragmentIntoZones({ type: "Feature", geometry: tail.geometry }, zones)) {
    for (let idx = 0; idx < zones.length; idx++) {
      try {
        const zf = { type: "Feature", geometry: zones[idx].geometry };
        const merged = turf.union(zf, tail);
        if (merged && merged.geometry) {
          zones[idx].geometry = merged.geometry;
          break;
        }
      } catch (e) {
        /* try next zone */
      }
    }
  }
}

function inflateGeoBbox(bbox, ratio) {
  if (!bbox || bbox.length < 4) {
    return bbox;
  }
  const minX = bbox[0];
  const minY = bbox[1];
  const maxX = bbox[2];
  const maxY = bbox[3];
  const dx = (maxX - minX) * ratio;
  const dy = (maxY - minY) * ratio;
  return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

/**
 * Split remaining parcel gap by Voronoi cells around each zone’s “seed”
 * (center of mass), then union each slice into that zone — fills corridors
 * your coordinates never enclosed.
 */
function voronoiAssignGapToZones(parcelFeat, zones) {
  if (
    typeof turf === "undefined" ||
    typeof turf.voronoi !== "function" ||
    !parcelFeat ||
    !zones ||
    zones.length === 0
  ) {
    return false;
  }

  let gap = parcelGapAfterZones(parcelFeat, zones);
  if (gapAreaSqm(gap) < CAMPUS_GAP_MIN_SQM) {
    return false;
  }

  const pts = [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z.geometry) {
      return false;
    }
    let p = null;
    try {
      const zf = { type: "Feature", geometry: z.geometry };
      p =
        typeof turf.centerOfMass === "function"
          ? turf.centerOfMass(zf)
          : turf.centroid(zf);
    } catch (e) {
      p = null;
    }
    if (!p || !p.geometry) {
      return false;
    }
    pts.push(p);
  }

  let bbox;
  try {
    bbox = turf.bbox(parcelFeat);
  } catch (e) {
    return false;
  }
  const inflated = inflateGeoBbox(bbox, 0.04);

  let vor = null;
  try {
    vor = turf.voronoi(turf.featureCollection(pts), { bbox: inflated });
  } catch (e) {
    return false;
  }
  if (!vor || !vor.features || vor.features.length < zones.length) {
    return false;
  }

  gap = parcelGapAfterZones(parcelFeat, zones);
  if (!gap || !gap.geometry || gapAreaSqm(gap) < CAMPUS_GAP_MIN_SQM) {
    return false;
  }

  const gapFeat = { type: "Feature", geometry: gap.geometry };
  let mergedAny = false;
  for (let i = 0; i < zones.length; i++) {
    const cell = vor.features[i];
    if (!cell || !cell.geometry) {
      continue;
    }
    let piece = null;
    try {
      piece = turf.intersect(gapFeat, cell);
    } catch (e) {
      piece = null;
    }
    if (!piece || !piece.geometry || gapAreaSqm(piece) < 1e-10) {
      continue;
    }
    try {
      const zf = { type: "Feature", geometry: zones[i].geometry };
      const merged = turf.union(zf, piece);
      if (merged && merged.geometry) {
        zones[i].geometry = merged.geometry;
        mergedAny = true;
      }
    } catch (e) {
      /* skip */
    }
  }
  return mergedAny;
}

function fillParcelGapsAggressive(parcelFeat, zones) {
  if (
    typeof turf === "undefined" ||
    !parcelFeat ||
    !zones ||
    zones.length === 0
  ) {
    return;
  }
  absorbParcelGapsIntoZones(parcelFeat, zones);
  const rounds = 4;
  for (let r = 0; r < rounds; r++) {
    const g = parcelGapAfterZones(parcelFeat, zones);
    if (gapAreaSqm(g) < CAMPUS_GAP_MIN_SQM) {
      return;
    }
    voronoiAssignGapToZones(parcelFeat, zones);
    absorbParcelGapsIntoZones(parcelFeat, zones);
  }
}

function registerCampusOverlay(mapKey, bundle) {
  if (!mapKey || !bundle) {
    return;
  }
  campusMapOverlays[mapKey] = bundle;
}

/**
 * Stack divided zone paths so later template entries paint above earlier ones.
 * Call before bringToFront on the parcel outline.
 */
function raiseDividedZoneStack(layerGroup) {
  if (!layerGroup || typeof layerGroup.eachLayer !== "function") {
    return;
  }
  layerGroup.eachLayer((layer) => {
    if (typeof layer.bringToFront === "function") {
      layer.bringToFront();
    }
  });
}

/** Map pane for campus zone polygons (below outline). */
function setupCampusMapPanes(map) {
  if (!map || typeof map.createPane !== "function") {
    return;
  }
  if (!map.getPane("campusZones")) {
    const pz = map.createPane("campusZones");
    pz.style.zIndex = 410;
  }
}

/**
 * Clip zones to the parcel, trim overlaps (defined order), add gap-fill so the
 * parcel interior is fully covered without overlapping zones.
 */
function computeCampusZonePayload() {
  if (
    !Array.isArray(NBSC_PARCEL_LATLNG) ||
    NBSC_PARCEL_LATLNG.length < 3
  ) {
    return {
      parcelLatLng: [],
      zones: [],
      zonesFallback: true,
    };
  }

  if (typeof turf === "undefined") {
    return {
      parcelLatLng: closeLatLngRing(NBSC_PARCEL_LATLNG),
      zones: [],
      zonesFallback: true,
    };
  }

  let parcelFeat = latLngRingToPolygonFeature(NBSC_PARCEL_LATLNG);
  parcelFeat = rewindPolygonFeature(parcelFeat);
  if (!parcelFeat) {
    return {
      parcelLatLng: closeLatLngRing(NBSC_PARCEL_LATLNG),
      zones: [],
      zonesFallback: true,
    };
  }

  try {
    const ctr = turf.center(parcelFeat);
    if (ctr && ctr.geometry && ctr.geometry.coordinates) {
      const [lng, lat] = ctr.geometry.coordinates;
      campusCenter = [lat, lng];
    }
  } catch (e) {
    /* keep default center */
  }

  let assignedUnion = null;
  const zones = [];

  NBSC_ZONE_DEFS.forEach((def) => {
    const adjustedRing = expandGuideRingLatLng(def.ring);
    let raw = null;
    try {
      raw = latLngRingToPolygonFeature(
        adjustedRing && adjustedRing.length >= 3 ? adjustedRing : def.ring
      );
    } catch (e) {
      raw = null;
    }
    if (!raw) return;

    raw = rewindPolygonFeature(raw);

    let clipped = null;
    try {
      clipped = turf.intersect(raw, parcelFeat);
    } catch (e) {
      clipped = null;
    }
    if (!clipped) return;

    let piece = clipped;
    if (assignedUnion) {
      try {
        piece = turf.difference(clipped, assignedUnion);
      } catch (e) {
        piece = null;
      }
      if (!piece) return;
    }

    try {
      assignedUnion = assignedUnion
        ? turf.union(assignedUnion, piece)
        : piece;
    } catch (e) {
      return;
    }

    zones.push({
      id: def.id,
      name: def.name,
      color: def.color,
      geometry: piece.geometry,
    });
  });

  let gap = null;
  try {
    gap = assignedUnion
      ? turf.difference(parcelFeat, assignedUnion)
      : parcelFeat;
  } catch (e) {
    gap = null;
  }

  const initialGapSqm = gapAreaSqm(gap);
  if (initialGapSqm >= CAMPUS_GAP_MIN_SQM && zones.length > 0) {
    try {
      fillParcelGapsAggressive(parcelFeat, zones);
    } catch (e) {
      /* ignore */
    }
  } else if (
    initialGapSqm >= CAMPUS_GAP_MIN_SQM &&
    zones.length === 0 &&
    gap &&
    gap.geometry
  ) {
    zones.push({
      id: "parcel-remainder",
      name: "Campus parcel (no zone guides matched)",
      color: "#94a3b8",
      geometry: gap.geometry,
    });
  }

  return {
    parcelLatLng: closeLatLngRing(NBSC_PARCEL_LATLNG).map(([lat, lng]) => [
      lat,
      lng,
    ]),
    zones,
    zonesFallback: zones.length === 0,
  };
}

function getCampusZonePayload() {
  if (
    !cachedCampusZonePayload ||
    cachedCampusZonePayload._build !== RAINSAFE_MAP_BUILD
  ) {
    cachedCampusZonePayload = computeCampusZonePayload();
    cachedCampusZonePayload._build = RAINSAFE_MAP_BUILD;
  }
  return cachedCampusZonePayload;
}

let parcelPolyFeatHitTestCache = null;
let parcelPolyFeatHitTestBuild = null;

function getCampusParcelPolygonFeatureForHitTest() {
  if (
    parcelPolyFeatHitTestBuild === RAINSAFE_MAP_BUILD &&
    parcelPolyFeatHitTestCache
  ) {
    return parcelPolyFeatHitTestCache;
  }
  if (
    typeof turf === "undefined" ||
    !Array.isArray(NBSC_PARCEL_LATLNG) ||
    NBSC_PARCEL_LATLNG.length < 3
  ) {
    parcelPolyFeatHitTestCache = null;
    parcelPolyFeatHitTestBuild = RAINSAFE_MAP_BUILD;
    return null;
  }
  let f = latLngRingToPolygonFeature(closeLatLngRing(NBSC_PARCEL_LATLNG));
  f = rewindPolygonFeature(f);
  parcelPolyFeatHitTestCache = f;
  parcelPolyFeatHitTestBuild = RAINSAFE_MAP_BUILD;
  return f;
}

function isLatLngInsideCampusParcel(lat, lng) {
  if (
    typeof turf === "undefined" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }
  const pf = getCampusParcelPolygonFeatureForHitTest();
  if (!pf) {
    return false;
  }
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), pf);
  } catch (e) {
    return false;
  }
}

/**
 * Canonical display name for a report pin (which campus subdivision contains the point).
 */
function campusZoneDisplayNameAtLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (!isLatLngInsideCampusParcel(lat, lng)) {
    return null;
  }
  const payload = getCampusZonePayload();
  const zones = payload && Array.isArray(payload.zones) ? payload.zones : [];
  if (zones.length === 0 || typeof turf === "undefined") {
    return "NBSC Campus";
  }
  const pt = turf.point([lng, lat]);
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z || !z.geometry) {
      continue;
    }
    try {
      const zf = rewindPolygonFeature({ type: "Feature", geometry: z.geometry });
      if (zf && turf.booleanPointInPolygon(pt, zf)) {
        return String(z.name || "NBSC Campus").trim() || "NBSC Campus";
      }
    } catch (e) {
      /* skip */
    }
  }
  return "NBSC Campus";
}

/** Parcel outline + subdivided zones; zone names shown on hover only. */
function addCampusParcelAndZones(
  map,
  { outlineWeight = 2, mapKey = "userSubmit" } = {}
) {
  const payload = getCampusZonePayload();

  if (
    !payload.parcelLatLng ||
    payload.parcelLatLng.length < 3
  ) {
    return null;
  }

  setupCampusMapPanes(map);

  const dividedGroup = L.layerGroup();

  const onlyWholeParcelGap =
    payload.zones.length === 1 &&
    payload.zones[0].id === "parcel-remainder";

  const turfOk =
    typeof turf !== "undefined" &&
    payload.zones.length > 0 &&
    !onlyWholeParcelGap;

  /** No visible borders between zones; single tint across all subdivisions */
  const zonePolyStyleBase = {
    weight: 0,
    opacity: 0,
    fillOpacity: 0.36,
    fillColor: CAMPUS_UNIFIED_ZONE_FILL,
    color: CAMPUS_UNIFIED_ZONE_FILL,
  };

  const bindZoneHoverName = (layer, displayName) => {
    layer.bindTooltip(escapeHtml(displayName), {
      sticky: true,
      direction: "auto",
      className: "campus-zone-tooltip",
    });
  };

  if (turfOk) {
    payload.zones.forEach((z) => {
      if (!z.geometry) {
        return;
      }
      const gj = {
        type: "Feature",
        properties: { name: z.name, color: z.color },
        geometry: z.geometry,
      };
      L.geoJSON(gj, {
        pane: "campusZones",
        style: () => ({ ...zonePolyStyleBase }),
        onEachFeature: (feat, layer) => {
          bindZoneHoverName(layer, feat.properties.name);
        },
      }).addTo(dividedGroup);
    });
  } else if (NBSC_ZONE_DEFS.length > 0) {
    console.warn(
      "[RainSafe] Drawing campus zones as raw polygons (Turf missing or produced no zones). Overlap clipping disabled — hard-refresh (Ctrl+F5) if this persists."
    );
    NBSC_ZONE_DEFS.forEach((def) => {
      const adjustedRing = expandGuideRingLatLng(def.ring);
      const ring = closeLatLngRing(
        adjustedRing && adjustedRing.length >= 3 ? adjustedRing : def.ring
      );
      const lyr = L.polygon(ring, {
        pane: "campusZones",
        ...zonePolyStyleBase,
      });
      bindZoneHoverName(lyr, def.name);
      dividedGroup.addLayer(lyr);
    });
  }

  try {
    console.info(
      "[RainSafe] campus map build %s · Turf: %s · zone layers: %s",
      String(RAINSAFE_MAP_BUILD),
      typeof turf !== "undefined" ? "yes" : "no",
      turfOk ? String(payload.zones.length) : "raw"
    );
  } catch (e) {
    /* ignore */
  }

  const outline = L.polygon(payload.parcelLatLng, {
    color: "#0f172a",
    weight: outlineWeight,
    opacity: 1,
    fillOpacity: 0,
  });

  dividedGroup.addTo(map);
  raiseDividedZoneStack(dividedGroup);
  outline.addTo(map);
  outline.bringToFront();

  try {
    const bounds = L.latLngBounds(payload.parcelLatLng);
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
  } catch (e) {
    /* ignore */
  }

  const bundle = {
    map,
    mapKey,
    dividedGroup,
    outline,
  };
  registerCampusOverlay(mapKey, bundle);
  campusPolygon = outline;
  return bundle;
}

// Chart objects
let severityChart = null;
let monthlyTrendsChart = null;
let topLocationsChart = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  };

  if (
    method !== "GET" &&
    method !== "HEAD" &&
    csrfToken
  ) {
    options.headers["X-CSRF-Token"] = csrfToken;
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API_BASE + path, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && data.error ? data.error : "Request failed.";
    throw new Error(message);
  }

  return data;
}

async function apiGetSession() {
  const data = await apiRequest("auth.php?action=session", { method: "GET" });
  if (data && data.csrf_token) {
    csrfToken = data.csrf_token;
  }
  return data;
}

async function apiLogin(email, password) {
  return apiRequest("auth.php?action=login", {
    method: "POST",
    body: { email, password },
  });
}

async function apiSignup(email, password) {
  return apiRequest("auth.php?action=signup", {
    method: "POST",
    body: { email, password },
  });
}

async function apiLogout() {
  return apiRequest("auth.php?action=logout", { method: "POST" });
}

async function apiGetUserReports() {
  const data = await apiRequest("reports.php", { method: "GET" });
  return asArray(data && data.reports);
}

async function apiGetAdminReports(filters = {}) {
  const params = new URLSearchParams();
  params.set("scope", "admin");
  if (filters.severity) params.set("severity", filters.severity);

  const data = await apiRequest(
    `reports.php?${params.toString()}`,
    { method: "GET" }
  );
  return asArray(data && data.reports);
}

async function apiGetStats() {
  return apiRequest("reports.php?stats=true", { method: "GET" });
}

async function apiCreateReport(reportBody) {
  return apiRequest("reports.php", {
    method: "POST",
    body: reportBody,
  });
}

async function apiGetUserActivityLogs() {
  const data = await apiRequest("activity_logs.php", { method: "GET" });
  return asArray(data && data.logs);
}

async function apiGetAdminActivityLogs() {
  const params = new URLSearchParams();
  params.set("scope", "admin");
  const data = await apiRequest(
    `activity_logs.php?${params.toString()}`,
    { method: "GET" }
  );
  return asArray(data && data.logs);
}

// Elements
const loginView = document.getElementById("loginView");
const userDashboardView = document.getElementById("userDashboardView");
const adminDashboardView = document.getElementById("adminDashboardView");

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");

const reportForm = document.getElementById("reportForm");
const reportMessage = document.getElementById("reportMessage");
const userReportsList = document.getElementById("userReportsList");
const userActivityLogsList = document.getElementById("userActivityLogsList");
const userSideNav = document.getElementById("userSideNav");

const adminRefreshBtn = document.getElementById("adminRefreshBtn");
const adminTopNav = document.getElementById("adminTopNav");

// Always resolve these fresh from the DOM to avoid stale null refs
function getAdminReportsList()     { return document.getElementById("adminReportsList"); }
function getAdminSeverityFilter()  { return document.getElementById("adminSeverityFilter"); }
function getHotspotsTableBody()    { return document.querySelector("#hotspotsTable tbody"); }
function getAdminActivityLogsList(){ return document.getElementById("adminActivityLogsList"); }

const currentUserLabel = document.getElementById("currentUserLabel");
const logoutBtn = document.getElementById("logoutBtn");

const severityToggle = document.getElementById("severityToggle");
const selectedLocationCoords = document.getElementById("selectedLocationCoords");
const locationInput = document.getElementById("location");

let currentUser = null;
let selectedSeverity = "Low";

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("error", "success");
  if (type) {
    element.classList.add(type);
  }
}

function setLoading(button, isLoading, labelWhenIdle) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = "Please wait…";
    button.disabled = true;
  } else {
    button.textContent = labelWhenIdle || button.dataset.originalLabel || "";
    button.disabled = false;
  }
}

function teardownLeafletMaps() {
  if (userSubmitMap) {
    userSubmitMap.remove();
    userSubmitMap = null;
  }
  if (userReportsMap) {
    userReportsMap.remove();
    userReportsMap = null;
  }
  if (adminReportsMap) {
    adminReportsMap.remove();
    adminReportsMap = null;
  }
  campusPolygon = null;
  campusMapOverlays.userSubmit = null;
  campusMapOverlays.userReports = null;
  campusMapOverlays.admin = null;
  currentMarker = null;
  userMarkers = [];
  adminMarkers = [];
}

function showView(view) {
  if (!loginView || !userDashboardView || !adminDashboardView) return;

  loginView.classList.add("hidden");
  userDashboardView.classList.add("hidden");
  adminDashboardView.classList.add("hidden");

  if (view === "login") {
    teardownLeafletMaps();
    loginView.classList.remove("hidden");
    currentUserLabel.classList.add("hidden");
    logoutBtn.classList.add("hidden");
  } else if (view === "user") {
    userDashboardView.classList.remove("hidden");
    currentUserLabel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  } else if (view === "admin") {
    adminDashboardView.classList.remove("hidden");
    currentUserLabel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  }
}

function invalidateMapWhenReady(map) {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 150);
  });
}

async function ensureUserSubmitMapReady() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initUserSubmitMap();
        invalidateMapWhenReady(userSubmitMap);
        setTimeout(resolve, 50);
      });
    });
  });
}

async function ensureAdminMapReady() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initAdminMap();
        invalidateMapWhenReady(adminReportsMap);
        setTimeout(resolve, 50);
      });
    });
  });
}

function resetSubmitTabForm() {
  if (reportForm) {
    reportForm.reset();
  }
  selectedSeverity = "Low";
  if (severityToggle) {
    Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
      btn.classList.toggle("chip-selected", btn.dataset.value === selectedSeverity);
    });
  }
  clearSelectedLocation();
  setStatus(reportMessage, "");
}

function setUserTab(tab) {
  const previous = document
    .querySelector("[data-user-tab].side-tab-active")
    ?.getAttribute("data-user-tab");

  if (previous === "submit" && tab !== "submit") {
    resetSubmitTabForm();
  }

  const buttons = document.querySelectorAll("[data-user-tab]");
  const panels = document.querySelectorAll("[data-user-tab-panel]");

  buttons.forEach((btn) => {
    const value = btn.getAttribute("data-user-tab");
    btn.classList.toggle("side-tab-active", value === tab);
  });

  panels.forEach((panel) => {
    const value = panel.getAttribute("data-user-tab-panel");
    panel.classList.toggle("hidden", value !== tab);
  });

  if (tab === "map") {
    ensureUserReportsMap();
    updateUserMapMarkers(cachedUserReports);
    invalidateMapWhenReady(userReportsMap);
  } else if (tab === "submit" && userSubmitMap) {
    invalidateMapWhenReady(userSubmitMap);
  }

  try {
    sessionStorage.setItem(STORAGE_KEY_USER_TAB, tab);
  } catch (e) {
    /* ignore */
  }
}

function setAdminTab(tab) {
  const buttons = document.querySelectorAll("[data-admin-tab]");
  const panels = document.querySelectorAll("[data-admin-tab-panel]");

  buttons.forEach((btn) => {
    const value = btn.getAttribute("data-admin-tab");
    btn.classList.toggle("top-tab-active", value === tab);
  });

  panels.forEach((panel) => {
    const value = panel.getAttribute("data-admin-tab-panel");
    panel.classList.toggle("hidden", value !== tab);
  });

  if (tab === "analytics") {
    if (currentUser && currentUser.role === "admin") {
      loadAnalytics();
    }
  } else if (tab === "reports" && adminReportsMap) {
    invalidateMapWhenReady(adminReportsMap);
  }

  try {
    sessionStorage.setItem(STORAGE_KEY_ADMIN_TAB, tab);
  } catch (e) {
    /* ignore */
  }
}

function getSeverityClass(severity) {
  if (severity === "High") return "tag-high";
  if (severity === "Medium") return "tag-medium";
  return "tag-low";
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function escapeHtml(str) {
  if (str == null || str === "") return "";
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}

function renderReports(listElement, reports, { showReporter = false } = {}) {
  if (!listElement) return;

  const rows = asArray(reports).filter((r) => r && typeof r === "object");

  if (rows.length === 0) {
    listElement.innerHTML =
      '<p class="muted">No reports yet. Encourage students to submit after rainfall.</p>';
    listElement.classList.add("empty-state");
    return;
  }

  listElement.classList.remove("empty-state");

  listElement.innerHTML = rows
    .map((r) => {
      const severityClass = getSeverityClass(r.severity);
      const reporterLabel =
        r.reporter_name && r.reporter_name.trim().length > 0
          ? r.reporter_name
          : "Anonymous";

      return `
      <article class="report-card">
        <div class="report-card-header">
          <div>
            <div class="report-location">${escapeHtml(r.location) || "Unknown location"}</div>
            <div class="report-tags">
              <span class="tag ${severityClass}">${r.severity} severity</span>
            </div>
          </div>
        </div>
        <div class="report-body">
          ${r.description ? escapeHtml(r.description) : "<em>No additional details provided.</em>"}
        </div>
        <div class="report-footer">
          <span>${formatDateTime(r.created_at)}</span>
          <span>${
            showReporter
              ? `Reported by: ${escapeHtml(reporterLabel)}`
              : `You reported this`
          }</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function renderActivityLogs(listElement, logs, { showUser = false } = {}) {
  if (!listElement) return;

  const rows = asArray(logs).filter((r) => r && typeof r === "object");

  if (rows.length === 0) {
    listElement.innerHTML = '<p class="muted">No activity yet.</p>';
    listElement.classList.add("empty-state");
    return;
  }

  listElement.classList.remove("empty-state");

  listElement.innerHTML = rows
    .map((log) => {
      const who = showUser
        ? log.user_email || `User #${log.user_id}`
        : "";

      return `
      <article class="report-card">
        <div class="report-card-header">
          <div>
            <div class="report-location">${escapeHtml(log.action)}</div>
            ${
              who
                ? `<div class="report-tags"><span class="tag tag-muted">${escapeHtml(who)}</span></div>`
                : ""
            }
          </div>
        </div>
        <div class="report-body">
          ${log.details ? escapeHtml(log.details) : "<em>No extra details recorded.</em>"}
        </div>
        <div class="report-footer">
          <span>${formatDateTime(log.created_at)}</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function groupHotspots(reports) {
  const byLocation = new Map();

  asArray(reports)
    .filter((r) => r && typeof r === "object")
    .forEach((r) => {
    const key = (r.location || "Unknown location").trim();
    if (!byLocation.has(key)) {
      byLocation.set(key, []);
    }
    byLocation.get(key).push(r);
  });

  const items = [];
  byLocation.forEach((rows, location) => {
    const reportsCount = rows.length;
    const sorted = [...rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const mostRecent = sorted[0];
    if (!mostRecent) {
      return;
    }

    items.push({
      location,
      reportsCount,
      mostRecentSeverity: mostRecent.severity,
      lastReported: mostRecent.created_at,
    });
  });

  items.sort((a, b) => b.reportsCount - a.reportsCount);
  return items;
}

function renderHotspots(reports) {
  const hotspotsTableBody = getHotspotsTableBody();
  if (!hotspotsTableBody) return;

  const hotspots = groupHotspots(reports).slice(0, 10);

  if (hotspots.length === 0) {
    hotspotsTableBody.innerHTML =
      '<tr><td colspan="4" class="muted">No data yet.</td></tr>';
    return;
  }

  hotspotsTableBody.innerHTML = hotspots
    .map(
      (h) => `
      <tr>
        <td>${escapeHtml(h.location)}</td>
        <td>${h.reportsCount}</td>
        <td>${h.mostRecentSeverity}</td>
        <td>${formatDateTime(h.lastReported)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadAnalytics() {
  try {
    const stats = await apiGetStats();
    const severityStats = asArray(stats && stats.severity_stats);
    const monthlyTrends = asArray(stats && stats.monthly_trends);
    const topLocations = asArray(stats && stats.top_locations);

    if (typeof Chart === "undefined") {
      console.warn("Chart.js is not available.");
      return;
    }

    // Severity Chart
    if (severityChart) severityChart.destroy();
    const severityCanvas = document.getElementById("severityChart");
    if (severityCanvas) {
      const ctx = severityCanvas.getContext("2d");
      if (ctx) {
        severityChart = new Chart(ctx, {
          type: "pie",
          data: {
            labels: severityStats.map((s) => s.severity),
            datasets: [
              {
                data: severityStats.map((s) => s.count),
                backgroundColor: ["#22c55e", "#eab308", "#ef4444"],
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: true },
        });
      }
    }

    // Monthly Trends Chart
    if (monthlyTrendsChart) monthlyTrendsChart.destroy();
    const monthlyCanvas = document.getElementById("monthlyTrendsChart");
    if (monthlyCanvas) {
      const ctx = monthlyCanvas.getContext("2d");
      if (ctx) {
        monthlyTrendsChart = new Chart(ctx, {
          type: "line",
          data: {
            labels: stats.monthly_trends.map((t) => t.month).reverse(),
            datasets: [
              {
                label: "Reports per Month",
                data: stats.monthly_trends.map((t) => t.count).reverse(),
                borderColor: "#2563eb",
                backgroundColor: "rgba(37, 99, 235, 0.1)",
                fill: true,
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: true },
        });
      }
    }

    // Top Locations Chart
    if (topLocationsChart) topLocationsChart.destroy();
    const locationsCanvas = document.getElementById("topLocationsChart");
    if (locationsCanvas) {
      const ctx = locationsCanvas.getContext("2d");
      if (ctx) {
        topLocationsChart = new Chart(ctx, {
          type: "bar",
          data: {
            labels: topLocations.map((l) => l.location),
            datasets: [
              {
                label: "Number of Reports",
                data: topLocations.map((l) => l.count),
                backgroundColor: "#3b82f6",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: "y",
          },
        });
      }
    }
  } catch (error) {
    console.error("Error loading analytics:", error);
  }
}

function addCampusTiles(map) {
  // Single-host tile URL (recommended by OSM; avoids {s} subdomain issues in some setups)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

function fixMapTiles(map) {
  if (!map || typeof map.whenReady !== "function") return;
  map.whenReady(() => {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 120);
    setTimeout(() => map.invalidateSize(), 450);
  });
}

/** Submit map (visible on default tab). */
function initUserSubmitMap() {
  if (userSubmitMap || !document.getElementById("userSubmitMap")) return;

  getCampusZonePayload();

  userSubmitMap = L.map("userSubmitMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
  }).setView(campusCenter, 18);
  addCampusTiles(userSubmitMap);

  const submitCampus = addCampusParcelAndZones(userSubmitMap, {
    outlineWeight: 3,
    mapKey: "userSubmit",
  });
  campusPolygon = submitCampus ? submitCampus.outline : null;

  userSubmitMap.on("click", function (e) {
    placeMarker(e.latlng);
  });

  fixMapTiles(userSubmitMap);
}

/**
 * "All reports" map lives in a tab that starts hidden; init only when the tab
 * is shown so Leaflet gets a non-zero container size.
 */
function ensureUserReportsMap() {
  if (userReportsMap) {
    userReportsMap.invalidateSize();
    return;
  }
  const el = document.getElementById("userReportsMap");
  if (!el) return;

  getCampusZonePayload();

  userReportsMap = L.map("userReportsMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
  }).setView(campusCenter, 18);
  addCampusTiles(userReportsMap);

  addCampusParcelAndZones(userReportsMap, {
    outlineWeight: 2,
    mapKey: "userReports",
  });
}

function initAdminMap() {
  if (adminReportsMap || !document.getElementById("adminReportsMap")) return;

  getCampusZonePayload();

  adminReportsMap = L.map("adminReportsMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
  }).setView(campusCenter, 18);
  addCampusTiles(adminReportsMap);

  addCampusParcelAndZones(adminReportsMap, {
    outlineWeight: 2,
    mapKey: "admin",
  });

  fixMapTiles(adminReportsMap);
}

function placeMarker(latlng) {
  if (!userSubmitMap) return;

  if (!isLatLngInsideCampusParcel(latlng.lat, latlng.lng)) {
    setStatus(
      reportMessage,
      "Place your pin inside the NBSC campus outline only (click inside the bordered area).",
      "error"
    );
    return;
  }

  const zoneDisplay = campusZoneDisplayNameAtLatLng(latlng.lat, latlng.lng);

  setStatus(reportMessage, "");
  if (locationInput && zoneDisplay) {
    locationInput.value = zoneDisplay;
  }

  if (currentMarker) {
    userSubmitMap.removeLayer(currentMarker);
  }

  currentMarker = L.marker(latlng, { draggable: true }).addTo(userSubmitMap);

  let dragResume = L.latLng(latlng.lat, latlng.lng);
  currentMarker.on("dragstart", function () {
    dragResume = this.getLatLng();
  });

  currentMarker.on("dragend", function () {
    const newPos = this.getLatLng();
    if (!isLatLngInsideCampusParcel(newPos.lat, newPos.lng)) {
      this.setLatLng(dragResume);
      setStatus(
        reportMessage,
        "The pin must stay inside the campus boundary.",
        "error"
      );
      return;
    }
    setStatus(reportMessage, "");
    const zn = campusZoneDisplayNameAtLatLng(newPos.lat, newPos.lng);
    if (locationInput && zn) {
      locationInput.value = zn;
    }
    this.setPopupContent(
      `<strong>${escapeHtml(zn)}</strong><br>
      Lat: ${newPos.lat.toFixed(6)}<br>
      Lng: ${newPos.lng.toFixed(6)}`
    );
    updateSelectedLocationDisplay(newPos.lat, newPos.lng);
  });

  currentMarker
    .bindPopup(
      `<strong>${escapeHtml(zoneDisplay)}</strong><br>
      Lat: ${latlng.lat.toFixed(6)}<br>
      Lng: ${latlng.lng.toFixed(6)}`
    )
    .openPopup();

  updateSelectedLocationDisplay(latlng.lat, latlng.lng);
}

function updateSelectedLocationDisplay(lat, lng) {
  if (selectedLocationCoords) {
    selectedLocationCoords.innerHTML = `📍 Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

function clearSelectedLocation() {
  if (currentMarker && userSubmitMap) {
    userSubmitMap.removeLayer(currentMarker);
    currentMarker = null;
  }
  if (selectedLocationCoords) {
    selectedLocationCoords.innerHTML = "";
  }
  if (locationInput) {
    locationInput.value = "";
  }
}

function useMyLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (position) {
      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );
      if (userSubmitMap) {
        userSubmitMap.setView(latlng, 18);
        if (!isLatLngInsideCampusParcel(latlng.lat, latlng.lng)) {
          setStatus(
            reportMessage,
            "Your GPS position is outside the campus parcel. Zoom to the outlined campus and tap inside it to drop your pin.",
            "error"
          );
          return;
        }
        placeMarker(latlng);
      }
    },
    function (error) {
      console.error("Error getting location:", error);
      alert(
        "Unable to get your location. Please check your browser permissions."
      );
    }
  );
}

function updateUserMapMarkers(reports) {
  if (!userReportsMap) return;

  userMarkers.forEach((marker) => userReportsMap.removeLayer(marker));
  userMarkers = [];

  reports.forEach((report) => {
    if (report.latitude && report.longitude) {
      const marker = L.marker([report.latitude, report.longitude])
        .bindPopup(
          `<strong>${escapeHtml(report.location)}</strong><br>
          Severity: ${report.severity}<br>
          ${report.description ? escapeHtml(report.description) : ""}<br>
          <small>${formatDateTime(report.created_at)}</small>`
        )
        .addTo(userReportsMap);
      userMarkers.push(marker);
    }
  });
}

function updateAdminMapMarkers(reports) {
  if (!adminReportsMap) return;

  adminMarkers.forEach((marker) => adminReportsMap.removeLayer(marker));
  adminMarkers = [];

  reports.forEach((report) => {
    if (report.latitude && report.longitude) {
      const markerColor = getSeverityColor(report.severity);
      const marker = L.circleMarker([report.latitude, report.longitude], {
        radius: 8,
        fillColor: markerColor,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      })
        .bindPopup(
          `<strong>${escapeHtml(report.location)}</strong><br>
          Severity: ${report.severity}<br>
          Reporter: ${escapeHtml(report.reporter_name || "Anonymous")}<br>
          ${report.description ? escapeHtml(report.description) : ""}<br>
          <small>${formatDateTime(report.created_at)}</small>`
        )
        .addTo(adminReportsMap);
      adminMarkers.push(marker);
    }
  });
}

function getSeverityColor(severity) {
  switch (severity) {
    case "High":   return "#ef4444";
    case "Medium": return "#eab308";
    default:       return "#22c55e";
  }
}

async function handleAuthChange(user) {
  currentUser = user;

  if (!user) {
    if (currentUserLabel) currentUserLabel.textContent = "";
    clearDashboardTabStorage();
    showView("login");
    return;
  }

  const role = user.role || "user";
  if (currentUserLabel) {
    currentUserLabel.textContent = `${user.email} · ${role.toUpperCase()} MODE`;
  }

  try {
    if (role === "admin") {
      showView("admin");
      setAdminTab(readStoredAdminTab());
      await ensureAdminMapReady();
      await loadAdminReports();
      await loadAdminActivityLogs();
    } else {
      showView("user");
      setUserTab(readStoredUserTab());
      await ensureUserSubmitMapReady();
      await loadUserReports();
      await loadUserActivityLogs();
    }
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

async function loadUserReports() {
  if (!currentUser) return;

  try {
    const reports = await apiGetUserReports();
    cachedUserReports = reports;
    renderReports(userReportsList, reports, { showReporter: false });
    updateUserMapMarkers(reports);
  } catch (error) {
    console.error("Error loading user reports:", error);
    setStatus(reportMessage, "Unable to load your reports right now.", "error");
  }
}

async function loadAdminReports() {
  if (!currentUser || currentUser.role !== "admin") return;

  const reportsList    = getAdminReportsList();
  const severityFilter = getAdminSeverityFilter();
  const tableBody      = getHotspotsTableBody();

  if (!reportsList) return;

  const filters = {};
  const sev =
    severityFilter && typeof severityFilter.value === "string"
      ? severityFilter.value
      : "";
  if (sev) {
    filters.severity = sev;
  }

  try {
    const reports = await apiGetAdminReports(filters);
    renderReports(reportsList, reports, { showReporter: true });
    if (tableBody) renderHotspots(reports);
    if (adminReportsMap) updateAdminMapMarkers(reports);
  } catch (error) {
    console.error("Error loading admin reports:", error);
    renderReports(reportsList, [], { showReporter: true });
  }
}

async function loadUserActivityLogs() {
  if (!currentUser) return;

  try {
    const logs = await apiGetUserActivityLogs();
    renderActivityLogs(userActivityLogsList, logs, { showUser: false });
  } catch (error) {
    console.error("Error loading user activity logs:", error);
    renderActivityLogs(userActivityLogsList, [], { showUser: false });
  }
}

async function loadAdminActivityLogs() {
  if (!currentUser || currentUser.role !== "admin") return;

  const logsList = getAdminActivityLogsList();
  if (!logsList) return;

  try {
    const logs = await apiGetAdminActivityLogs();
    renderActivityLogs(logsList, logs, { showUser: true });
  } catch (error) {
    console.error("Error loading admin activity logs:", error);
    renderActivityLogs(logsList, [], { showUser: true });
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

if (severityToggle) {
  severityToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;

    selectedSeverity = button.dataset.value;

    Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
      btn.classList.remove("chip-selected");
    });
    button.classList.add("chip-selected");
  });
}

if (userSideNav) {
  userSideNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-tab]");
    if (!button) return;
    const tab = button.getAttribute("data-user-tab");
    if (!tab) return;
    setUserTab(tab);
  });
}

if (adminTopNav) {
  adminTopNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-tab]");
    if (!button) return;
    const tab = button.getAttribute("data-admin-tab");
    if (!tab) return;
    setAdminTab(tab);
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(authMessage, "");

    const email     = document.getElementById("loginEmail").value.trim();
    const password  = document.getElementById("loginPassword").value;
    const submitBtn = document.getElementById("loginSubmitBtn");
    setLoading(submitBtn, true, "Sign In");

    try {
      const { user } = await apiLogin(email, password);
      setLoading(submitBtn, false, "Sign In");
      setStatus(authMessage, "Signed in successfully.", "success");
      await handleAuthChange(user);
    } catch (error) {
      console.error("Login error:", error);
      setLoading(submitBtn, false, "Sign In");
      setStatus(
        authMessage,
        error.message || "Sign in failed. Check your email and password.",
        "error"
      );
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(authMessage, "");

    const email     = document.getElementById("signupEmail").value.trim();
    const password  = document.getElementById("signupPassword").value;
    const submitBtn = document.getElementById("signupSubmitBtn");
    setLoading(submitBtn, true, "Create User Account");

    try {
      await apiSignup(email, password);
      setLoading(submitBtn, false, "Create User Account");
      setStatus(authMessage, "Account created. You can now sign in.", "success");
      signupForm.reset();
    } catch (error) {
      console.error("Signup error:", error);
      setLoading(submitBtn, false, "Create User Account");
      setStatus(
        authMessage,
        error.message ||
          "Could not create account. Use a different email or try again.",
        "error"
      );
    }
  });
}

if (reportForm) {
  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      setStatus(reportMessage, "Please sign in again.", "error");
      return;
    }

    setStatus(reportMessage, "");

    if (!currentMarker || !userSubmitMap) {
      setStatus(
        reportMessage,
        "Tap inside the campus map to drop a pin — reports are tied to campus areas only.",
        "error"
      );
      return;
    }

    const mll = currentMarker.getLatLng();
    if (!isLatLngInsideCampusParcel(mll.lat, mll.lng)) {
      setStatus(
        reportMessage,
        "Move your pin inside the campus outline before submitting.",
        "error"
      );
      return;
    }

    const fromMap = campusZoneDisplayNameAtLatLng(mll.lat, mll.lng);

    const payload = {
      location: String(fromMap || "").trim(),
      severity: selectedSeverity,
      description: document.getElementById("description").value.trim(),
      reporter_name: document.getElementById("reporterName").value.trim(),
    };

    payload.latitude = mll.lat;
    payload.longitude = mll.lng;

    if (!payload.location) {
      setStatus(
        reportMessage,
        "Could not resolve campus area name for your pin.",
        "error"
      );
      return;
    }

    const submitBtn = document.getElementById("reportSubmitBtn");
    setLoading(submitBtn, true, "Submit Report");

    try {
      await apiGetSession();
      if (!csrfToken) {
        setStatus(
          reportMessage,
          "Session not ready. Please refresh the page and try again.",
          "error"
        );
        setLoading(submitBtn, false, "Submit Report");
        return;
      }
      await apiCreateReport(payload);
      setLoading(submitBtn, false, "Submit Report");

      reportForm.reset();
      selectedSeverity = "Low";
      if (severityToggle) {
        Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
          btn.classList.toggle(
            "chip-selected",
            btn.dataset.value === selectedSeverity
          );
        });
      }

      clearSelectedLocation();
      setStatus(
        reportMessage,
        "Thank you. Your report has been recorded.",
        "success"
      );

      await loadUserReports();
      await loadUserActivityLogs();
    } catch (error) {
      console.error("Error submitting report:", error);
      setLoading(submitBtn, false, "Submit Report");
      setStatus(
        reportMessage,
        error.message || "Unable to submit report right now. Please try again.",
        "error"
      );
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error("Logout error:", error);
    }
    csrfToken = null;
    try {
      await apiGetSession();
    } catch (e) {
      console.error("Session refresh after logout:", e);
    }
    await handleAuthChange(null);
  });
}

if (adminRefreshBtn) {
  adminRefreshBtn.addEventListener("click", () => {
    if (currentUser && currentUser.role === "admin") {
      loadAdminReports();
      loadAdminActivityLogs();
    }
  });
}

// Use event delegation for the severity filter so it works even while the
// admin panel is hidden on page load (direct getElementById binding at init
// time can return the element but calling .value on a detached/hidden element
// is fine — the real historical crash was that reports.php still referenced
// hazard_type which no longer exists in the DB schema).
document.addEventListener("change", (event) => {
  if (event.target && event.target.id === "adminSeverityFilter") {
    if (currentUser && currentUser.role === "admin") {
      loadAdminReports();
    }
  }
});

document
  .getElementById("useMyLocationBtn")
  ?.addEventListener("click", useMyLocation);
document
  .getElementById("clearLocationBtn")
  ?.addEventListener("click", clearSelectedLocation);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async function bootstrap() {
  try {
    const { user } = await apiGetSession();
    await handleAuthChange(user ?? null);
  } catch (err) {
    console.error("Error initializing session:", err);
    showView("login");
  }
})();