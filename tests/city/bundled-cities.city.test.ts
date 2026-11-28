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

// TASK-348: Heathrow's archive rebuilt on its layout (signalised crossings between nodes laid out
// as plain nodes in its landside roads).
// TASK-351: rebuilt. A public part a map entry feeds and an exit drains is circulation: London
// City's car parks leave by their own entrances, Zurich's entrances stay by their buildings,
// Heathrow's pk:11441 gains exits on r:11590. No new place entrance on a lot's aisle: Heathrow's
// places and garages on r:12293 and r:11893 leave by streets.
// TASK-364: Zurich rebuilt with two one-way to two-way seams laid out as continuations.
// TASK-372: every real archive has a country, including the pinned Boston layout.
test.for([
  ['london-city-airport', '2c0b4f9c2aa119f469e88ec33906e41b1fafc2c892b823a4f339bb9538b6b97c'],
  ['zurich-airport', '95a573d6440863992d9901848f0583c30b6520977dbb1850126ef5a5cf211d67'],
  ['boston-logan', '87847dd4cd5e29629bfccc7766921f3b11d63108fd6c8a322d31dac72f9b56a5'],
  ['heathrow', '7ef57ec8a7559d7f54d5d571e4666bad2c36d7ba35495fdaa1dda71b9e50279a'],
] as const)('%s retains the reference archive bytes', ([id, sha256]) => {
  const archive = readFileSync(projectFile(id));
  expect(createHash('sha256').update(archive).digest('hex')).toBe(sha256);
});

// TASK-284: the driving side is the importer's inference from the location (TASK-268), not an
// option of the build: York, the first left-hand place, drives on the left with UK markings.
test.for([
  ['luebeck', 'right', 'de', 'de'],
  ['york', 'left', 'uk', 'gb'],
] as const)('%s drives on the %s, inferred', async ([id, side, theme, country]) => {
  const { city } = await openBundled(id);
  expect([city.drivingSide, city.markingTheme, city.country]).toEqual([side, theme, country]);
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
    // Zurich's morning takes about 22 min on a CI runner (Full 45833844542), the others under 15.
    limit(id === 'zurich-airport' ? 1_800_000 : 900_000),
  );
});
