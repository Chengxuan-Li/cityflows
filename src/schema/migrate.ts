import type { City } from './city';
import { citySchema, legacyCitySchema } from './city.schema';

export function migrateCity(json: unknown): City {
  const version =
    typeof json === 'object' && json !== null && 'schemaVersion' in json
      ? json.schemaVersion
      : undefined;
  switch (version) {
    case 1:
    case 2:
      return legacyCitySchema.parse(json);
    case 3:
      return citySchema.parse(json);
    default:
      throw new Error(`Unsupported city schema version: ${String(version)}`);
  }
}
