import { bypass } from '../fixtures/bypass';
import { disconnected } from '../fixtures/disconnected';
import { dividedHighway } from '../fixtures/divided-highway';
import { ramp } from '../fixtures/ramp';
import { scenarios } from '../fixtures/scenarios';
import { shortTurnLane } from '../fixtures/short-turn-lane';
import { signalApproach } from '../fixtures/signal-approach';
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
};

export async function bundledProject(id: string): Promise<OpenResult> {
  const archive = archives[`../../fixtures/projects/${id}.cityflows.json`];
  if (archive) return openProject(await archive());
  const scenario = scenarios.find((entry) => entry.id === id);
  const generate = generators[id];
  if (!scenario || !generate) throw new Error(`Missing bundled project ${id}`);
  return { ok: true, project: { city: generate(scenario.seed), scenarios: [scenario] } };
}
