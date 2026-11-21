import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { elevatorLandings, elevatorPoints, elevatorTopM } from '../../src/render3d/elevators';
import type { City } from '../../src/schema';

// TASK-274: the elevators mapped only as `highway=elevator` nodes, and the ones drawn.

function elevators(city: City) {
  const net = compile(city);
  if (!net.ok) throw new Error(JSON.stringify(net.diagnostics.slice(0, 3)));
  const features = city.context?.features ?? [];
  const { towers, shafts } = elevatorPoints(features, net.compiled.walk);
  return {
    points: features.filter((f) => f.kind === 'point' && f.class === 'elevator').length,
    towers: [...towers].map((tower) => {
      if (tower.kind !== 'area') throw new Error('a tower is an outline');
      const landings = elevatorLandings(tower.rings, net.compiled.walk);
      return {
        levels: [...new Set(landings.map((l) => l.heightM))],
        topM: elevatorTopM(tower, landings),
      };
    }),
    shafts: shafts.length,
  };
}

test('V274 Munich draws its two lifts up to the Donnersbergerbrücke in their glass towers', () => {
  // Of its 7 nodes, 3 are tagged indoor (the S-Bahn station's); 2 have walkways of one layer only.
  // The two lifts stand in 6 to 7 m² glass outlines tagged 15 m, from the ground to the bridge.
  expect(elevators(loadAuditCity('munich'))).toEqual({
    points: 4,
    towers: [
      { levels: [0, 5], topM: 15 },
      { levels: [0, 10], topM: 15 },
    ],
    shafts: 0,
  });
  expect(elevators(loadAuditCity('sindelfingen'))).toEqual({ points: 0, towers: [], shafts: 0 });
});

test('V274 Freiburg draws the Mobilitätszentrale tower; its other nodes are indoors or underground', async () => {
  // Of its 11 nodes, 5 stand in TASK-263's shafts, 1 is tagged indoor and 3 are inside larger
  // buildings; the one at level -1;0 serves only below the ground.
  expect(elevators((await openFreiburg()).city)).toEqual({
    points: 2,
    towers: [{ levels: [0, 5], topM: 8 }],
    shafts: 0,
  });
});
