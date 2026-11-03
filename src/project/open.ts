import { z } from 'zod';
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

const jsonDocumentSchema = z.record(z.string(), z.unknown());

function readJsonDocument(text: string): Record<string, Uint8Array> {
  const document = jsonDocumentSchema.parse(JSON.parse(text));
  const encoder = new TextEncoder();
  // Single-document members are hashed as compact JSON in parsed property order.
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      `${key}.json`,
      encoder.encode(JSON.stringify(value)),
    ]),
  );
}

export async function openProject(input: Uint8Array | string): Promise<OpenResult> {
  let file = 'manifest.json';
  const decoder = new TextDecoder('utf-8', { fatal: true });

  try {
    const files =
      typeof input === 'string'
        ? readJsonDocument(input)
        : input[0] === 0x50 && input[1] === 0x4b
          ? readZip(input)
          : readJsonDocument(decoder.decode(input));

    const manifestBytes = files[file];
    if (!manifestBytes) throw new Error('Missing file');
    const manifest = manifestSchema.parse(JSON.parse(decoder.decode(manifestBytes)));

    // Members outside the layout (archive metadata, future files) are ignored, not rejected.
    async function read<T>(name: ProjectFile, parse: (value: unknown) => T): Promise<T> {
      file = name;
      const bytes = files[name];
      if (!bytes) throw new Error('Missing file');
      const expected = manifest.files[name];
      if (!expected) throw new Error('Missing manifest hash');
      if ((await sha256(bytes)) !== expected) throw new Error('SHA-256 hash mismatch');
      return parse(JSON.parse(decoder.decode(bytes)));
    }

    const city = await read('city.json', migrateCity);
    const scenarios = await read('scenarios.json', (value) => scenariosSchema.parse(value));
    const project = { city, scenarios };
    const population =
      files['population.json'] || manifest.files['population.json']
        ? await read('population.json', (value) => populationSchema.parse(value))
        : undefined;
    const history =
      files['history.json'] || manifest.files['history.json']
        ? await read('history.json', (value) => historySchema.parse(value).entries)
        : undefined;
    const view =
      files['view.json'] || manifest.files['view.json']
        ? await read('view.json', (value) => viewSchema.parse(value))
        : undefined;
    return {
      ok: true,
      project: {
        ...project,
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
