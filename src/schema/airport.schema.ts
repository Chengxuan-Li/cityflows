import { z } from 'zod';
import { aircraftCodes } from './aircraft';
import { airsideEdgeKinds, airsideSurfaceKinds, standKinds, type Airport } from './airport';

const point = z.object({ x: z.number(), y: z.number() });
const ring = z.array(point).min(3);
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:\\d+$`));
const nodeId = id('an');
const edgeId = id('ae');
const runwayId = id('rw');
const standId = id('st');
const gateId = id('gt');
const terminalId = id('tm');
const code = z.enum(aircraftCodes).nullable();
const provenance = z.object({
  source: z.enum(['osm', 'authored', 'generated']),
  osmIds: z.array(z.int()).optional(),
  inferred: z.array(z.string()).optional(),
});
const runwayEnd = z.object({
  designator: z.string().min(1),
  node: nodeId,
  pos: point,
  threshold: z.object({ node: nodeId, pos: point }),
  displacedM: z.number().nonnegative(),
  heading: z.number(),
});

const daySeconds = z.number().min(0).max(86_400);
export const runwayOperationsSchema = z.object({
  configurations: z
    .array(
      z.object({
        id: z.string().min(1),
        arrivalEnds: z.array(z.string().min(1)).min(1),
        departureEnds: z.array(z.string().min(1)).min(1),
      }),
    )
    .optional(),
  concepts: z
    .array(
      z.object({
        startS: daySeconds,
        endS: daySeconds,
        configurationId: z.string().min(1).nullable(),
      }),
    )
    .optional(),
  tailwindLimitKt: z.number().nonnegative().optional(),
});

export const airportSchema = z
  .object({
    name: z.string().nullable(),
    iata: z.string().optional(),
    icao: z.string().optional(),
    boundary: z.array(ring).min(1).optional(),
    nodes: z.record(
      nodeId,
      z.object({
        id: nodeId,
        pos: point,
        layer: z.int(),
        osmId: z.int().optional(),
        provenance,
      }),
    ),
    edges: z.record(
      edgeId,
      z.object({
        id: edgeId,
        from: nodeId,
        to: nodeId,
        line: z.array(point).min(2),
        kind: z.enum(airsideEdgeKinds),
        layer: z.int(),
        widthM: z.number().positive(),
        maxCode: code,
        ref: z.string().optional(),
        name: z.string().optional(),
        surface: z.string().optional(),
        oneway: z.literal(true).optional(),
        runway: runwayId.optional(),
        stand: standId.optional(),
        provenance,
      }),
    ),
    runways: z.record(
      runwayId,
      z.object({
        id: runwayId,
        ref: z.string().min(1),
        ends: z.tuple([runwayEnd, runwayEnd]),
        edges: z.array(edgeId).min(1),
        lengthM: z.number().positive(),
        widthM: z.number().positive(),
        surface: z.string().optional(),
        maxCode: code,
        stopways: z.array(z.array(point).min(2)),
        osmIds: z.array(z.int()),
        provenance,
      }),
    ),
    holdingPositions: z.record(
      id('hp'),
      z.object({
        id: id('hp'),
        node: nodeId,
        ref: z.string().optional(),
        kind: z.enum(['runway', 'intermediate']),
        runway: runwayId.nullable(),
        side: z.enum(['left', 'right']).nullable(),
        toward: edgeId.nullable(),
        osmId: z.int().optional(),
        provenance,
      }),
    ),
    stands: z.record(
      standId,
      z.object({
        id: standId,
        ref: z.string().optional(),
        kind: z.enum(standKinds),
        pos: point,
        heading: z.number(),
        leadIn: z.array(edgeId),
        gate: gateId.nullable(),
        maxCode: code,
        osmIds: z.array(z.int()),
        provenance,
      }),
    ),
    gates: z.record(
      gateId,
      z.object({
        id: gateId,
        ref: z.string().optional(),
        pos: point,
        terminal: terminalId.nullable(),
        osmId: z.int().optional(),
      }),
    ),
    terminals: z.record(
      terminalId,
      z.object({
        id: terminalId,
        name: z.string().optional(),
        rings: z.array(ring).min(1),
        group: z.int().nonnegative(),
        osmId: z.int().optional(),
      }),
    ),
    helipads: z.record(
      id('hl'),
      z.object({
        id: id('hl'),
        pos: point,
        ring: ring.optional(),
        ref: z.string().optional(),
        name: z.string().optional(),
        osmId: z.int().optional(),
      }),
    ),
    surfaces: z.array(
      z.object({
        kind: z.enum(airsideSurfaceKinds),
        rings: z.array(ring).min(1),
        name: z.string().optional(),
        ref: z.string().optional(),
        surface: z.string().optional(),
        osmId: z.int().optional(),
      }),
    ),
    hangars: z.array(
      z.object({
        rings: z.array(ring).min(1),
        name: z.string().optional(),
        ref: z.string().optional(),
        osmId: z.int().optional(),
      }),
    ),
    windsocks: z.array(z.object({ pos: point, lit: z.boolean().optional(), osmId: z.int() })),
    approachAids: z.array(
      z.object({
        kind: z.string(),
        pos: point,
        facing: z.number().optional(),
        runway: runwayId.optional(),
        end: z.string().optional(),
        osmId: z.int(),
      }),
    ),
    turnPads: z.array(z.object({ pos: point, node: nodeId.optional(), osmId: z.int().optional() })),
    roadCrossings: z.array(
      z.object({
        edge: edgeId,
        pos: point,
        roads: z.array(z.string().regex(/^r:\d+$/)).min(1),
        roadOsmIds: z.array(z.int()),
        osmId: z.int().optional(),
      }),
    ),
    runwayOperations: runwayOperationsSchema.optional(),
  })
  .superRefine((airport, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const kind of [
      'nodes',
      'edges',
      'runways',
      'holdingPositions',
      'stands',
      'gates',
      'terminals',
      'helipads',
    ] as const)
      for (const [key, item] of Object.entries(airport[kind]))
        if (key !== item.id) issue([kind, key, 'id'], 'Record key must match entity id');
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y) <= 0.001;
    for (const edge of Object.values(airport.edges)) {
      for (const end of ['from', 'to'] as const) {
        const node = airport.nodes[edge[end]];
        if (!node || !near(node.pos, end === 'from' ? edge.line[0]! : edge.line.at(-1)!))
          issue(['edges', edge.id, end], 'Edge must meet an existing endpoint');
      }
      if (edge.runway && !airport.runways[edge.runway])
        issue(['edges', edge.id, 'runway'], 'Edge runway does not exist');
      if (edge.stand && !airport.stands[edge.stand])
        issue(['edges', edge.id, 'stand'], 'Edge stand does not exist');
    }
    for (const runway of Object.values(airport.runways)) {
      let at = runway.ends[0].node;
      for (const [i, id] of runway.edges.entries()) {
        const edge = airport.edges[id];
        if (!edge || edge.kind !== 'runway' || edge.from !== at)
          issue(['runways', runway.id, 'edges', i], 'Runway edges must chain from end to end');
        else at = edge.to;
      }
      if (at !== runway.ends[1].node)
        issue(['runways', runway.id, 'edges'], 'Runway edges must reach its far end');
      for (const [i, end] of runway.ends.entries())
        for (const node of [end.node, end.threshold.node])
          if (!airport.nodes[node]) issue(['runways', runway.id, 'ends', i], 'End node missing');
    }
    for (const hold of Object.values(airport.holdingPositions)) {
      if (!airport.nodes[hold.node])
        issue(['holdingPositions', hold.id, 'node'], 'Hold node does not exist');
      if (hold.runway && !airport.runways[hold.runway])
        issue(['holdingPositions', hold.id, 'runway'], 'Hold runway does not exist');
      if (hold.toward && !airport.edges[hold.toward])
        issue(['holdingPositions', hold.id, 'toward'], 'Hold edge does not exist');
    }
    for (const stand of Object.values(airport.stands)) {
      for (const id of stand.leadIn)
        if (airport.edges[id]?.stand !== stand.id)
          issue(['stands', stand.id, 'leadIn'], 'Lead-in edge must belong to its stand');
      if (stand.gate && !airport.gates[stand.gate])
        issue(['stands', stand.id, 'gate'], 'Stand gate does not exist');
    }
    for (const [i, crossing] of airport.roadCrossings.entries())
      if (!airport.edges[crossing.edge])
        issue(['roadCrossings', i, 'edge'], 'Crossing edge does not exist');
    for (const gate of Object.values(airport.gates))
      if (gate.terminal && !airport.terminals[gate.terminal])
        issue(['gates', gate.id, 'terminal'], 'Gate terminal does not exist');
    const designators = new Set(
      Object.values(airport.runways).flatMap(({ ends }) => ends.map((end) => end.designator)),
    );
    const operations = airport.runwayOperations;
    for (const [i, configuration] of (operations?.configurations ?? []).entries())
      for (const end of [...configuration.arrivalEnds, ...configuration.departureEnds])
        if (!designators.has(end))
          issue(['runwayOperations', 'configurations', i], `Runway end ${end} does not exist`);
  }) satisfies z.ZodType<Airport>;
