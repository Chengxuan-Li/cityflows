import { bypass } from '../fixtures/bypass';
import { disconnected } from '../fixtures/disconnected';
import { dividedHighway } from '../fixtures/divided-highway';
import { ramp } from '../fixtures/ramp';
import { scenarios } from '../fixtures/scenarios';
import { shortTurnLane } from '../fixtures/short-turn-lane';
import { signalApproach } from '../fixtures/signal-approach';
import { station } from '../fixtures/station';
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
    id: 'luebeck',
    name: 'Lübeck Altstadt',
    note: 'Altstadt island and Hauptbahnhof: Holstentor, Trave bridges',
  },
];

export async function bundledProject(id: string): Promise<OpenResult> {
  const archive = archives[`../../fixtures/projects/${id}.cityflows.json`];
  if (archive) return openProject(await archive());
  const scenario = scenarios.find((entry) => entry.id === id);
  const generate = generators[id];
  if (!scenario || !generate) throw new Error(`Missing bundled project ${id}`);
  return { ok: true, project: { city: generate(scenario.seed), scenarios: [scenario] } };
}
