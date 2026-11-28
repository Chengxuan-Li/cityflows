import { offsetPolyline } from '../../geo/polyline';
import type { Diagnostic } from '../../network';
import { PLACEMENT_TRANSITION } from '../../network/lanes';
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
export const defaultLaneWidth = (roadClass: RoadClass) =>
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
  // TASK-271 (TASK-259 D6, TASK-197 finding 8): a building passage or a covered street runs at
  // grade under a roof, not underground; only a tagged `layer` puts it elsewhere.
  if (tag.tunnel !== undefined && !['no', 'building_passage'].includes(tag.tunnel)) return -1;
  return 0;
}

const restricted = (value: string | undefined) =>
  value === 'no_parking' || value === 'no_stopping' || value === 'no_standing';

/**
 * TASK-276 (D8): the UK yellow lines along a way's kerb, read from its street parking tags (the
 * `parking:<side>` scheme and the older `parking:lane` and `parking:condition` one, a side's own
 * key before `both`). Waiting restricted at stated times only (a `:conditional` restriction, or
 * an old-scheme condition with a `time_interval`) is a single line; parking forbidden outright
 * (`no_parking`, `no_stopping`, `no_standing`, or `parking:<side>=no`: on a UK street a kerb
 * without parking is a restricted one) is a double line; any other kerb has none. Recorded on the
 * directed road as `kerbLine:<left|right>:<single|double>`, sides in travel direction, for a UK
 * import only (other themes draw no kerb restrictions, and their imports stay as they were).
 */
export function kerbLines(tag: OsmTags, reversed: boolean): string[] {
  return (['left', 'right'] as const).flatMap((side) => {
    const key = (pattern: (s: string) => string) => tag[pattern(side)] ?? tag[pattern('both')];
    const parking = key((s) => `parking:${s}`);
    const restriction = key((s) => `parking:${s}:restriction`);
    const conditional = key((s) => `parking:${s}:restriction:conditional`);
    const lane = key((s) => `parking:lane:${s}`);
    const condition = key((s) => `parking:condition:${s}`);
    const interval = key((s) => `parking:condition:${s}:time_interval`);
    const always =
      restricted(restriction) ||
      restricted(condition) ||
      (parking === 'no' && restriction === undefined) ||
      lane === 'no' ||
      lane === 'fire_lane' ||
      restricted(lane);
    const timed =
      /\bno_(parking|stopping|standing)\s*@/.test(conditional ?? '') ||
      (always && conditional !== undefined) ||
      (restricted(condition) && interval !== undefined);
    if (!timed && !always) return [];
    const travel = reversed ? (side === 'left' ? 'right' : 'left') : side;
    return [`kerbLine:${travel}:${timed ? 'single' : 'double'}`];
  });
}

// The class keys are looked up through vehicleClasses; adding van there enables goods.
const classTags: Record<string, string[]> = { van: ['goods'], truck: ['hgv'], bus: ['psv', 'bus'] };

const accessValue = (raw: string): AccessValue | undefined =>
  raw === 'yes' || raw === 'permissive' || raw === 'designated'
    ? 'yes'
    : raw === 'no' || raw === 'destination' || raw === 'delivery' || raw === 'private'
      ? raw
      : raw === 'customers'
        ? 'private'
        : undefined;

/** Splits on `separator` outside parentheses. */
const splitTop = (text: string, separator: string) => {
  const parts = [''];
  let depth = 0;
  for (const char of text) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if (char === separator && depth === 0) parts.push('');
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim());
};
/** Drops the parentheses round the whole text, as in `(08:00-10:30, 17:00-18:00)`. */
const unwrap = (text: string) => {
  let depth = 0;
  for (const [i, char] of [...text].entries()) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if (depth === 0) return i === text.length - 1 && i > 0 ? text.slice(1, -1).trim() : text;
  }
  return text;
};

const dayStartMin = 7 * 60;
const dayMinutes = 12 * 60;
const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** The minutes of the simulated day (07:00 to 19:00, a working day) an opening-hours time
 * condition (`Mo-Sa 08:00-18:00`, `08:00-10:30, 17:00-18:00; 18:00-08:00`) covers, or
 * undefined for any other condition (dates, holidays, occupancy). */
function conditionMinutes(text: string): boolean[] | undefined {
  const minutes = new Array<boolean>(dayMinutes).fill(false);
  for (const rule of unwrap(text)
    .split(';')
    .map((r) => r.trim())) {
    const match = /^(?:([A-Z][a-z](?:-[A-Z][a-z])?(?:,[A-Z][a-z](?:-[A-Z][a-z])?)*)\s+)?(.+)$/.exec(
      rule,
    )!;
    const days = match[1]
      ?.split(',')
      .map((range) => range.split('-').map((d) => weekdays.indexOf(d)));
    if (days?.flat().includes(-1)) return undefined;
    const working = !days || days.some(([a, b = a]) => a! <= 4 || b! < a! || b! <= 4);
    for (const range of match[2]!.split(',')) {
      const time = /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/.exec(range.trim());
      if (!time) return undefined;
      const from = Number(time[1]) * 60 + Number(time[2] ?? 0);
      const to = Number(time[3]) * 60 + Number(time[4] ?? 0);
      if (!working) continue;
      for (let i = 0; i < dayMinutes; i++) {
        const at = dayStartMin + i;
        if (from <= to ? at >= from && at < to : at >= from || at < to) minutes[i] = true;
      }
    }
  }
  return minutes;
}

/**
 * TASK-271 (TASK-259 D12): a `*:conditional` access tag read into the schema's single value per
 * road. Each minute of 07:00 to 19:00 takes the last time condition holding then (else `base`);
 * the road takes the value of most minutes (ties to the stricter). A road closed for most of the
 * day that admits deliveries in some of it (`delivery @ (08:00-10:30); no @ (10:30-17:00)`, or
 * `yes @ (10:00-16:00 AND loading)`) reads as `delivery`. Conditions on anything but the time of
 * day and the delivery purpose (dates, holidays, occupancy, hotel guests) are not read.
 */
function conditionalAccess(raw: string, base: AccessValue): AccessValue {
  const general = new Array<AccessValue>(dayMinutes).fill(base);
  let deliveries = false;
  for (const item of splitTop(raw, ';')) {
    const at = item.indexOf('@');
    const value = at < 0 ? undefined : accessValue(item.slice(0, at).trim());
    if (!value) continue;
    for (const alternative of splitTop(unwrap(item.slice(at + 1).trim()), ';')) {
      const parts = alternative.split(/\s+AND\s+/).map((part) => unwrap(part.trim()));
      const purpose = parts.some((part) => part === 'delivery' || part === 'loading');
      const times = parts.filter((part) => part !== 'delivery' && part !== 'loading');
      const minutes = times.map(conditionMinutes);
      if (minutes.includes(undefined)) continue;
      for (let i = 0; i < dayMinutes; i++) {
        if (!minutes.every((m) => m![i])) continue;
        if (!purpose) general[i] = value;
        else if (value !== 'no') deliveries = true;
      }
    }
  }
  const order: AccessValue[] = ['no', 'delivery', 'private', 'destination', 'yes'];
  const count = (value: AccessValue) => general.filter((v) => v === value).length;
  const most = order.reduce((best, value) => (count(value) > count(best) ? value : best));
  return most === 'no' && (deliveries || general.includes('delivery')) ? 'delivery' : most;
}

function roadAccess(tag: OsmTags, direction: string, inferred: string[]): Road['access'] {
  const access: NonNullable<Road['access']> = {};
  const keyFor = (key: string) =>
    tag[`${key}:${direction}`] !== undefined ? `${key}:${direction}` : key;
  const value = (key: string): AccessValue => {
    const read = accessValue(tag[key]!);
    if (!read) inferred.push(key);
    return read ?? 'yes';
  };
  const conditional = (key: string, base: AccessValue) => {
    const raw = tag[`${key}:${direction}:conditional`] ?? tag[`${key}:conditional`];
    return raw === undefined ? base : conditionalAccess(raw, base);
  };
  for (const key of ['access', 'vehicle', 'motor_vehicle', 'motorcar']) {
    if (tag[keyFor(key)] !== undefined) access.all = value(keyFor(key));
    const base = access.all ?? 'yes';
    const read = conditional(key, base);
    if (read !== base) access.all = read;
  }
  for (const kind of vehicleClasses)
    for (const key of classTags[kind] ?? []) {
      if (tag[keyFor(key)] !== undefined) access[kind] = value(keyFor(key));
      const base = access[kind] ?? access.all ?? 'yes';
      const read = conditional(key, base);
      if (read !== base) access[kind] = read;
    }

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
  // TASK-271 (TASK-259 D12, D18): `faux` signs a two-way street as one-way at one end;
  // `alternating` passes one direction at a time over one lane, read as two directions sharing
  // it (the schema has no alternation: both directions may pass at once).
  const supportedOneway = [
    'yes',
    'no',
    '1',
    '0',
    'true',
    'false',
    '-1',
    'faux',
    'alternating',
  ].includes(oneway ?? '');
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
    directions.length === 2 &&
    ((total === 1 && forward === undefined && backward === undefined) || oneway === 'alternating');

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
    if (directions.length === 1 && tag.placement === 'transition')
      inferred.push(PLACEMENT_TRANSITION);
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
      const reversed = direction === 'backward';
      if (city.markingTheme === 'uk') inferred.push(...kerbLines(way.tag, reversed));
      const provenance = { ...sourceProvenance, inferred: [...new Set(inferred)] };
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
