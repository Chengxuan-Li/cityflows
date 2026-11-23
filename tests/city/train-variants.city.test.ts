import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { railTimetable } from '../../src/network/trams';
import { builtVariant, trainVariantFor } from '../../src/render3d/train-variants';

// TASK-332: the variant each bundled city's routes are drawn with. London City's Elizabeth Line
// runs as `mainline` (it calls nowhere in the extract), so the rule gives it the DB train; the
// Heathrow extract's timetable has no Link Line route, only the Piccadilly line.
test.for([
  ['london-city-airport', { dlr: 4, intercity: 2 }],
  ['heathrow', { tube: 1 }],
  ['munich', { sbahn: 2, intercity: 18, tram: 4 }],
  ['freiburg', { sbahn: 5, tram: 8 }],
  ['philadelphia', { nyc: 4, sbahn: 3, tram: 1 }],
  ['york', { intercity: 4 }],
  ['luebeck', { intercity: 3 }],
] as const)('%s routes take their variants', async ([id, expected]) => {
  const { city } = await openBundled(id);
  const result = compile(city);
  if (!result.ok) throw Error(id);
  const rail = result.compiled.rail!;
  const table = railTimetable(rail);
  const counts: Record<string, number> = {};
  for (const route of table.routes) {
    const variant = trainVariantFor(route, rail, city.drivingSide);
    counts[variant] = (counts[variant] ?? 0) + 1;
    // Philadelphia's Broad Street and Market-Frankford lines are its subway routes.
    if (variant === 'nyc')
      expect(
        route.sections.some((s) =>
          /Broad Street|Market-Frankford/.test(rail.tracks[s.track]!.name ?? ''),
        ),
      ).toBe(true);
    // Until TASK-333 and TASK-334, the S-Bahn stands in for the variants not built yet.
    expect(builtVariant(variant).id).toBe(variant === 'tram' ? 'tram' : 'sbahn');
  }
  expect(counts).toEqual(expected);
});
