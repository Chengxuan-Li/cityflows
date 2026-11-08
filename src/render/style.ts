import type { Vec2 } from '../geo/vec2';
import type { RoadClass, VehicleClass } from '../schema';

export type MarkingRole = 'edge' | 'lane' | 'centre' | 'channel' | 'hatch' | 'arrow' | 'stop';
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
    stop: { widthM: 0.28 },
  };
}
const townLines = germanLines(false),
  highwayLines = germanLines(true);
export const markingTheme: MarkingTheme = {
  id: 'de',
  colors: {
    edge: 0xfffcf3,
    lane: 0xfffcf3,
    centre: 0xfffcf3,
    channel: 0xfffcf3,
    hatch: 0xfffcf3,
    arrow: 0xfffcf3,
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

const placePalette = [
  0x78b397, // mint
  0xd48a7e, // coral
  0x849fd3, // periwinkle
  0xc29b62, // honey
  0xb893c4, // lilac
  0x75aeb4, // lagoon
] as const;

export function placeHue(id: string): number {
  // Hash the canonical ID so a place keeps its hue through edits, sorting and reopens.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return placePalette[(hash >>> 0) % placePalette.length]!;
}

export const style = {
  background: 0xf4f1e7,
  context: {
    building: 0xe5e1d7,
    buildingEdge: 0xd5d0c5,
    water: 0xd0e2e6,
    green: 0xe0e8d5,
    parking: 0xe5e4de,
    landuse: 0xece9df,
    landuseSub: {
      path: 0xe5e4de,
      residential: 0xeee7de,
      commercial: 0xe9e6e1,
      retail: 0xeee5df,
      industrial: 0xe6e4df,
      railway: 0xe8e6df,
      construction: 0xede7d9,
    } as Record<string, number>,
    rail: 0xa7aaa5,
    tram: 0xb2b5af,
  },
  vegetation: { canopy: [0xc0d0b0, 0xc9d6b9, 0xb9cba8], trunk: 0x958c76 },
  asphalt: 0xaebdb8,
  shadow: 0x303d3a,
  deckEdge: 0x6e817b,
  deckEdgeWidthM: 0.35,
  tunnelAlpha: 0.55,
  deckGhostAlpha: 0.35,
  marking: markingTheme.colors.lane,
  connector: 0x6f827a,
  selection: 0x4d8e94,
  route: 0x588eac,
  driving: 0x667c81,
  signalRed: 0xc95656,
  signalAmber: 0xe7a637,
  signalGreen: 0x30926c,
  dividerWidthM: markingTheme.classes.residential.lane.widthM,
  pointRadiusM: 6,
  connectorRadiusM: 0.7,
  vehicleClasses: {
    car: { lengthM: 4.5, widthM: 1.8, heightM: 1.5, color: 0x789397 },
    van: { lengthM: 5.5, widthM: 2, heightM: 2.2, color: 0xc49b70 },
    truck: { lengthM: 12, widthM: 2.5, heightM: 3.5, color: 0xad8385 },
    bus: { lengthM: 12, widthM: 2.55, heightM: 3.2, color: 0x8c91b2 },
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
