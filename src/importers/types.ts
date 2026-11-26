import type { Diagnostic } from '../network';
import type { City, DrivingSide } from '../schema';

export type ImportResult =
  { ok: true; city: City; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

export interface ImportOptions {
  /** West, south, east, north in degrees. Overrides the extract's bounds. */
  bbox?: [number, number, number, number];
  /** OSM only (TASK-198): a boundary ring of [longitude, latitude] in degrees, open or closed.
   * Replaces the bbox: everything is clipped to the ring, the local frame and `geo.bbox` come
   * from its bounding box, and `geo.boundary` keeps the ring. */
  polygon?: [number, number][];
  /** Absent: inferred with the marking theme, from the country tags or the location (TASK-268). */
  drivingSide?: DrivingSide;
  context?: boolean;
  terrain?: boolean;
  importerVersion: string;
  /** OSM only: largest displacement of the relaxation of overlapping roads, m (TASK-084);
   * internal, not shown in the UI. 0 turns it off; `Infinity` leaves it unbounded. */
  relaxMaxM?: number;
  /** OSM only (TASK-131): nodes joined by roads of at most this length form a junction group;
   * default `DEFAULT_JUNCTION_GROUP_MAX_M` (30 m). */
  junctionGroupMaxM?: number;
}
