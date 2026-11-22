// Airports batch (docs/decisions/2026-11-22-airports.md): the aircraft catalogue every airport task
// reads. Dimensions are the types' published length and wingspan (rotor diameter for helicopters),
// in metres. TASK-306 adds performance figures to these entries.

/** ICAO aerodrome reference code letters, by wingspan. */
export const aircraftCodes = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type AircraftCode = (typeof aircraftCodes)[number];

/** Upper wingspan bound (exclusive) of each code, metres. */
export const codeSpanLimitM: Record<AircraftCode, number> = {
  A: 15,
  B: 24,
  C: 36,
  D: 52,
  E: 65,
  F: 80,
};

/** The code of a wingspan: the first whose bound exceeds it. */
export function codeForSpan(spanM: number): AircraftCode {
  const code = aircraftCodes.find((c) => spanM < codeSpanLimitM[c]);
  if (!code) throw new Error(`wingspan ${spanM} m exceeds code F`);
  return code;
}

/** True when a stand or edge admitting `limit` admits an aircraft of `code`. */
export const codeAdmits = (limit: AircraftCode, code: AircraftCode) =>
  aircraftCodes.indexOf(code) <= aircraftCodes.indexOf(limit);

export const aircraftClasses = [
  'double_decker',
  'widebody',
  'narrowbody',
  'regional_jet',
  'propeller',
  'private',
  'helicopter',
] as const;
export type AircraftClass = (typeof aircraftClasses)[number];

export interface AircraftType {
  id: string;
  name: string;
  class: AircraftClass;
  lengthM: number;
  /** Wingspan; for a helicopter, the main rotor diameter. */
  spanM: number;
  /** Engines and where they sit: under the wing, at the rear fuselage, or none for a helicopter. */
  engines: { count: number; mount: 'wing' | 'rear' | 'none' };
}

export const aircraftTypes: readonly AircraftType[] = [
  {
    id: 'A388',
    name: 'A380-800',
    class: 'double_decker',
    lengthM: 72.7,
    spanM: 79.8,
    engines: { count: 4, mount: 'wing' },
  },
  {
    id: 'B748',
    name: '747-8',
    class: 'double_decker',
    lengthM: 76.3,
    spanM: 68.4,
    engines: { count: 4, mount: 'wing' },
  },
  {
    id: 'B77W',
    name: '777-300ER',
    class: 'widebody',
    lengthM: 73.9,
    spanM: 64.8,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'A359',
    name: 'A350-900',
    class: 'widebody',
    lengthM: 66.8,
    spanM: 64.75,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'A333',
    name: 'A330-300',
    class: 'widebody',
    lengthM: 63.7,
    spanM: 60.3,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'B789',
    name: '787-9',
    class: 'widebody',
    lengthM: 62.8,
    spanM: 60.1,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'A20N',
    name: 'A320neo',
    class: 'narrowbody',
    lengthM: 37.6,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'B738',
    name: '737-800',
    class: 'narrowbody',
    lengthM: 39.5,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'A21N',
    name: 'A321neo',
    class: 'narrowbody',
    lengthM: 44.5,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'BCS3',
    name: 'A220-300',
    class: 'narrowbody',
    lengthM: 38.7,
    spanM: 35.1,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'E190',
    name: 'E190',
    class: 'regional_jet',
    lengthM: 36.2,
    spanM: 28.7,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'E175',
    name: 'E175',
    class: 'regional_jet',
    lengthM: 31.7,
    spanM: 26.0,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'CRJ9',
    name: 'CRJ900',
    class: 'regional_jet',
    lengthM: 36.2,
    spanM: 24.9,
    engines: { count: 2, mount: 'rear' },
  },
  {
    id: 'AT76',
    name: 'ATR 72',
    class: 'propeller',
    lengthM: 27.2,
    spanM: 27.1,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'DH8D',
    name: 'Dash 8-400',
    class: 'propeller',
    lengthM: 32.8,
    spanM: 28.4,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'SF34',
    name: 'Saab 340',
    class: 'propeller',
    lengthM: 19.7,
    spanM: 21.4,
    engines: { count: 2, mount: 'wing' },
  },
  {
    id: 'C25C',
    name: 'Citation CJ4',
    class: 'private',
    lengthM: 16.3,
    spanM: 15.5,
    engines: { count: 2, mount: 'rear' },
  },
  {
    id: 'PC24',
    name: 'PC-24',
    class: 'private',
    lengthM: 16.9,
    spanM: 17.0,
    engines: { count: 2, mount: 'rear' },
  },
  {
    id: 'GLF6',
    name: 'G650',
    class: 'private',
    lengthM: 30.4,
    spanM: 30.4,
    engines: { count: 2, mount: 'rear' },
  },
  {
    id: 'EC45',
    name: 'H145',
    class: 'helicopter',
    lengthM: 13.6,
    spanM: 11.0,
    engines: { count: 2, mount: 'none' },
  },
  {
    id: 'A139',
    name: 'AW139',
    class: 'helicopter',
    lengthM: 16.7,
    spanM: 13.8,
    engines: { count: 2, mount: 'none' },
  },
];

/** A fixed-wing type's code from its wingspan; helicopters use helipads and carry none. */
export const aircraftCode = (type: AircraftType): AircraftCode | null =>
  type.class === 'helicopter' ? null : codeForSpan(type.spanM);
