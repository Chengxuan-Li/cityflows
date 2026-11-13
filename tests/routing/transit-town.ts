import { town } from '../../src/fixtures/town';
import type { Vec2 } from '../../src/geo/vec2';
import type { City } from '../../src/schema';
import type { RailNetwork } from '../../src/schema/rail';

// TASK-174: the Town with two synthetic tram lines on its arterials, each one track that trams run
// both ways (TASK-138's service). Line A runs west to east along y = 400 past West Park, North
// Gardens and Orchard; line B north to south along x = 1200 past Market Offices and Foundry. They
// cross at (1200, 400) without sharing a node; their stops there are a short walk apart.
export function transitTown(): City {
  const city = town();
  const rail: RailNetwork = { nodes: {}, tracks: {}, platforms: {}, tramStops: {} };
  const line = (name: string, from: Vec2, to: Vec2, stops: [string, Vec2][]) => {
    const [a, b, t] = [`rn:${name}0`, `rn:${name}1`, `rt:${name}`];
    rail.nodes[a] = { id: a, pos: from, layer: 0, kind: 'plain' };
    rail.nodes[b] = { id: b, pos: to, layer: 0, kind: 'plain' };
    rail.tracks[t] = { id: t, from: a, to: b, line: [from, to], kind: 'tram', layer: 0 };
    stops.forEach(([stop, pos], i) => {
      const id = `ts:${name}${i}`;
      rail.tramStops![id] = {
        id,
        name: stop,
        lines: [name],
        layer: 0,
        tracks: [t],
        halts: [{ track: t, pos }],
        platform: null,
        osmIds: [],
      };
    });
  };
  line('A', { x: 0, y: 400 }, { x: 1700, y: 400 }, [
    ['West Park', { x: 200, y: 400 }],
    ['North Gardens', { x: 650, y: 400 }],
    ['Orchard', { x: 1000, y: 400 }],
    ['Crossway', { x: 1150, y: 400 }],
  ]);
  line('B', { x: 1200, y: 0 }, { x: 1200, y: 1700 }, [
    ['Crossway', { x: 1200, y: 450 }],
    ['Market Offices', { x: 1200, y: 750 }],
    ['Foundry', { x: 1200, y: 1150 }],
  ]);
  city.rail = rail;
  return city;
}

export const townPlace = (city: City, name: string) =>
  Object.values(city.places).find((p) => p.name === name)!;
