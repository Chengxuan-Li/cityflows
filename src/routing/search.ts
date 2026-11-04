import { MinHeap } from './heap';

type Relax = (to: number, cost: number, via?: number) => void;

export function createPathSearch() {
  let costs = new Float64Array(0);
  let previous = new Int32Array(0);
  let edges = new Int32Array(0);
  const queue = new MinHeap();
  return function shortestPath(
    nodeCount: number,
    origin: number,
    destination: number,
    originCost: number,
    expand: (node: number, relax: Relax) => void,
  ) {
    if (costs.length < nodeCount) {
      costs = new Float64Array(nodeCount);
      previous = new Int32Array(nodeCount);
      edges = new Int32Array(nodeCount);
    }
    costs.fill(Infinity, 0, nodeCount);
    queue.clear();
    costs[origin] = originCost;
    queue.push(origin, originCost);

    let current = origin;
    let currentCost = originCost;
    const relax: Relax = (node, cost, via = -1) => {
      const total = currentCost + cost;
      if (total >= costs[node]!) return;
      costs[node] = total;
      previous[node] = current;
      edges[node] = via;
      queue.push(node, total);
    };

    for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
      const cost = queue.cost;
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
  };
}
