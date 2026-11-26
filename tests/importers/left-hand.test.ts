import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';

// TASK-268: left-hand traffic from the location (D11) and its signal programs (D3).

/** A signalised crossroads of two-way residential streets, about 145 m arms, at `lat`, `lon`. */
function crossroads(lat: number, lon: number, tags = '') {
  const dLat = 0.0013;
  const dLon = 0.0013 / Math.cos((lat * Math.PI) / 180);
  const nodes = [
    [1, lat, lon, '<tag k="highway" v="traffic_signals"/>'],
    [2, lat + dLat, lon, ''],
    [3, lat, lon + dLon, ''],
    [4, lat - dLat, lon, ''],
    [5, lat, lon - dLon, ''],
  ] as const;
  const way = (id: number, a: number, b: number, name: string) =>
    `<way id="${id}"><nd ref="${a}"/><nd ref="${b}"/><tag k="highway" v="residential"/><tag k="name" v="${name}"/></way>`;
  return `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${nodes
    .map(([id, la, lo, tag]) => `<node id="${id}" lat="${la}" lon="${lo}">${tag}</node>`)
    .join('')}${way(10, 2, 1, 'North')}${way(11, 1, 4, 'South')}${way(12, 3, 1, 'East')}${way(
    13,
    1,
    5,
    'West',
  )}${tags}</osm>`;
}
const york = [53.96, -1.08] as const;
const munich = [48.14, 11.53] as const;

function imported(xml: string, drivingSide?: City['drivingSide']): City {
  const result = importOsm(xml, { importerVersion: 'test', ...(drivingSide && { drivingSide }) });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-3)));
  return result.city;
}

test.each([
  ['York, by location', crossroads(...york), undefined, 'left'],
  ['Munich, by location', crossroads(...munich), undefined, 'right'],
  ['Philadelphia, by location', crossroads(39.95, -75.165), undefined, 'right'],
  [
    'Munich tagged GB',
    crossroads(...munich, '<relation id="9"><tag k="addr:country" v="GB"/></relation>'),
    undefined,
    'left',
  ],
  [
    'York tagged DE',
    crossroads(...york, '<relation id="9"><tag k="addr:country" v="DE"/></relation>'),
    undefined,
    'right',
  ],
  ['York, set right', crossroads(...york), 'right', 'right'],
  ['Munich, set left', crossroads(...munich), 'left', 'left'],
] as const)(
  'D11: the driving side follows the marking theme unless set (%s)',
  (_, xml, set, side) => {
    const city = imported(xml, set);
    expect(city.drivingSide).toBe(side);
    if (set === undefined) expect(city.markingTheme === 'uk').toBe(side === 'left');
  },
);

/** The turn of each green group in the signal's 15 s (protected turn) phases. */
function protectedTurns(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const { compiled } = result;
  const signal = Object.values(city.nodes).find((n) => n.control === 'signal')!;
  const movements = compiled.nodes[compiled.index.node.get(signal.id)!]!.movements.map(
    (m) => compiled.movements[m]!,
  );
  const road = (lane: number) => compiled.roads[compiled.lanes[lane]!.road]!.id;
  const turn = (from: string, to: string) =>
    movements.find((m) => road(m.fromLane) === from && road(m.toLane) === to)!.turn;
  const turns = (protect: boolean) =>
    signal
      .signal!.phases.filter((phase) => (phase.durationS === 15) === protect)
      .flatMap((phase) => phase.groups.map(({ from, to }) => turn(from, to)));
  return { protected: turns(true), others: turns(false) };
}

test.each([
  ['right', 'left', 'right'],
  ['left', 'right', 'left'],
] as const)(
  'D3: a four-arm signal under %s-hand traffic protects the far-side %s turns',
  (side, far, near) => {
    const turns = protectedTurns(imported(crossroads(...york), side));
    expect(turns.protected.length).toBe(4);
    expect(new Set(turns.protected)).toEqual(new Set([far]));
    expect(turns.others).not.toContain(far);
    expect(turns.others.filter((t) => t === near)).toHaveLength(4);
  },
);
