import { offsetPolyline } from '../../geo/polyline';
import type { Diagnostic } from '../../network';
import { allocateId, type City, type Road, type RoadClass } from '../../schema';
import { vehicleClasses, type AccessValue } from '../../schema';
import type { ClippedPart } from './clip';
import type { OsmTags, OsmWay } from './parse';
import { sidewalkTags } from './walk';

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

/** The lane width where no width is tagged. */
const defaultLaneWidth = (roadClass: RoadClass) =>
  roadClass === 'residential' || roadClass === 'service' ? 3 : 3.5;

/**
 * TASK-254 (TASK-242's `n:1146`): where a one-way road gains or drops lanes across a node of only
 * its two ends, the network lines the lanes that run on up by their left edges and tapers in the
 * gained ones; it draws no width taper for a lane that runs on, so lanes running on at another
 * width turn the node into a junction fan. There tagged widths (`roadSpecs`) that would change
 * the width of a lane running on are not read: the road keeps its class's default width, repeated
 * until no such node is left. The tag describes its whole way, so the other roads of that way keep
 * the default too (else they meet it at a step across the junction that split the way).
 * Friedrichstraße `r:1148` (`width:lanes=2.5|3|3|3|2.5`) after the two 3.5 m lanes of `r:1175`
 * drew a fan whose edge sagged up to 0.4 m onto the median's grass; `r:1149`, the same way beyond
 * the Hauptbahnhof junction `n:1147`, then met it 3.5 m narrower.
 */
export function keepRunningLaneWidths(roads: OsmRoad[]): void {
  const ends = new Map<string, Road[]>();
  for (const { road } of roads)
    for (const node of [road.from, road.to]) ends.set(node, [...(ends.get(node) ?? []), road]);
  const widths = (road: Road) => road.lanes.map((lane) => lane.widthM);
  const tagged = (road: Road) =>
    road.lanes.some((lane) => lane.widthM !== defaultLaneWidth(road.roadClass));
  for (let changed = true; changed;) {
    changed = false;
    for (const { road, wayId } of roads) {
      if (road.streetGroupId !== null || !tagged(road)) continue;
      const steps = [road.from, road.to].some((node) => {
        const at = ends.get(node)!;
        const other = at.find((o) => o !== road);
        if (at.length !== 2 || !other || other.streetGroupId !== null) return false;
        if ((node === road.to ? other.from : other.to) !== node) return false;
        if (other.lanes.length === road.lanes.length) return false;
        const [a, b] = [widths(road), widths(other)];
        return a.some((w, i) => i < b.length && Math.abs(w - b[i]!) > 1e-9);
      });
      if (!steps) continue;
      // The tag describes its whole way: every road of the way keeps the default.
      for (const same of roads.filter((o) => o.wayId === wayId)) {
        const width = defaultLaneWidth(same.road.roadClass);
        same.road.lanes = same.road.lanes.map((lane) => ({ ...lane, widthM: width }));
      }
      changed = true;
    }
  }
}

/** A lane width read from `width` or `width:lanes` outside these bounds is not a lane's (a
 * `width` that covers parking, cycle lanes or a hard shoulder, a typo), so the tag is ignored;
 * motorways, trunk roads and ramps keep at least RAA's narrowest lanes. */
function taggedLaneBounds(roadClass: RoadClass): { min: number; max: number } {
  return roadClass === 'motorway' || roadClass === 'trunk' || roadClass === 'ramp'
    ? { min: 3, max: 3.75 }
    : { min: 2.5, max: 4.5 };
}

/** No street parking on either side: a carriageway `width` then covers the lanes alone; otherwise
 * it includes the parking lanes the importer draws as strips beside them (TASK-218's variant:
 * Munich's way 90400545, `width=7` with parking on both sides, is not two 3.5 m lanes). */
function noStreetParking(tag: OsmTags): boolean {
  const none = (side: 'left' | 'right') =>
    [`parking:${side}`, 'parking:both', `parking:lane:${side}`, 'parking:lane:both'].some((key) =>
      ['no', 'separate'].includes(tag[key] ?? ''),
    );
  return none('left') && none('right');
}

/** A length in metres (`4`, `4.5 m`), else undefined. */
function metres(value: string | undefined): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*m?$/.exec(value?.trim() ?? '');
  return match ? Number(match[1]) : undefined;
}

/** TASK-242: a one-way way's `placement` (`left_of:N`, `middle_of:N`, `right_of:N`, lanes counted
 * from the left in travel direction) as the lane block centre's offset from the way's line,
 * positive to the right of travel, for lanes of `widths`. Undefined when the tag is absent,
 * `transition`, or names a lane the road does not have (`placeRoads`). */
export function placementOffset(value: string | undefined, widths: number[]): number | undefined {
  const match = /^(left_of|middle_of|right_of):([1-9]\d*)$/.exec(value?.trim() ?? '');
  const n = Number(match?.[2]);
  if (!match || n > widths.length) return undefined;
  const sum = (list: number[]) => list.reduce((total, w) => total + w, 0);
  const lane = widths[n - 1]!;
  const line =
    sum(widths.slice(0, n - 1)) +
    (match[1] === 'left_of' ? 0 : match[1] === 'right_of' ? lane : lane / 2);
  return sum(widths) / 2 - line;
}

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

// The class keys are looked up through vehicleClasses; adding van there enables goods.
const classTags: Record<string, string[]> = { van: ['goods'], truck: ['hgv'], bus: ['psv', 'bus'] };

function roadAccess(tag: OsmTags, direction: string, inferred: string[]): Road['access'] {
  const access: NonNullable<Road['access']> = {};
  const keyFor = (key: string) =>
    tag[`${key}:${direction}`] !== undefined ? `${key}:${direction}` : key;
  const value = (key: string): AccessValue => {
    const raw = tag[key]!;
    if (raw === 'yes' || raw === 'permissive' || raw === 'designated') return 'yes';
    if (raw === 'no' || raw === 'destination' || raw === 'delivery' || raw === 'private')
      return raw;
    if (raw === 'customers') return 'private';
    inferred.push(key);
    return 'yes';
  };
  for (const key of ['access', 'vehicle', 'motor_vehicle', 'motorcar'].map(keyFor))
    if (tag[key] !== undefined) access.all = value(key);
  for (const kind of vehicleClasses)
    for (const key of (classTags[kind] ?? []).map(keyFor))
      if (tag[key] !== undefined) access[kind] = value(key);

  for (const attribute of ['maxweight', 'maxheight']) {
    const key = keyFor(attribute);
    const raw = tag[key];
    if (raw === undefined) continue;
    const match = /^(\d+(?:\.\d+)?)\s*(t|kg|m|ft|lbs)?$/.exec(raw.trim());
    const unit = match?.[2];
    const weight = attribute === 'maxweight';
    const validUnit = weight
      ? unit === undefined || ['t', 'kg', 'lbs'].includes(unit!)
      : unit === undefined || ['m', 'ft'].includes(unit!);
    if (!match || !validUnit) {
      inferred.push(key);
      continue;
    }
    const limit =
      Number(match[1]) *
      (unit === 'kg' ? 0.001 : unit === 'lbs' ? 0.00045359237 : unit === 'ft' ? 0.3048 : 1);
    if (limit >= (weight ? 3.5 : 3)) continue;
    for (const kind of vehicleClasses)
      if (kind === 'truck' || kind === 'bus' || (!weight && kind === 'van')) access[kind] = 'no';
  }
  return Object.keys(access).length ? access : undefined;
}

function busLanes(
  lanes: Road['lanes'],
  tag: OsmTags,
  direction: string,
  paired: boolean,
  drivingSide: City['drivingSide'],
  inferred: string[],
): Road['lanes'] {
  const directional = (key: string) =>
    tag[`${key}:${direction}`] ?? (!paired ? tag[key] : undefined);
  const exact = directional('bus:lanes') ?? directional('psv:lanes');
  if (exact !== undefined) {
    const pattern = exact.split('|');
    if (pattern.length === lanes.length)
      return lanes.map((lane, i) => {
        const value = pattern[i]!;
        if (value === 'designated' || value === 'exclusive') return { ...lane, allowed: ['bus'] };
        if (value === 'no')
          return { ...lane, allowed: lane.allowed.filter((kind) => kind !== 'bus') };
        if (!['', 'yes', 'permissive'].includes(value)) inferred.push('bus:lanes');
        return lane;
      });
    inferred.push('bus:lanes');
  }
  const side = (direction === 'forward') === (drivingSide === 'right') ? 'right' : 'left';
  const otherSide = side === 'right' ? 'left' : 'right';
  const hasSide = tag[`busway:${side}`] !== undefined || tag[`busway:${otherSide}`] !== undefined;
  const busway =
    tag[`busway:${direction}`] ?? tag[`busway:${side}`] ?? (!hasSide ? tag.busway : undefined);
  const oppositeBusway =
    tag[`busway:${direction === 'forward' ? 'backward' : 'forward'}`] ??
    tag[`busway:${otherSide}`] ??
    (!hasSide ? tag.busway : undefined);
  let count: number | undefined;
  for (const key of ['lanes:psv', 'lanes:bus']) {
    const directKey =
      tag[`${key}:${direction}`] !== undefined ? `${key}:${direction}` : `${key}:${side}`;
    const direct = tag[directKey];
    const hasCountSide = tag[`${key}:left`] !== undefined || tag[`${key}:right`] !== undefined;
    const raw = direct ?? (!hasCountSide ? tag[key] : undefined);
    if (raw === undefined) continue;
    if (!/^\d+$/.test(raw) || Number(raw) > 32) {
      inferred.push(direct === undefined ? key : directKey);
      continue;
    }
    const total = Number(raw);
    if (direct !== undefined || !paired) count = total;
    else if (busway === 'lane' && oppositeBusway !== 'lane') count = total;
    else if (oppositeBusway === 'lane' && busway !== 'lane') count = 0;
    else if (busway === 'no') count = 0;
    else if (oppositeBusway === 'no') count = total;
    else count = direction === 'forward' ? Math.ceil(total / 2) : Math.floor(total / 2);
  }
  count ??= busway === 'lane' ? 1 : 0;
  if (count > lanes.length) inferred.push('lanes:bus');
  return lanes.map((lane, i) =>
    (drivingSide === 'right' ? i >= lanes.length - count : i < count)
      ? { ...lane, allowed: ['bus'] }
      : lane,
  );
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
  const widthM = defaultLaneWidth(roadClass);
  // TASK-233 (TASK-216 D6): a two-way way tagged `lanes=1` is one carriageway that oncoming cars
  // share, drawn without a centre line (`marking-geometry.ts`). Each direction keeps its default
  // width: TASK-231's 4.5 m (RASt 06, a car meeting a lorry) narrowed Freiburg's promenade, whose
  // ground is about 10 m, and moved its traffic (the gate +14.5 s).
  const shared =
    directions.length === 2 && total === 1 && forward === undefined && backward === undefined;

  const specs = directions.map((direction) => {
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
    if (shared) inferred.push('sharedLane');
    const access = roadAccess(tag, direction, inferred);
    return {
      ...(access && { access }),
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

  // TASK-242 (TASK-216 D3, D9; TASK-218's variant): tagged widths. `width:lanes` (per direction
  // on a two-way way) gives each lane's width when it lists every lane within bounds; otherwise
  // `width` (or `width:carriageway`), the carriageway's, is shared evenly by the lanes of both
  // directions where the way tags no street parking. Estimated widths (`source:width=estimated`)
  // are not read: Freiburg's run 1 to 3 m under the aerial imagery on five-lane roads
  // (Bismarckallee `r:1171`, 14.5 m tagged against 17.5 m).
  const bounds = taggedLaneBounds(roadClass);
  const estimated = tag['source:width'] === 'estimated';
  const inBounds = (w: number | undefined): w is number =>
    !estimated && w !== undefined && w >= bounds.min && w <= bounds.max;
  const lanesInAll = specs.reduce((n, { lanes }) => n + lanes.length, 0);
  const carriageway = noStreetParking(tag)
    ? metres(tag.width ?? tag['width:carriageway'])
    : undefined;
  const even =
    carriageway !== undefined && inBounds(carriageway / lanesInAll)
      ? carriageway / lanesInAll
      : undefined;
  return specs.map((spec) => {
    const raw =
      tag[`width:lanes:${spec.direction}`] ??
      (directions.length === 1 ? tag['width:lanes'] : undefined);
    const listed = raw?.split('|').map(metres);
    const widths =
      listed?.length === spec.lanes.length && listed.every(inBounds) ? listed : undefined;
    if (!widths && even === undefined) return spec;
    return {
      ...spec,
      lanes: spec.lanes.map((lane, i) => ({ ...lane, widthM: widths?.[i] ?? even! })),
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
  return specs.map(
    ({
      direction,
      turnLanes,
      lanes: sourceLanes,
      speedLimitMps,
      provenance: sourceProvenance,
      access,
    }) => {
      const inferred = [...sourceProvenance.inferred];
      const lanes = busLanes(sourceLanes, way.tag, direction, paired, city.drivingSide, inferred);
      const provenance = { ...sourceProvenance, inferred: [...new Set(inferred)] };
      const reversed = direction === 'backward';
      const sidewalk = sidewalkTags(way.tag, reversed);
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
          ? ((city.drivingSide === 'right' ? 1 : -1) *
              lanes.reduce((width, lane) => width + lane.widthM, 0)) /
            2
          : 0,
        lanes,
        speedLimitMps,
        ...(access && { access }),
        ...(sidewalk && { sidewalk }),
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
    },
  );
}
