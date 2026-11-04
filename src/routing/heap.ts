export class MinHeap {
  private readonly nodes: number[] = [];
  private readonly costs: number[] = [];
  private size = 0;
  cost = 0;

  clear(): void {
    this.size = 0;
  }

  push(node: number, cost: number): void {
    const { nodes, costs } = this;
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (cost > costs[parent]! || (cost === costs[parent] && node >= nodes[parent]!)) break;
      nodes[index] = nodes[parent]!;
      costs[index] = costs[parent]!;
      index = parent;
    }
    nodes[index] = node;
    costs[index] = cost;
  }

  pop(): number | undefined {
    if (this.size === 0) return undefined;
    const { nodes, costs } = this;
    const first = nodes[0]!;
    this.cost = costs[0]!;
    const size = --this.size;
    const lastNode = nodes[size]!;
    const lastCost = costs[size]!;
    let index = 0;
    // Move the smaller children up first, then insert the last entry from the
    // bottom. This avoids comparing it at every level on the usual long descent.
    while (index * 2 + 1 < size) {
      let child = index * 2 + 1;
      if (
        child + 1 < size &&
        (costs[child + 1]! < costs[child]! ||
          (costs[child + 1] === costs[child] && nodes[child + 1]! < nodes[child]!))
      )
        child++;
      nodes[index] = nodes[child]!;
      costs[index] = costs[child]!;
      index = child;
    }
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (lastCost > costs[parent]! || (lastCost === costs[parent] && lastNode >= nodes[parent]!))
        break;
      nodes[index] = nodes[parent]!;
      costs[index] = costs[parent]!;
      index = parent;
    }
    nodes[index] = lastNode;
    costs[index] = lastCost;
    return first;
  }
}
