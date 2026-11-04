import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  pointAtDistance,
  sampleBezier,
} from '../../geo/polyline';
import type { City, Command } from '../../schema';
import { applyPatch, diffCity } from '../patch';
import { editTopology } from './topology';
import { requireEntity, type CommandPatch } from './types';

type AddRamp = Extract<Command, { kind: 'addRamp' }>;

/** Endpoint tangents follow the selected carriageways, preserving merge/diverge angles. */
export function rampCenterline(city: City, from: AddRamp['from'], to: AddRamp['to']) {
  if (from.roadId === to.roadId) throw new Error('Pick two different roads');
  const endpoints = [from, to].map(({ roadId, atM }) => {
    const road = requireEntity(city.roads, roadId);
    const cumulative = cumulativeLengths(road.centerline);
    if (!Number.isFinite(atM) || atM <= 0 || atM >= cumulative.at(-1)!)
      throw new Error('Ramp endpoints must be inside their roads');
    return {
      pos: pointAtDistance(road.centerline, cumulative, atM),
      heading: headingAtDistance(road.centerline, cumulative, atM),
    };
  });
  const [start, end] = endpoints;
  const chord = distance(start!.pos, end!.pos);
  if (chord < 10) throw new Error('Ramp endpoints must be at least ten meters apart');
  const control = chord * 0.4;
  return sampleBezier(
    start!.pos,
    {
      x: start!.pos.x + Math.cos(start!.heading) * control,
      y: start!.pos.y + Math.sin(start!.heading) * control,
    },
    {
      x: end!.pos.x - Math.cos(end!.heading) * control,
      y: end!.pos.y - Math.sin(end!.heading) * control,
    },
    end!.pos,
  );
}

export function editRamp(
  city: City,
  command: Extract<Command, { kind: 'addRamp' | 'removeRamp' }>,
): CommandPatch {
  let draft = city;
  const warnings: NonNullable<CommandPatch['warnings']> = [];
  function append(next: Parameters<typeof editTopology>[1]) {
    const patch = editTopology(draft, next);
    draft = applyPatch(draft, patch);
    warnings.push(...(patch.warnings ?? []));
  }
  if (command.kind === 'addRamp') {
    const centerline = rampCenterline(city, command.from, command.to);
    const from = `n:${draft.nextId}`;
    append({ kind: 'splitRoad', ...command.from });
    const to = `n:${draft.nextId}`;
    append({ kind: 'splitRoad', ...command.to });
    append({
      kind: 'addRoad',
      newNodes: [],
      road: {
        from,
        to,
        centerline,
        lateralOffsetM: 0,
        lanes: [{ widthM: 3.5, allowed: ['car', 'truck', 'bus'] }],
        roadClass: 'ramp',
        speedLimitMps: city.roads[command.to.roadId]!.speedLimitMps,
        name: null,
        streetGroupId: null,
        provenance: { source: 'authored' },
      },
    });
  } else {
    const ramp = requireEntity(city.roads, command.roadId);
    if (ramp.roadClass !== 'ramp') throw new Error('Select a ramp to remove');
    append({ kind: 'deleteRoad', roadId: ramp.id });
    for (const node of [ramp.from, ramp.to]) {
      const incoming = Object.values(draft.roads).find((road) => road.to === node);
      const outgoing =
        incoming &&
        Object.values(draft.roads).find((road) => road.from === node && road.to !== incoming.from);
      if (!incoming || !outgoing) throw new Error('Ramp endpoints must join two split roads');
      append({ kind: 'mergeRoads', roadId: incoming.id, otherRoadId: outgoing.id });
    }
  }
  return { ...diffCity(city, draft), warnings };
}
