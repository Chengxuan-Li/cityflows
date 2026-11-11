import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { citySchema, migrateCity, type City } from '../../src/schema';
import { dualSingle } from '../importers/junction-group-osm';
import { vehicleJson } from '../vehicle-json';

// TASK-131 Phase 1: the junction group in the city model, its compile index and editing.

function imported(signal: boolean): City {
  const result = importOsm(dualSingle(20, signal), { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}
/** The city's hash without `version`, the edit counter every commit (an undo too) bumps. */
function cityHash(city: City) {
  return createHash('sha256')
    .update(JSON.stringify({ ...city, version: 0 }))
    .digest('hex');
}

describe('T68 junction groups in the model', () => {
  it('T68.6: an old city loads with no groups and today’s compiled result', () => {
    const city = grid5x5();
    const loaded = migrateCity(JSON.parse(JSON.stringify(city)));
    expect(loaded.junctionGroups).toBeUndefined();
    const result = compile(loaded);
    if (!result.ok) throw new Error('grid must compile');
    expect(result.compiled.groups).toBeUndefined();
    expect(result.compiled.nodes.some((n) => 'group' in n)).toBe(false);
    // V106's pinned compiled hash of the grid, unchanged by the schema.
    expect(createHash('sha256').update(vehicleJson(result)).digest('hex')).toBe(
      '296948629376e758231293088f0cdb136d7554c269b0d0880a92577177e913a6',
    );
  });

  it('T68.7: the schema and the compile check groups', () => {
    const city = imported(true);
    expect(citySchema.safeParse(city).success).toBe(true);
    expect(migrateCity(JSON.parse(JSON.stringify(city)))).toEqual(city);
    const group = Object.values(city.junctionGroups!)[0]!;
    const broken = (edit: (c: City) => void) => {
      const copy = structuredClone(city);
      edit(copy);
      const compiled = compile(copy);
      return {
        schema: citySchema.safeParse(copy).success,
        codes: compiled.ok ? [] : compiled.diagnostics.map((d) => d.code),
      };
    };
    // A member with a program of its own, an inner road that leaves the group, a node in two
    // groups, a missing member: each fails the schema and the compile.
    for (const edit of [
      (c: City) => (c.nodes[group.nodes[0]!]!.signal = group.signal),
      (c: City) => c.junctionGroups![group.id]!.innerRoads.push('r:3'),
      (c: City) =>
        (c.junctionGroups!['jg:999'] = {
          ...group,
          id: 'jg:999',
          signal: null,
          nodes: group.nodes,
        }),
      (c: City) => c.junctionGroups![group.id]!.nodes.push('n:99999'),
    ])
      expect(broken(edit)).toEqual({
        schema: false,
        codes: expect.arrayContaining(['junction_group_invalid']),
      });
    // A green group naming a road that does not enter the group is a program error.
    expect(
      broken((c) => (c.junctionGroups![group.id]!.signal!.phases[0]!.groups[0]!.from = 'r:5'))
        .codes,
    ).toContain('signal_phase_invalid');
  });

  it('T68.8: the compile indexes each node’s group, inner roads, entries, exits and chains', () => {
    const city = imported(false);
    const result = compile(city);
    if (!result.ok) throw new Error('must compile');
    const net = result.compiled;
    const group = net.groups![0]!;
    expect(net.index.group!.get(group.id)).toBe(0);
    expect(group.nodes.map((n) => net.nodes[n]!.id)).toEqual(['n:2', 'n:7']);
    for (const n of group.nodes) expect(net.nodes[n]!.group).toBe(0);
    expect(group.innerRoads.map((r) => net.roads[r]!.id)).toEqual(['r:14', 'r:15']);
    for (const r of group.innerRoads) expect(net.roads[r]!.group).toBe(0);
    expect(net.nodes.filter((n) => n.group !== undefined)).toHaveLength(2);
    const ids = (list: number[]) => list.map((r) => net.roads[r]!.id).sort();
    expect(ids(group.entries)).toEqual(['r:12', 'r:18', 'r:3', 'r:8']);
    expect(ids(group.exits)).toEqual(['r:10', 'r:13', 'r:17', 'r:5']);
    for (const chain of group.chains) {
      // A chain runs lane to lane from its entry to its exit through member nodes only.
      const first = net.movements[chain.movements[0]!]!;
      const last = net.movements[chain.movements.at(-1)!]!;
      expect(net.lanes[first.fromLane]!.road).toBe(chain.from);
      expect(net.lanes[last.toLane]!.road).toBe(chain.to);
      chain.movements.forEach((m, i) => {
        expect(group.nodes).toContain(net.movements[m]!.node);
        if (i)
          expect(net.movements[m]!.fromLane).toBe(net.movements[chain.movements[i - 1]!]!.toLane);
      });
    }
  });

  it('T68.9: a topology edit dissolves a signalised group into member programs; undo restores it', () => {
    const city = imported(true);
    const editor = createEditor(city);
    const before = cityHash(editor.city);
    const result = editor.apply({ kind: 'splitRoad', roadId: 'r:14', atM: 10 });
    expect(result.ok).toBe(true);
    expect(Object.keys(editor.city.junctionGroups ?? {})).toEqual([]);
    for (const id of ['n:2', 'n:7']) {
      expect(editor.city.nodes[id]!.control).toBe('signal');
      expect(editor.city.nodes[id]!.signal).not.toBeNull();
    }
    expect(editor.undo()?.ok).toBe(true);
    expect(cityHash(editor.city)).toBe(before);
    expect(editor.redo()?.ok).toBe(true);
    expect(editor.undo()?.ok).toBe(true);
    expect(cityHash(editor.city)).toBe(before);
  });

  it('T68.10: a control change on a member applies to the whole group', () => {
    const editor = createEditor(imported(true));
    const program = Object.values(editor.city.junctionGroups!)[0]!.signal!;
    expect(editor.apply({ kind: 'setControl', nodeId: 'n:7', control: 'stop' }).ok).toBe(true);
    const group = Object.values(editor.city.junctionGroups!)[0]!;
    expect(group.signal).toBeNull();
    for (const id of group.nodes) {
      expect(editor.city.nodes[id]!.control).toBe('stop');
      expect(editor.city.nodes[id]!.signal).toBeNull();
    }
    expect(editor.compiled.nodes.every((n) => !n.signal)).toBe(true);
    expect(
      editor.apply({ kind: 'setControl', nodeId: 'n:2', control: 'signal', signal: program }).ok,
    ).toBe(true);
    expect(Object.values(editor.city.junctionGroups!)[0]!.signal).toEqual(program);
    for (const id of group.nodes) expect(editor.city.nodes[id]!.control).toBe('signal');
  });
});
