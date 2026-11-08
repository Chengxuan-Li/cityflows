import { z } from 'zod';
import { version } from '../../package.json';
import type { City } from '../schema';
import type { ProjectKey } from './types';

export type ProjectFile = `${ProjectKey}.json`;

export const manifestSchema = z.object({
  format: z.literal('cityflows'),
  schemaVersion: z.int().positive(), // the city schema version at save time; migrateCity handles it
  appVersion: z.string(),
  projectId: z.string(),
  name: z.string(),
  savedAt: z.iso.datetime(),
  files: z.partialRecord(
    z.enum([
      'city.json',
      'population.json',
      'scenarios.json',
      'history.json',
      'view.json',
      'baseline.json',
    ]),
    z.string().regex(/^[0-9a-f]{64}$/),
  ),
  licenses: z.array(z.string()),
  attribution: z.string().nullable(),
});

export type Manifest = z.infer<typeof manifestSchema>;

export type SaveMetadata = Partial<Pick<Manifest, 'projectId' | 'savedAt' | 'licenses'>>;

export function createManifest(city: City, metadata: SaveMetadata): Manifest {
  return {
    format: 'cityflows',
    schemaVersion: city.schemaVersion,
    appVersion: version,
    projectId: metadata.projectId ?? globalThis.crypto.randomUUID(),
    name: city.name,
    savedAt: metadata.savedAt ?? new Date().toISOString(),
    files: {},
    licenses: metadata.licenses ?? (city.geo?.source.kind === 'osm' ? ['ODbL-1.0'] : []),
    attribution:
      [city.geo?.source.attribution, city.terrain?.source].filter(Boolean).join('; ') || null,
  };
}
