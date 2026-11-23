import { expect, test } from 'vitest';
import type { RailGraph } from '../network/rail';
import type { TrainRoute } from '../network/trains';
import type { RailKind } from '../schema/rail';
import { builtVariant, trainVariantFor } from './train-variants';

/** A route over tracks of the given kinds and lengths. */
function route(kind: TrainRoute['kind'], tracks: [RailKind, number][]) {
  const rail = {
    tracks: tracks.map(([k, lengthM]) => ({ kind: k, lengthM })),
  } as unknown as RailGraph;
  const r = { kind, sections: tracks.map((_, track) => ({ track })) } as unknown as TrainRoute;
  return [r, rail] as const;
}

test('TASK-332 the variant rule gives each of the seven variants', () => {
  const cases: [TrainRoute['kind'], [RailKind, number][], 'left' | 'right', string][] = [
    ['tram', [['tram', 900]], 'right', 'tram'],
    [
      'sbahn',
      [
        ['light_rail', 700],
        ['rail', 300],
      ],
      'left',
      'dlr',
    ],
    [
      'sbahn',
      [
        ['subway', 700],
        ['rail', 600],
      ],
      'left',
      'tube',
    ],
    [
      'sbahn',
      [
        ['subway', 700],
        ['rail', 600],
      ],
      'right',
      'nyc',
    ],
    [
      'sbahn',
      [
        ['rail', 700],
        ['subway', 600],
      ],
      'left',
      'elizabeth',
    ],
    [
      'sbahn',
      [
        ['rail', 700],
        ['narrow_gauge', 10],
      ],
      'right',
      'sbahn',
    ],
    ['mainline', [['rail', 700]], 'left', 'intercity'],
    ['mainline', [['rail', 700]], 'right', 'intercity'],
    // The kind covering most of the length decides, not the most sections.
    [
      'mainline',
      [
        ['rail', 100],
        ['rail', 100],
        ['subway', 300],
      ],
      'right',
      'nyc',
    ],
  ];
  for (const [kind, tracks, side, expected] of cases) {
    const [r, rail] = route(kind, tracks);
    expect(trainVariantFor(r, rail, side), `${kind} ${JSON.stringify(tracks)} ${side}`).toBe(
      expected,
    );
  }
  expect(builtVariant('tram').id).toBe('tram');
  for (const id of ['dlr', 'elizabeth', 'intercity', 'sbahn'] as const)
    expect(builtVariant(id).id).toBe('sbahn');
});
