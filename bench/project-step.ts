import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// TASK-277: the stepping time and state hash of a project's morning at 0.15 (the gate's
// `probeMorning`, mode choice on), from 07:00 to `--until`; with `--baseline <root>` the same run
// with another checkout's code (main), interleaved `--reps` times, since one timing on a shared
// machine says little. Any project file: a bundled city or an import saved from the app.
//   node --experimental-strip-types --import ./bench/register.ts bench/project-step.ts \
//     <project.cityflows.json> [--until 10:00] [--baseline ../main] [--reps 2]

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args[0];
if (!file)
  throw new Error('Usage: project-step.ts <project.json> [--until hh:mm] [--baseline root]');
const [h, m] = (option('--until') ?? '10:00').split(':').map(Number);
const untilS = h! * 3600 + m! * 60;
const reps = Number(option('--reps') ?? 1);
const baseline = option('--baseline');
const json = readFileSync(file, 'utf8');

async function run(root: string) {
  const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);
  const [{ openProject }, { compile }, { probeMorning }] = await Promise.all([
    load('src/project/open.ts'),
    load('src/network/index.ts'),
    load('bench/import-probe.ts'),
  ]);
  const opened = await openProject(json);
  if (!opened.ok) throw new Error(opened.error);
  const result = compile(opened.project.city);
  if (!result.ok) throw new Error('The project does not compile');
  const morning = probeMorning(opened.project.city, result.compiled, 0.15, {
    untilS,
    endS: Math.max(untilS, 10 * 3600),
  });
  const steps = (untilS - 7 * 3600) * 10;
  return {
    root,
    completed: morning.completed,
    failed: morning.failed,
    stateHash: morning.stateHash,
    stepMs: Math.round(morning.stepTimeMs),
    msPerStep: +(morning.stepTimeMs / steps).toFixed(3),
  };
}

for (let rep = 0; rep < reps; rep++)
  for (const root of baseline ? [baseline, '.'] : ['.'])
    console.info(JSON.stringify(await run(root)));
