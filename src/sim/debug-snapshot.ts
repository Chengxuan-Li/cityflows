/** TASK-373: sim state for the developer debug views, computed only when a snapshot request asks
 * for it. It only reads the run's state: normal runs, their hashes and their snapshots are the
 * same with or without it. */
export interface DebugRequest {
  vehicles?: boolean;
  aircraft?: boolean;
  gridlock?: boolean;
}

/** `from` waits for `to` (public ids); `ring`: the link is on a closed wait-for ring. */
export interface WaitLink {
  from: number;
  to: number;
  ring: boolean;
}

export interface VehicleDebug {
  id: number;
  /** The physical leader's public id and the gap to its rear, else 0 and NaN. */
  leader: number;
  gapM: number;
  /** Why it stands or moves: 0 moving, 1 in a queue, 2 a head held at its junction, 3 jammed
   * (the gridlock timer runs), 4 parking, 5 arriving at its destination. */
  wait: number;
  /** Movements ahead on the route, at most eight. */
  route: number[];
  /** The adjacent lane a mandatory change waits for, else -1. */
  wantsLane: number;
}

export interface AircraftDebug {
  id: number;
  /** Half the body plus the claim margin, on the ground; 0 in the air. */
  radiusM: number;
  /** Claimed stretches, in stations along compiled airside edges. */
  reserved: { edge: number; fromM: number; toM: number }[];
}

export interface DebugSnapshot {
  vehicles?: VehicleDebug[];
  aircraft?: AircraftDebug[];
  vehicleWaits?: WaitLink[];
  aircraftWaits?: WaitLink[];
}

/** Marks the links inside a strongly connected component of two or more members (Tarjan,
 * iterative: a long standing queue would overflow the call stack). */
export function markRings(links: WaitLink[]) {
  const out = new Map<number, number[]>();
  for (const { from, to } of links) {
    let list = out.get(from);
    if (!list) out.set(from, (list = []));
    list.push(to);
  }
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const component = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  let counter = 0;
  for (const root of out.keys()) {
    if (index.has(root)) continue;
    const work: [node: number, edge: number][] = [[root, 0]];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work.at(-1)!;
      const [node, edge] = top;
      const next = out.get(node)?.[edge];
      if (next !== undefined) {
        top[1]++;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          work.push([next, 0]);
        } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work.at(-1)![0];
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
      if (low.get(node) === index.get(node)) {
        let member: number;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.set(member, node);
        } while (member !== node);
      }
    }
  }
  for (const link of links)
    link.ring = link.from !== link.to && component.get(link.from) === component.get(link.to);
  return links;
}
