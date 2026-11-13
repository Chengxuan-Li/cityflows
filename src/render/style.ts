import type { Vec2 } from '../geo/vec2';
import type { MarkingThemeId, PlaceKind, RoadClass, VehicleClass } from '../schema';

export type MarkingRole =
  'edge' | 'lane' | 'centre' | 'channel' | 'hatch' | 'arrow' | 'stop' | 'bus';
export interface MarkingLineStyle {
  widthM: number;
  dash?: readonly [number, number];
}
export type ArrowKind =
  | 'through'
  | 'left'
  | 'right'
  | 'through-left'
  | 'through-right'
  | 'left-right'
  | 'merge-left'
  | 'merge-right';
export interface MarkingTheme {
  id: string;
  colors: Record<MarkingRole, number>;
  classes: Record<RoadClass, Record<MarkingRole, MarkingLineStyle>>;
  guide: MarkingLineStyle;
  hatch: { widthM: number; townSpacingM: number; highwaySpacingM: number };
  arrows: Record<ArrowKind, Vec2[][]>;
  arrowLengthM: number;
  fastArrowLengthM: number;
  movementArrow: { head: Vec2[]; maxSizeM: number; lengthDivisor: number; widthM: number };
}

const polygon = (points: number[][]): Vec2[] => points.map(([x, y]) => ({ x: x!, y: y! }));
const straight = polygon([
  [-2.5, -0.15],
  [1.1, -0.15],
  [1.1, -0.55],
  [2.5, 0],
  [1.1, 0.55],
  [1.1, 0.15],
  [-2.5, 0.15],
]);
const left = polygon([
  [-2.5, -0.15],
  [1.4, -0.15],
  [1.4, -0.55],
  [0.8, -0.55],
  [1.65, -1.3],
  [2.5, -0.55],
  [1.85, -0.55],
  [1.85, 0.15],
  [-2.5, 0.15],
]);
const right = left.map(({ x, y }) => ({ x, y: -y }));
const mergeLeft = polygon([
  [-2.5, 0.65],
  [-0.8, 0.65],
  [1.1, -0.55],
  [0.8, -0.9],
  [2.5, -1.2],
  [1.7, 0.35],
  [1.4, 0],
  [-0.65, 0.95],
  [-2.5, 0.95],
]);
function germanLines(highway: boolean): Record<MarkingRole, MarkingLineStyle> {
  const widthM = highway ? 0.15 : 0.12;
  return {
    edge: { widthM: 0.3 },
    lane: { widthM, dash: highway ? [6, 12] : [3, 6] },
    centre: { widthM },
    channel: { widthM: 0.3 },
    hatch: { widthM: 0.5 },
    arrow: { widthM },
    bus: { widthM },
    stop: { widthM: 0.28 },
  };
}
const townLines = germanLines(false),
  highwayLines = germanLines(true);
const germanTheme: MarkingTheme = {
  id: 'de',
  colors: {
    edge: 0xfffcf3,
    lane: 0xfffcf3,
    centre: 0xfffcf3,
    channel: 0xfffcf3,
    hatch: 0xfffcf3,
    arrow: 0xfffcf3,
    bus: 0xfffcf3,
    stop: 0xfffcf3,
  },
  classes: {
    motorway: highwayLines,
    trunk: highwayLines,
    primary: townLines,
    secondary: townLines,
    tertiary: townLines,
    residential: townLines,
    service: townLines,
    ramp: highwayLines,
  },
  guide: { widthM: 0.12, dash: [1.5, 1.5] },
  hatch: { widthM: 0.5, townSpacingM: 2, highwaySpacingM: 4 },
  arrows: {
    through: [straight],
    left: [left],
    right: [right],
    'through-left': [straight, left],
    'through-right': [straight, right],
    'left-right': [left, right],
    'merge-left': [mergeLeft],
    'merge-right': [mergeLeft.map(({ x, y }) => ({ x, y: -y }))],
  },
  arrowLengthM: 5,
  fastArrowLengthM: 7.5,
  movementArrow: {
    head: polygon([
      [0, 0],
      [-1, 0.55],
      [-1, -0.55],
    ]),
    maxSizeM: 1.05,
    lengthDivisor: 6,
    widthM: 0.12,
  },
};

const white = 0xfffcf3,
  yellow = 0xf2ca4b;
function arrowSet(straight: Vec2[], left: Vec2[], merge: Vec2[]): Record<ArrowKind, Vec2[][]> {
  const right = left.map(({ x, y }) => ({ x, y: -y }));
  return {
    through: [straight],
    left: [left],
    right: [right],
    'through-left': [straight, left],
    'through-right': [straight, right],
    'left-right': [left, right],
    'merge-left': [merge],
    'merge-right': [merge.map(({ x, y }) => ({ x, y: -y }))],
  };
}
const usStraight = polygon([
  [-2.5, -0.15],
  [0.7, -0.15],
  [0.7, -0.65],
  [2.5, 0],
  [0.7, 0.65],
  [0.7, 0.15],
  [-2.5, 0.15],
]);
const usLeft = polygon([
  [-2.5, -0.15],
  [0.8, -0.15],
  [0.8, -0.55],
  [0.15, -0.55],
  [1.1, -1.4],
  [2.05, -0.55],
  [1.3, -0.55],
  [1.3, 0.15],
  [-2.5, 0.15],
]);
const ukStraight = polygon([
  [-2.5, -0.12],
  [1.05, -0.12],
  [0.65, -0.52],
  [0.95, -0.52],
  [2.5, 0],
  [0.95, 0.52],
  [0.65, 0.52],
  [1.05, 0.12],
  [-2.5, 0.12],
]);
const ukLeft = polygon([
  [-2.5, -0.12],
  [0.9, -0.12],
  [0.9, -0.8],
  [0.35, -0.55],
  [0.35, -0.8],
  [1.1, -1.55],
  [1.85, -0.8],
  [1.85, -0.55],
  [1.3, -0.8],
  [1.3, 0.12],
  [-2.5, 0.12],
]);
function themedLines(id: 'us' | 'uk'): MarkingTheme['classes'] {
  const result = { ...germanTheme.classes };
  for (const key of Object.keys(result) as RoadClass[]) {
    const lines = result[key];
    result[key] = {
      ...lines,
      edge: { widthM: 0.15 },
      lane: { widthM: 0.15, dash: id === 'us' ? [3, 9] : [2, 4] },
      centre: {
        widthM: 0.15,
        ...(id === 'uk'
          ? { dash: ['primary', 'secondary', 'trunk'].includes(key) ? [6, 3] : [3, 6] }
          : {}),
      },
      stop: { widthM: id === 'us' ? 0.3 : 0.2 },
    };
  }
  return result;
}
export const markingThemes: Record<MarkingThemeId, MarkingTheme> = {
  de: germanTheme,
  us: {
    ...germanTheme,
    id: 'us',
    colors: { ...germanTheme.colors, centre: yellow },
    classes: themedLines('us'),
    guide: { widthM: 0.15, dash: [0.6, 1.8] },
    hatch: { widthM: 0.5, townSpacingM: 3, highwaySpacingM: 6 },
    arrows: arrowSet(
      usStraight,
      usLeft,
      mergeLeft.map(({ x, y }) => ({ x, y: y * 1.15 })),
    ),
    arrowLengthM: 5,
    fastArrowLengthM: 7.5,
  },
  uk: {
    ...germanTheme,
    id: 'uk',
    colors: { ...germanTheme.colors, edge: yellow, centre: white },
    classes: themedLines('uk'),
    guide: { widthM: 0.1, dash: [1, 1] },
    hatch: { widthM: 0.5, townSpacingM: 2, highwaySpacingM: 4 },
    arrows: arrowSet(
      ukStraight,
      ukLeft,
      mergeLeft.map(({ x, y }) => ({ x, y: y * 0.85 })),
    ),
    arrowLengthM: 6,
    fastArrowLengthM: 9,
  },
};
export const markingTheme = markingThemes.de;

const local = { color: 0xbcc8c4, vergeM: 0.25 };
const avenue = { color: 0xa6b7b4, vergeM: 0.55 };
const expressway = { color: 0x899fa5, vergeM: 0.9 };
const roads: Record<RoadClass, typeof local> = {
  motorway: expressway,
  trunk: expressway,
  primary: avenue,
  secondary: avenue,
  tertiary: { color: 0xb0bfb9, vergeM: 0.4 },
  residential: local,
  service: { color: 0xcad0c3, vergeM: 0.1 },
  ramp: { color: 0xa1b2b4, vergeM: 0.4 },
};

export function roadStyle(
  road: { roadClass: RoadClass; lanes: readonly number[] },
  roadClasses = false,
) {
  const tone =
    road.roadClass === 'residential' && road.lanes.length > 1 ? avenue : roads[road.roadClass];
  return { ...tone, color: roadClasses ? tone.color : style.asphalt };
}

export function mixColor(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const x = (a >> shift) & 255,
      y = (b >> shift) & 255;
    out |= Math.round(x + (y - x) * t) << shift;
  }
  return out;
}

/** TASK-162: one macOS system colour per place type, drawn as a quiet tint with a thin, slightly
 * darker edge. System blue (#007AFF) is kept for selection. */
const placeHues: Record<PlaceKind, number> = {
  residential: 0x34c759, // green
  work: 0x5856d6, // indigo
  retail: 0xff9500, // orange
  school: 0xffcc00, // yellow
  station: 0x30b0c7, // teal
  airport: 0xaf52de, // purple
  parking: 0x32ade6, // cyan
  gateway: 0xa2845e, // brown
  other: 0xff2d55, // pink
};

/** `base` is the ground the tint is mixed from: white, or the dark appearance's (TASK-166). */
export function placeColors(kind: PlaceKind, base = 0xffffff) {
  const hue = placeHues[kind];
  return { fill: mixColor(base, hue, 0.3), edge: mixColor(base, hue, 0.62) };
}

/** Vehicles take their destination's hue from the macOS system colours, spread per destination
 * so neighbouring destinations of one type still differ. Blue is left out for selection, yellow
 * because it vanishes on light surfaces. */
const vehicleHues = [
  0x34c759, // green
  0xff9500, // orange
  0xff3b30, // red
  0xaf52de, // purple
  0x30b0c7, // teal
  0x5856d6, // indigo
  0xff2d55, // pink
  0xa2845e, // brown
] as const;

export function placeHue(id: string): number {
  // Hash the canonical ID so a place keeps its hue through edits, sorting and reopens.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return vehicleHues[(hash >>> 0) % vehicleHues.length]!;
}

export const style = {
  stall: 0xf9f7ef,
  walk: { sidewalk: 0xe2ded2, footway: 0xd7d3c5, steps: 0xb2ac9d },
  hillshadeAlpha: 0.3,
  /** TASK-162: an Apple-Maps light canvas; buildings, land use, water and green to match. Roads,
   * markings, paving, rail and street furniture keep their real-world tones. */
  background: 0xf2f1ee,
  context: {
    building: 0xe0ded8,
    buildingEdge: 0xcac7c0,
    water: 0xb3d7f2,
    green: 0xcfe7c5,
    parking: 0xe5e4de,
    landuse: 0xeeede9,
    landuseSub: {
      path: 0xe8e7e3,
      residential: 0xefeeea,
      commercial: 0xf0ecea,
      retail: 0xf2ebe8,
      industrial: 0xebeae7,
      railway: 0xe9e8e5,
      construction: 0xedeae3,
    } as Record<string, number>,
    rail: 0xa7aaa5,
    tram: 0xb2b5af,
  },
  buildings: {
    taggedColourStrength: 0.28,
    windowStrength: 0.32,
    walls: {
      brick: 0xd8bcae,
      plaster: 0xe8e5de,
      concrete: 0xd8d7d3,
      glass: 0xcddae2,
      wood: 0xdbc9ae,
      metal: 0xcfd2d5,
    } as Record<string, number>,
    roofs: {
      tile: 0xcaaea0,
      tiles: 0xcaaea0,
      roof_tiles: 0xcaaea0,
      metal: 0xc5cacf,
      concrete: 0xd3d2ce,
      slate: 0xb9bdc2,
      glass: 0xcfdee6,
      gravel: 0xd3d0c8,
    } as Record<string, number>,
    pitchedRoof: 0xcfb9ab,
    flatRoof: 0xd6d5d1,
    window: 0xa2b3c1,
    windowFadeM: [150, 600] as const,
    // TASK-163: lit windows stay distinct further out than the daytime panes.
    litWindowFadeM: [700, 1600] as const,
  },
  vegetation: { canopy: [0xb6d8a6, 0xc1deb2, 0xaad19a], trunk: 0x9c8f7a },
  /** TASK-135: tram track forms, apart from the railway palette in `rail-geometry.ts`. */
  tram: {
    beds: { grass: 0x9dbf88, paved: 0xc4b9a8, ballast: 0x9e9c95 },
    sleeper: 0xc6c2b8,
    rail: 0x5b6266,
    groove: 0x4a5054,
    bedWidthM: 3.2,
    railWidthM: 0.16,
    sleeperSpacingM: 0.9,
    sleeperLengthM: 2.3,
    sleeperWidthM: 0.26,
  },
  // TASK-162: a neutral real asphalt gray (main: 0xaebdb8, green-gray) for the neutral canvas.
  asphalt: 0xacb0b3,
  shadow: 0x303d3a,
  deckEdge: 0x6e817b,
  deckEdgeWidthM: 0.35,
  tunnelAlpha: 0.55,
  deckGhostAlpha: 0.35,
  marking: markingTheme.colors.lane,
  connector: 0x6f827a,
  selection: 0x007aff,
  route: 0x007aff,
  driving: 0x8e8e93,
  // TASK-111: pedestrians, darker than the paving; a warmer tone while waiting at a kerb.
  walker: { walking: 0x3d4a52, waiting: 0xb4683f },
  signalRed: 0xc95656,
  signalAmber: 0xe7a637,
  signalGreen: 0x30926c,
  dividerWidthM: markingTheme.classes.residential.lane.widthM,
  pointRadiusM: 6,
  placeAlpha: 0.72,
  connectorRadiusM: 0.7,
  vehicleClasses: {
    car: { lengthM: 4.5, widthM: 1.8, heightM: 1.5, color: 0x30b0c7 },
    van: { lengthM: 5.5, widthM: 2, heightM: 2.2, color: 0xff9500 },
    truck: { lengthM: 12, widthM: 2.5, heightM: 3.5, color: 0xa2845e },
    bus: { lengthM: 12, widthM: 2.55, heightM: 3.2, color: 0xaf52de },
  } satisfies Record<
    VehicleClass,
    { lengthM: number; widthM: number; heightM: number; color: number }
  >,
  vehicleDotRadiusPx: 1.65,
  vehiclePickRadiusPx: 8,
  detailZoom: 1.45,
  minZoom: 0.00001,
  maxZoom: 32,
} as const;

/** TASK-166: the map's canvas, land use and buildings for each appearance. Light is TASK-162's
 * palette. Dark (the chosen appearance, at every lighting preset, which then lights or darkens
 * it) follows Apple Maps' dark style: a near-black canvas, buildings a step lighter
 * than the ground, deep water and green, places as quiet tints of that ground, and paving toned
 * down from near-white. Roads, markings, rail, vehicles and street furniture keep their real
 * colours in both. */
export interface MapPalette {
  background: number;
  /** The ground place tints are mixed from (`placeColors`). */
  placeBase: number;
  /** Sidewalk and footway paving, and the step hatching. */
  walk: Record<'sidewalk' | 'footway' | 'steps', number>;
  context: Record<
    'building' | 'buildingEdge' | 'water' | 'green' | 'parking' | 'landuse',
    number
  > & {
    landuseSub: Record<string, number>;
  };
  buildings: Record<'pitchedRoof' | 'flatRoof' | 'window', number> & {
    walls: Record<string, number>;
    roofs: Record<string, number>;
  };
}
const darkBuilding = 0x3a3b3f,
  darkFlatRoof = 0x434448,
  darkPitchedRoof = 0x4a4241;
/** A material's dark variant: the dark base with a trace of the material's own hue. */
const darkMaterial = (base: number, colours: Record<string, number>) =>
  Object.fromEntries(Object.entries(colours).map(([k, c]) => [k, mixColor(base, c, 0.14)]));
export const mapPalettes: Record<'light' | 'dark', MapPalette> = {
  light: {
    background: style.background,
    placeBase: 0xffffff,
    walk: style.walk,
    context: style.context,
    buildings: style.buildings,
  },
  dark: {
    background: 0x222326,
    placeBase: 0x2b2c30,
    // Concrete in shade: a step below the asphalt so roads lead, light enough for pedestrians.
    walk: { sidewalk: 0x8c8981, footway: 0x7f7c75, steps: 0x9a978f },
    context: {
      building: darkBuilding,
      buildingEdge: 0x4d4e53,
      water: 0x1b3045,
      green: 0x223628,
      parking: 0x2e2f33,
      landuse: 0x26272a,
      landuseSub: {
        path: 0x2d2e31,
        residential: 0x27282b,
        commercial: 0x2a2729,
        retail: 0x2c2728,
        industrial: 0x28292c,
        railway: 0x29292b,
        construction: 0x2b2a27,
      },
    },
    buildings: {
      walls: darkMaterial(darkBuilding, style.buildings.walls),
      roofs: darkMaterial(darkFlatRoof, style.buildings.roofs),
      pitchedRoof: darkPitchedRoof,
      flatRoof: darkFlatRoof,
      window: 0x23282e,
    },
  },
};
