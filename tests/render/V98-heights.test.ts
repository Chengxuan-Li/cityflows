import { expect, test } from 'vitest';
import { auditCities, loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { cityHeights, heightAt } from '../../src/render3d/heights';
import { tierCities } from '../tier';

test.each(tierCities(auditCities))(
  'V98 %s road ends join junction heights continuously',
  (name) => {
    const city = loadAuditCity(name);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const heights = cityHeights(result.compiled, city);
    let worst = { road: '', deltaM: 0, atM: 0, lengthM: 0, deckM: 0, fromM: 0, toM: 0 };
    let ramps = 0;
    let gradeZeroRamps = 0;

    for (const road of result.compiled.roads) {
      const h = heights.roads[road.idx]!;
      expect(heightAt(h, 0)).toBe(h.fromM);
      expect(heightAt(h, h.lengthM)).toBe(h.toM);
      expect(heightAt(h, h.lengthM / 2)).toBe(h.deckM);
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
    console.info(
      JSON.stringify({ name, ramps, gradeZeroRamps, worst, maximumSampledSlope: 2 * worst.deltaM }),
    );
  },
);
