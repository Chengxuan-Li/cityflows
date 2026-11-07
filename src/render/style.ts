import type { RoadClass } from '../schema';

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
  asphalt: 0xaebdb8,
  marking: 0xfffcf3,
  connector: 0x6f827a,
  selection: 0x4d8e94,
  route: 0x588eac,
  driving: 0x667c81,
  signalRed: 0xc95656,
  signalAmber: 0xe7a637,
  signalGreen: 0x30926c,
  dividerWidthM: 0.18,
  guideDashM: 1.5,
  guideGapM: 1.5,
  pointRadiusM: 6,
  connectorRadiusM: 0.7,
  vehicleLengthM: 4.5,
  vehicleWidthM: 1.9,
  vehicleDotRadiusPx: 1.65,
  vehiclePickRadiusPx: 8,
  detailZoom: 1.45,
  minZoom: 0.00001,
  maxZoom: 32,
} as const;
