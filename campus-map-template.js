/**
 * RainSafe — campus map template
 *
 * Lists lat/lng corners per zone (rough outlines). app.js expands those points
 * slightly from each shape’s center, then clips to the campus parcel for the split map.
 *
 * Optional tuning in app.js: CAMPUS_ZONE_EXPAND_RATIO or
 * window.RAINSAFE_ZONE_EXPAND_RATIO before loading app.js.
 */
window.RAINSAFE_CAMPUS_PARCEL_LATLNG = [
  [8.36104, 124.869611],
  [8.36148, 124.867659],
  [8.358812, 124.866853],
  [8.358337, 124.86902],
];

window.RAINSAFE_CAMPUS_ZONE_DEFS = [
  {
    id: "main-gate-entrance-road",
    name: "Road 1 — Main Gate Entrance Road",
    color: "#dc2626",
    ring: [
      [8.361198, 124.867547],
      [8.36112, 124.867961],
      [8.361227, 124.867991],
      [8.361335, 124.867569],
    ],
  },
  {
    id: "main-gate-to-admin-road",
    name: "Road 2 — Main Gate to Admin Building Road",
    color: "#2563eb",
    ring: [
      [8.361240, 124.867922],
      [8.360948, 124.869224],
      [8.360822, 124.869196],
      [8.361144, 124.867966],
    ],
  },
  {
    id: "admin-curved-road",
    name: "Road 3 — Admin Building Curved Road",
    color: "#059669",
    ring: [
      [8.360948, 124.869224],
      [8.360868, 124.869296],
      [8.360703, 124.869296],
      [8.360713, 124.869202],
      [8.360821, 124.869192],
      [8.360845, 124.869145],
    ],
  },
  {
    id: "admin-to-gso-road",
    name: "Road 4 — Admin Building to GSO Road",
    color: "#ca8a04",
    ring: [
      [8.360720, 124.869290],
      [8.358924, 124.86893],
      [8.358948, 124.86884],
      [8.360712, 124.869183],
    ],
  },
  {
    id: "supply-to-utility-front-road",
    name: "Road 5 — Supply to Utility Quarters Front Area Road",
    color: "#7c3aed",
    ring: [
      [8.35921, 124.868971],
      [8.35957, 124.867476],
      [8.359479, 124.867447],
      [8.359136, 124.868964],
    ],
  },
  {
    id: "main-gate-to-utility-front-road",
    name: "Road 6 — Main Gate to Utility Quarters Front Area Road",
    color: "#ea580c",
    ring: [
      [8.359521, 124.867563],
      [8.361148, 124.867979],
      [8.361137, 124.867860],
      [8.359559, 124.867472],
    ],
  },
  {
    id: "utility-front-to-lrc-side-road",
    name: "Road 7 — Utility Front Area to LRC Side Road",
    color: "#16a34a",
    ring: [
      [8.359559, 124.867472],
      [8.359229, 124.867399],
      [8.359224, 124.867531],
      [8.35955, 124.867579],
    ],
  },
  {
    id: "lrc-front-to-gso-road",
    name: "Road 8 — LRC Front to GSO Road",
    color: "#0ea5e9",
    ring: [
      [8.35896, 124.868806],
      [8.359266, 124.867407],
      [8.359187, 124.867387],
      [8.358862, 124.868791],
    ],
  },
  {
    id: "lrc-side-to-pcoo-road",
    name: "Road 9 — LRC Side to PCOO Road",
    color: "#9333ea",
    ring: [
      [8.359476, 124.867555],
      [8.359241, 124.867371],
      [8.35878, 124.86728],
      [8.358802, 124.867431],
    ],
  },
  {
    id: "ba-side-to-pcoo-road",
    name: "Road 10 — PCOO Road to PCOO Gate",
    color: "#0891b2",
    ring: [
      [8.358616, 124.868292],
      [8.358497, 124.868252],
      [8.35874, 124.867271],
      [8.35885, 124.86728],
    ],
  },
  {
    id: "ba-to-gso-curved-road",
    name: "Road 11 — BA to GSO Curved Road",
    color: "#db2777",
    ring: [
      [8.358955, 124.86878],
      [8.358852, 124.86878],
      [8.358921, 124.868919],
      [8.358982, 124.868856],
    ],
  },
  {
    id: "unofficial-field-road",
    name: "Unofficial Road — Field Road",
    color: "#64748b",
    widthMeters: 6,
    path: [
      [8.361149, 124.867977],
      [8.361017, 124.868106],
      [8.360884, 124.868385],
      [8.360831, 124.868632],
      [8.360624, 124.868793],
      [8.360369, 124.868809],
      [8.359897, 124.868686],
      [8.359695, 124.868659],
      [8.359462, 124.868525],
    ],
  },
  {
    id: "unofficial-road-to-admin-gso",
    name: "Unofficial Road — Road to Admin GSO",
    color: "#64748b",
    widthMeters: 6,
    path: [
      [8.360369, 124.868809],
      [8.360252, 124.869126],
    ],
  },
  {
    id: "unofficial-road-comlab-front",
    name: "Unofficial Road — Admin to GSO (ComLab Front)",
    color: "#64748b",
    widthMeters: 6,
    path: [
      [8.359865, 124.86868],
      [8.35944, 124.868965],
    ],
  },
  {
    id: "unofficial-road-to-parking",
    name: "Unofficial Road — Road to Parking",
    color: "#64748b",
    widthMeters: 6,
    path: [
      [8.361057, 124.867894],
      [8.361022, 124.867757],
      [8.361075, 124.867607],
    ],
  },
  {
    id: "unofficial-road-swdc-back",
    name: "Unofficial Road — Road to SWDC Back",
    color: "#64748b",
    widthMeters: 6,
    path: [
      [8.361075, 124.867607],
      [8.359801, 124.867205],
      [8.359743, 124.867393],
    ],
  },
];
