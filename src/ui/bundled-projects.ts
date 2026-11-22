import { bypass } from '../fixtures/bypass';
import { disconnected } from '../fixtures/disconnected';
import { dividedHighway } from '../fixtures/divided-highway';
import { ramp } from '../fixtures/ramp';
import { scenarios } from '../fixtures/scenarios';
import { shortTurnLane } from '../fixtures/short-turn-lane';
import { signalApproach } from '../fixtures/signal-approach';
import { station } from '../fixtures/station';
import { syntheticAirport, syntheticAirportBacktrack } from '../fixtures/synthetic-airport';
import { openProject } from '../project/open';
import type { OpenResult } from '../project/types';
import type { City } from '../schema';

const archives = import.meta.glob<string>('../../fixtures/projects/*.cityflows.json', {
  query: '?raw',
  import: 'default',
});
const generators: Record<string, (seed: number) => City> = {
  signalApproach,
  bypass,
  ramp,
  dividedHighway,
  shortTurnLane,
  disconnected,
  station,
  syntheticAirport,
  syntheticAirportBacktrack,
};

/** TASK-258: the real places of the New city panel, each a bundled archive built by
 * `bench/bundled-cities.ts` from its committed extract; `?city=<id>` opens one, as it opens the
 * archives the builder holds out of the panel (TASK-284: York). */
export const realPlaces = [
  {
    id: 'freiburg',
    name: 'Freiburg im Breisgau',
    note: 'Altstadt and Hauptbahnhof: trams, S-Bahn, Dreisam bridges',
  },
  {
    id: 'munich',
    name: 'Munich Donnersbergerbrücke',
    note: 'Mittlerer Ring over the main line, S-Bahn and trams',
  },
  {
    id: 'sindelfingen',
    name: 'Sindelfingen A81',
    note: 'A81 junction with roundabouts by the Mercedes-Benz plant',
  },
  {
    id: 'philadelphia',
    name: 'Philadelphia Center City',
    note: 'One-way grid around City Hall: right on red, trains below',
  },
  {
    id: 'luebeck',
    name: 'Lübeck Altstadt',
    note: 'Altstadt island and Hauptbahnhof: Holstentor, Trave bridges',
  },
  {
    id: 'york',
    name: 'York city centre',
    note: 'City walls and station: left-hand traffic, mini-roundabouts',
  },
  {
    id: 'london-city-airport',
    name: 'London City Airport',
    note: 'One runway between the docks: taxiways, stands, the DLR',
  },
];

async function readBundle(id: string): Promise<OpenResult> {
  const archive = archives[`../../fixtures/projects/${id}.cityflows.json`];
  if (archive) return openProject(await archive());
  const scenario = scenarios.find((entry) => entry.id === id);
  const generate = generators[id];
  if (!scenario || !generate) throw new Error(`Missing bundled project ${id}`);
  return { ok: true, project: { city: generate(scenario.seed), scenarios: [scenario] } };
}

export async function bundledProject(id: string): Promise<OpenResult> {
  const result = await readBundle(id);
  if (!result.ok || !result.project.city.airport) return result;
  const [scenario, ...others] = result.project.scenarios;
  if (!scenario) return result;
  const midnight = (Math.floor(scenario.startS / 86_400) + 1) * 86_400;
  return {
    ok: true,
    project: { ...result.project, scenarios: [{ ...scenario, endS: midnight }, ...others] },
  };
}
