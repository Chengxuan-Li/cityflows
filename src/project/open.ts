import { z } from 'zod';
import { withHouseholds } from '../demand/households';
import type { City, Person } from '../schema';
import { migrateCity } from '../schema/migrate';
import { sha256 } from './hash';
import { manifestSchema, type ProjectFile } from './manifest';
import {
  historySchema,
  populationSchema,
  scenariosSchema,
  viewSchema,
  type OpenResult,
} from './types';
import { readZip } from './zip';
import { baselineSchema } from './scenarios';

const jsonDocumentSchema = z.record(z.string(), z.unknown());

/** TASK-129: a population saved before households gets the grouping a regenerated one has. */
function households(city: City, persons: z.infer<typeof populationSchema>, seed: number) {
  return persons.every((person): person is Person => person.householdId !== undefined)
    ? persons
    : withHouseholds(city, persons, seed);
}

export async function openProject(input: Uint8Array | string): Promise<OpenResult> {
  let file = 'manifest.json';
  const decoder = new TextDecoder('utf-8', { fatal: true });

  try {
    const text =
      typeof input === 'string'
        ? input
        : input[0] === 0x50 && input[1] === 0x4b
          ? undefined
          : decoder.decode(input);
    const document = text === undefined ? undefined : jsonDocumentSchema.parse(JSON.parse(text));
    const files = typeof input !== 'string' && text === undefined ? readZip(input) : undefined;
    const encoder = new TextEncoder();
    const key = (name: string) => name.slice(0, -'.json'.length);
    const has = (name: string) => (document ? Object.hasOwn(document, key(name)) : !!files?.[name]);

    if (!has(file)) throw new Error('Missing file');
    const manifest = manifestSchema.parse(
      document ? document.manifest : JSON.parse(decoder.decode(files![file]!)),
    );

    // Members outside the layout (archive metadata, future files) are ignored, not rejected.
    async function read<T>(name: ProjectFile, parse: (value: unknown) => T): Promise<T> {
      file = name;
      if (!has(name)) throw new Error('Missing file');
      const expected = manifest.files[name];
      if (!expected) throw new Error('Missing manifest hash');
      // Single-document members are hashed as compact JSON in parsed property order.
      const json = document ? JSON.stringify(document[key(name)]) : undefined;
      const bytes = json === undefined ? files![name]! : encoder.encode(json);
      if ((await sha256(bytes)) !== expected) throw new Error('SHA-256 hash mismatch');
      return parse(JSON.parse(json ?? decoder.decode(bytes)));
    }

    const city = await read('city.json', migrateCity);
    const scenarios = await read('scenarios.json', (value) => scenariosSchema.parse(value));
    const project = { city, scenarios };
    const baseline =
      has('baseline.json') || manifest.files['baseline.json']
        ? await read('baseline.json', (value) => {
            const { population, ...baseline } = baselineSchema.parse(value);
            return population
              ? {
                  ...baseline,
                  population: households(baseline.city, population, baseline.scenario.demand.seed),
                }
              : baseline;
          })
        : undefined;
    const population =
      has('population.json') || manifest.files['population.json']
        ? await read('population.json', (value) =>
            households(city, populationSchema.parse(value), scenarios[0]!.demand.seed),
          )
        : undefined;
    const history =
      has('history.json') || manifest.files['history.json']
        ? await read('history.json', (value) => historySchema.parse(value).entries)
        : undefined;
    const view =
      has('view.json') || manifest.files['view.json']
        ? await read('view.json', (value) => viewSchema.parse(value))
        : undefined;
    return {
      ok: true,
      project: {
        ...project,
        ...(baseline === undefined ? {} : { baseline }),
        ...(population === undefined ? {} : { population }),
        ...(history === undefined ? {} : { history }),
        ...(view === undefined ? {} : { view }),
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]!;
      const path = issue.path.reduce<string>(
        (path, part) => path + (typeof part === 'number' ? `[${part}]` : `.${String(part)}`),
        '$',
      );
      return { ok: false, file, error: `${path}: ${issue.message}` };
    }
    return { ok: false, file, error: error instanceof Error ? error.message : String(error) };
  }
}
