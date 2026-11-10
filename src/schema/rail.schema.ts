import { z } from 'zod';
import { railKinds, type RailNetwork } from './rail';

const point = z.object({ x: z.number(), y: z.number() });
const nodeId = z.string().regex(/^rn:\d+$/);
const trackId = z.string().regex(/^rt:\d+$/);
const platformId = z.string().regex(/^rp:\d+$/);
export const stationSchema = z.object({
  platforms: z.array(platformId),
  entrances: z.array(z.string().regex(/^wn:\d+$/)),
});
export const railSchema = z
  .object({
    nodes: z.record(
      nodeId,
      z.object({
        id: nodeId,
        pos: point,
        layer: z.int(),
        kind: z.enum(['plain', 'switch', 'buffer_stop', 'stop', 'level_crossing']),
        osmId: z.int().optional(),
        signal: z.boolean().optional(),
      }),
    ),
    tracks: z.record(
      trackId,
      z.object({
        id: trackId,
        from: nodeId,
        to: nodeId,
        line: z.array(point).min(2),
        kind: z.enum(railKinds),
        layer: z.int(),
        bridge: z.boolean().optional(),
        tunnel: z.boolean().optional(),
        service: z.string().optional(),
        usage: z.string().optional(),
        preferredDirection: z.enum(['forward', 'backward', 'both']).optional(),
        name: z.string().optional(),
        maxSpeedMps: z.number().positive().optional(),
        osmId: z.int().optional(),
      }),
    ),
    platforms: z.record(
      platformId,
      z.object({
        id: platformId,
        shape: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('point'), pos: point }),
          z.object({ kind: z.literal('polygon'), ring: z.array(point).min(4) }),
          z.object({ kind: z.literal('line'), line: z.array(point).min(2) }),
        ]),
        layer: z.int(),
        name: z.string(),
        ref: z.string().optional(),
        mode: z.enum(['rail', 'tram', 'bus']),
        tracks: z.array(trackId),
        station: z
          .string()
          .regex(/^p:\d+$/)
          .nullable(),
        osmId: z.int().optional(),
      }),
    ),
  })
  .superRefine((rail, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const kind of ['nodes', 'tracks', 'platforms'] as const)
      for (const [id, item] of Object.entries(rail[kind]))
        if (id !== item.id) issue([kind, id, 'id'], 'Record key must match entity id');
    for (const track of Object.values(rail.tracks)) {
      for (const end of ['from', 'to'] as const) {
        const node = rail.nodes[track[end]];
        const p = end === 'from' ? track.line[0]! : track.line.at(-1)!;
        if (!node || Math.hypot(node.pos.x - p.x, node.pos.y - p.y) > 0.001)
          issue(['tracks', track.id, end], 'Track must meet an existing endpoint');
      }
      if (!track.line.some((p) => p.x !== track.line[0]!.x || p.y !== track.line[0]!.y))
        issue(['tracks', track.id, 'line'], 'Track must have positive length');
    }
    for (const platform of Object.values(rail.platforms)) {
      for (const id of platform.tracks)
        if (!rail.tracks[id])
          issue(['platforms', platform.id, 'tracks'], 'Platform track does not exist');
      if (platform.shape.kind === 'polygon') {
        const ring = platform.shape.ring;
        if (ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y)
          issue(['platforms', platform.id, 'shape'], 'Platform ring must be closed');
      }
    }
  }) satisfies z.ZodType<RailNetwork>;
