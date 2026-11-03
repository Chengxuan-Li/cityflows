import { MinHeap } from './heap';

type Relax = (to: number, cost: number, via?: number) => void;

export function shortestPath(
  nodeCount: number,
  origin: number,
  destination: number,
  originCost: number,
  expand: (node: number, relax: Relax) => void,
) {
  const costs = new Float64Array(nodeCount).fill(Infinity);
  const previous = new Int32Array(nodeCount).fill(-1);
  const edges = new Int32Array(nodeCount);
  const queue = new MinHeap();
  costs[origin] = originCost;
  queue.push({ node: origin, cost: originCost });

  let current = origin;
  let currentCost = originCost;
  const relax: Relax = (node, cost, via = -1) => {
    const total = currentCost + cost;
    if (total >= costs[node]!) return;
    costs[node] = total;
    previous[node] = current;
    edges[node] = via;
    queue.push({ node, cost: total });
  };

  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const { node, cost } = entry;
    if (cost !== costs[node]) continue;
    if (node === destination) {
      const nodes = [node];
      const via: number[] = [];
      for (let step = node; step !== origin; step = previous[step]!) {
        via.push(edges[step]!);
        nodes.push(previous[step]!);
      }
      return { nodes: nodes.reverse(), via: via.reverse(), costS: cost };
    }
    current = node;
    currentCost = cost;
    expand(node, relax);
  }
  return null;
}
