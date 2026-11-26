import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { elevatorLandings, elevatorTopM, isElevator } from '../../src/render3d/elevators';
import { buildingPieces } from '../../src/render3d/roofs';
import type { City } from '../../src/schema';

// TASK-263 (owner's bug 6, docs/findings/2026-11-20-owner-3d-bugs/bug6.png): the Hauptbahnhof's
// footbridge elevators, drawn by main as 10 m blocks with lit office windows.

function shafts(city: City) {
  const net = compile(city);
  if (!net.ok) throw new Error(JSON.stringify(net.diagnostics.slice(0, 3)));
  return (city.context?.features ?? []).flatMap((feature) =>
    feature.kind === 'area' && feature.class === 'building'
      ? buildingPieces(feature)
          .filter(isElevator)
          .map((piece) => {
            const landings = elevatorLandings(piece.rings, net.compiled.walk);
            return {
              part: !!feature.parts?.length,
              levels: [...new Set(landings.map((l) => l.heightM))],
              topM: elevatorTopM(piece, landings),
            };
          })
      : [],
  );
}

test('V263 Freiburg draws its six elevators as shafts, the footbridge five up to the deck', async () => {
  const found = shafts((await openFreiburg()).city);
  expect(found).toHaveLength(6);
  // Five `building=elevator` outlines at the Hauptbahnhof serve the footbridge (layer 2, 10 m);
  // four also the platforms at the ground, one a passage below it. Each tops out 3 m above the deck.
  const bridge = found.filter((s) => !s.part);
  expect(bridge.map((s) => s.levels.join())).toEqual(['0,10', '0,10', '0,10', '10', '0,10']);
  expect(bridge.every((s) => s.topM === 13)).toBe(true);
  // The `building:part=elevator` at Bertoldstraße keeps its tagged 9 m.
  expect(found.filter((s) => s.part)).toEqual([{ part: true, levels: [], topM: 9 }]);
});

test('V263 Munich and Sindelfingen map no elevator outlines', () => {
  for (const name of ['munich', 'sindelfingen'] as const)
    expect(shafts(loadAuditCity(name)), name).toEqual([]);
});
