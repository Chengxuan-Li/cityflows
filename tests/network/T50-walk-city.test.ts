import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { createWalkRouter } from '../../src/routing/walk';
import { walkGeometry } from '../../src/render/walk-geometry';
import { tierCities } from '../tier';

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T50 %s walk counts, reachability and render geometry',
  (name) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
      terrain: false,
    });
    if (!imported.ok) throw new Error('import failed');
    const start = performance.now(),
      result = compile(imported.city),
      compileMs = performance.now() - start;
    if (!result.ok) throw new Error('compile failed');
    // TASK-124 changes car connectors; T61 separately pins the unchanged lanes/movements.
    const { lanes, movements, connectors } = result.compiled;
    expect(
      createHash('sha256').update(JSON.stringify({ lanes, movements, connectors })).digest('hex'),
    ).toBe(
      name.startsWith('munich')
        ? '7ae427770d90dfeb5d6af716b1f898b48fb2ec7c1319093f09c74c1fdeff21f3'
        : 'fa151a5ebe6007e2d6fbddea44d2d4268a55907c66f3448e69ac84b3e7d81a38',
    );
    const g = result.compiled.walk;
    const expected = name.startsWith('munich')
      ? { footway: 2125, living_street: 32, steps: 72, path: 982, pedestrian: 42, crossing: 170 }
      : { footway: 120, path: 139, crossing: 16, steps: 4 };
    const counts: Record<string, number> = {};
    for (const link of Object.values(imported.city.walk!.links))
      counts[link.kind] = (counts[link.kind] ?? 0) + 1;
    for (const [kind, count] of Object.entries(expected)) {
      expect(counts[kind]).toBeGreaterThanOrEqual(count * 0.9);
      expect(counts[kind]).toBeLessThanOrEqual(count * 1.1);
    }
    const entrances = Object.values(imported.city.walk!.nodes).filter((n) => n.entrance).length;
    const doors = name.startsWith('munich') ? 348 : 5;
    expect(entrances).toBeGreaterThanOrEqual(doors * 0.9);
    expect(entrances).toBeLessThanOrEqual(doors * 1.1);
    const central = name.startsWith('munich') ? 'p:1731' : 'p:1379';
    const seen = new Set(g.places.get(central)),
      queue = [...seen];
    for (const i of queue)
      for (const j of g.nodes[i]!.links) {
        const l = g.links[j]!,
          n = l.from === i ? l.to : l.from;
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    const places = Object.values(imported.city.places).filter((p) => p.population || p.jobs);
    const missing = places
      .filter((p) => !g.places.get(p.id)?.some((i) => seen.has(i)))
      .map((p) => p.id);
    const router = createWalkRouter(g),
      queryStart = performance.now();
    if (name.startsWith('sindelfingen')) {
      const garage = result.compiled.parking.find((p) => p.id === 'pk:1453')!;
      const connector = connectors.find((c) => c.parking === garage.idx)!;
      expect(
        router.route({ from: { node: g.connectors.get(connector.id)! }, to: { placeId: 'p:1407' } })
          .ok,
      ).toBe(true);
    }
    for (let i = 0; i < 100; i++)
      router.route({ from: { placeId: central }, to: { placeId: places[i % places.length]!.id } });
    const queryMs = (performance.now() - queryStart) / 100;
    const byKind: Record<string, { nodes: Set<number>; links: number; lengthM: number }> = {};
    for (const l of g.links) {
      const row = (byKind[l.kind] ??= { nodes: new Set(), links: 0, lengthM: 0 });
      row.nodes.add(l.from);
      row.nodes.add(l.to);
      row.links++;
      row.lengthM += l.lengthM;
    }
    console.log(
      JSON.stringify({
        name,
        counts,
        entrances,
        nodes: g.nodes.length,
        byKind: Object.fromEntries(
          Object.entries(byKind).map(([k, v]) => [k, { ...v, nodes: v.nodes.size }]),
        ),
        central,
        places: places.length,
        reachable: places.length - missing.length,
        missing,
        compileMs,
        queryMs,
      }),
    );
    expect(() => walkGeometry(result.compiled, imported.city)).not.toThrow();
    if (name.startsWith('munich'))
      expect((places.length - missing.length) / places.length).toBeGreaterThanOrEqual(0.95);
  },
);
