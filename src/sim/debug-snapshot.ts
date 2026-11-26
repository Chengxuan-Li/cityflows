export interface DebugRequest {
  vehicles?: boolean;
  aircraft?: boolean;
  gridlock?: boolean;
}

export interface WaitLink {
  from: number;
  to: number;
  cycle: boolean;
  stuck?: boolean;
}

export interface DebugSnapshot {
  vehicles?: {
    id: number;
    positionM: number;
    leaderId: number | null;
    gapM: number | null;
    routeLanes: number[];
    routeMovements: number[];
    intentLane: number | null;
  }[];
  aircraft?: {
    id: number;
    radiusM: number;
    /** Metres along the compiled airside edge, independent of taxi direction. */
    reservations: { edge: number; fromM: number; toM: number }[];
  }[];
  vehicleWaits?: WaitLink[];
  aircraftWaits?: WaitLink[];
}

/** A wait belongs to a ring exactly when its ends are in the same strongly connected
 * component. Iterative Kosaraju keeps long stationary queues off the call stack. */
export function markWaitCycles(links: WaitLink[]) {
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  for (const { from, to } of links) {
    if (!outgoing.has(from)) outgoing.set(from, []);
    if (!incoming.has(to)) incoming.set(to, []);
    outgoing.get(from)!.push(to);
    incoming.get(to)!.push(from);
  }
  const seen = new Set<number>();
  const order: number[] = [];
  for (const id of outgoing.keys()) {
    if (seen.has(id)) continue;
    const stack = [id];
    while (stack.length) {
      const at = stack.pop()!;
      if (at < 0) order.push(-at);
      else if (!seen.has(at)) {
        seen.add(at);
        stack.push(-at);
        for (const next of outgoing.get(at) ?? []) stack.push(next);
      }
    }
  }
  const component = new Map<number, number>();
  for (const root of order.reverse()) {
    if (component.has(root)) continue;
    const stack = [root];
    component.set(root, root);
    while (stack.length) {
      const at = stack.pop()!;
      for (const prev of incoming.get(at) ?? []) {
        if (component.has(prev)) continue;
        component.set(prev, root);
        stack.push(prev);
      }
    }
  }
  for (const link of links) link.cycle = component.get(link.from) === component.get(link.to);
  return links;
}
