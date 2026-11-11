import type { Diagnostic } from '../network';
import type { City, DrivingSide } from '../schema';

export type ImportResult =
  { ok: true; city: City; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

export interface ImportOptions {
  /** West, south, east, north in degrees. Overrides the extract's bounds. */
  bbox?: [number, number, number, number];
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
  /** OSM only (TASK-131 proposals, the owner to decide; default 'shortest', the approved rule):
   * the order links unite in. 'pairs-first' unites the links between the two carriageways of
   * one street first, so the 60 m span cap cannot leave them apart; 'merge-first' joins the
   * degree-2 artefacts (a signal's stop position) before grouping, so no group chains through
   * a node that is then merged away. */
  junctionGroupOrder?: 'shortest' | 'pairs-first' | 'merge-first';
  /** OSM only (TASK-131 proposal, off until the owner decides): restriction via nodes may join
   * junction groups; their restrictions stay at the member. */
  junctionGroupViaNodes?: boolean;
}
