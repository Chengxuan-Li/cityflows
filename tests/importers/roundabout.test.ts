import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { parseOsm } from '../../src/importers/osm/parse';

test('Sindelfingen keeps circulating ways and gives them priority over entries', () => {
  const xml = readFileSync('fixtures/osm/sindelfingen-a81.osm', 'utf8');
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  const ways = new Set(data.way.filter((w) => w.tag.junction === 'roundabout').map((w) => w.id));
  expect(ways.size).toBeGreaterThan(0);
  const result = importOsm(xml, { importerVersion: 'test' });
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  const roads = Object.values(result.city.roads);
  const ring = new Set(
    roads.filter((r) => r.provenance.osmIds?.some((id) => ways.has(id))).map((r) => r.id),
  );
  expect(ring.size).toBeGreaterThan(0);
  let entries = 0;
  for (const id of new Set(roads.filter((r) => ring.has(r.id)).map((r) => r.to))) {
    const minor = roads.filter((r) => r.to === id && !ring.has(r.id));
    if (!minor.length) continue;
    entries++;
    const node = result.city.nodes[id]!;
    expect(node.control).toBe('yield');
    expect(node.minorRoads.sort()).toEqual(minor.map((r) => r.id).sort());
  }
  expect(entries).toBeGreaterThan(0);
});
