import { expect, test } from 'vitest';
import { auditCities, loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { cityHeights, heightAt, heightSlopeAt } from '../../src/render3d/heights';
import { tierCities } from '../tier';

test.each(tierCities(auditCities))(
  'V98 %s road ends join junction heights continuously',
  (name) => {
    const city = loadAuditCity(name);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    // This gate pins the original grade-only profile. V105 exercises terrain separately.
    const heights = cityHeights(result.compiled, { ...city, terrain: undefined });
    let worst = { road: '', deltaM: 0, atM: 0, lengthM: 0, deckM: 0, fromM: 0, toM: 0 };
    let ramps = 0;
    let gradeZeroRamps = 0;

    for (const road of result.compiled.roads) {
      const h = heights.roads[road.idx]!;
      expect(heightAt(h, 0)).toBe(h.fromM);
      expect(heightAt(h, h.lengthM)).toBe(h.toM);
      const extremum = h.deckM > Math.max(h.fromM, h.toM) || h.deckM < Math.min(h.fromM, h.toM);
      if (h.fromM === h.toM || extremum) expect(heightAt(h, h.lengthM / 2)).toBe(h.deckM);
      if (result.compiled.nodes[road.from]!.outline.length) expect(heightSlopeAt(h, 0)).toBe(0);
      if (result.compiled.nodes[road.to]!.outline.length)
        expect(heightSlopeAt(h, h.lengthM)).toBe(0);
      for (let s = 0; s <= h.lengthM; s += 0.5) {
        expect(heightAt(h, s)).toBeGreaterThanOrEqual(Math.min(h.fromM, h.toM, h.deckM) - 1e-8);
        expect(heightAt(h, s)).toBeLessThanOrEqual(Math.max(h.fromM, h.toM, h.deckM) + 1e-8);
        if (!extremum)
          expect(heightSlopeAt(h, s) * Math.sign(h.toM - h.fromM)).toBeGreaterThanOrEqual(-1e-8);
      }
      for (const end of [0, h.lengthM]) {
        expect(Math.abs(heightAt(h, end + 1e-4) - heightAt(h, end))).toBeLessThan(1e-5);
        expect(Math.abs(heightAt(h, end - 1e-4) - heightAt(h, end))).toBeLessThan(1e-5);
      }
      if (h.deckM === 0 && h.fromM === 0 && h.toM === 0)
        for (let s = 0; s <= h.lengthM; s += 0.5) expect(heightAt(h, s)).toBe(0);
      if (h.deckM === h.fromM && h.deckM === h.toM) continue;
      ramps++;
      if (h.deckM === 0) gradeZeroRamps++;
      for (let s = 0; s < h.lengthM; s += 0.5) {
        const deltaM = Math.abs(heightAt(h, Math.min(s + 0.5, h.lengthM)) - heightAt(h, s));
        if (deltaM > worst.deltaM) worst = { road: road.id, deltaM, atM: s, ...h };
      }
    }
    for (const movement of result.compiled.movements) {
      const node = result.compiled.nodes[movement.node]!;
      if (
        node.outline.length ||
        node.control !== 'uncontrolled' ||
        movement.neverGreen ||
        movement.turn === 'uturn'
      )
        continue;
      const before = heights.roads[result.compiled.lanes[movement.fromLane]!.road]!;
      const after = heights.roads[result.compiled.lanes[movement.toLane]!.road]!;
      expect(heightSlopeAt(before, before.lengthM)).toBeCloseTo(heightSlopeAt(after, 0), 12);
    }
    if (name === 'munich') {
      for (const id of ['r:702', 'r:928']) {
        const road = heights.roads[result.compiled.index.road.get(id)!]!;
        expect(heightAt(road, road.lengthM / 2)).toBeLessThan(8);
        const maximum = Math.max(
          ...Array.from({ length: 101 }, (_, i) =>
            Math.abs(heightSlopeAt(road, (road.lengthM * i) / 100)),
          ),
        );
        expect(maximum).toBeLessThan(0.13);
      }
    }
    console.info(
      JSON.stringify({ name, ramps, gradeZeroRamps, worst, maximumSampledSlope: 2 * worst.deltaM }),
    );
  },
);
