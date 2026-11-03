import type { Diagnostic } from '../network';
import type { City, DrivingSide } from '../schema';

export type ImportResult =
  { ok: true; city: City; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

export interface ImportOptions {
  /** West, south, east, north in degrees. Overrides the extract's bounds. */
  bbox?: [number, number, number, number];
  drivingSide?: DrivingSide;
  importerVersion: string;
}
