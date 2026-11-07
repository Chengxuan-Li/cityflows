import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  pointAtDistance,
  polylineLength,
  sampleBezier,
} from '../../geo/polyline';
import type { City, Command, Road, TurnRule } from '../../schema';
import { applyPatch, diffCity } from '../patch';
import { editTopology, relocateConnectors } from './topology';
import { requireEntity, type CommandPatch } from './types';

type AddRamp = Extract<Command, { kind: 'addRamp' }>;

function taperRules(incoming: Road, taper: Road, rampId: string, right: boolean): TurnRule[] {
  const rules: TurnRule[] = [];
  const curb = right ? taper.lanes.length - 1 : 0;
  for (const from of [incoming, { id: rampId, lanes: [taper.lanes[curb]!] }]) {
    for (let fromLane = 0; fromLane < from.lanes.length; fromLane++) {
      for (let toLane = 0; toLane < taper.lanes.length; toLane++) {
        rules.push({
          from: from.id,
          to: taper.id,
          fromLane,
          toLane,
          allowed: from.id === rampId ? toLane === curb : toLane === fromLane + (right ? 0 : 1),
          provenance: { source: 'authored' },
        });
      }
    }
  }
  return rules;
}

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
    if (polylineLength(city.roads[command.to.roadId]!.centerline) - command.to.atM <= 60)
      throw new Error('The receiving road needs more than 60 meters after the ramp join');
    const from = `n:${draft.nextId}`;
    append({ kind: 'splitRoad', ...command.from });
    const to = `n:${draft.nextId}`;
    append({ kind: 'splitRoad', ...command.to });
    const receiving = Object.values(draft.roads).find(
      (r) => r.from === to && r.to === city.roads[command.to.roadId]!.to,
    )!;
    append({ kind: 'splitRoad', roadId: receiving.id, atM: 60 });
    const rampId = `r:${draft.nextId}`;
    const taper = draft.roads[receiving.id]!;
    const right = city.drivingSide === 'right';
    const extra = {
      widthM: 3.5,
      allowed: ['car', 'van', 'truck', 'bus'] as Road['lanes'][number]['allowed'],
    };
    const lanes = right ? [...taper.lanes, extra] : [extra, ...taper.lanes];
    const rules = taperRules(draft.roads[command.to.roadId]!, { ...taper, lanes }, rampId, right);
    // Install the rules with the ramp so intermediate compiles never see a dangling rule.
    append({
      kind: 'addRoad',
      newNodes: [],
      road: {
        from,
        to,
        centerline,
        lateralOffsetM:
          receiving.lateralOffsetM +
          (right ? 1 : -1) *
            (receiving.lanes.reduce((sum, lane) => sum + lane.widthM, 0) / 2 + extra.widthM / 2),
        lanes: [{ widthM: 3.5, allowed: ['car', 'van', 'truck', 'bus'] }],
        roadClass: 'ramp',
        speedLimitMps: city.roads[command.to.roadId]!.speedLimitMps,
        name: null,
        streetGroupId: null,
        provenance: { source: 'authored' },
      },
    });
    const beforeTaper = draft;
    draft = applyPatch(draft, {
      set: {
        roads: {
          [taper.id]: {
            ...draft.roads[taper.id]!,
            lanes,
            lateralOffsetM: taper.lateralOffsetM + ((right ? 1 : -1) * extra.widthM) / 2,
          },
        },
        nodes: { [to]: { ...draft.nodes[to]!, turnRules: rules } },
        places: Object.fromEntries(
          Object.values(draft.places).map((place) => [
            place.id,
            {
              ...place,
              connectors: place.connectors.map((c) =>
                !right && c.roadId === taper.id ? { ...c, lane: c.lane + 1 } : c,
              ),
            },
          ]),
        ),
      },
      remove: {},
    });
    const changes = diffCity(beforeTaper, draft);
    // Physical lanes stay in place; only the curb lane and the join's movements are new.
    draft = applyPatch(beforeTaper, relocateConnectors(beforeTaper, changes));
  } else {
    const ramp = requireEntity(city.roads, command.roadId);
    if (ramp.roadClass !== 'ramp') throw new Error('Select a ramp to remove');
    const join = draft.nodes[ramp.to]!;
    const feed = join.turnRules.find(
      (rule) => rule.from === ramp.id && rule.allowed && rule.toLane !== undefined,
    );
    if (feed) {
      const taper = requireEntity(draft.roads, feed.to);
      const next = Object.values(draft.roads).find(
        (r) => r.from === taper.to && r.to !== taper.from,
      );
      const right = city.drivingSide === 'right';
      const curb = right ? taper.lanes.length - 1 : 0;
      if (
        !next ||
        Math.abs(polylineLength(taper.centerline) - 60) > 1e-6 ||
        taper.lanes.length !== next.lanes.length + 1 ||
        feed.toLane !== curb
      )
        throw new Error('Ramp taper has incompatible intervening edits');
      const incoming = Object.values(draft.roads).find(
        (r) => r.to === join.id && r.id !== ramp.id && r.from !== taper.to,
      );
      if (
        !incoming ||
        JSON.stringify(join.turnRules) !==
          JSON.stringify(taperRules(incoming, taper, ramp.id, right))
      )
        throw new Error('Ramp taper has incompatible intervening edits');
      const extra = taper.lanes[curb]!;
      const reduced = {
        ...taper,
        lanes: taper.lanes.filter((_, i) => i !== curb),
        lateralOffsetM: taper.lateralOffsetM - ((right ? 1 : -1) * extra.widthM) / 2,
      };
      const beforeReduction = draft;
      draft = applyPatch(draft, {
        set: {
          roads: { [taper.id]: reduced },
          nodes: { [join.id]: { ...join, turnRules: [] } },
          places: Object.fromEntries(
            Object.values(draft.places).map((place) => [
              place.id,
              {
                ...place,
                connectors: place.connectors.map((c) =>
                  c.roadId === taper.id
                    ? {
                        ...c,
                        lane: Math.min(
                          reduced.lanes.length - 1,
                          Math.max(0, c.lane - (right ? 0 : 1)),
                        ),
                      }
                    : c,
                ),
              },
            ]),
          ),
        },
        remove: {},
      });
      draft = applyPatch(
        beforeReduction,
        relocateConnectors(beforeReduction, diffCity(beforeReduction, draft)),
      );
      append({ kind: 'mergeRoads', roadId: taper.id, otherRoadId: next.id });
    }
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
