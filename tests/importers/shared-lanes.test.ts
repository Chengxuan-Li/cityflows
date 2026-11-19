import { describe, expect, it } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { roadSpecs } from '../../src/importers/osm/roads';
import { compile, type Diagnostic } from '../../src/network';
import { roadMarkingGeometry } from '../../src/render/marking-geometry';
import type { City, RoadClass } from '../../src/schema';
import { osm } from './junction-group-osm';

// TASK-233 (TASK-216 D6; TASK-231's rule): a two-way `lanes=1` way is one shared carriageway.

const specs = (tags: Record<string, string>, roadClass: RoadClass) => {
  const diagnostics: Diagnostic[] = [];
  return roadSpecs({ id: 1, nd: [1, 2], tag: tags }, roadClass, diagnostics).map((spec) => ({
    widths: spec.lanes.map((lane) => lane.widthM),
    inferred: spec.provenance.inferred,
  }));
};

/** A two-way residential street "Gasse" along y = 0 with `tags` added. */
function gasse(tags: Record<string, string>) {
  const result = importOsm(
    osm([
      {
        id: 1,
        tags: { highway: 'residential', name: 'Gasse', ...tags },
        points: [
          [-100, 0],
          [100, 0],
        ],
      },
    ]),
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

describe('TASK-233 shared one-lane streets', () => {
  it('a two-way way with lanes=1 is one shared carriageway, each direction at its default width', () => {
    const shared = specs({ highway: 'service', lanes: '1' }, 'service');
    expect(shared.map((s) => s.widths)).toEqual([[3], [3]]);
    expect(shared.every((s) => s.inferred.includes('sharedLane'))).toBe(true);
    // lanes=2, lanes:forward given, or a one-way lanes=1 is not shared.
    expect(specs({ lanes: '2' }, 'service')[0]!.inferred).not.toContain('sharedLane');
    expect(specs({ lanes: '1', 'lanes:forward': '1' }, 'tertiary')[0]!.inferred).not.toContain(
      'sharedLane',
    );
    expect(specs({ oneway: 'yes', lanes: '1' }, 'service')[0]!.inferred).not.toContain(
      'sharedLane',
    );
    // Imported, the two directions lie side by side, 6 m in all.
    const roads = Object.values(gasse({ lanes: '1' }).roads);
    expect(roads).toHaveLength(2);
    for (const road of roads) expect(road.lateralOffsetM).toBeCloseTo(1.5, 9);
  });

  it('no centre line between the halves of a shared carriageway', () => {
    const centres = (city: City) => {
      const result = compile(city);
      if (!result.ok) throw new Error('compile');
      const net = result.compiled;
      return net.roads.flatMap((road) =>
        roadMarkingGeometry(net, road, city).below.filter((shape) => shape.role === 'centre'),
      );
    };
    expect(centres(gasse({ lanes: '1' }))).toHaveLength(0);
    // Without lanes=1 the same street draws its centre line.
    expect(centres(gasse({ lanes: '2' })).length).toBeGreaterThan(0);
    expect(centres(gasse({ highway: 'tertiary', lanes: '2' })).length).toBeGreaterThan(0);
  });
});
