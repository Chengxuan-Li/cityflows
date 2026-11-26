import { readFileSync } from 'node:fs';
import { openProject } from '../../src/project/open';
import { scheduleTrips } from '../../src/demand';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';

const opened = await openProject(readFileSync(process.argv[2]!, 'utf8'));
if (!opened.ok) throw new Error(opened.error);
const {
  city,
  population,
  scenarios: [scenario],
} = opened.project;
let finishWalk = () => {};
const result = compile(city, (finish) => (finishWalk = finish));
if (!result.ok) throw new Error('compile');
finishWalk();
const trips = scheduleTrips(city, population!, scenario!, result.compiled);
const engine = createEngine();
engine.load({ compiled: result.compiled, trips, scenario: scenario!, population });
const seen = new Map<number, string>();
// Usage: probe-flights.ts <project.json> <fromS>: 1 s states of runway movements for 30 min.
engine.step(10 * (Number(process.argv[3]) - 25200));
for (let i = 0; i < 1800; i++) {
  engine.step(10);
  const snap = engine.snapshot();
  for (const a of snap.aircraft ?? []) {
    if (seen.get(a.id) === a.state) continue;
    seen.set(a.id, a.state);
    if (['line-up', 'takeoff-roll', 'rotation', 'climb'].includes(a.state))
      console.log(
        snap.timeS.toFixed(1),
        a.id,
        a.typeId,
        a.state,
        a.runwayEnd,
        a.x.toFixed(0),
        a.y.toFixed(0),
      );
  }
}
