/** A muted green-to-red scale shared by facility glyphs in both views. */
export function parkingColor(occupied: number, capacity: number): number {
  const ratio = capacity === 0 ? 1 : Math.min(1, occupied / capacity);
  const from = ratio < 0.7 ? [121, 170, 153] : [211, 175, 105];
  const to = ratio < 0.7 ? [211, 175, 105] : [186, 101, 91];
  const t = ratio < 0.7 ? ratio / 0.7 : (ratio - 0.7) / 0.3;
  const [r, g, b] = from.map((value, i) => Math.round(value + (to[i]! - value) * t));
  return (r! << 16) | (g! << 8) | b!;
}

export const parkingRadiusM = 5;
