import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { drawRoadCommand, newRoadNode } from '../../src/editor/commands/topology';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { pointAtDistance } from '../../src/geo/polyline';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { citySchema, historyFileSchema, type Command } from '../../src/schema';

it('T12 adds a faster bypass with legal movements at both ends and undoes it exactly', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  const road = city.roads['r:26']!;
  const command: Command = {
    kind: 'addRoad',
    newNodes: [],
    road: {
      ...road,
      from: 'n:2',
      to: 'n:20',
      centerline: [city.nodes['n:2']!.pos, city.nodes['n:20']!.pos],
      streetGroupId: null,
      lateralOffsetM: 0,
      speedLimitMps: 30,
    },
  };
  const result = editor.apply(command);
  expect(result.ok).toBe(true);
  expect(citySchema.safeParse(editor.city).success).toBe(true);
  const id = `r:${city.nextId}`;
  const compiled = editor.compiled;
  const bypass = compiled.roads[compiled.index.road.get(id)!]!;
  const lane = compiled.lanes[bypass.lanes[0]!]!;
  expect(lane.in.length).toBeGreaterThan(0);
  expect(lane.out.length).toBeGreaterThan(0);
  const route = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), {
    fromLane: compiled.index.lane.get('r:26#0')!,
    fromPosM: 10,
    toConnector: compiled.index.connector.get('c:109')!,
    vehicleClass: 'car',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  });
  expect(route.ok).toBe(true);
  if (route.ok) expect(route.route.roads).toContain(bypass.idx);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
  expect(editor.redo()?.ok).toBe(true);
});

it('snaps a drawn street to both halves of an existing road in one history entry', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  const command = drawRoadCommand(
    city,
    [
      { kind: 'road', roadId: 'r:26', pos: { x: 30, y: 0 } },
      { kind: 'free', pos: { x: 60, y: -60 } },
      { kind: 'road', roadId: 'r:26', pos: { x: 90, y: 0 } },
    ],
    { twoWay: true, lanes: 1, roadClass: 'residential', speedKph: 30 },
  );
  const result = editor.apply(command);
  expect(result.ok).toBe(true);
  expect(editor.history).toHaveLength(1);
  expect(Object.keys(editor.city.nodes)).toHaveLength(27);
  const created = Object.values(editor.city.roads).filter(
    (r) => r.provenance.source === 'authored',
  );
  expect(created).toHaveLength(2);
  expect(created[0]!.streetGroupId).toBe(created[1]!.streetGroupId);
  for (const r of created) {
    expect(r.lanes.every((lane) => lane.allowed.includes('van'))).toBe(true);
    const lane = editor.compiled.lanes[editor.compiled.index.lane.get(`${r.id}#0`)!]!;
    expect(lane.in.length).toBeGreaterThan(0);
    expect(lane.out.length).toBeGreaterThan(0);
  }
  editor.undo();
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
});

it('deletes dependent connectors, turn rules and signal groups with warnings and removes orphan nodes', () => {
  const city = createEditor(grid5x5()).city;
  city.nodes['n:2']!.turnRules.push({
    from: 'r:26',
    to: 'r:30',
    allowed: false,
    provenance: { source: 'authored' },
  });
  const editor = createEditor(city);
  const result = editor.apply({ kind: 'deleteRoad', roadId: 'r:26' });
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['connector_removed', 'junction_references_removed']),
    );
  expect(editor.city.nodes['n:2']!.turnRules).toEqual([]);
  expect(
    Object.values(editor.city.places)
      .flatMap((p) => p.connectors)
      .some((c) => c.roadId === 'r:26'),
  ).toBe(false);
  const signal = Object.values(city.nodes).find((n) => n.signal)!;
  const incoming = signal.signal!.phases[0]!.groups[0]!.from;
  expect(editor.apply({ kind: 'deleteRoad', roadId: incoming }).ok).toBe(true);
  expect(JSON.stringify(editor.city.nodes[signal.id]!.signal)).not.toContain(`"${incoming}"`);
  const incident = Object.values(editor.city.roads).filter(
    (r) => r.from === 'n:1' || r.to === 'n:1',
  );
  const deleted = editor.apply({
    kind: 'batch',
    label: 'Delete corner',
    commands: incident.map((r) => ({ kind: 'deleteRoad', roadId: r.id })),
  });
  expect(deleted.ok).toBe(true);
  expect(editor.city.nodes['n:1']).toBeUndefined();
  if (deleted.ok)
    expect(deleted.diagnostics.some((d) => d.code === 'orphan_node_removed')).toBe(true);
});

it('moves every incident endpoint as one undoable edit', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  const pos = { x: 130, y: 15 };
  expect(editor.apply({ kind: 'moveNode', nodeId: 'n:2', pos }).ok).toBe(true);
  for (const road of Object.values(editor.city.roads)) {
    if (road.from === 'n:2') expect(road.centerline[0]).toEqual(pos);
    if (road.to === 'n:2') expect(road.centerline.at(-1)).toEqual(pos);
  }
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
});

it('allocates new endpoints without connecting a grade-separated crossing', () => {
  const city = createEditor(grid5x5()).city;
  const editor = createEditor(city);
  const from = { x: 60, y: -40 },
    to = { x: 60, y: 520 };
  expect(
    editor.apply({
      kind: 'addRoad',
      newNodes: [newRoadNode(from, 1), newRoadNode(to, 1)],
      road: {
        ...city.roads['r:26']!,
        from: `n:${city.nextId}`,
        to: `n:${city.nextId + 1}`,
        centerline: [from, to],
        streetGroupId: null,
      },
    }).ok,
  ).toBe(true);
  expect(Object.keys(editor.city.nodes)).toHaveLength(27);
  expect(editor.compiled.movements).toHaveLength(createEditor(city).compiled.movements.length);
  expect(citySchema.safeParse(editor.city).success).toBe(true);
});

it('splits and merges a two-way street, preserving attributes, end rules and connector positions', () => {
  const city = createEditor(grid5x5()).city;
  const road = city.roads['r:26']!;
  city.nodes[road.to]!.turnRules.push({
    from: road.id,
    to: 'r:30',
    allowed: false,
    provenance: { source: 'authored' },
  });
  const editor = createEditor(city);
  const result = editor.apply({ kind: 'splitRoad', roadId: road.id, atM: 60 });
  expect(result.ok).toBe(true);
  const first = editor.city.roads[road.id]!;
  const second = Object.values(editor.city.roads).find(
    (r) => r.from === first.to && r.to === road.to,
  )!;
  expect(second).toBeDefined();
  expect(second.lanes).toEqual(road.lanes);
  expect(editor.city.nodes[road.to]!.turnRules[0]!.from).toBe(second.id);
  expect(editor.compiled.movements.some((m) => m.id === `${first.id}#0>${second.id}#0`)).toBe(true);
  expect(editor.apply({ kind: 'mergeRoads', roadId: first.id, otherRoadId: second.id }).ok).toBe(
    true,
  );
  expect(editor.city.roads[road.id]).toEqual(road);
  expect(editor.city.roads).toEqual(city.roads);
  expect(editor.city.nodes).toEqual(city.nodes);
  expect(editor.city.places).toEqual(city.places);
  expect(historyFileSchema.safeParse({ historyVersion: 1, entries: editor.history }).success).toBe(
    true,
  );
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city).toEqual({ ...city, version: editor.city.version });
});

it('keeps connectors on their spatial split half, including lane trimming, and restores them on merge', () => {
  const city = createEditor(grid5x5()).city;
  const place = city.places['p:104']!;
  const template = place.connectors[0]!;
  place.connectors = [10, 90].map((positionM) => ({
    ...template,
    id: `c:${city.nextId++}`,
    positionM,
  }));
  const editor = createEditor(city);
  const points = () =>
    place.connectors.map(({ id }) => {
      const c = editor.compiled.connectors[editor.compiled.index.connector.get(id)!]!;
      const lane = editor.compiled.lanes[c.lane]!;
      return pointAtDistance(lane.polyline, lane.cumulative, c.positionM);
    });
  const originalPoints = points();
  expect(editor.apply({ kind: 'splitRoad', roadId: template.roadId, atM: 60 }).ok).toBe(true);
  const split = editor.city.places[place.id]!.connectors;
  expect(split[0]!.roadId).toBe(template.roadId);
  expect(split[1]!.roadId).not.toBe(template.roadId);
  expect(points()).toEqual(originalPoints);
  expect(
    editor.apply({ kind: 'mergeRoads', roadId: split[0]!.roadId, otherRoadId: split[1]!.roadId })
      .ok,
  ).toBe(true);
  expect(editor.city.places[place.id]).toEqual(place);
});

it('rejects invalid split positions and merges that would discard controls or different attributes', () => {
  const editor = createEditor(grid5x5());
  for (const atM of [0, 120, -1, NaN])
    expect(() => editor.apply({ kind: 'splitRoad', roadId: 'r:26', atM })).toThrow('inside');
  expect(editor.history).toHaveLength(0);
  expect(editor.apply({ kind: 'splitRoad', roadId: 'r:26', atM: 60 }).ok).toBe(true);
  const first = editor.city.roads['r:26']!;
  const second = Object.values(editor.city.roads).find(
    (r) => r.from === first.to && r.to === 'n:2',
  )!;
  const merge = { kind: 'mergeRoads', roadId: first.id, otherRoadId: second.id } as const;
  editor.apply({ kind: 'setControl', nodeId: first.to, control: 'stop' });
  expect(() => editor.apply(merge)).toThrow('controls');
  editor.undo();
  editor.apply({ kind: 'setRoadAttributes', roadId: second.id, speedLimitMps: 50 });
  expect(() => editor.apply(merge)).toThrow('equal attributes');
});
