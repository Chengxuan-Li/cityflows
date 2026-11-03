interface Entry {
  node: number;
  cost: number;
}

function precedes(a: Entry, b: Entry): boolean {
  return a.cost < b.cost || (a.cost === b.cost && a.node < b.node);
}

export class MinHeap {
  private readonly entries: Entry[] = [];

  push(entry: Entry): void {
    const entries = this.entries;
    let index = entries.length;
    entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!precedes(entry, entries[parent]!)) break;
      entries[index] = entries[parent]!;
      index = parent;
    }
    entries[index] = entry;
  }

  pop(): Entry | undefined {
    const entries = this.entries;
    const first = entries[0];
    const last = entries.pop();
    if (!last || entries.length === 0) return first;

    let index = 0;
    while (index * 2 + 1 < entries.length) {
      let child = index * 2 + 1;
      if (child + 1 < entries.length && precedes(entries[child + 1]!, entries[child]!)) child++;
      if (!precedes(entries[child]!, last)) break;
      entries[index] = entries[child]!;
      index = child;
    }
    entries[index] = last;
    return first;
  }
}
