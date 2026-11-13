import { describe, expect, it } from 'vitest';
import type { LevelCrossing } from '../network/level-crossings';
import { crossingColors, crossingDrawings, tramCrossingSignals } from './level-crossings';
import { operatingCrossing } from '../fixtures/operating-crossings';
import { compile } from '../network';

const rail: LevelCrossing = {
  nodes: ['rn:1'],
  kind: 'rail',
  layer: 0,
  approaches: [
    {
      roadId: 'r:1',
      pos: { x: -5, y: 0 },
      post: { x: -5, y: 3 },
      heading: 0,
      halfWidthM: 2,
      barrier: true,
      lights: true,
      bell: false,
    },
  ],
};

describe('live crossing equipment shared by both views', () => {
  it('places the tram signal on the mapped incoming track, facing its driver before the road', () => {
    const source = operatingCrossing('tram'),
      result = compile(source);
    if (!result.ok) throw new Error('fixture compilation failed');
    const graph = result.compiled.rail!,
      f = graph.facilities![0]!,
      signals = tramCrossingSignals(f, graph);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.pos.y).toBeLessThan(-3);
    expect(Math.sin(signals[0]!.heading)).toBeCloseTo(1);
    expect(Math.cos(signals[0]!.heading)).toBeCloseTo(0);
    expect(Math.abs(signals[0]!.pos.x)).toBeGreaterThan(2);
  });
  it('keeps warning arms upright, closes across the approach, and alternates lamps on simulation time', () => {
    const draw = (phase: number, timeS = 0) =>
      crossingDrawings([rail], new Uint8Array([phase]), timeS)[0]!;
    const arms = (phase: number) => draw(phase).parts.filter((p) => p.kind === 'arm');
    expect(arms(0).every((p) => p.roll === Math.PI / 2)).toBe(true);
    expect(arms(1)).toEqual(arms(0));
    expect(arms(2).every((p) => p.roll === 0 && p.bottom < 1)).toBe(true);
    expect(Math.min(...arms(2).map((p) => p.y))).toBeLessThan(rail.approaches[0]!.pos.y);
    const lamps = (phase: number, timeS: number) =>
      draw(phase, timeS)
        .parts.filter((p) => p.kind === 'lamp')
        .map((p) => p.color);
    expect(lamps(0, 0)).toEqual([crossingColors.lamp, crossingColors.lamp]);
    expect(lamps(1, 0)).toEqual([crossingColors.lit, crossingColors.lamp]);
    expect(lamps(2, 0.5)).toEqual([crossingColors.lamp, crossingColors.lit]);
    expect(draw(2, 0.5)).toEqual(draw(2, 0.5));
  });

  it('shows a tram-facing permissive only when rail has clearance, separate from the road-facing red light', () => {
    const tram = {
      ...rail,
      kind: 'tram' as const,
      approaches: [{ ...rail.approaches[0]!, barrier: false }],
    };
    const lamp = (phase: number, ready = false) =>
      crossingDrawings([tram], new Uint8Array([phase]), 0, new Uint8Array([ready ? 1 : 0]), [
        [{ pos: { x: 0, y: -8 }, heading: Math.PI / 2 }],
      ])[0]!.parts.find((p) => p.kind === 'tram-signal')!;
    expect(lamp(0).width).toBeGreaterThan(lamp(0).height);
    expect(lamp(1).width).toBeGreaterThan(lamp(1).height);
    expect(lamp(2)).toEqual(lamp(1));
    expect(lamp(2, true).height).toBeGreaterThan(lamp(2, true).width);
    expect(lamp(0, true)).toEqual(lamp(0));
  });
});
