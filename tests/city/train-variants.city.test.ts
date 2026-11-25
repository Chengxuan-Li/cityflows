import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { railTimetable } from '../../src/network/trams';
import { builtVariant, trainVariantFor } from '../../src/render3d/train-variants';

// TASK-332: the variant each bundled city's routes are drawn with. London City's Elizabeth Line
// runs as `mainline` (it calls nowhere in the extract). TASK-333 draws both stopping and through
// rail services in left-hand-traffic cities as Elizabeth-line trains. Heathrow's timetable has
// no Link Line route, only the Piccadilly line.
test.for([
  ['london-city-airport', { dlr: 4, elizabeth: 2 }],
  ['heathrow', { tube: 1 }],
  ['munich', { sbahn: 2, intercity: 18, tram: 4 }],
  ['freiburg', { sbahn: 5, tram: 8 }],
  ['philadelphia', { nyc: 4, sbahn: 3, tram: 1 }],
  ['york', { elizabeth: 4 }],
  ['luebeck', { intercity: 3 }],
] as const)('%s routes take their variants', async ([id, expected]) => {
  const { city } = await openBundled(id);
  const result = compile(city);
  if (!result.ok) throw Error(id);
  const rail = result.compiled.rail!;
  const table = railTimetable(rail);
  const counts: Record<string, number> = {};
  const subwayLines = new Set<string>();
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
    if (variant === 'tube' || variant === 'nyc') {
      for (const { track } of route.sections) {
        const { kind, name } = rail.tracks[track]!;
        if (kind === 'subway' && name) subwayLines.add(name);
      }
    }
    expect(builtVariant(variant).id).toBe(variant);
  }
  expect(counts).toEqual(expected);
  if (id === 'heathrow')
    expect(subwayLines).toEqual(
      new Set(['Piccadilly Line (Heathrow Branch)', 'Piccadilly Line (Heathrow T4 Loop)']),
    );
  if (id === 'philadelphia') {
    expect(subwayLines).toEqual(new Set(['Broad Street Line', 'Market-Frankford Line']));
    // PATCO is mapped but has no scheduled route in this extract. Classify its real track
    // in isolation so the presentation rule is tested without changing the timetable.
    const patco = rail.tracks.find((track) => track.name === 'PATCO High Speed Line')!;
    const route = {
      ...table.routes[0]!,
      sections: [{ track: patco.idx, forward: true, startM: 0, endM: patco.lengthM }],
    };
    expect(builtVariant(trainVariantFor(route, rail, city.drivingSide)).id).toBe('nyc');
  }
});
