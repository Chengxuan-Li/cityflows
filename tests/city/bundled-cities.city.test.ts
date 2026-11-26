import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  heldOutOfPanel,
  openBundled,
  projectFile,
  realPlaceBuilds,
} from '../../bench/bundled-cities';
import { probeMorning } from '../../bench/import-probe';
import { compile } from '../../src/network';
import { realPlaces } from '../../src/ui/bundled-projects';
import { limit } from '../timeouts';

// TASK-258: the real places of the New city panel, as bundled (fixtures/projects/<id>.cityflows.json).

const manifest = (json: string) =>
  (JSON.parse(json) as { manifest: { files: Record<string, string> } }).manifest.files;

test('the panel lists every bundled real place not held out of it, and each has a build', () => {
  expect(realPlaces.map((place) => place.id).sort()).toEqual(
    Object.keys(realPlaceBuilds)
      .filter((id) => !(id in heldOutOfPanel))
      .sort(),
  );
});

// TASK-351: rebuilt. A public part a map entry feeds and an exit drains is circulation: London
// City's car parks leave by their own entrances, Zurich's entrances stay by their buildings,
// Heathrow's pk:11441 gains exits on r:11590. No new place entrance on a lot's aisle: Heathrow's
// places and garages on r:12293 and r:11893 leave by streets.
test.for([
  ['london-city-airport', '41e898110f9da0db81c60ca1ec90066652c5bb30274d359fbf45f266bc9abad9'],
  ['zurich-airport', '49e10df7abb53a6641b11308e1bfe4aedc246ba1d362a9c07af0a3f166f80017'],
  ['boston-logan', '35c3229d3a9ee56302cd5fcfbb7bf49398e72ab853b03e45021a4858104570da'],
  ['heathrow', 'c6f485e915655a0b7b69187a087a61e0b0e3343a5bd1962f9f3800cd7b08ffe6'],
] as const)('%s retains the reference archive bytes', ([id, sha256]) => {
  const archive = readFileSync(projectFile(id));
  expect(createHash('sha256').update(archive).digest('hex')).toBe(sha256);
});

// TASK-284: the driving side is the importer's inference from the location (TASK-268), not an
// option of the build: York, the first left-hand place, drives on the left with UK markings.
test.for([
  ['luebeck', 'right', 'de'],
  ['york', 'left', 'uk'],
] as const)('%s drives on the %s, inferred', async ([id, side, theme]) => {
  const { city } = await openBundled(id);
  expect([city.drivingSide, city.markingTheme]).toEqual([side, theme]);
});

// The staleness test: a bundled archive must be what its builder makes of the committed extract
// today, so an importer, demand or schema change cannot leave a bundled city stale unnoticed.
// Freiburg's own test compares its whole archive byte for byte (freiburg.city.test.ts). The
// imports come from the import cache tests/warm-cache.ts fills, so each check costs 3 to 4 s;
// after an importer change it imports afresh (4 to 12 s). On failure, rebuild with
//   node --experimental-strip-types --import ./bench/register.ts bench/bundled-cities.ts
test.for(Object.keys(realPlaceBuilds).filter((id) => id !== 'freiburg'))(
  '%s: the bundled archive is a fresh build of its extract',
  // Heathrow's fresh build takes 10 to 26 s here and over 120 s on a CI runner (Full 45064837109).
  { timeout: limit(600_000) },
  async (id) => {
    const archive = readFileSync(projectFile(id), 'utf8');
    expect(
      manifest(await realPlaceBuilds[id]!()),
      `${projectFile(id)} is stale: run bench/bundled-cities.ts`,
    ).toEqual(manifest(archive));
  },
);

// The showcase gate (TASK-258), as Freiburg's: the morning at the showcase demand (0.15 persons
// per resident, mode choice on, the bundled population), 07:00 to 10:00. A place that fails it
// leaves the panel; it is not curated (owner, 2026-11-20). The state hash is reported, not pinned:
// Munich's and Sindelfingen's own traffic tests pin theirs. A place held out of the panel for its
// gate (`heldOutOfPanel`) is expected to fail, so the fix that lets it pass shows. TASK-286: York passes
// since its Layerthorpe gateway leaves on a lane the router can leave, and it joins the panel.
// TASK-351: Zurich Airport passes since a public part a map entry feeds and an exit drains is
// circulation (Kloten and the airport landside meet only on airport roads), and joins the panel.
// TASK-354: Heathrow joined the panel on the owner's word (2026-11-25) without this gate; its landside
// morning is to be measured and improved in parallel.
describe.for([
  'munich',
  'sindelfingen',
  'philadelphia',
  'luebeck',
  'york',
  'london-city-airport',
  'zurich-airport',
])('%s at the showcase demand', (id) => {
  (id in heldOutOfPanel ? test.fails : test)(
    'drains: no gridlock, no stalled head, no unroutable trip, no visit adds 900 s',
    async () => {
      const project = await openBundled(id);
      const { city } = project;
      const result = compile(city);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
      const { compiled } = result;
      // The most wait any single visit to one road added (TASK-154's drain criterion, generalised
      // to every road as TASK-197 measured it), sampled every simulated second, and where.
      const worstVisit = { addedS: 0, road: '' };
      const visits = new Map<number, { road: number; waitS: number }>();
      let tick = 0;
      const morning = probeMorning(city, compiled, 0.15, {
        observe(engine) {
          if (++tick % 10) return;
          const snapshot = engine.snapshot();
          const active = new Set(snapshot.id);
          for (const vehicle of visits.keys()) if (!active.has(vehicle)) visits.delete(vehicle);
          for (const [i, vehicle] of snapshot.id.entries()) {
            const segment = snapshot.lane[i]!;
            if (segment === -2147483648) {
              visits.delete(vehicle);
              continue;
            }
            const lane = segment < 0 ? compiled.movements[-segment - 1]!.fromLane : segment;
            const road = compiled.lanes[lane]!.road;
            const visit = visits.get(vehicle);
            const waitS = engine.inspect(vehicle)!.waitingS;
            if (visit?.road !== road) visits.set(vehicle, { road, waitS });
            else if (waitS - visit.waitS > worstVisit.addedS)
              Object.assign(worstVisit, {
                addedS: waitS - visit.waitS,
                road: compiled.roads[road]!.id,
              });
          }
        },
      });
      console.info(`${city.name} morning at 0.15, mode choice on`, {
        persons: morning.persons,
        completed: morning.completed,
        failed: morning.failed,
        failedByReason: morning.failedByReason,
        stalledHeads: morning.stalledHeads,
        localArrivals: morning.localArrivals,
        meanDelayS: morning.meanDelayS,
        worstVisit,
        stateHash: morning.stateHash,
      });
      // The archive's population is the one the morning generated from the same demand.
      expect(project.population).toHaveLength(morning.persons);
      expect(morning.failedByReason.gridlocked).toBe(0);
      expect(morning.stalledHeads).toBe(0);
      expect(morning.failedByReason.no_route).toBe(0);
      // Every failure is a counted parking failure, under 2% of local arrivals.
      expect(morning.failed).toBe(morning.failedByReason.no_parking);
      expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
      expect(worstVisit.addedS, worstVisit.road).toBeLessThan(900);
    },
    limit(900_000),
  );
});
