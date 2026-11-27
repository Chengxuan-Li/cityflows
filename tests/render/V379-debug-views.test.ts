import { describe, expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import {
  flatHeights,
  heightsLayer,
  networkLayer,
  type DebugItem,
} from '../../src/render/debug-geometry';
import {
  activeDebug,
  debugFromUrl,
  defaultDebug,
  parseDebug,
} from '../../src/render/debug-settings';
import { parseVisual } from '../../src/render/lighting';
import { setup } from '../sim/fixtures';

// TASK-379: the developer debug views' settings and their shared overlay geometry.

describe('debug settings', () => {
  test('parse each field on its own and fall back to the defaults', () => {
    expect(parseDebug(null)).toEqual(defaultDebug);
    expect(parseDebug('nonsense')).toEqual(defaultDebug);
    const parsed = parseDebug({
      rendered: false,
      shading: 'overdraw',
      overlays: { roadGraph: true, wireframe: 'yes', unknown: true },
    });
    expect(parsed.rendered).toBe(false);
    expect(parsed.shading).toBe('overdraw');
    expect(parsed.overlays.roadGraph).toBe(true);
    expect(parsed.overlays.wireframe).toBe(false);
    expect(Object.keys(parsed.overlays)).toHaveLength(13);
    expect(parseDebug({ shading: 'contactShadows' }).shading).toBe('normal');
    expect(parseDebug({ rendered: 'no' }).rendered).toBe(true);
  });

  test('developer tools are off by default, on by the switch or ?debug', () => {
    expect(parseVisual({}).developerTools).toBe(false);
    expect(parseVisual({ developerTools: true }).developerTools).toBe(true);
    expect(parseVisual({ developerTools: 'true' }).developerTools).toBe(false);
    expect(debugFromUrl('?city=munich&debug')).toBe(true);
    expect(debugFromUrl('?debug=1')).toBe(true);
    expect(debugFromUrl('?city=munich')).toBe(false);
  });

  test('3D-only views drop out in 2D, and nothing is active without developer tools', () => {
    const settings = parseDebug({
      shading: 'normals',
      overlays: { wireframe: true, detailRanges: true, roadGraph: true },
    });
    expect(activeDebug(settings, false, true)).toBeNull();
    const flat = activeDebug(settings, true, false)!;
    expect(flat.shading).toBe('normal');
    expect(flat.overlays).toMatchObject({ wireframe: false, detailRanges: false, roadGraph: true });
    const solid = activeDebug(settings, true, true)!;
    expect(solid.shading).toBe('normals');
    expect(solid.overlays).toMatchObject({ wireframe: true, detailRanges: true });
    expect(activeDebug({ ...settings, shading: 'heights' }, true, false)!.shading).toBe('heights');
    // Rendered view off: no shading applies.
    expect(activeDebug({ ...settings, rendered: false }, true, true)!.shading).toBe('normal');
  });
});

const count = (items: DebugItem[], kind: DebugItem['kind'], label: string) =>
  items.filter((item) => item.kind === kind && item.target?.label.startsWith(label)).length;

describe('overlay geometry matches the compiled city', () => {
  test('road graph: a dot per node and a line per road; lanes: a line per lane and movement', () => {
    const city = grid5x5();
    const compiled = setup(city);
    const roads = networkLayer('roadGraph', compiled, city, flatHeights);
    expect(count(roads, 'dot', 'Node ')).toBe(compiled.nodes.length);
    expect(count(roads, 'line', 'Road ')).toBe(compiled.roads.length);
    expect(roads.filter((item) => item.kind === 'dot' && item.ink === 'red').length).toBe(
      compiled.nodes.filter((n) => n.signal || n.control === 'signal').length,
    );
    const lanes = networkLayer('lanes', compiled, city, flatHeights);
    expect(count(lanes, 'line', 'Lane ')).toBe(compiled.lanes.length);
    expect(count(lanes, 'line', 'Movement ')).toBe(compiled.movements.length);
    const walk = networkLayer('walkNetwork', compiled, city, flatHeights);
    expect(count(walk, 'line', 'Walk link ')).toBe(compiled.walk.links.length);
    const places = networkLayer('places', compiled, city, flatHeights);
    expect(count(places, 'dot', 'Connector ')).toBe(compiled.connectors.length);
  });

  test('rail graph: a line per track, a dot per rail node', () => {
    const city = operatingCrossing('rail');
    const compiled = setup(city);
    const rail = networkLayer('railGraph', compiled, city, flatHeights);
    expect(compiled.rail!.tracks.length).toBeGreaterThan(0);
    expect(count(rail, 'line', 'Track ')).toBe(compiled.rail!.tracks.length);
    expect(count(rail, 'dot', 'Rail node ')).toBe(compiled.rail!.nodes.length);
  });

  test('airside graph: runways, taxi edges, holds and stands', () => {
    const city = syntheticAirport(1);
    const compiled = setup(city);
    const graph = compiled.airside!;
    const items = networkLayer('airsideGraph', compiled, city, flatHeights);
    expect(count(items, 'line', 'Runway ')).toBe(graph.runways.length);
    expect(count(items, 'line', 'Holding position ')).toBe(graph.holds.length);
    expect(count(items, 'dot', 'Stand ')).toBe(graph.stands.length);
    expect(items.filter((item) => item.target?.pick?.kind === 'taxiway').length).toBe(
      graph.edges.filter((e) => e.kind !== 'runway').length,
    );
  });

  test('heights and grades: a grade per road, segments coloured on the ramp', () => {
    const city = grid5x5();
    const compiled = setup(city);
    const ramp = [0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff0000];
    const items = heightsLayer(compiled, flatHeights, ramp, true);
    expect(items.filter((item) => item.kind === 'text')).toHaveLength(compiled.roads.length);
    // A flat city: every segment at the foot of the ramp.
    const colours = new Set(
      items.flatMap((item) => (item.colour === undefined ? [] : [item.colour])),
    );
    expect([...colours]).toEqual([0x0000ff]);
  });
});
