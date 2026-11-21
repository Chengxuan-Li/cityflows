import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { kerbLines } from '../../src/importers/osm/roads';

// TASK-276 (TASK-259's D8): UK kerb lines are read from the street parking tags, not inferred.

test.each([
  ['parking:both=no', { 'parking:both': 'no' }, ['kerbLine:left:double', 'kerbLine:right:double']],
  [
    'parking:both:restriction=no_stopping (York, Leeman Road)',
    { 'parking:both': 'no', 'parking:both:restriction': 'no_stopping' },
    ['kerbLine:left:double', 'kerbLine:right:double'],
  ],
  [
    'a side key before both',
    { 'parking:both': 'no', 'parking:right': 'lane' },
    ['kerbLine:left:double'],
  ],
  [
    'parking:left=no, a parking lane on the right (York, The Crescent)',
    { 'parking:left': 'no', 'parking:right': 'lane', 'parking:right:orientation': 'diagonal' },
    ['kerbLine:left:double'],
  ],
  [
    'a conditional restriction over a parking lane',
    {
      'parking:right': 'lane',
      'parking:right:restriction:conditional': 'no_parking @ (Mo-Sa 08:00-18:00)',
    },
    ['kerbLine:right:single'],
  ],
  [
    'a restriction lifted at times',
    {
      'parking:both:restriction': 'no_parking',
      'parking:both:restriction:conditional': 'none @ (Su)',
    },
    ['kerbLine:left:single', 'kerbLine:right:single'],
  ],
  [
    'the old scheme, all day',
    { 'parking:lane:left': 'no_stopping', 'parking:lane:right': 'parallel' },
    ['kerbLine:left:double'],
  ],
  [
    'the old scheme, at times',
    {
      'parking:lane:both': 'parallel',
      'parking:condition:both': 'no_parking',
      'parking:condition:both:time_interval': 'Mo-Fr 08:00-18:30',
    },
    ['kerbLine:left:single', 'kerbLine:right:single'],
  ],
  ['parking lanes', { 'parking:both': 'lane', 'parking:both:markings': 'yes' }, []],
  ['a loading-only kerb', { 'parking:both': 'no', 'parking:both:restriction': 'loading_only' }, []],
  ['parking mapped separately', { 'parking:both': 'separate' }, []],
  ['untagged', {}, []],
] as const)('V276: %s', (_, tags, expected) => {
  expect(kerbLines(tags, false)).toEqual(expected);
  // The backward road of a two-way way has the way's left kerb on its right.
  expect(kerbLines(tags, true).sort()).toEqual(
    expected.map((v) => v.replace(/left|right/, (s) => (s === 'left' ? 'right' : 'left'))).sort(),
  );
});

const york = readFileSync('tests/importers/york-blossom-street.osm', 'utf8');

test('V276: York kerb lines land on the directed roads of their ways, on the kerb side', () => {
  const result = importOsm(york, { importerVersion: '1', drivingSide: 'left' });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  expect(result.city.markingTheme).toBe('uk');
  const roads = Object.values(result.city.roads);
  const lines = (osmId: number) =>
    roads
      .filter((r) => r.provenance.osmIds?.includes(osmId))
      .map((r) => r.provenance.inferred!.filter((v) => v.startsWith('kerbLine:')).sort());
  // Blossom Street (`parking:both=no`): both kerbs of both directions.
  for (const way of [181142623, 995872924, 1528885222]) {
    expect(lines(way).length).toBeGreaterThan(0);
    for (const road of lines(way))
      expect(road).toEqual(['kerbLine:left:double', 'kerbLine:right:double']);
  }
  // The Crescent (`parking:left=no`, a parking lane on the right): the forward road has the
  // line on its left, its kerb under left-hand traffic; the backward road has it on its right,
  // the median side, and nothing at its kerb (the parking lane).
  expect(lines(159482174).sort()).toEqual([['kerbLine:left:double'], ['kerbLine:right:double']]);
  // Untagged ways have none.
  for (const way of [676208824, 820241988, 4434555]) {
    expect(lines(way).length).toBeGreaterThan(0);
    for (const road of lines(way)) expect(road).toEqual([]);
  }
  // A German or US import records none (their paint has no kerb restrictions).
  const relabelled = importOsm(
    york.replace('</osm>', '<relation id="1"><tag k="addr:country" v="DE"/></relation></osm>'),
    { importerVersion: '1', drivingSide: 'left' },
  );
  if (!relabelled.ok) throw Error('relabelled import');
  expect(relabelled.city.markingTheme).toBe('de');
  expect(
    Object.values(relabelled.city.roads).flatMap((r) =>
      r.provenance.inferred!.filter((v) => v.startsWith('kerbLine:')),
    ),
  ).toEqual([]);
});
