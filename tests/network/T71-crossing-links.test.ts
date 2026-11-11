import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { distance, segmentDistance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity, type CWalkLink } from '../../src/network';
import {
  crossingArms,
  crossingCentreM,
  crossingLine,
  crossingSpan,
  STOP_CLEAR_M,
} from '../../src/network/crossings';
import { walkSignalMarks } from '../../src/render/layers/walkers';
import type { City } from '../../src/schema';
import { osm } from '../importers/junction-group-osm';

// TASK-140 (B59): the stripes' centreline is the one position of a crossing: the walk link runs
// along it, the walk lights stand at its ends, the walker conflict zone (the link's spans) covers
// the stripes, and the stop line stays behind them.

function compiled(city: City): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.compiled;
}

/** Mapped walk nodes and links (OSM-like), a crossing way split where it meets the road. */
function mapped(
  city: City,
  points: Record<string, Vec2>,
  links: [string, string, 'footway' | 'crossing'][],
) {
  city.walk = { nodes: {}, links: {} };
  for (const [id, pos] of Object.entries(points))
    city.walk.nodes[id] = { id, pos, layer: 0, provenance: { source: 'osm' } };
  links.forEach(([from, to, kind], i) => {
    const id = `wl:${900 + i}`;
    city.walk!.links[id] = {
      id,
      from,
      to,
      line: [points[from]!, points[to]!],
      kind,
      widthM: null,
      provenance: { source: 'osm', osmIds: [900 + i] },
    };
  });
}

/** A four-way signal of two-lane streets, with a mapped crossing over the south arm 3 m from the
 * node (B59: nearer the junction than its stripes), split on the road's centreline and joined to
 * footways at both kerbs. */
function signalJunction(): City {
  const { city, node, street, signal } = buildCity('T71 signal', 1);
  const centre = node(0, 0);
  const arms = [node(-150, 0), node(150, 0), node(0, -150), node(0, 150)].map((end) =>
    street(end, centre, 2),
  );
  signal(centre, arms);
  mapped(
    city,
    {
      'wn:1': { x: -11, y: 9 },
      'wn:2': { x: 0, y: 9 },
      'wn:3': { x: 11, y: 9 },
      'wn:4': { x: -11, y: 60 },
      'wn:5': { x: 11, y: 60 },
    },
    [
      ['wn:1', 'wn:2', 'crossing'],
      ['wn:2', 'wn:3', 'crossing'],
      ['wn:4', 'wn:1', 'footway'],
      ['wn:5', 'wn:3', 'footway'],
    ],
  );
  return city;
}

/** An unsignalised T of one-lane streets: zebra crossings only. */
function zebraJunction(): City {
  const { city, node, street } = buildCity('T71 zebra', 1);
  const centre = node(0, 0);
  street(node(-150, 0), centre);
  street(centre, node(150, 0));
  street(centre, node(0, -150));
  return city;
}

/** TASK-131's dual carriageway (two-lane one-way ways 20 m apart) crossed by a two-way street at
 * a signalised junction group, with a mapped crossing over both carriageways 4 m west of the
 * side street, split on the median: each half crosses at its own member's stripes. */
function medianJunction(): City {
  const main = { highway: 'secondary', oneway: 'yes', lanes: '2', name: 'Main' };
  const crossing = { highway: 'footway', footway: 'crossing' };
  const result = importOsm(
    osm(
      [
        {
          id: 1,
          tags: main,
          points: [
            [-250, 10],
            [0, 10],
            [250, 10],
          ],
        },
        {
          id: 2,
          tags: main,
          points: [
            [250, -10],
            [0, -10],
            [-250, -10],
          ],
        },
        {
          id: 3,
          tags: { highway: 'residential', name: 'Side' },
          points: [
            [0, 250],
            [0, 10],
            [0, -10],
            [0, -250],
          ],
        },
        {
          id: 4,
          tags: crossing,
          points: [
            [-6, -20],
            [-6, -10],
            [-6, 0],
          ],
        },
        {
          id: 5,
          tags: crossing,
          points: [
            [-6, 0],
            [-6, 10],
            [-6, 20],
          ],
        },
        {
          id: 6,
          tags: { highway: 'footway' },
          points: [
            [-6, 0],
            [-30, 0],
          ],
        },
      ],
      { '0,-10': { highway: 'traffic_signals' } },
    ),
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

const cases = [
  ['signalised', signalJunction],
  ['zebra', zebraJunction],
  ['median-split', medianJunction],
] as const;

/** Every junction crossing link's spans over lanes whose road end draws stripes, with the span
 * that end draws on that lane. */
function striped(city: City, net: CompiledCity) {
  return net.walk.links.flatMap((link) =>
    (link.crossing?.spans ?? []).flatMap((span) => {
      const lane = net.lanes[span.lane]!;
      const road = net.roads[lane.road]!;
      const node = link.crossing!.node;
      if (node < 0 || (road.from !== node && road.to !== node)) return [];
      const stripes = crossingSpan(net, lane, road.to === node, city);
      return stripes ? [{ link, span, stripes }] : [];
    }),
  );
}

describe('T71 crossing walk links at the stripes', () => {
  test.each(cases)(
    'T71.1 %s: the walk link lies within 0.3 m of the stripes centreline',
    (_, build) => {
      const city = build();
      const net = compiled(city);
      const spans = striped(city, net);
      expect(spans.length).toBeGreaterThan(0);
      for (const { span, stripes } of spans)
        expect(Math.abs(span.atM - (stripes.nearM + stripes.farM) / 2)).toBeLessThanOrEqual(0.3);
    },
  );

  test.each(cases)('T71.2 %s: the conflict zone covers the stripes', (_, build) => {
    const city = build();
    const net = compiled(city);
    for (const { span, stripes } of striped(city, net)) {
      expect(span.atM - span.halfM).toBeLessThanOrEqual(
        Math.min(stripes.nearM, stripes.farM) + 1e-6,
      );
      expect(span.atM + span.halfM).toBeGreaterThanOrEqual(
        Math.max(stripes.nearM, stripes.farM) - 1e-6,
      );
    }
    // The stop line stays behind the stripes (TASK-094).
    for (const lane of net.lanes) {
      const road = net.roads[lane.road]!;
      const stripes = crossingSpan(net, lane, true, city);
      if (stripes && net.nodes[road.to]!.signal && lane.stopM < lane.lengthM)
        expect(lane.stopM).toBeCloseTo(stripes.farM - STOP_CLEAR_M, 6);
    }
  });

  test.each(cases.filter(([name]) => name !== 'zebra'))(
    'T71.3 %s: the walk lights stand at the stripes ends',
    (_, build) => {
      const city = build();
      const net = compiled(city);
      let marks = 0;
      for (const node of net.nodes) {
        if (!node.signal) continue;
        const arms = crossingArms(net, node);
        for (const { link, pos } of walkSignalMarks(net, node)) {
          const { arm } = net.walk.links[link]!.crossing!;
          const ends = arms[arm]!.flatMap((e) => {
            const atM = crossingCentreM(net, e.road, e.atEnd, city);
            return atM === null ? [] : [{ ...e, atM }];
          });
          if (!ends.length) continue;
          marks++;
          // Within 1.5 m of an end of the centreline, on its extension beyond the road edge.
          const line = crossingLine(net, ends);
          const end = [line[0]!, line.at(-1)!].reduce((a, b) =>
            distance(a, pos) < distance(b, pos) ? a : b,
          );
          const next = end === line[0] ? line[1]! : line.at(-2)!;
          const out = {
            x: end.x + ((end.x - next.x) / distance(end, next)) * 2,
            y: end.y + ((end.y - next.y) / distance(end, next)) * 2,
          };
          expect(distance(pos, end)).toBeLessThanOrEqual(1.5);
          expect(segmentDistance(pos, end, out)).toBeLessThanOrEqual(0.3);
        }
      }
      expect(marks).toBeGreaterThan(0);
    },
  );

  test('T71.4 a mapped crossing nearer the junction moves onto the stripes and keeps its kerbs', () => {
    const city = signalJunction();
    const net = compiled(city);
    const links = net.walk.links.filter((l) => l.id.startsWith('wl:900'));
    // Its two halves, split on the road's centreline, become one link over both directions.
    expect(net.walk.links.some((l) => l.id.startsWith('wl:901/'))).toBe(false);
    const crossing = links.filter((l) => l.crossing);
    expect(crossing.flatMap((l) => l.crossing!.spans)).toHaveLength(4);
    // Mapped at y = 9 m, it now runs more than 3 m farther out, along the stripes.
    expect(Math.min(...crossing.flatMap((l) => l.line.map((p) => p.y)))).toBeGreaterThan(12);
    const kerbs = links.filter((l) => l.id.includes(':kerb:'));
    expect(kerbs).toHaveLength(2);
    expect(kerbs.every((l) => !l.crossing && l.kind === 'crossing')).toBe(true);
    // The mapped footways on both sides still connect through the crossing.
    const node = (x: number) => net.walk.nodes.findIndex((n) => n.pos.x === x && n.pos.y === 60);
    expect(reachable(net.walk.links, node(-11))).toContain(node(11));
  });

  test.each(cases)('T71.5 %s: the same city compiles to the same walk graph', (_, build) => {
    const hash = (net: CompiledCity) =>
      createHash('sha256').update(JSON.stringify(net.walk.links)).digest('hex');
    expect(hash(compiled(build()))).toBe(hash(compiled(build())));
  });
});

function reachable(links: CWalkLink[], from: number) {
  const seen = new Set([from]),
    queue = [from];
  for (const at of queue)
    for (const link of links)
      for (const [a, b] of [
        [link.from, link.to],
        [link.to, link.from],
      ] as const)
        if (a === at && !seen.has(b)) {
          seen.add(b);
          queue.push(b);
        }
  return [...seen];
}
