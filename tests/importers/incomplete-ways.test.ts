import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

const node = (id: number, lat: number, lon: number) =>
  `<node id="${id}" lat="${lat}" lon="${lon}"/>`;
const way = (id: number, refs: number[], tags: Record<string, string>) =>
  `<way id="${id}">${refs.map((ref) => `<nd ref="${ref}"/>`).join('')}${Object.entries(tags)
    .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
    .join('')}</way>`;
const osm = (parts: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${parts.join('')}</osm>`;
const crossing = [
  node(1, 48.14, 11.53),
  node(2, 48.14, 11.532),
  node(3, 48.14, 11.534),
  node(4, 48.1415, 11.532),
  node(5, 48.1385, 11.532),
  way(100, [1, 2, 3], { highway: 'residential', name: 'Main' }),
  way(101, [4, 2, 5], { highway: 'residential', name: 'Cross' }),
];
const options = { importerVersion: 'test', drivingSide: 'right' } as const;

// Clipped extracts keep references to nodes outside the file, and mappers leave one-node
// ways; neither may fail the whole import.
test('a way is trimmed to its longest run of present nodes and the rest import', () => {
  const result = importOsm(
    osm([
      ...crossing,
      node(6, 48.139, 11.534),
      node(7, 48.138, 11.534),
      node(8, 48.137, 11.534),
      way(102, [3, 6, 999, 7, 8, 5], { highway: 'residential', name: 'Edge' }),
      way(103, [3, 998], { highway: 'residential' }),
      way(104, [4], { highway: 'service' }),
      way(105, [1, 2, 997, 1], { building: 'yes' }),
    ]),
    options,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const roads = Object.values(result.city.roads);
  const edge = roads.filter((road) => road.provenance.osmIds?.includes(102));
  expect(edge.length).toBeGreaterThan(0);
  // The longer run (7, 8, 5) is kept, not (3, 6).
  expect(edge.every((road) => road.centerline.every((p) => p.y > 0))).toBe(true);
  expect(roads.some((road) => road.provenance.osmIds?.includes(103))).toBe(false);
  expect(roads.some((road) => road.provenance.osmIds?.includes(104))).toBe(false);
  const warning = result.diagnostics.find((d) => d.code === 'osm_incomplete_way')!;
  expect(warning.severity).toBe('warning');
  expect(warning.message).toContain('Trimmed 1 ways');
  expect(warning.message).toContain('dropped 2 ways');
  expect(warning.refs).toEqual(['way/102', 'way/103', 'way/104']);
});

test('an extract whose highways all lack nodes still reports that it has no roads', () => {
  const result = importOsm(osm([way(109, [994, 995], { highway: 'primary' })]), options);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((d) => d.code)).toEqual([
    'osm_incomplete_way',
    'osm_no_drivable_ways',
  ]);
});
