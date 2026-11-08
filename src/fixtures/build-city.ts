import { createRandom } from '../geo/random';
import type { Vec2 } from '../geo/vec2';
import {
  allocateId,
  type City,
  type Connector,
  type Node,
  type PlaceKind,
  type Provenance,
  type Road,
} from '../schema';

export const generated: Provenance = { source: 'generated' };

export function buildCity(name: string, seed: number) {
  const random = createRandom(seed);
  const city: City = {
    schemaVersion: 3,
    version: 0,
    name,
    drivingSide: 'right',
    geo: null,
    nodes: {},
    roads: {},
    places: {},
    nextId: 1,
  };

  function node(x: number, y: number, layer = 0): Node {
    const id = allocateId(city, 'n');
    return (city.nodes[id] = {
      id,
      pos: { x, y },
      layer,
      control: 'uncontrolled',
      minorRoads: [],
      turnRules: [],
      signal: null,
      provenance: generated,
    });
  }

  function road(
    from: Node,
    to: Node,
    options: {
      lanes?: number;
      roadClass?: Road['roadClass'];
      speedKmh?: number;
      streetGroupId?: string;
      via?: Vec2[];
    } = {},
  ): Road {
    const {
      lanes = 1,
      roadClass = 'residential',
      speedKmh = 50,
      streetGroupId = null,
      via = [],
    } = options;
    const id = allocateId(city, 'r');
    const widthM = roadClass === 'residential' ? 3 : 3.5;
    return (city.roads[id] = {
      id,
      from: from.id,
      to: to.id,
      centerline: [from.pos, ...via, to.pos],
      lateralOffsetM: streetGroupId === null ? 0 : (lanes * widthM) / 2,
      lanes: Array.from({ length: lanes }, () => ({
        widthM,
        allowed: ['car', 'van', 'truck', 'bus'],
      })),
      roadClass,
      speedLimitMps: speedKmh / 3.6,
      name: null,
      streetGroupId,
      provenance: generated,
    });
  }

  function street(a: Node, b: Node, lanes = 1): [Road, Road] {
    const streetGroupId = `street:${a.id}:${b.id}`;
    return [road(a, b, { lanes, streetGroupId }), road(b, a, { lanes, streetGroupId })];
  }

  function place(
    name: string,
    kind: PlaceKind,
    pos: Vec2,
    links: { road: Road; direction: Connector['direction']; lane?: number; positionM?: number }[],
  ) {
    const id = allocateId(city, 'p');
    city.places[id] = {
      id,
      name,
      kind,
      shape: { kind: 'point', pos },
      // Enough commuters that the morning peak overloads the central signal and queues form.
      population: kind === 'residential' ? 900 + Math.floor(random.uniform(0, 301)) : 0,
      jobs: kind === 'work' ? 1200 : 0,
      attraction: 1,
      capacity: null,
      profile: null,
      events: [],
      provenance: generated,
      connectors: links.map(({ road, direction, lane = 0, positionM = 5 }) => ({
        id: allocateId(city, 'c'),
        roadId: road.id,
        lane,
        positionM,
        direction,
        throughputPerMin: 30,
      })),
    };
  }

  function signal(center: Node, arms: [Road, Road][]) {
    center.control = 'signal';
    center.signal = {
      offsetS: 0,
      amberS: 3,
      allRedS: 1,
      phases: arms.map(([incoming], i) => ({
        durationS: 25,
        groups: arms.flatMap(([, outgoing], j) =>
          i === j ? [] : [{ from: incoming.id, to: outgoing.id }],
        ),
      })),
    };
  }

  return { city, node, road, street, place, signal };
}
