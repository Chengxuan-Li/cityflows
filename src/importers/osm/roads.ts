import { offsetPolyline } from '../../geo/polyline';
import type { Diagnostic } from '../../network';
import { allocateId, type City, type Road, type RoadClass } from '../../schema';
import type { ClippedPart } from './clip';
import type { OsmTags, OsmWay } from './parse';

const speedKph: Record<RoadClass, number> = {
  motorway: 100,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
  service: 20,
  ramp: 40,
};

export interface OsmRoad {
  road: Road;
  wayId: number;
  turnLanes: string | undefined;
  cutStart: boolean;
  cutEnd: boolean;
  attributes: string;
  layer: number;
}

export function isBridge(tag: OsmTags): boolean {
  return tag.bridge !== undefined && tag.bridge !== 'no';
}

export function osmLayer(tag: OsmTags): number | undefined {
  if (tag.layer !== undefined) {
    const layer = /^-?\d+$/.test(tag.layer) ? Number(tag.layer) : NaN;
    return Number.isSafeInteger(layer) ? layer : undefined;
  }
  if (isBridge(tag)) return 1;
  if ((tag.tunnel !== undefined && tag.tunnel !== 'no') || tag.covered === 'yes') return -1;
  return 0;
}

export function roadSpecs(way: OsmWay, roadClass: RoadClass, diagnostics: Diagnostic[]) {
  const { tag, id } = way;
  const unsupported = (key: string) =>
    diagnostics.push({
      severity: 'warning',
      code: 'osm_unsupported_tag',
      refs: [`way/${id}`],
      message: `Unsupported ${key}=${tag[key]} on OSM way ${id}`,
    });
  const oneway = tag.oneway;
  const supportedOneway = ['yes', 'no', '1', '0', 'true', 'false', '-1'].includes(oneway ?? '');
  if (oneway !== undefined && !supportedOneway) {
    unsupported('oneway');
  }
  const directions: ('forward' | 'backward')[] =
    oneway === '-1'
      ? ['backward']
      : ['yes', '1', 'true'].includes(oneway ?? '') ||
          (oneway === undefined && (roadClass === 'motorway' || tag.junction === 'roundabout'))
        ? ['forward']
        : ['forward', 'backward'];

  if (directions.length === 2 && tag['turn:lanes'] !== undefined) unsupported('turn:lanes');
  for (const key of ['lanes:both_ways', 'turn:lanes:both_ways']) {
    if (tag[key] !== undefined) unsupported(key);
  }

  const count = (key: string) => {
    const value = tag[key];
    if (value === undefined) return undefined;
    const number = Number(value);
    if (/^[1-9]\d*$/.test(value) && number <= 32) return number;
    unsupported(key);
    return undefined;
  };
  const total = count('lanes');
  const forward = count('lanes:forward');
  const backward = count('lanes:backward');
  const speed = /^(\d+(?:\.\d+)?)\s*(mph|km\/h)?$/i.exec(tag.maxspeed?.trim() ?? '');
  const taggedSpeed =
    Number(speed?.[1]) * (speed?.[2]?.toLowerCase() === 'mph' ? 0.44704 : 1 / 3.6);
  const hasSpeed = Number.isFinite(taggedSpeed) && taggedSpeed > 0;
  if (!hasSpeed && tag.maxspeed !== undefined) unsupported('maxspeed');
  if (osmLayer(tag) === undefined) unsupported('layer');
  const widthM = roadClass === 'residential' || roadClass === 'service' ? 3 : 3.5;

  return directions.map((direction) => {
    const direct = direction === 'forward' ? forward : backward;
    const opposite = direction === 'forward' ? backward : forward;
    const splitTotal = total !== undefined && total >= 2 && directions.length === 2;
    let laneCount = direct;
    if (laneCount === undefined && total !== undefined) {
      if (directions.length === 1) laneCount = total;
      else if (opposite !== undefined && total > opposite) laneCount = total - opposite;
      else if (splitTotal && opposite === undefined) {
        laneCount = direction === 'forward' ? Math.ceil(total / 2) : Math.floor(total / 2);
      }
    }
    const inferred: string[] = [];
    if (laneCount === undefined || (direct === undefined && splitTotal && opposite === undefined)) {
      inferred.push('lanes');
    }
    if (!hasSpeed) inferred.push('speedLimitMps');
    if (!supportedOneway) inferred.push('oneway');
    return {
      direction,
      turnLanes:
        tag[`turn:lanes:${direction}`] ?? (directions.length === 1 ? tag['turn:lanes'] : undefined),
      lanes: Array.from(
        { length: laneCount ?? (roadClass === 'motorway' || roadClass === 'trunk' ? 2 : 1) },
        (): Road['lanes'][number] => ({ widthM, allowed: ['car', 'van', 'truck', 'bus'] }),
      ),
      speedLimitMps: hasSpeed ? taggedSpeed : speedKph[roadClass] / 3.6,
      provenance: { source: 'osm' as const, osmIds: [id], inferred },
    };
  });
}

export function createRoads(
  city: City,
  way: OsmWay,
  roadClass: RoadClass,
  specs: ReturnType<typeof roadSpecs>,
  part: ClippedPart,
  segment: number,
  from: string,
  to: string,
): OsmRoad[] {
  const paired = specs.length === 2;
  const layer = osmLayer(way.tag) ?? 0;
  // The compiler identifies U-turns by street group. Pair only the reverse of this section.
  const streetGroupId = paired ? `osm:way/${way.id}${segment === 0 ? '' : '/' + segment}` : null;
  return specs.map(({ direction, turnLanes, lanes, speedLimitMps, provenance }) => {
    const reversed = direction === 'backward';
    const centerline = offsetPolyline(
      part.points.map(({ pos }) => pos),
      0,
    );
    const id = allocateId(city, 'r');
    const road: Road = {
      id,
      from: reversed ? to : from,
      to: reversed ? from : to,
      layer,
      centerline: reversed ? centerline.reverse() : centerline,
      lateralOffsetM: paired
        ? ((city.drivingSide === 'right' ? 1 : -1) * lanes.length * lanes[0]!.widthM) / 2
        : 0,
      lanes,
      speedLimitMps,
      provenance,
      roadClass,
      streetGroupId,
      name: way.tag.name ?? null,
    };
    city.roads[id] = road;
    return {
      road,
      wayId: way.id,
      turnLanes,
      cutStart: reversed ? part.cutEnd : part.cutStart,
      cutEnd: reversed ? part.cutStart : part.cutEnd,
      attributes: JSON.stringify(
        Object.entries(way.tag)
          .filter(([key]) => !key.startsWith('turn:lanes'))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      layer,
    };
  });
}
