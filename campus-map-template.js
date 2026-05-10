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
    id: "main-gate",
    name: "Area 1 — Main Gate",
    color: "#dc2626",
    ring: [
      [8.361483, 124.867673],
      [8.361401, 124.868028],
      [8.361039, 124.867942],
      [8.361146, 124.867548],
    ],
  },
  {
    id: "swdc",
    name: "Area 2 — SWDC",
    color: "#2563eb",
    ring: [
      [8.361137, 124.867571],
      [8.361055, 124.86793],
      [8.359661, 124.867606],
      [8.359796, 124.867147],
    ],
  },
  {
    id: "gso-utility",
    name: "Area 3 — GSO Utility Area",
    color: "#059669",
    ring: [
      [8.359769, 124.867151],
      [8.359669, 124.867493],
      [8.35918, 124.867381],
      [8.359327, 124.866918],
    ],
  },
  {
    id: "under-developed",
    name: "Area 4 — Under Developed",
    color: "#ca8a04",
    ring: [
      [8.359264, 124.866923],
      [8.358818, 124.869078],
      [8.358377, 124.868965],
      [8.35888, 124.866871],
    ],
  },
  {
    id: "lrc",
    name: "Area 5 — LRC, Clinic, President Quarters",
    color: "#7c3aed",
    ring: [
      [8.359467, 124.867536],
      [8.359247, 124.867482],
      [8.359034, 124.868277],
      [8.359274, 124.868331],
    ],
  },
  {
    id: "bsba",
    name: "Area 6 — BSBA Building",
    color: "#ea580c",
    ring: [
      [8.359274, 124.868352],
      [8.359031, 124.868293],
      [8.358926, 124.868829],
      [8.359156, 124.868878],
    ],
  },
  /**
   * Field BEFORE Supply/Gym/Canteen: app.js assigns zones in order (exclusive
   * clip). If Supply came first, its guide polygon stole overlapping athletic
   * field ground before “Field” ran — making Supply/Gym/Canteen look too large.
   */
  {
    id: "field",
    name: "Area 7 — Field",
    color: "#16a34a",
    ring: [
      [8.359317, 124.868523],
      [8.360782, 124.868868],
      [8.361084, 124.867993],
      [8.359559, 124.867575],
    ],
  },
  {
    id: "supply-gym-canteen",
    name: "Area 8 — Supply, Gym, Canteen",
    color: "#0ea5e9",
    ring: [
      [8.359251, 124.868884],
      [8.359345, 124.868496],
      [8.360342, 124.868771],
      [8.360287, 124.869111],
    ],
  },
  {
    id: "it-building",
    name: "Area 9 — IT Building",
    color: "#9333ea",
    ring: [
      [8.3614, 124.868037],
      [8.361117, 124.86932],
      [8.360898, 124.869288],
      [8.361195, 124.867989],
    ],
  },
  {
    id: "banghouse",
    name: "Area 10 — Construction Worker Banghouse",
    color: "#0891b2",
    ring: [
      [8.360236, 124.869098],
      [8.360315, 124.868765],
      [8.360903, 124.868898],
      [8.360815, 124.869228],
    ],
  },
  {
    id: "admin",
    name: "Area 11 — Admin Building",
    color: "#db2777",
    ring: [
      [8.361093, 124.869307],
      [8.361049, 124.869593],
      [8.360446, 124.869472],
      [8.360488, 124.869233],
    ],
  },
  {
    id: "under-construction",
    name: "Area 12 — Under Construction Building",
    color: "#e11d48",
    ring: [
      [8.3605, 124.869233],
      [8.360451, 124.869485],
      [8.359736, 124.869317],
      [8.359785, 124.869085],
    ],
  },
  {
    id: "nstp-safety",
    name: "Area 13 — NSTP, Campus Safety Office",
    color: "#f59e0b",
    ring: [
      [8.359787, 124.869085],
      [8.359744, 124.869302],
      [8.359385, 124.869237],
      [8.359423, 124.869019],
    ],
  },
  {
    id: "computer-lab",
    name: "Area 14 — Computer Lab, GAD, GSO",
    color: "#475569",
    ring: [
      [8.359377, 124.869255],
      [8.359419, 124.869017],
      [8.358894, 124.868905],
      [8.358851, 124.86913],
    ],
  },
];
