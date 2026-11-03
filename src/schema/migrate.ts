import type { City } from './city';
import { citySchema } from './city.schema';

export function migrateCity(json: unknown): City {
  const version =
    typeof json === 'object' && json !== null && 'schemaVersion' in json
      ? json.schemaVersion
      : undefined;
  switch (version) {
    case 1:
      return citySchema.parse(json);
    default:
      throw new Error(`Unsupported city schema version: ${String(version)}`);
  }
}
