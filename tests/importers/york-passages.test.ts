import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

// TASK-271 (TASK-259 D6, D12): York's drivable building passages, covered ways, conditional
// access and Leeman Road, cut unchanged from TASK-259's extract (ATTRIBUTION.txt).
const result = importOsm(readFileSync('tests/importers/york-passages.osm', 'utf8'), {
  importerVersion: 'test',
  drivingSide: 'right',
  bbox: [-1.1, 53.95, -1.07, 53.967],
});
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-3)));
const roads = Object.values(result.city.roads);
const of = (way: number) => roads.filter((r) => r.provenance.osmIds?.includes(way));

test("York's building passages and covered ways run at grade; its underpasses stay below", () => {
  const below = roads.filter((r) => (r.layer ?? 0) < 0).map((r) => r.provenance.osmIds![0]!);
  // Leeman Road under the railway (tunnel=yes, layer=-1); Pump Court and Trinity Court, tagged
  // tunnel=yes as well as covered=yes, stay tunnels.
  expect([...new Set(below)].sort((a, b) => a - b)).toEqual([4434469, 295558546, 317918915]);
  expect(of(131158813).map((r) => r.layer)).toEqual([0]); // High Petergate through Bootham Bar
});

test("York's footstreets close to all but deliveries; Leeman Road shares one lane", () => {
  for (const way of [131158813, 131158812, 4436829, 967688120])
    expect(of(way).map((r) => r.access?.all)).toEqual(['delivery']);
  expect(of(131158813)[0]!.access?.bus).toBe('yes');
  expect(of(260876322).map((r) => r.access?.all)).toEqual(['yes']);
  for (const way of [4436605, 4469123, 4437061])
    expect(new Set(of(way).map((r) => r.access?.all))).toEqual(new Set(['destination']));
  for (const way of [4434469, 147420937, 4019022]) {
    expect(of(way)).toHaveLength(2);
    expect(of(way).every((r) => r.provenance.inferred?.includes('sharedLane'))).toBe(true);
  }
  expect(result.diagnostics.filter((d) => d.message.includes('oneway'))).toEqual([]);
});
