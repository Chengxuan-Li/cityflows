import type { WalkGraph } from '../network';
import { MinHeap } from './heap';

export type WalkPosition =
  { node: number } | { link: number; positionM: number } | { placeId: string };
export interface WalkRequest {
  from: WalkPosition;
  to: WalkPosition;
  speedMps?: number;
  stepsFactor?: number;
}
export interface WalkLeg {
  link: number;
  fromM: number;
  toM: number;
}
export interface WalkRoute {
  links: number[];
  legs: WalkLeg[];
  lengthM: number;
  costS: number;
}
export type WalkResult =
  { ok: true; route: WalkRoute } | { ok: false; reason: 'no_path' | 'position_unreachable' };

/** Bidirectional walking, shortest by time. Scratch arrays and heap are reused per router.
 * `checkSkips` (the engine's `debugSkips`) checks each kept link time and far end against the
 * link itself and throws on a difference. */
export function createWalkRouter(graph: WalkGraph, checkSkips = false) {
  const costs = new Float64Array(graph.nodes.length);
  const previous = new Int32Array(graph.nodes.length),
    via = new Int32Array(graph.nodes.length);
  // TASK-243: a node's cost, previous node and link count only when stamped by the current
  // request (Infinity, -1 and -1 otherwise), instead of filling the three arrays each request.
  const stamps = new Uint32Array(graph.nodes.length);
  let stamp = 0;
  // Each node's links in compressed rows, in `nodes[node].links` order, with the far end and
  // the full link's walking time at the speed and steps factor last asked for.
  const linkStart = new Int32Array(graph.nodes.length + 1);
  const linkIdx = new Int32Array(graph.nodes.reduce((sum, node) => sum + node.links.length, 0));
  const linkFar = new Int32Array(linkIdx.length);
  let at = 0;
  graph.nodes.forEach((node, n) => {
    linkStart[n] = at;
    for (const idx of node.links) {
      const link = graph.links[idx]!;
      linkIdx[at] = idx;
      linkFar[at++] = link.from === n ? link.to : link.from;
    }
  });
  linkStart[graph.nodes.length] = at;
  const linkTime = new Float64Array(linkIdx.length);
  let timeSpeed = NaN,
    timeSteps = NaN;
  const heap = new MinHeap();
  return {
    route(request: WalkRequest): WalkResult {
      const speed = request.speedMps ?? 1.4,
        steps = request.stepsFactor ?? 0.6;
      if (!(speed > 0 && Number.isFinite(speed) && steps > 0 && steps <= 1))
        throw new Error('Walking speed must be positive; steps factor must be in (0, 1]');
      const time = (link: number, length: number) =>
        length / (speed * (graph.links[link]!.kind === 'steps' ? steps : 1));
      type End = { node: number; cost: number; leg?: WalkLeg };
      const ends = (position: WalkPosition, start: boolean): End[] => {
        if ('placeId' in position)
          return (graph.places.get(position.placeId) ?? []).map((node) => ({ node, cost: 0 }));
        if ('node' in position)
          return graph.nodes[position.node] ? [{ node: position.node, cost: 0 }] : [];
        const link = graph.links[position.link],
          s = position.positionM;
        if (!link || !Number.isFinite(s) || s < 0 || s > link.lengthM) return [];
        return [
          {
            node: link.from,
            cost: time(link.idx, s),
            leg: { link: link.idx, fromM: start ? s : 0, toM: start ? 0 : s },
          },
          {
            node: link.to,
            cost: time(link.idx, link.lengthM - s),
            leg: { link: link.idx, fromM: start ? s : link.lengthM, toM: start ? link.lengthM : s },
          },
        ];
      };
      const origins = ends(request.from, true),
        targets = ends(request.to, false);
      if (!origins.length || !targets.length) return { ok: false, reason: 'position_unreachable' };
      let best = Infinity,
        finish = -1,
        tail: WalkLeg | undefined,
        direct: WalkLeg | undefined;
      if ('link' in request.from && 'link' in request.to && request.from.link === request.to.link) {
        direct = {
          link: request.from.link,
          fromM: request.from.positionM,
          toM: request.to.positionM,
        };
        best = time(direct.link, Math.abs(direct.toM - direct.fromM));
      }
      if (speed !== timeSpeed || steps !== timeSteps) {
        for (let row = 0; row < linkIdx.length; row++)
          linkTime[row] = time(linkIdx[row]!, graph.links[linkIdx[row]!]!.lengthM);
        timeSpeed = speed;
        timeSteps = steps;
      }
      if (stamp === 0xffffffff) {
        stamps.fill(0);
        stamp = 0;
      }
      const mark = ++stamp;
      const reach = (n: number) => {
        if (stamps[n] === mark) return;
        stamps[n] = mark;
        costs[n] = Infinity;
        previous[n] = -1;
        via[n] = -1;
      };
      heap.clear();
      const roots = new Map<number, WalkLeg | undefined>();
      for (const origin of origins) {
        reach(origin.node);
        if (origin.cost < costs[origin.node]!) {
          costs[origin.node] = origin.cost;
          roots.set(origin.node, origin.leg);
          heap.push(origin.node, origin.cost);
        }
      }
      let node: number | undefined;
      while ((node = heap.pop()) !== undefined) {
        const cost = heap.cost;
        if (cost >= best) break;
        if (cost !== costs[node]) continue;
        for (const target of targets)
          if (target.node === node && cost + target.cost < best) {
            best = cost + target.cost;
            finish = node;
            tail = target.leg;
            direct = undefined;
          }
        for (let at = linkStart[node]!, end = linkStart[node + 1]!; at < end; at++) {
          const next = linkFar[at]!,
            value = cost + linkTime[at]!;
          if (checkSkips) {
            const link = graph.links[linkIdx[at]!]!;
            if (
              next !== (link.from === node ? link.to : link.from) ||
              linkTime[at] !== time(link.idx, link.lengthM)
            )
              throw new Error(`Walk link ${link.idx} differs from its kept time or end`);
          }
          reach(next);
          if (value >= costs[next]!) continue;
          costs[next] = value;
          previous[next] = node;
          via[next] = linkIdx[at]!;
          heap.push(next, value);
        }
      }
      if (!Number.isFinite(best)) return { ok: false, reason: 'no_path' };
      let legs: WalkLeg[] = [];
      if (direct) legs = [direct];
      else {
        let current = finish;
        while (previous[current] !== -1) {
          const idx = via[current]!,
            link = graph.links[idx]!,
            forward = link.to === current;
          legs.push({
            link: idx,
            fromM: forward ? 0 : link.lengthM,
            toM: forward ? link.lengthM : 0,
          });
          current = previous[current]!;
        }
        legs.reverse();
        const first = roots.get(current);
        if (first) legs.unshift(first);
        if (tail) legs.push(tail);
      }
      legs = legs.filter((leg) => Math.abs(leg.toM - leg.fromM) > 1e-9);
      return {
        ok: true,
        route: {
          legs,
          links: legs.map((leg) => leg.link),
          lengthM: legs.reduce((s, leg) => s + Math.abs(leg.toM - leg.fromM), 0),
          costS: best,
        },
      };
    },
  };
}
