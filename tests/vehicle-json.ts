/** Keep pre-TASK-110 vehicle hashes pinned: exclude only walk data and its final ID allocations. */
export function vehicleJson(value: unknown, arrays = false): string {
  return JSON.stringify(value, function (key, value: unknown) {
    if (key === 'walk' || key === 'sidewalk') return undefined;
    if (key === 'nextId' && typeof value === 'number') {
      const walk = (
        this as { walk?: { nodes: Record<string, unknown>; links: Record<string, unknown> } }
      ).walk;
      if (walk) return value - Object.keys(walk.nodes).length - Object.keys(walk.links).length;
    }
    return value instanceof Map
      ? [...value]
      : arrays && ArrayBuffer.isView(value)
        ? Array.from(value as unknown as number[])
        : value;
  });
}
