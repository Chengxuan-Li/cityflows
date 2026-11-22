import type { Vec2 } from '../geo/vec2';
import type { MarkingShape } from './marking-geometry';

// Single-stroke pavement lettering. Each pair is a column (0–4) and row (0–6),
// starting at the pilot's upper left. Spaces separate the strokes of a glyph.
const glyphs: Record<string, string> = {
  '0': '10-30-41-45-36-16-05-01-10',
  '1': '12-20-26 06-46',
  '2': '01-10-30-41-42-05-06-46',
  '3': '00-30-41-42-23-43-45-36-06',
  '4': '30-04-44 30-36',
  '5': '40-00-03-33-44-45-36-06',
  '6': '40-20-02-05-16-36-45-44-33-03',
  '7': '00-40-16',
  '8': '10-30-41-42-33-13-02-01-10 13-04-05-16-36-45-44-33',
  '9': '43-13-02-01-10-30-41-44-26-06',
  A: '06-20-46 13-33',
  B: '06-00-30-41-42-33-03 33-44-45-36-06',
  C: '41-30-10-01-05-16-36-45',
  D: '00-30-42-44-36-06-00',
  E: '40-00-06-46 03-33',
  F: '40-00-06 03-33',
  G: '41-30-10-01-05-16-36-45-43-23',
  H: '00-06 40-46 03-43',
  I: '00-40 20-26 06-46',
  J: '00-40 30-35-26-16-05',
  K: '00-06 40-03-46',
  L: '00-06-46',
  M: '06-00-23-40-46',
  N: '06-00-46-40',
  O: '10-30-41-45-36-16-05-01-10',
  P: '06-00-30-41-42-33-03',
  Q: '10-30-41-45-36-16-05-01-10 24-46',
  R: '06-00-30-41-42-33-03 23-46',
  S: '41-30-10-01-02-13-33-44-45-36-16-05',
  T: '00-40 20-26',
  U: '00-05-16-36-45-40',
  V: '00-26-40',
  W: '00-06-23-46-40',
  X: '00-46 40-06',
  Y: '00-23-40 23-26',
  Z: '00-40-06-46',
  '-': '13-33',
  '/': '06-40',
};

export function paintAirsideText(
  text: string,
  height: number,
  world: (forward: number, right: number) => Vec2,
  forward: number,
  right: number,
  color: number,
): MarkingShape[] {
  const cell = height / 6;
  const first = right - (((text.length - 1) * 6 + 4) * cell) / 2;
  return [...text].flatMap((char, i) =>
    (glyphs[char]?.split(' ') ?? []).map((stroke) => ({
      kind: 'line',
      role: 'centre',
      color,
      alpha: 1,
      widthM: cell,
      points: stroke
        .split('-')
        .map(([col, row]) =>
          world(forward + (3 - Number(row)) * cell, first + (i * 6 + Number(col)) * cell),
        ),
    })),
  );
}
