import type { Vec2 } from '../geo/vec2';
import { allocateId, type City } from '../schema';
import type { Airport, AirsideEdge, AirsideNode, RunwayEnd, StandKind } from '../schema/airport';
import { buildCity, generated } from './build-city';

function rectangle(left: number, top: number, right: number, bottom: number): Vec2[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export function syntheticAirport(seed = 1, layout: 'parallel' | 'backtrack' = 'parallel'): City {
  const name = layout === 'parallel' ? 'Synthetic airport' : 'Synthetic airport (backtrack)';
  const { city, node, road, place } = buildCity(name, seed);
  const accessLoop = rectangle(1225, 552, 1525, 645).map(({ x, y }) => node(x, y));
  const [frontage] = accessLoop.map((from, i) => {
    const to = accessLoop[(i + 1) % accessLoop.length]!;
    const segment = road(from, to, { roadClass: 'service', speedKmh: 30 });
    segment.name = 'Terminal Road';
    return segment;
  });
  place('Terminal', 'airport', { x: 1355, y: 501 }, [
    { road: frontage!, direction: 'in', positionM: 130 },
    { road: frontage!, direction: 'out', positionM: 115 },
  ]);
  const parkingId = allocateId(city, 'pk');
  city.parking = {
    [parkingId]: {
      id: parkingId,
      kind: 'lot',
      name: 'Terminal car park',
      access: 'public',
      capacity: 36,
      placeId: Object.keys(city.places)[0]!,
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: frontage!.id,
          lane: 0,
          positionM: 190,
          direction: 'both',
          throughputPerMin: 12,
        },
      ],
      shape: { kind: 'polygon', ring: rectangle(1340, 570, 1490, 625) },
      provenance: { ...generated, inferred: ['driveway'] },
    },
  };

  const hangarRing = rectangle(1920, 460, 2090, 528);
  const airport: Airport = {
    name,
    boundary: [rectangle(-100, -100, 2900, 680)],
    nodes: {},
    edges: {},
    runways: {},
    holdingPositions: {},
    stands: {},
    gates: {},
    terminals: {},
    helipads: {},
    surfaces: [
      { kind: 'apron', name: 'Remote apron', rings: [rectangle(620, 280, 875, 460)] },
      { kind: 'apron', name: 'Terminal apron', rings: [rectangle(875, 250, 1820, 460)] },
      { kind: 'apron', name: 'Hangar apron', rings: [rectangle(1820, 280, 2190, 460)] },
    ],
    hangars: [{ name: 'Maintenance hangar', ref: 'M', rings: [hangarRing] }],
    windsocks: [],
    approachAids: [],
    turnPads: [],
    roadCrossings: [],
  };
  city.airport = airport;

  function airNode(x: number, y: number): AirsideNode {
    const id = allocateId(city, 'an');
    return (airport.nodes[id] = { id, pos: { x, y }, layer: 0, provenance: generated });
  }

  function edge(
    from: AirsideNode,
    to: AirsideNode,
    kind: AirsideEdge['kind'],
    ref: string,
    maxCode: 'C' | 'E',
  ): AirsideEdge {
    const id = allocateId(city, 'ae');
    return (airport.edges[id] = {
      id,
      from: from.id,
      to: to.id,
      kind,
      ref,
      line: [from.pos, to.pos],
      widthM: kind === 'runway' ? 45 : maxCode === 'E' ? 23 : 15,
      maxCode,
      layer: 0,
      surface: 'asphalt',
      provenance: generated,
    });
  }

  const lengthM = 2800;
  const midfieldX = 1400;
  const runwayId = allocateId(city, 'rw');
  const runwayNodes = (
    layout === 'parallel' ? [0, 800, 2000, lengthM] : [0, midfieldX, lengthM]
  ).map((x) => airNode(x, 0));
  function runwayEnd({ id, pos }: AirsideNode, designator: string, heading: number): RunwayEnd {
    return { designator, node: id, pos, threshold: { node: id, pos }, displacedM: 0, heading };
  }
  const west = runwayNodes[0]!;
  const east = runwayNodes.at(-1)!;
  airport.runways[runwayId] = {
    id: runwayId,
    ref: '09/27',
    ends: [runwayEnd(west, '09', 0), runwayEnd(east, '27', Math.PI)],
    edges: runwayNodes.slice(1).map((to, i) => {
      const segment = edge(runwayNodes[i]!, to, 'runway', '09/27', 'E');
      segment.runway = runwayId;
      return segment.id;
    }),
    lengthM,
    widthM: 45,
    surface: 'asphalt',
    maxCode: 'E',
    stopways: [],
    osmIds: [],
    provenance: generated,
  };

  function runwayEntry(from: AirsideNode, to: AirsideNode, ref: string) {
    const holdY = 100;
    const hold = airNode(from.pos.x + ((to.pos.x - from.pos.x) * holdY) / to.pos.y, holdY);
    const toward = edge(from, hold, 'taxiway', ref, 'E');
    edge(hold, to, 'taxiway', ref, 'E');
    const id = allocateId(city, 'hp');
    airport.holdingPositions[id] = {
      id,
      node: hold.id,
      ref,
      kind: 'runway',
      runway: runwayId,
      side: 'right',
      toward: toward.id,
      provenance: generated,
    };
  }

  const apronY = 320;
  const apronEntry = airNode(midfieldX, apronY);
  if (layout === 'parallel') {
    const parallel = [0, 510, midfieldX, 2290, lengthM].map((x) => airNode(x, 180));
    for (const [i, to] of parallel.slice(1).entries()) edge(parallel[i]!, to, 'taxiway', 'A', 'E');
    // The two angled exits continue in the landing direction, one for each runway end.
    for (const [i, parallelIndex] of [0, 1, 3, 4].entries())
      runwayEntry(runwayNodes[i]!, parallel[parallelIndex]!, `A${i + 1}`);
    edge(parallel[2]!, apronEntry, 'taxiway', 'B', 'E');
  } else {
    runwayEntry(runwayNodes[1]!, apronEntry, 'B');
    const westPad = [
      { x: -55, y: -22.5 },
      { x: 170, y: -22.5 },
      { x: 115, y: 22.5 },
      { x: 50, y: 92 },
      { x: -55, y: 92 },
    ];
    const eastPad = westPad.map(({ x, y }) => ({ x: lengthM - x, y })).reverse();
    airport.turnPads.push({ pos: west.pos, node: west.id }, { pos: east.pos, node: east.id });
    airport.surfaces.push(
      { kind: 'turn_pad', ref: '09', rings: [westPad] },
      { kind: 'turn_pad', ref: '27', rings: [eastPad] },
    );
  }

  const terminal = allocateId(city, 'tm');
  const terminalRing = rectangle(875, 460, 1815, 530);
  airport.terminals[terminal] = { id: terminal, name: 'Terminal', rings: [terminalRing], group: 0 };
  city.context = {
    features: [
      { sub: 'terminal', ring: terminalRing, heightM: 14 },
      { sub: 'hangar', ring: hangarRing, heightM: 12 },
    ].map(({ sub, ring, heightM }) => ({
      kind: 'area',
      class: 'building',
      sub,
      rings: [[...ring, ring[0]!]],
      heightM,
    })),
  };

  function stand(from: AirsideNode, ref: string, kind: StandKind, maxCode: 'C' | 'E') {
    const id = allocateId(city, 'st');
    const to = airNode(from.pos.x, 449);
    const leadIn = edge(from, to, 'lead_in', ref, maxCode);
    leadIn.stand = id;
    const gate = kind === 'contact' ? allocateId(city, 'gt') : null;
    if (gate) airport.gates[gate] = { id: gate, ref, pos: { x: to.pos.x, y: 460 }, terminal };
    airport.stands[id] = {
      id,
      ref,
      kind,
      maxCode,
      pos: to.pos,
      heading: Math.PI / 2,
      leadIn: [leadIn.id],
      gate,
      osmIds: [],
      provenance: generated,
    };
  }

  function apronLane(
    kind: 'taxiway' | 'taxilane',
    ref: string,
    maxCode: 'C' | 'E',
    stops: [number, string, StandKind, 'C' | 'E'][],
  ) {
    let previous = apronEntry;
    for (const [x, standRef, standKind, standCode] of stops) {
      const root = airNode(x, apronY);
      edge(previous, root, kind, ref, maxCode);
      stand(root, standRef, standKind, standCode);
      previous = root;
    }
  }
  apronLane('taxiway', 'C', 'E', [
    [1140, '3', 'contact', 'E'],
    [1050, '2', 'contact', 'E'],
    [960, '1', 'contact', 'E'],
    [765, 'R2', 'remote', 'C'],
    [675, 'R1', 'remote', 'C'],
  ]);
  apronLane('taxilane', 'T', 'C', [
    [1600, '4', 'contact', 'C'],
    [1660, '5', 'contact', 'C'],
    [1720, '6', 'contact', 'C'],
    [2000, 'M1', 'maintenance', 'C'],
  ]);

  const helipad = allocateId(city, 'hl');
  const helipadRing = rectangle(2131, 376, 2159, 404);
  airport.helipads[helipad] = {
    id: helipad,
    ref: 'H1',
    pos: { x: 2145, y: 390 },
    ring: helipadRing,
  };
  airport.surfaces.push({ kind: 'helipad', ref: 'H1', rings: [helipadRing] });
  return city;
}

export function syntheticAirportBacktrack(seed = 1): City {
  return syntheticAirport(seed, 'backtrack');
}
