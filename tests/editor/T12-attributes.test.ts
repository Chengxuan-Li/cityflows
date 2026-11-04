import { expect, it } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import type { City, Command } from '../../src/schema';

const city = grid5x5();
const road = Object.values(city.roads).find((road) => road.streetGroupId === null)!;
const paired = Object.values(city.roads).find((road) => road.streetGroupId !== null)!;
const signalNode = Object.values(city.nodes).find((node) => node.signal)!;
const place = Object.values(city.places)[0]!;
const outgoing = Object.values(city.roads).find((other) => other.from === road.to)!;
const rule = { from: road.id, to: outgoing.id, allowed: false, provenance: road.provenance };
const connectorId = `c:${city.nextId}`;
const addedPlaceId = `p:${city.nextId}`;

const cases: { command: Command; setup?: Command; verify: (edited: City) => void }[] = [
  {
    command: { kind: 'setRoadLanes', roadId: road.id, lanes: [...road.lanes, ...road.lanes] },
    verify: (edited) => expect(edited.roads[road.id]!.lanes).toHaveLength(2),
  },
  {
    command: {
      kind: 'setRoadAttributes',
      roadId: road.id,
      roadClass: 'primary',
      speedLimitMps: 20,
      name: 'Market Street',
    },
    verify: (edited) =>
      expect(edited.roads[road.id]).toMatchObject({
        roadClass: 'primary',
        speedLimitMps: 20,
        name: 'Market Street',
      }),
  },
  {
    command: { kind: 'reverseRoad', roadId: road.id },
    verify: (edited) =>
      expect(edited.roads[road.id]).toMatchObject({
        from: road.to,
        to: road.from,
        centerline: [city.nodes[road.to]!.pos, city.nodes[road.from]!.pos],
      }),
  },
  {
    command: {
      kind: 'setStreetDirection',
      streetGroupId: paired.streetGroupId!,
      direction: paired.id,
    },
    verify: (edited) =>
      expect(Object.keys(edited.roads)).toHaveLength(Object.keys(city.roads).length - 1),
  },
  {
    command: { kind: 'setTurnRule', nodeId: road.to, rule },
    verify: (edited) => expect(edited.nodes[road.to]!.turnRules).toContainEqual(rule),
  },
  {
    setup: { kind: 'setTurnRule', nodeId: road.to, rule },
    command: { kind: 'clearTurnRule', nodeId: road.to, rule },
    verify: (edited) => expect(edited.nodes[road.to]!.turnRules).toEqual([]),
  },
  {
    command: { kind: 'setControl', nodeId: road.to, control: 'stop', minorRoads: [road.id] },
    verify: (edited) =>
      expect(edited.nodes[road.to]).toMatchObject({ control: 'stop', minorRoads: [road.id] }),
  },
  {
    command: {
      kind: 'setSignal',
      nodeId: signalNode.id,
      signal: { ...signalNode.signal!, offsetS: 6 },
    },
    verify: (edited) => expect(edited.nodes[signalNode.id]!.signal!.offsetS).toBe(6),
  },
  {
    command: {
      kind: 'addPlace',
      place: {
        ...place,
        name: 'New place',
        connectors: [{ ...place.connectors[0]!, id: connectorId }],
      },
    },
    verify: (edited) => {
      const id = `p:${city.nextId + 1}`;
      expect(edited.places[id]).toMatchObject({
        id,
        name: 'New place',
        connectors: [{ id: connectorId }],
      });
      expect(edited.nextId).toBe(city.nextId + 2);
    },
  },
  {
    command: { kind: 'updatePlace', placeId: place.id, patch: { jobs: 100 } },
    verify: (edited) => expect(edited.places[place.id]!.jobs).toBe(100),
  },
  {
    command: {
      kind: 'setConnectors',
      placeId: place.id,
      connectors: [{ ...place.connectors[0]!, id: connectorId }],
    },
    verify: (edited) => {
      expect(edited.places[place.id]!.connectors).toMatchObject([{ id: connectorId }]);
      expect(edited.nextId).toBe(city.nextId + 1);
    },
  },
  {
    command: { kind: 'deletePlace', placeId: place.id },
    verify: (edited) => expect(edited.places[place.id]).toBeUndefined(),
  },
  {
    command: {
      kind: 'batch',
      label: 'Add and configure a place',
      commands: [
        { kind: 'addPlace', place: { ...place, connectors: [], capacity: null } },
        { kind: 'updatePlace', placeId: addedPlaceId, patch: { capacity: 10 } },
      ],
    },
    verify: (edited) => expect(edited.places[addedPlaceId]!.capacity).toBe(10),
  },
];

it.each(cases)(
  'T12 $command.kind applies, undoes and redoes one history entry',
  ({ command, setup, verify }) => {
    const editor = createEditor(city);
    if (setup) expect(editor.apply(setup).ok).toBe(true);
    const original = editor.city;
    const historyLength = editor.history.length;

    const result = editor.apply(command);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const edited = editor.city;
    verify(edited);
    expect(edited.version).toBe(original.version + 1);
    expect(editor.compiled.version).toBe(edited.version);
    expect(editor.history).toHaveLength(historyLength + 1);
    expect(editor.history.at(-1)).toMatchObject({
      label: command.kind === 'batch' ? command.label : command.kind,
      version: edited.version,
    });

    expect(editor.undo()?.ok).toBe(true);
    expect(editor.city).toEqual({ ...original, version: edited.version + 1 });
    expect(editor.canRedo).toBe(true);
    expect(editor.redo()?.ok).toBe(true);
    expect(editor.city).toEqual({ ...edited, version: edited.version + 2 });
    expect(editor.canRedo).toBe(false);
    expect(editor.history).toHaveLength(historyLength + 1);
  },
);

it('shares untouched records and discards redo when a new edit commits', () => {
  const editor = createEditor(city);
  expect(editor.undo()).toBeNull();
  expect(editor.redo()).toBeNull();
  expect(editor.apply({ kind: 'setRoadAttributes', roadId: road.id, name: 'First' }).ok).toBe(true);
  expect(editor.city.roads[paired.id]).toBe(city.roads[paired.id]);
  expect(editor.city.nodes).toBe(city.nodes);
  expect(editor.city.places).toBe(city.places);
  editor.undo();
  expect(editor.canUndo).toBe(false);
  expect(editor.apply({ kind: 'setRoadAttributes', roadId: road.id, name: 'Second' }).ok).toBe(
    true,
  );
  expect(editor.redo()).toBeNull();
  expect(editor.history).toHaveLength(1);
});
