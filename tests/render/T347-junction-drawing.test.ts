import { describe, expect, it } from 'vitest';
import { areaD } from 'clipper2-ts';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { pointInPolygon } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { crossingArms } from '../../src/network/crossings';
import { drawnRings, groupSurface, insideRings, roadStrip } from '../../src/render/layers/nodes';
import { nodeMarkingGeometry } from '../../src/render/marking-geometry';
import { dualSingle } from '../importers/junction-group-osm';

// TASK-347 (drawing only): nodes of two arms drawn as the road running on, and a junction group
// drawn as one surface.

function compiled(city: Parameters<typeof compile>[0]): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.compiled;
}

describe('T347 junction drawing', () => {
  const grid = compiled(grid5x5());
  const corners = grid.nodes.filter((n) => n.outline.length && crossingArms(grid, n).length === 2);

  it('draws a corner of two arms as a strip covering its movements, junctions as outlines', () => {
    expect(corners.length).toBe(4);
    for (const node of corners) {
      const strip = roadStrip(grid, node)!;
      expect(strip).not.toBeNull();
      const closed = [...strip, strip[0]!];
      for (const i of node.movements)
        for (const p of grid.movements[i]!.polyline)
          expect(pointInPolygon(p, closed, 0.25)).toBe(true);
      // The strip is drawn instead of the outline, which the simulation keeps.
      expect(drawnRings(grid, node)).toEqual([strip]);
      expect(node.outline.length).toBeGreaterThan(2);
    }
    for (const node of grid.nodes.filter((n) => crossingArms(grid, n).length > 2))
      expect(roadStrip(grid, node)).toBeNull();
  });

  it('runs the centre line on across a corner of a two-way street', () => {
    for (const node of corners) {
      const centre = nodeMarkingGeometry(grid, node).filter((s) => s.role === 'centre');
      expect(centre.length).toBeGreaterThan(0);
      const strip = roadStrip(grid, node)!;
      for (const shape of centre)
        for (const p of shape.points)
          expect(pointInPolygon(p, [...strip, strip[0]!], 0.05)).toBe(true);
    }
  });

  it('draws a junction group as one surface at its first member, with curbs on its outside', () => {
    const result = importOsm(dualSingle(20, true), { importerVersion: 'test' });
    if (!result.ok) throw new Error('fixture must import');
    const city = compiled(result.city);
    const group = city.groups![0]!;
    const rings = groupSurface(city, group.idx);
    expect(rings.filter((ring) => areaD(ring) > 0)).toHaveLength(1);
    const [first, ...rest] = group.nodes.map((n) => city.nodes[n]!);
    expect(drawnRings(city, first!)).toBe(rings);
    for (const node of rest) expect(drawnRings(city, node)).toEqual([]);
    // Every member and the middle of every inner road lie inside the one surface.
    for (const node of group.nodes) expect(insideRings(rings, city.nodes[node]!.pos, 0)).toBe(true);
    for (const r of group.innerRoads) {
      const lane = city.lanes[city.roads[r]!.lanes[0]!]!;
      expect(insideRings(rings, lane.polyline[Math.floor(lane.polyline.length / 2)]!, 0)).toBe(
        true,
      );
    }
  });
});
