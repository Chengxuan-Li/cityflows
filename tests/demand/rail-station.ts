import type { Vec2 } from '../../src/geo/vec2';
import { generated } from '../../src/fixtures/build-city';
import { station } from '../../src/fixtures/station';
import type { Place } from '../../src/schema';
import type { RailNetwork } from '../../src/schema/rail';

// TASK-128: S-Bahn riders get off at a station, walk out of its entrances to a place nearby and
// walk back later. T64's synthetic rail city, laid north of the Station fixture's station: the
// southern track (row 1) serves the platform (S-Bahn), the northern one passes it (main line).
export function railStation() {
  const city = station();
  const rail: RailNetwork = { nodes: {}, tracks: {}, platforms: {} };
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const id = `rn:${row * 4 + i}`;
      rail.nodes[id] = { id, pos: { x: i * 400, y: -300 + row * 6 }, kind: 'plain', layer: 0 };
    }
    for (let i = 0; i < 3; i++) {
      const id = `rt:${row * 3 + i}`;
      const from = `rn:${row * 4 + i}`,
        to = `rn:${row * 4 + i + 1}`;
      rail.tracks[id] = {
        id,
        from,
        to,
        line: [rail.nodes[from]!.pos, rail.nodes[to]!.pos],
        kind: 'rail',
        layer: 0,
      };
    }
  }
  const stationPlace = Object.values(city.places).find((p) => p.kind === 'station')!;
  rail.platforms['rp:1'] = {
    id: 'rp:1',
    shape: {
      kind: 'line',
      line: [
        { x: 450, y: -291 },
        { x: 650, y: -291 },
      ],
    },
    name: 'Central',
    station: stationPlace.id,
    mode: 'rail',
    layer: 0,
    tracks: ['rt:4'],
  };
  city.rail = rail;
  const entrances = Object.values(city.walk!.nodes)
    .filter((n) => n.entrance?.placeId === stationPlace.id)
    .map((n) => n.id);
  stationPlace.station = { platforms: ['rp:1'], entrances };
  const add = (name: string, kind: Place['kind'], pos: Vec2, jobs: number, attraction: number) => {
    const id = `p:${city.nextId++}`;
    city.places[id] = {
      id,
      name,
      kind,
      shape: { kind: 'point', pos },
      population: 0,
      jobs,
      attraction,
      capacity: null,
      connectors: [],
      profile: null,
      events: [],
      provenance: generated,
    };
    return city.places[id]!;
  };
  const offices = add('Offices', 'work', { x: 640, y: 30 }, 400, 0);
  const shops = add('Shops', 'retail', { x: 300, y: 30 }, 0, 20);
  const far = add('Far offices', 'work', { x: 600, y: 1600 }, 100_000, 100_000);
  return { city, station: stationPlace, offices, shops, far };
}
