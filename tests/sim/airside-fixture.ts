import { buildCity } from '../../src/fixtures/build-city';
import type { Vec2 } from '../../src/geo/vec2';
import type { AircraftCode } from '../../src/schema/aircraft';
import type { Airport, AirsideEdge, StandKind } from '../../src/schema/airport';

// TASK-298: a small inline airport (local frame, x east, y south). Runway 09/27 runs 3 km along
// y = 0, 45 m wide, code E; a parallel taxiway at y = 200 meets it by perpendicular connectors
// with holding positions 100 m from the centreline. Between x = -1000 and -300 the parallel
// taxiway is code C, with a code E loop at y = 400 round it; a north-south link at x = -600
// crosses the loop. Four stands south of the taxiway (two code E, two code C), two on the loop
// and a remote one at the end of the link. `backtrack`: the 27 end's connector is 100 m in
// instead (departures from 27 backtrack). `road`: a two-way service road crossing the link at
// y = 300. `hook` (TASK-320): a stand K whose lead-in runs 45 m south from the taxiway at x = 700
// and turns back 25 m to the north-west, as London City's stands do, on an apron with an apron
// service road (closed to cars) along y = 250 behind it. `far` (TASK-363): a code E stand J south
// of the taxiway at x = 1000, east of K, reached from the runway's exits along the taxiway past K.

const generated = { source: 'generated' as const };

export function airportFixture({
  backtrack = false,
  road = false,
  hook = false,
  far = false,
  intersectionX,
}: {
  backtrack?: boolean;
  road?: boolean;
  hook?: boolean;
  far?: boolean;
  intersectionX?: number;
} = {}) {
  const { city, node, road: addRoad, place } = buildCity('Inline airport', 298);
  const airport: Airport = {
    name: 'Inline',
    icao: 'XXXX',
    nodes: {},
    edges: {},
    runways: {},
    holdingPositions: {},
    stands: {},
    gates: {},
    terminals: {},
    helipads: {},
    surfaces: [],
    hangars: [],
    windsocks: [],
    approachAids: [],
    turnPads: [],
    roadCrossings: [],
  };
  let next = 1;
  const at = new Map<string, string>();
  const nodeAt = (p: Vec2) => {
    const key = `${p.x},${p.y}`;
    let id = at.get(key);
    if (!id) {
      id = `an:${next++}`;
      at.set(key, id);
      airport.nodes[id] = { id, pos: p, layer: 0, provenance: generated };
    }
    return id;
  };
  const edge = (
    kind: AirsideEdge['kind'],
    points: Vec2[],
    maxCode: AircraftCode,
    extra: Partial<AirsideEdge> = {},
  ) => {
    const id = `ae:${next++}`;
    airport.edges[id] = {
      id,
      from: nodeAt(points[0]!),
      to: nodeAt(points.at(-1)!),
      line: points,
      kind,
      layer: 0,
      widthM: kind === 'runway' ? 45 : 23,
      maxCode,
      provenance: generated,
      ...extra,
    };
    return id;
  };
  const p = (x: number, y: number) => ({ x, y });
  // Runway nodes from the 09 end; connectors at each.
  const runwayXs = [-1500, -900, -300, 300, 1400, 1500];
  const runwayEdges = runwayXs
    .slice(1)
    .map((x, i) => edge('runway', [p(runwayXs[i]!, 0), p(x, 0)], 'E', { runway: 'rw:1' }));
  const connectorXs = [-1500, -900, -300, 300, backtrack ? 1400 : 1500];
  for (const x of connectorXs) {
    const toward = edge('taxiway', [p(x, 0), p(x, 100)], 'E');
    edge('taxiway', [p(x, 100), p(x, 200)], 'E');
    const id = `hp:${next++}`;
    airport.holdingPositions[id] = {
      id,
      node: nodeAt(p(x, 100)),
      kind: 'runway',
      runway: 'rw:1',
      side: 'right',
      toward,
      osmId: next,
      provenance: generated,
    };
  }
  // The parallel taxiway, split at every junction.
  const taxiXs = [-1500, -1000, -900, -800, -600, -300, -150, -50, 50, 150, 300];
  if (hook) taxiXs.push(700);
  if (far) taxiXs.push(1000);
  taxiXs.push(backtrack ? 1400 : 1500);
  for (let i = 1; i < taxiXs.length; i++) {
    const [a, b] = [taxiXs[i - 1]!, taxiXs[i]!];
    edge('taxiway', [p(a, 200), p(b, 200)], a >= -1000 && b <= -300 ? 'C' : 'E');
  }
  // The code E loop round the code C stretch, crossed by the link at x = -600.
  edge('taxiway', [p(-1000, 200), p(-1000, 400), p(-800, 400)], 'E');
  edge('taxiway', [p(-800, 400), p(-600, 400)], 'E');
  edge('taxiway', [p(-600, 400), p(-400, 400)], 'E');
  edge('taxiway', [p(-400, 400), p(-300, 400), p(-300, 200)], 'E');
  edge('taxiway', [p(-600, 200), p(-600, 300)], 'E');
  edge('taxiway', [p(-600, 300), p(-600, 400)], 'E');
  edge('taxiway', [p(-600, 400), p(-600, 500)], 'E');
  edge('taxiway', [p(-600, 500), p(-600, 650)], 'E');
  const stand = (
    ref: string,
    root: Vec2,
    stop: Vec2,
    code: AircraftCode,
    kind: StandKind,
    via: Vec2[] = [],
  ) => {
    const id = `st:${next++}`;
    const lead = edge('lead_in', [root, ...via, stop], code, { stand: id });
    const from = via.at(-1) ?? root;
    airport.stands[id] = {
      id,
      ref,
      kind,
      pos: stop,
      heading: Math.atan2(stop.y - from.y, stop.x - from.x),
      leadIn: [lead],
      gate: null,
      maxCode: code,
      osmIds: [],
      provenance: generated,
    };
    return id;
  };
  const stands = {
    E1: stand('E1', p(-150, 200), p(-150, 290), 'E', 'contact'),
    E2: stand('E2', p(-50, 200), p(-50, 290), 'E', 'contact'),
    C1: stand('C1', p(50, 200), p(50, 260), 'C', 'contact'),
    C2: stand('C2', p(150, 200), p(150, 260), 'C', 'contact'),
    L1: stand('L1', p(-800, 400), p(-800, 490), 'E', 'remote'),
    L2: stand('L2', p(-400, 400), p(-400, 490), 'E', 'remote'),
    R: stand('R', p(-600, 500), p(-510, 500), 'E', 'remote'),
    ...(hook
      ? {
          K: stand('K', p(700, 200), p(681.8, 227.9), 'C', 'remote', [p(700, 245)]),
        }
      : {}),
    ...(far ? { J: stand('J', p(1000, 200), p(1000, 290), 'E', 'contact') } : {}),
  };
  if (hook) {
    airport.surfaces.push({
      kind: 'apron',
      rings: [[p(620, 190), p(780, 190), p(780, 300), p(620, 300)]],
    });
    const west = node(600, 250),
      east = node(800, 250);
    for (const [a, b] of [
      [west, east],
      [east, west],
    ] as const)
      addRoad(a, b, { roadClass: 'service' }).access = { all: 'no' };
  }
  airport.runways['rw:1'] = {
    id: 'rw:1',
    ref: '09/27',
    ends: [
      {
        designator: '09',
        node: nodeAt(p(-1500, 0)),
        pos: p(-1500, 0),
        threshold: { node: nodeAt(p(-1500, 0)), pos: p(-1500, 0) },
        displacedM: 0,
        heading: 0,
      },
      {
        designator: '27',
        node: nodeAt(p(1500, 0)),
        pos: p(1500, 0),
        threshold: { node: nodeAt(p(1500, 0)), pos: p(1500, 0) },
        displacedM: 0,
        heading: Math.PI,
      },
    ],
    edges: runwayEdges,
    lengthM: 3000,
    widthM: 45,
    maxCode: 'E',
    stopways: [],
    osmIds: [],
    provenance: generated,
  };
  if (intersectionX !== undefined) {
    const x = intersectionX;
    const south = p(x, 1800);
    const north = p(x, -1400);
    const crossing = p(x, -800);
    const centre = p(x, 0);
    const end = (point: Vec2, designator: string, heading: number) => ({
      designator,
      node: nodeAt(point),
      pos: point,
      threshold: { node: nodeAt(point), pos: point },
      displacedM: 0,
      heading,
    });
    airport.runways['rw:2'] = {
      ...airport.runways['rw:1'],
      id: 'rw:2',
      ref: '36/18',
      ends: [end(south, '36', -Math.PI / 2), end(north, '18', Math.PI / 2)],
      edges: [
        edge('runway', [south, centre], 'E', { runway: 'rw:2' }),
        edge('runway', [centre, crossing], 'E', { runway: 'rw:2' }),
        edge('runway', [crossing, north], 'E', { runway: 'rw:2' }),
      ],
      lengthM: 3200,
    };
    const mouth = p(x, 2100);
    edge('taxiway', [mouth, south], 'E');
    edge('taxiway', [p(x, 2200), mouth], 'E');
    const west = p(x - 240, crossing.y);
    const east = p(x + 240, crossing.y);
    edge('taxiway', [west, crossing], 'E');
    edge('taxiway', [crossing, east], 'E');
    edge('taxiway', [p(west.x - 100, west.y), west], 'E');
    edge('taxiway', [east, p(east.x + 100, east.y)], 'E');
    Object.assign(stands, {
      South: stand('South', mouth, p(x + 90, mouth.y), 'E', 'contact'),
      West: stand('West', west, p(west.x, west.y + 90), 'E', 'contact'),
      East: stand('East', east, p(east.x, east.y + 90), 'E', 'contact'),
    });
  }
  airport.helipads['hl:1'] = { id: 'hl:1', pos: p(0, 700), ref: 'H', osmId: 1 };
  if (road) {
    // A service road across the link at y = 300, with homes and work at either end.
    const west = node(-880, 300),
      east = node(-400, 300);
    const forward = addRoad(west, east, { roadClass: 'service' }),
      backward = addRoad(east, west, { roadClass: 'service' });
    place('Homes', 'residential', p(-880, 315), [
      { road: forward, direction: 'out', positionM: 20 },
    ]);
    place('Work', 'work', p(-420, 315), [{ road: forward, direction: 'in', positionM: 460 }]);
    airport.roadCrossings.push({
      edge: Object.values(airport.edges).find((e) => e.line[0]!.x === -600 && e.line[0]!.y === 200)!
        .id,
      pos: p(-600, 300),
      roads: [forward.id, backward.id],
      roadOsmIds: [],
    });
  } else {
    const a = node(-1200, 900),
      b = node(-1000, 900);
    addRoad(a, b);
    addRoad(b, a);
  }
  city.airport = airport;
  return {
    city,
    stands: stands as typeof stands & Partial<Record<'South' | 'West' | 'East', string>>,
  };
}

/** TASK-360: runs `body` with the departure rules `rules` (the env T360, read when a fleet is
 * created: i intersection take-offs, r line-up behind a passing roll, m multiple line-ups; empty
 * for the line-up choice before them). */
export function withRules<T>(rules: string, body: () => T): T {
  const before = process.env.T360;
  process.env.T360 = rules;
  try {
    return body();
  } finally {
    if (before === undefined) delete process.env.T360;
    else process.env.T360 = before;
  }
}
