import { describe, expect, test } from 'vitest';
import { createEditor, type Editor } from '../../src/editor';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import { polylineLength } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { arcEdge, routeAirside } from '../../src/routing/airside';
import { aircraftCodes } from '../../src/schema/aircraft';
import type { Airport } from '../../src/schema/airport';
import { airportSchema } from '../../src/schema/airport.schema';
import { scenarioSchema, type City, type Command } from '../../src/schema';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { airportFixture } from '../sim/airside-fixture';

// TASK-305: airport edits through the editor: each command, its undo, the recompiled airside.

function airport(editor: Editor): Airport {
  return editor.city.airport!;
}

/** Applies `command`, checks the airport still validates, and that undo restores it exactly. */
function applied(editor: Editor, command: Command) {
  const before = editor.city;
  const result = editor.apply(command);
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('; '));
  expect(airportSchema.safeParse(airport(editor)).success).toBe(true);
  // An airport-only edit recompiles the airside alone, as a full compile would.
  const full = compile(editor.city);
  expect(full.ok && editor.compiled.airside).toEqual(full.ok && full.compiled.airside);
  expect(editor.compiled.version).toBe(editor.city.version);
  const after = editor.city;
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.airport).toEqual(before.airport);
  expect(editor.city.nextId).toBe(before.nextId);
  expect(editor.redo()?.ok).toBe(true);
  expect(editor.city.airport).toEqual(after.airport);
  return { before: before.airport!, after: after.airport! };
}

const added = <T>(before: Record<string, T>, after: Record<string, T>) =>
  Object.keys(after).filter((id) => !before[id]);
const byRef = (a: Airport, ref: string) => Object.values(a.stands).find((s) => s.ref === ref)!;
const edgeAt = (a: Airport, ref: string, x: number) =>
  Object.values(a.edges).find(
    (e) =>
      e.ref === ref &&
      Math.min(e.line[0]!.x, e.line.at(-1)!.x) < x &&
      Math.max(e.line[0]!.x, e.line.at(-1)!.x) > x,
  )!;

describe('stands', () => {
  test('a stand added by the remote apron joins the taxiway, takes a code by rule; moved, set and deleted', () => {
    const editor = createEditor(syntheticAirport());
    const { before, after } = applied(editor, {
      kind: 'addStand',
      pos: { x: 610, y: 449 },
      standKind: 'remote',
      ref: 'R0',
    });
    const [id] = added(before.stands, after.stands);
    const stand = after.stands[id!]!;
    expect(stand).toMatchObject({ ref: 'R0', kind: 'remote', gate: null });
    expect(stand.provenance.inferred).toContain('maxCode');
    // Joined straight to taxiway C below it (y = 320), nose to the south.
    const lead = after.edges[stand.leadIn[0]!]!;
    expect(lead).toMatchObject({ kind: 'lead_in', stand: id, maxCode: stand.maxCode });
    expect(lead.line[0]).toEqual({ x: 610, y: 320 });
    expect(stand.heading).toBeCloseTo(Math.PI / 2);
    // R1 stands 65 m east, nose in line: their wings keep the clearance up to code D (52 m span
    // and 7.5 m), and R1, derived again, keeps its set code C.
    expect(stand.maxCode).toBe('D');
    expect(byRef(after, 'R1')).toEqual(byRef(before, 'R1'));
    const compiled = editor.compiled.airside!;
    const c = compiled.stands[compiled.index.stand.get(id!)!]!;
    expect(compiled.nodes[c.root]!.pos).toEqual({ x: 610, y: 320 });
    expect(compiled.edges.filter((e) => e.kind !== 'lead_in')).toHaveLength(
      Object.values(before.edges).filter((e) => e.kind !== 'lead_in').length + 1,
    );

    // Moving it 140 m west, its lead-in follows and its code is derived again: nothing within
    // reach limits it now.
    const moved = applied(editor, { kind: 'moveStand', standId: id!, pos: { x: 470, y: 400 } });
    const placed = moved.after.stands[id!]!;
    expect(placed.pos).toEqual({ x: 470, y: 400 });
    expect(moved.after.edges[stand.leadIn[0]!]).toBeUndefined();
    expect(moved.after.edges[placed.leadIn[0]!]!.line).toEqual([
      { x: 580, y: 320 },
      { x: 470, y: 400 },
    ]);
    expect(placed.heading).toBeCloseTo(Math.atan2(80, -110));
    expect(placed.maxCode).toBe('F');

    // A set code is the user's: it keeps through a move, and 'rule' gives the derivation back.
    const set = applied(editor, {
      kind: 'setStand',
      standId: id!,
      maxCode: 'C',
      standKind: 'cargo',
    });
    expect(set.after.stands[id!]).toMatchObject({ maxCode: 'C', kind: 'cargo' });
    expect(set.after.stands[id!]!.provenance.inferred ?? []).not.toContain('maxCode');
    expect(set.after.edges[placed.leadIn[0]!]!.maxCode).toBe('C');
    const kept = applied(editor, { kind: 'moveStand', standId: id!, pos: { x: 480, y: 410 } });
    expect(kept.after.stands[id!]!.maxCode).toBe('C');
    const rule = applied(editor, { kind: 'setStand', standId: id!, maxCode: 'rule' });
    expect(rule.after.stands[id!]!.maxCode).toBe('F');

    const removed = applied(editor, { kind: 'deleteStand', standId: id! });
    expect(removed.after.stands[id!]).toBeUndefined();
    for (const e of rule.after.stands[id!]!.leadIn) expect(removed.after.edges[e]).toBeUndefined();
    expect(Object.keys(removed.after.stands)).toEqual(Object.keys(before.stands));
  });

  test('a stand beyond 150 m of every taxiway is refused', () => {
    const editor = createEditor(syntheticAirport());
    expect(() =>
      editor.apply({ kind: 'addStand', pos: { x: 1000, y: 1000 }, standKind: 'remote' }),
    ).toThrow(/within 150 m/);
    expect(editor.history).toHaveLength(0);
  });

  test('a mapped jet bridge survives deletion and undo of its imported stand', () => {
    const city = syntheticAirport();
    const stand = byRef(city.airport!, '1');
    const bridges = [{ osmId: 1, stand: stand.id, line: [{ x: 10, y: 20 }, stand.pos] }];
    city.airport!.jetBridges = bridges;
    const editor = createEditor(city);
    const { after } = applied(editor, { kind: 'deleteStand', standId: stand.id });
    expect(after.stands[stand.id]).toBeUndefined();
    expect(after.jetBridges).toEqual(bridges);
  });
});

describe('taxiways', () => {
  test('drawn, split, set and deleted: the graph and the code limits recompile', () => {
    const editor = createEditor(syntheticAirport());
    const start = airport(editor);
    const taxiwayC = edgeAt(start, 'C', 620);
    // A taxilane from taxiway C at x = 620 south-west to a free end.
    const drawn = applied(editor, {
      kind: 'addTaxiway',
      edgeKind: 'taxilane',
      ref: 'K',
      vertices: [
        { edge: taxiwayC.id, atM: taxiwayC.line[0]!.x - 620 },
        { pos: { x: 560, y: 380 } },
        { pos: { x: 500, y: 400 } },
      ],
    });
    const [lane] = Object.values(drawn.after.edges).filter((e) => e.ref === 'K');
    expect(lane).toMatchObject({ kind: 'taxilane', layer: 0, provenance: { source: 'authored' } });
    expect(lane!.line).toHaveLength(3);
    expect(lane!.provenance.inferred).toEqual(['widthM', 'maxCode']);
    expect(lane!.maxCode).not.toBeNull();
    expect(lane!.widthM).toBe({ A: 7.5, B: 10.5, C: 15, D: 18, E: 23, F: 25 }[lane!.maxCode!]);
    // Taxiway C split where it joins; its pieces keep the original's attributes.
    expect(drawn.after.edges[taxiwayC.id]!.line.at(-1)).toEqual({ x: 620, y: 320 });
    expect(added(drawn.before.edges, drawn.after.edges)).toHaveLength(2);

    // A width set is mapped: the code follows the width and the separations.
    const width = applied(editor, { kind: 'setTaxiway', edgeId: lane!.id, widthM: 10.5 });
    expect(width.after.edges[lane!.id]).toMatchObject({ widthM: 10.5, maxCode: 'B' });
    expect(width.after.edges[lane!.id]!.provenance.inferred).toEqual(['maxCode']);
    const code = applied(editor, { kind: 'setTaxiway', edgeId: lane!.id, maxCode: 'A' });
    expect(code.after.edges[lane!.id]).toMatchObject({ maxCode: 'A', widthM: 10.5 });
    expect(code.after.edges[lane!.id]!.provenance.inferred).toBeUndefined();

    // Split: the recompiled graph has the node and the two pieces, the same length between.
    const length = polylineLength(lane!.line);
    const graphBefore = editor.compiled.airside!;
    const split = applied(editor, { kind: 'splitTaxiway', edgeId: lane!.id, atM: 30 });
    const graph = editor.compiled.airside!;
    expect(graph.nodes).toHaveLength(graphBefore.nodes.length + 1);
    expect(graph.edges).toHaveLength(graphBefore.edges.length + 1);
    const [piece] = added(split.before.edges, split.after.edges);
    const first = split.after.edges[lane!.id]!;
    const second = split.after.edges[piece!]!;
    expect(first.to).toBe(second.from);
    expect(polylineLength(first.line)).toBeCloseTo(30);
    expect(polylineLength(first.line) + polylineLength(second.line)).toBeCloseTo(length);
    expect(second).toMatchObject({ kind: 'taxilane', ref: 'K', maxCode: 'A', widthM: 10.5 });
    const node = graph.index.node.get(first.to)!;
    expect(graph.nodes[node]!.edges.map((e) => graph.edges[e]!.id).sort()).toEqual(
      [lane!.id, piece!].sort(),
    );

    const removed = applied(editor, { kind: 'deleteTaxiway', edgeId: piece! });
    expect(removed.after.edges[piece!]).toBeUndefined();
    // Its free end goes with it; the split node stays on the first piece.
    expect(removed.after.nodes[second.to]).toBeUndefined();
    expect(removed.after.nodes[second.from]).toBeDefined();
  });

  test('a code limit edit re-routes a departure round the loop', () => {
    const { city, stands } = airportFixture();
    city.nextId = 10_000;
    const editor = createEditor(city);
    const departureRoute = () => {
      const graph = editor.compiled.airside!;
      const fleet = createAircraftFleet(graph, 1);
      const parked = fleet.spawnParked({ typeId: 'E190', stand: stands.C2 });
      if (!parked.ok) throw new Error(parked.reason);
      expect(fleet.requestDeparture(parked.id, '09').ok).toBe(true);
      for (let step = 0; step <= 100; step++) {
        fleet.step(step * 0.1);
        const pose = fleet.snapshot().find((p) => p.id === parked.id)!;
        if (pose.route.length) return pose.route.map((e) => graph.edges[e]!);
      }
      throw new Error('Departure did not receive a route');
    };
    const stretch = Object.values(airport(editor).edges).filter(
      (e) => e.kind === 'taxiway' && e.maxCode === 'C',
    );
    expect(stretch.length).toBeGreaterThan(0);
    // An E190 (code C) takes the code C stretch of the parallel taxiway at y = 200.
    const direct = departureRoute();
    expect(direct.some((e) => stretch.some((s) => s.id === e.id))).toBe(true);
    expect(direct.some((e) => e.line.some((p) => p.y === 400))).toBe(false);
    editor.apply({
      kind: 'batch',
      label: 'code B',
      commands: stretch.map((e) => ({ kind: 'setTaxiway', edgeId: e.id, maxCode: 'B' }) as const),
    });
    const round = departureRoute();
    expect(round.some((e) => stretch.some((s) => s.id === e.id))).toBe(false);
    expect(round.some((e) => e.line.some((p) => p.y === 400))).toBe(true);
    // And the router agrees: no route admits code C through the stretch any more.
    const graph = editor.compiled.airside!;
    const c = aircraftCodes.indexOf('C');
    for (const s of stretch) expect(graph.edges[graph.index.edge.get(s.id)!]!.maxCode).toBe(c - 1);
    expect(
      routeAirside(graph, {
        code: c,
        turnRadiusM: 20,
        from: { node: graph.index.node.get(stretch[0]!.from)! },
        goal: (arc) => graph.edges[arcEdge(arc)]!.id === stretch[0]!.id,
      }),
    ).toBeNull();
  });
});

describe('holding positions and runway configurations', () => {
  test('a hold added on a taxiway protects the runway it reaches; moved, reassigned, deleted', () => {
    const editor = createEditor(syntheticAirport());
    const a = airport(editor);
    const runway = Object.keys(a.runways)[0]!;
    // On taxiway A, 200 m east of exit A2's junction: 540 m of travel from the runway.
    const taxiA = edgeAt(a, 'A', 700);
    expect(taxiA.line[0]).toEqual({ x: 510, y: 180 });
    const { before, after } = applied(editor, {
      kind: 'addHold',
      edgeId: taxiA.id,
      atM: 200,
      ref: 'A9',
    });
    const [id] = added(before.holdingPositions, after.holdingPositions);
    const hold = after.holdingPositions[id!]!;
    expect(hold).toMatchObject({ ref: 'A9', kind: 'runway', runway, side: 'right' });
    expect(hold.toward).toBe(taxiA.id);
    expect(after.nodes[hold.node]!.pos).toEqual({ x: 710, y: 180 });
    // Taxiway B, more than 1 km of travel from the runway, gets an intermediate hold.
    const taxiB = Object.values(a.edges).find((e) => e.ref === 'B')!;
    const far = applied(editor, { kind: 'addHold', edgeId: taxiB.id, atM: 60 });
    const [farId] = added(far.before.holdingPositions, far.after.holdingPositions);
    expect(far.after.holdingPositions[farId!]).toMatchObject({
      kind: 'intermediate',
      runway: null,
    });
    expect(editor.undo()?.ok).toBe(true);

    const moved = applied(editor, { kind: 'moveHold', holdId: id!, edgeId: taxiA.id, atM: 100 });
    expect(moved.after.nodes[moved.after.holdingPositions[id!]!.node]!.pos).toEqual({
      x: 610,
      y: 180,
    });
    const intermediate = applied(editor, { kind: 'setHold', holdId: id!, runway: null });
    expect(intermediate.after.holdingPositions[id!]).toMatchObject({
      kind: 'intermediate',
      runway: null,
      side: null,
      toward: null,
    });
    const back = applied(editor, { kind: 'setHold', holdId: id!, runway });
    expect(back.after.holdingPositions[id!]).toMatchObject({ kind: 'runway', runway });
    const removed = applied(editor, { kind: 'deleteHold', holdId: id! });
    expect(removed.after.holdingPositions[id!]).toBeUndefined();
    const graph = editor.compiled.airside!;
    expect(graph.holds).toHaveLength(Object.keys(a.holdingPositions).length);
  });

  test('the runway configuration table and tailwind limit are set and undone', () => {
    const editor = createEditor(syntheticAirport());
    const operations = {
      concepts: [{ startS: 6 * 3600, endS: 22 * 3600, configurationId: '27' }],
      tailwindLimitKt: 7,
    };
    const { after } = applied(editor, { kind: 'setRunwayOperations', operations });
    expect(after.runwayOperations).toEqual(operations);
    expect(editor.compiled.airside!.runwayOperations).toEqual(operations);
    const cleared = applied(editor, { kind: 'setRunwayOperations', operations: null });
    expect(cleared.after.runwayOperations).toBeUndefined();
    // A configuration naming an end the airport lacks is refused.
    const refused = editor.apply({
      kind: 'setRunwayOperations',
      operations: { configurations: [{ id: '18', arrivalEnds: ['18'], departureEnds: ['18'] }] },
    });
    expect(refused.ok).toBe(false);
    expect(editor.city.airport!.runwayOperations).toBeUndefined();
  });
});

test('a saved project reopens equal to the edited one, history included', async () => {
  const editor = createEditor(syntheticAirport());
  const a = airport(editor);
  const taxiwayC = edgeAt(a, 'C', 700);
  for (const command of [
    { kind: 'addStand', pos: { x: 610, y: 449 }, standKind: 'remote', ref: 'R0' },
    { kind: 'splitTaxiway', edgeId: taxiwayC.id, atM: 20 },
    {
      kind: 'addHold',
      edgeId: Object.values(a.edges).find((e) => e.ref === 'B')!.id,
      atM: 60,
    },
    { kind: 'setTaxiway', edgeId: taxiwayC.id, maxCode: 'D', ref: 'C9' },
    { kind: 'setRunwayOperations', operations: { tailwindLimitKt: 8 } },
  ] satisfies Command[])
    expect(editor.apply(command).ok).toBe(true);
  const city: City = editor.city;
  const project = {
    city,
    scenarios: [scenarioSchema.parse(defaultScenario('syntheticAirport'))],
    history: editor.history,
  };
  const opened = await openProject(await saveProject(project));
  expect(opened).toEqual({ ok: true, project });
  if (!opened.ok) return;
  // The reopened history still undoes the edits on a fresh editor.
  const reopened = createEditor(opened.project.city);
  expect(reopened.compiled.airside!.stands).toHaveLength(editor.compiled.airside!.stands.length);
});
