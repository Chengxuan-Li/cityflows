// TASK-315: a few airline colour schemes, one per registration by a fixed hash (the accent of
// TASK-301 is the tail colour). Generic schemes, not any real airline's: a coloured tail with a
// cheatline, a coloured belly, a swept tail cone, a coloured crown, or the tail alone.

export type LiveryStyle = 'tail' | 'cheatline' | 'belly' | 'tailcone' | 'crown';

export interface AircraftLivery {
  style: LiveryStyle;
  /** Fin, winglets and the scheme's bands. */
  tail: number;
  /** Pinstripes; null where the scheme has none. */
  trim: number | null;
  /** Engine cowlings. */
  engines: number;
  /** A light grey belly under a white fuselage, or null for an all-white one. */
  belly: number | null;
}

export const hull = 0xf0f1f3;
const lightBelly = 0xc9ced4;
const gold = 0xc9a227;

const schemes: AircraftLivery[] = [
  { style: 'cheatline', tail: 0x1f3f78, trim: gold, engines: hull, belly: lightBelly },
  { style: 'belly', tail: 0xb3202a, trim: null, engines: 0xb3202a, belly: null },
  { style: 'tailcone', tail: 0x10707a, trim: null, engines: 0x10707a, belly: null },
  { style: 'cheatline', tail: 0x5a2d82, trim: null, engines: 0x5a2d82, belly: null },
  { style: 'tail', tail: 0xd9661f, trim: null, engines: 0xd9661f, belly: null },
  { style: 'belly', tail: 0x2e7d32, trim: gold, engines: hull, belly: null },
  { style: 'crown', tail: 0x1f78c8, trim: null, engines: hull, belly: lightBelly },
  { style: 'cheatline', tail: 0x7a1f3d, trim: gold, engines: 0x7a1f3d, belly: lightBelly },
  { style: 'tailcone', tail: 0xc79a1b, trim: 0x3b4650, engines: hull, belly: null },
  { style: 'tail', tail: 0x3b4650, trim: null, engines: hull, belly: lightBelly },
];

/** The plain scheme of an accent colour alone. */
export const plainLivery = (tail: number): AircraftLivery => ({
  style: 'tail',
  tail,
  trim: null,
  engines: hull,
  belly: null,
});

export function aircraftLivery(registration: string): AircraftLivery {
  let hash = 2166136261;
  for (let i = 0; i < registration.length; i++)
    hash = Math.imul(hash ^ registration.charCodeAt(i), 16777619);
  return schemes[(hash >>> 0) % schemes.length]!;
}
