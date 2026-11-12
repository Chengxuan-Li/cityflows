import { expect, test } from 'vitest';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';

test('T75 Munich crossing controls cover every legal entry without claiming parallel running streets', () => {
  const result = compile(loadAuditCity('munich'));
  if (!result.ok) throw new Error('Munich compilation failed');
  const city = result.compiled;
  const facility = (roadId: string) =>
    city.rail!.facilities!.find((f) => f.approaches.some((a) => a.roadId === roadId))!;
  for (const [crossing, road] of [
    ['r:269', 'r:364'],
    ['r:968', 'r:248'],
  ] as const) {
    const controls = facility(crossing).stops!;
    for (const lane of city.roads.find((r) => r.id === road)!.lanes.slice(0, 2))
      expect(
        controls.find((s) => s.lane === lane),
        city.lanes[lane]!.id,
      ).toEqual({ lane, stopM: city.lanes[lane]!.stopM });
  }
  const west = facility('r:978');
  expect(west.railSpans!.every((s) => s.toM - s.fromM < 30)).toBe(true);
  expect(west.spans!.some((s) => s.segment === 1066)).toBe(false);
  for (const roadId of ['r:702', 'r:928']) {
    const road = city.roads.find((r) => r.id === roadId)!;
    expect(
      facility('r:269').spans!.some((s) => s.segment >= 0 && road.lanes.includes(s.segment)),
      roadId,
    ).toBe(false);
  }
});
