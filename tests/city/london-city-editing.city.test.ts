import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { createEditor } from '../../src/editor';
import { derivedAirsideCodes } from '../../src/network/airside-codes';
import { compile } from '../../src/network';
import { limit } from '../timeouts';

// TASK-305: the code rules an edit re-runs give London City's imported codes from the bundled city
// (its context buildings, terminal and hangar stand in for the extract's buildings), and a stand
// added at the east end of the remote row joins the apron taxiway.

test(
  'London City: codes by rule re-derive unchanged; an added stand joins and takes its code',
  { timeout: limit(120_000) },
  async () => {
    const { city } = await openBundled('london-city-airport');
    const airport = city.airport!;
    const codes = derivedAirsideCodes(
      city,
      airport,
      Object.keys(airport.stands),
      Object.keys(airport.edges),
    );
    expect(codes.stands.size).toBe(19);
    expect(codes.edges.size).toBe(97);
    for (const [id, code] of codes.stands) expect(code, id).toBe(airport.stands[id]!.maxCode);
    for (const [id, code] of codes.edges) expect(code, id).toBe(airport.edges[id]!.maxCode);

    const editor = createEditor(city);
    const result = editor.apply({
      kind: 'addStand',
      pos: { x: 146, y: 19 },
      standKind: 'remote',
      ref: '29',
    });
    expect(result.ok).toBe(true);
    const edited = editor.city.airport!;
    const stand = Object.values(edited.stands).find((s) => s.ref === '29')!;
    expect(stand.maxCode).toBe('D');
    const lead = edited.edges[stand.leadIn[0]!]!;
    expect(lead.line[0]!.y).toBeCloseTo(-11.6, 0);
    const atRoot = Object.values(edited.edges).filter(
      (e) => e.id !== lead.id && (e.from === lead.from || e.to === lead.from),
    );
    expect(atRoot.map((e) => [e.kind, e.ref])).toEqual([
      ['taxiway', 'Apron Twy'],
      ['taxiway', 'Apron Twy'],
    ]);
    // Only the new stand, its lead-in and the split apron taxiway change.
    for (const s of Object.values(airport.stands)) expect(edited.stands[s.id]).toBe(s);
    const changed = Object.keys(edited.edges).filter(
      (id) => edited.edges[id] !== airport.edges[id],
    );
    expect(changed).toHaveLength(3);
    const full = compile(editor.city);
    expect(full.ok && full.compiled.airside).toEqual(editor.compiled.airside);
  },
);
