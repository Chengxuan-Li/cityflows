import { describe, expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { shapeGap, standShape } from '../../src/importers/osm/airport';
import { codeAdmits } from '../../src/schema/aircraft';
import type { Airport } from '../../src/schema/airport';

// TASK-295: the airside importer on a small airport. A runway 09/27 (a displaced threshold at the
// 09 end, 45 m wide), a parallel taxiway A 55.6 m south of it joined by links B (10.5 m wide) and
// C, a runway hold on B and one mapped 7.6 m beside C, a stand with a lead-in way and one mapped as
// a node only, a gate in the terminal, an apron, and a road that shares a node with taxiway A and
// crosses the runway without one.

const nodes: [number, number, number, Record<string, string>?][] = [
  [1, 0.0, 51.5],
  [2, 0.001, 51.5],
  [3, 0.005, 51.5],
  [4, 0.009, 51.5],
  [5, 0.01, 51.5],
  [6, 0.001, 51.4995],
  [7, 0.009, 51.4995],
  [8, 0.004, 51.4995],
  [9, 0.0065, 51.4995],
  [
    10,
    0.001,
    51.4998,
    { aeroway: 'holding_position', 'holding_position:type': 'runway', ref: 'B1' },
  ],
  [11, 0.00911, 51.4998, { aeroway: 'holding_position', 'holding_position:type': 'runway' }],
  [12, 0.004, 51.4991],
  [13, 0.0045, 51.4991, { aeroway: 'parking_position', ref: '2' }],
  [14, 0.004, 51.4988, { aeroway: 'gate', ref: '1' }],
  [20, 0.0065, 51.498],
  [21, 0.0065, 51.501],
  [30, 0.003, 51.4985],
  [31, 0.006, 51.4985],
  [32, 0.006, 51.4989],
  [33, 0.003, 51.4989],
  [40, 0.0035, 51.499],
  [41, 0.0055, 51.499],
  [42, 0.0055, 51.4994],
  [43, 0.0035, 51.4994],
];
const ways: [number, number[], Record<string, string>][] = [
  [101, [1, 2], { aeroway: 'runway', runway: 'displaced_threshold', width: '45' }],
  [102, [2, 3, 4, 5], { aeroway: 'runway', ref: '09/27', width: '45', surface: 'asphalt' }],
  [103, [2, 10, 6], { aeroway: 'taxiway', ref: 'B', width: '10.5' }],
  [104, [4, 7], { aeroway: 'taxiway', ref: 'C' }],
  [105, [6, 8, 9, 7], { aeroway: 'taxiway', ref: 'A', width: '23' }],
  [106, [8, 12], { aeroway: 'parking_position', ref: '1' }],
  [107, [30, 31, 32, 33, 30], { aeroway: 'terminal', building: 'terminal', name: 'Main' }],
  [108, [40, 41, 42, 43, 40], { aeroway: 'apron' }],
  [109, [20, 9, 21], { highway: 'service' }],
];
const tags = (t: Record<string, string> = {}) =>
  Object.entries(t)
    .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
    .join('');
const xml = `<osm version="0.6">${nodes
  .map(([id, lon, lat, t]) => `<node id="${id}" lat="${lat}" lon="${lon}">${tags(t)}</node>`)
  .join('')}${ways
  .map(
    ([id, nd, t]) =>
      `<way id="${id}">${nd.map((r) => `<nd ref="${r}"/>`).join('')}${tags(t)}</way>`,
  )
  .join('')}</osm>`;

const imported = () => {
  const result = importOsm(xml, {
    importerVersion: '1',
    bbox: [-0.0005, 51.4975, 0.0105, 51.5015],
    terrain: false,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-3)));
  return result;
};

/** Nodes reachable from `start` over the airside graph. */
function reachable(airport: Airport, start: string) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const at = queue.pop()!;
    for (const edge of Object.values(airport.edges))
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ])
        if (a === at && !seen.has(b!)) {
          seen.add(b!);
          queue.push(b!);
        }
  }
  return seen;
}

describe('TASK-295 airside import', () => {
  const { city, diagnostics } = imported();
  const airport = city.airport!;
  const edges = Object.values(airport.edges);
  const byOsm = (id: number) => edges.filter((e) => e.provenance.osmIds?.includes(id));

  test('reads the airport into the schema', () => {
    expect(airport).toBeDefined();
    expect(Object.keys(airport.runways)).toHaveLength(1);
    expect(Object.values(airport.terminals).map((t) => [t.name, t.group])).toEqual([['Main', 0]]);
    expect(Object.values(airport.gates).map((g) => [g.ref, g.terminal])).toEqual([
      ['1', Object.keys(airport.terminals)[0]],
    ]);
    expect(airport.surfaces.map((s) => s.kind)).toEqual(['apron']);
    expect(diagnostics.filter((d) => d.code.startsWith('airport_'))).toEqual([]);
  });

  test('splits edges at shared nodes, holds, stands and road nodes', () => {
    expect(edges.filter((e) => e.kind === 'runway')).toHaveLength(3);
    // Taxiway A: at link B's node, the stand's lead-in root, the generated root of stand 2 and
    // the road's node, and link C's node.
    expect(byOsm(105).filter((e) => e.kind === 'taxiway')).toHaveLength(4);
    expect(byOsm(103)).toHaveLength(2);
    expect(byOsm(104)).toHaveLength(2);
    for (const edge of edges) {
      expect(edge.line[0]).toEqual(airport.nodes[edge.from]!.pos);
      expect(edge.line.at(-1)).toEqual(airport.nodes[edge.to]!.pos);
    }
  });

  test('a runway runs from end to end, with its displaced threshold', () => {
    const runway = Object.values(airport.runways)[0]!;
    expect(runway.ref).toBe('09/27');
    expect(runway.ends.map((e) => e.designator)).toEqual(['09', '27']);
    expect(airport.nodes[runway.ends[0].node]!.osmId).toBe(1);
    expect(airport.nodes[runway.ends[0].threshold.node]!.osmId).toBe(2);
    expect(runway.ends[0].displacedM).toBeCloseTo(69.4, 0);
    expect(runway.ends[1].threshold.node).toBe(runway.ends[1].node);
    expect(runway.ends[0].heading).toBeCloseTo(0, 3);
    expect(Math.abs(runway.ends[1].heading)).toBeCloseTo(Math.PI, 3);
    let at = runway.ends[0].node;
    for (const id of runway.edges) {
      expect(airport.edges[id]!.from).toBe(at);
      at = airport.edges[id]!.to;
    }
    expect(at).toBe(runway.ends[1].node);
    expect(runway.lengthM).toBeCloseTo(694, -1);
    expect(runway.maxCode).toBe('F');
  });

  test('an unjoined stand and holding position get generated joins', () => {
    const holds = Object.values(airport.holdingPositions);
    expect(holds.map((h) => [h.ref, h.kind, h.side, h.provenance.source])).toEqual([
      ['B1', 'runway', 'right', 'osm'],
      [undefined, 'runway', 'right', 'generated'],
    ]);
    const runwayId = Object.keys(airport.runways)[0];
    for (const hold of holds) {
      expect(hold.runway).toBe(runwayId);
      const toward = airport.edges[hold.toward!]!;
      expect([toward.from, toward.to]).toContain(hold.node);
    }
    expect(airport.nodes[holds[1]!.node]!.provenance.source).toBe('generated');
    const stands = Object.values(airport.stands);
    expect(stands.map((s) => [s.ref, s.kind, s.leadIn.length])).toEqual([
      ['1', 'contact', 1],
      ['2', 'remote', 1],
    ]);
    const generated = airport.edges[stands[1]!.leadIn[0]!]!;
    expect([generated.kind, generated.provenance.source, generated.stand]).toEqual([
      'lead_in',
      'generated',
      stands[1]!.id,
    ]);
    expect(polyLength(generated.line)).toBeCloseTo(44.5, 0);
    expect(stands[0]!.heading).toBeCloseTo(Math.PI / 2, 3);
    expect(stands[0]!.gate).toBe(Object.keys(airport.gates)[0]);
    // Every stand reaches the runway on the graph.
    const runwayNodes = new Set(
      edges.filter((e) => e.kind === 'runway').flatMap((e) => [e.from, e.to]),
    );
    for (const stand of stands) {
      const root = airport.edges[stand.leadIn[0]!]!.from;
      expect([...reachable(airport, root)].some((n) => runwayNodes.has(n))).toBe(true);
    }
  });

  test('code limits from width and spacing', () => {
    // A is 23 m wide (E) but 55.6 m from the parallel runway: C (44 m) not D (63 m).
    expect(new Set(byOsm(105).map((e) => e.maxCode))).toEqual(new Set(['C']));
    expect(byOsm(105).map((e) => e.widthM)).toEqual([23, 23, 23, 23]);
    // Link B is 10.5 m wide: B. Link C is unmapped, clear of everything: F, at F's width.
    expect(new Set(byOsm(103).map((e) => e.maxCode))).toEqual(new Set(['B']));
    expect(byOsm(104).map((e) => [e.maxCode, e.widthM, e.provenance.inferred])).toEqual([
      ['F', 25, ['widthM', 'maxCode']],
      ['F', 25, ['widthM', 'maxCode']],
    ]);
    // The stands are 34.7 m apart nose-in: a code B aircraft (24 m) keeps 3 m, a code C one
    // (36 m) not 4.5 m; their lead-ins take their code.
    const stands = Object.values(airport.stands);
    expect(stands.map((s) => s.maxCode)).toEqual(['B', 'B']);
    for (const stand of stands)
      for (const id of stand.leadIn) expect(airport.edges[id]!.maxCode).toBe('B');
    expect(['A', 'B', 'C'].map((code) => codeAdmits('B', code as 'A'))).toEqual([
      true,
      true,
      false,
    ]);
    // Angled stands stagger their wings: 43 m apart along a row, nose 50 degrees off it.
    const angle = (-40 * Math.PI) / 180;
    const a = standShape({ x: 0, y: 0 }, angle, 'C'),
      b = standShape({ x: 43, y: 0 }, angle, 'C');
    expect(shapeGap(a, b)).toBeGreaterThan(4.5);
  });

  test('records roads crossing the airside at grade', () => {
    const crossings = airport.roadCrossings.map((c) => [
      airport.edges[c.edge]!.kind,
      c.osmId,
      c.roadOsmIds,
      c.roads.length,
    ]);
    expect(crossings).toEqual([
      ['taxiway', 9, [109], 2],
      ['runway', undefined, [109], 2],
    ]);
    for (const crossing of airport.roadCrossings)
      for (const road of crossing.roads) expect(city.roads[road]).toBeDefined();
  });

  test('a city without aeroway features has no airport section', () => {
    const plain = importOsm(xml.replace(/<tag k="aeroway" v="[^"]*"\/>/g, ''), {
      importerVersion: '1',
      bbox: [-0.0005, 51.4975, 0.0105, 51.5015],
      terrain: false,
    });
    expect(plain.ok && 'airport' in plain.city).toBe(false);
    expect(plain.ok).toBe(true);
  });
});

function polyLength(line: { x: number; y: number }[]) {
  let sum = 0;
  for (let i = 1; i < line.length; i++)
    sum += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
  return sum;
}
