import { buildCity, generated } from './build-city';
import type { Node, Road } from '../schema';

/** Explicit lane connections make the four lane-block transitions independently inspectable. */
export function continuity(seed = 1) {
  const { city, node, road } = buildCity('Lane continuity', seed);
  const connect = (at: Node, from: Road, to: Road, pairs: [number, number][]) => {
    at.turnRules.push({ from: from.id, to: to.id, allowed: false, provenance: generated });
    for (const [fromLane, toLane] of pairs)
      at.turnRules.push({
        from: from.id,
        to: to.id,
        fromLane,
        toLane,
        allowed: true,
        provenance: generated,
      });
  };
  const split = node(0, 0);
  const trunk = road(node(-180, 0), split, { lanes: 5 });
  const left = road(split, node(180, -35), { lanes: 3 });
  const right = road(split, node(180, 35), { lanes: 2 });
  connect(split, trunk, left, [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
  connect(split, trunk, right, [
    [3, 0],
    [4, 1],
  ]);

  const merge = node(0, 160);
  const leftIn = road(node(-180, 125), merge, { lanes: 3 });
  const rightIn = road(node(-180, 195), merge, { lanes: 2 });
  const joined = road(merge, node(180, 160), { lanes: 5 });
  connect(merge, leftIn, joined, [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
  connect(merge, rightIn, joined, [
    [0, 3],
    [1, 4],
  ]);

  for (const [y, before, after] of [
    [320, 3, 2],
    [440, 2, 3],
  ]) {
    const seam = node(0, y!);
    const from = road(node(-180, y!), seam, { lanes: before! });
    const to = road(seam, node(180, y!), { lanes: after! });
    connect(seam, from, to, [
      [0, 0],
      [1, 1],
    ]);
  }
  return city;
}
