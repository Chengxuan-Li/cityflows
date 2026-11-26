import type { CompiledCity } from './types';

/**
 * The router's lane-change rule (architecture section 7): the lanes a vehicle on lane `from` at
 * `startM` can reach by adjacent changes, each `changeDistanceM` of travel, while the position
 * stays within `endM` and within every lane crossed; with the number of changes. Lives here so the
 * importer judges gateway lanes by the rule the router routes by (TASK-286).
 */
export function* reachableLanes(
  compiled: CompiledCity,
  allowed: boolean[],
  from: number,
  endM: number,
  changeDistanceM: number,
  startM = 0,
) {
  if (!allowed[from] || startM > endM) return;
  yield { lane: from, changes: 0 };
  for (const side of ['left', 'right'] as const) {
    let lane = from;
    for (let changes = 1; ; changes++) {
      const positionM = startM + changes * changeDistanceM;
      const current = compiled.lanes[lane]!;
      const next = current[side];
      if (
        next === -1 ||
        !allowed[next] ||
        positionM > endM ||
        positionM > current.lengthM ||
        positionM > compiled.lanes[next]!.lengthM
      )
        break;
      yield { lane: next, changes };
      lane = next;
    }
  }
}
