// Airports batch (docs/decisions/2026-11-22-airports.md): the aircraft catalogue every airport task
// reads. Dimensions are the types' published length and wingspan (rotor diameter for helicopters),
// in metres.

/** ICAO aerodrome reference code letters, by wingspan. */
export const aircraftCodes = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type AircraftCode = (typeof aircraftCodes)[number];

/** Upper wingspan bound (exclusive) of each code, metres. */
const codeSpanLimitM: Record<AircraftCode, number> = { A: 15, B: 24, C: 36, D: 52, E: 65, F: 80 };

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

interface GroundPerformance {
  taxiStraightMps: number;
  taxiTurnMps: number;
  maxLateralAccelerationMps2: number;
  pushbackSpeedMps: number;
  towSpeedMps: number;
  brakingDecelerationMps2: number;
}

export interface FixedWingPerformance extends GroundPerformance {
  kind: 'fixedWing';
  /** Minimum radius of the aircraft's path centreline for routing. */
  minTurnRadiusM: number;
  rotationSpeedMps: number;
  /** Distance from brake release to rotation. */
  takeoffRollM: number;
  climbSpeedMps: number;
  /** Metres of rise per metre along the centreline. */
  climbGradient: number;
  approachSpeedMps: number;
  /** Distance from touchdown to straight taxi speed. */
  landingRollM: number;
}

export interface HelicopterPerformance {
  kind: 'helicopter';
  hoverTaxiMps: number;
  verticalClimbMps: number;
  transitionSpeedMps: number;
}

export interface AircraftType {
  id: string;
  name: string;
  class: AircraftClass;
  lengthM: number;
  /** Wingspan; for a helicopter, the main rotor diameter. */
  spanM: number;
  /** Engines and where they sit: under the wing, at the rear fuselage, or none for a helicopter. */
  engines: { count: number; mount: 'wing' | 'rear' | 'none' };
  performance: FixedWingPerformance | HelicopterPerformance;
}

// Representative dry, calm-condition figures for the simulation. Fixed-wing flight figures are
// informed by EUROCONTROL's Aircraft Performance Database (V2, initial climb, Vat and runway
// distances); model rotation speeds and ground rolls are estimates, since the published speeds and
// field lengths include airborne portions. Turn radii are rounded aircraft airport-planning
// geometry estimates. Taxi, pushback, tow and braking limits are shared operating assumptions by
// class. Helicopter pad manoeuvre speeds are model assumptions within manufacturer performance.
const groundPerformance = {
  double_decker: {
    taxiStraightMps: 12,
    taxiTurnMps: 4,
    maxLateralAccelerationMps2: 0.7,
    pushbackSpeedMps: 1.5,
    towSpeedMps: 3,
    brakingDecelerationMps2: 3.4,
  },
  widebody: {
    taxiStraightMps: 13,
    taxiTurnMps: 4.5,
    maxLateralAccelerationMps2: 0.8,
    pushbackSpeedMps: 1.5,
    towSpeedMps: 3,
    brakingDecelerationMps2: 3.4,
  },
  narrowbody: {
    taxiStraightMps: 14,
    taxiTurnMps: 5,
    maxLateralAccelerationMps2: 0.9,
    pushbackSpeedMps: 1.8,
    towSpeedMps: 3.5,
    brakingDecelerationMps2: 3.4,
  },
  regional_jet: {
    taxiStraightMps: 12,
    taxiTurnMps: 5,
    maxLateralAccelerationMps2: 0.9,
    pushbackSpeedMps: 1.8,
    towSpeedMps: 3.5,
    brakingDecelerationMps2: 3.4,
  },
  propeller: {
    taxiStraightMps: 11,
    taxiTurnMps: 4.5,
    maxLateralAccelerationMps2: 0.9,
    pushbackSpeedMps: 1.5,
    towSpeedMps: 3,
    brakingDecelerationMps2: 3.4,
  },
  private: {
    taxiStraightMps: 11,
    taxiTurnMps: 4.5,
    maxLateralAccelerationMps2: 1,
    pushbackSpeedMps: 1.5,
    towSpeedMps: 3,
    brakingDecelerationMps2: 3.5,
  },
} satisfies Record<Exclude<AircraftClass, 'helicopter'>, GroundPerformance>;

export const aircraftTypes: readonly AircraftType[] = [
  {
    id: 'A388',
    name: 'A380-800',
    class: 'double_decker',
    lengthM: 72.7,
    spanM: 79.8,
    engines: { count: 4, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.double_decker,
      minTurnRadiusM: 32,
      rotationSpeedMps: 74,
      takeoffRollM: 2240,
      climbSpeedMps: 98,
      climbGradient: 0.07,
      approachSpeedMps: 71,
      landingRollM: 1100,
    },
  },
  {
    id: 'B748',
    name: '747-8',
    class: 'double_decker',
    lengthM: 76.3,
    spanM: 68.4,
    engines: { count: 4, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.double_decker,
      minTurnRadiusM: 28,
      rotationSpeedMps: 82,
      takeoffRollM: 2470,
      climbSpeedMps: 98,
      climbGradient: 0.08,
      approachSpeedMps: 79,
      landingRollM: 1260,
    },
  },
  {
    id: 'B77W',
    name: '777-300ER',
    class: 'widebody',
    lengthM: 73.9,
    spanM: 64.8,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.widebody,
      minTurnRadiusM: 28,
      rotationSpeedMps: 80,
      takeoffRollM: 2390,
      climbSpeedMps: 95,
      climbGradient: 0.09,
      approachSpeedMps: 77,
      landingRollM: 1150,
    },
  },
  {
    id: 'A359',
    name: 'A350-900',
    class: 'widebody',
    lengthM: 66.8,
    spanM: 64.75,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.widebody,
      minTurnRadiusM: 27,
      rotationSpeedMps: 77,
      takeoffRollM: 2090,
      climbSpeedMps: 93,
      climbGradient: 0.1,
      approachSpeedMps: 73,
      landingRollM: 1040,
    },
  },
  {
    id: 'A333',
    name: 'A330-300',
    class: 'widebody',
    lengthM: 63.7,
    spanM: 60.3,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.widebody,
      minTurnRadiusM: 25,
      rotationSpeedMps: 75,
      takeoffRollM: 1970,
      climbSpeedMps: 92,
      climbGradient: 0.11,
      approachSpeedMps: 72,
      landingRollM: 1000,
    },
  },
  {
    id: 'B789',
    name: '787-9',
    class: 'widebody',
    lengthM: 62.8,
    spanM: 60.1,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.widebody,
      minTurnRadiusM: 26,
      rotationSpeedMps: 77,
      takeoffRollM: 2150,
      climbSpeedMps: 93,
      climbGradient: 0.1,
      approachSpeedMps: 74,
      landingRollM: 1060,
    },
  },
  {
    id: 'A20N',
    name: 'A320neo',
    class: 'narrowbody',
    lengthM: 37.6,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.narrowbody,
      minTurnRadiusM: 16,
      rotationSpeedMps: 71,
      takeoffRollM: 1500,
      climbSpeedMps: 90,
      climbGradient: 0.12,
      approachSpeedMps: 69,
      landingRollM: 930,
    },
  },
  {
    id: 'B738',
    name: '737-800',
    class: 'narrowbody',
    lengthM: 39.5,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.narrowbody,
      minTurnRadiusM: 16,
      rotationSpeedMps: 72,
      takeoffRollM: 1670,
      climbSpeedMps: 90,
      climbGradient: 0.12,
      approachSpeedMps: 71,
      landingRollM: 960,
    },
  },
  {
    id: 'A21N',
    name: 'A321neo',
    class: 'narrowbody',
    lengthM: 44.5,
    spanM: 35.8,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.narrowbody,
      minTurnRadiusM: 18,
      rotationSpeedMps: 72,
      takeoffRollM: 1700,
      climbSpeedMps: 90,
      climbGradient: 0.11,
      approachSpeedMps: 72,
      landingRollM: 990,
    },
  },
  {
    id: 'BCS3',
    name: 'A220-300',
    class: 'narrowbody',
    lengthM: 38.7,
    spanM: 35.1,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.narrowbody,
      minTurnRadiusM: 15,
      rotationSpeedMps: 67,
      takeoffRollM: 1230,
      climbSpeedMps: 85,
      climbGradient: 0.12,
      approachSpeedMps: 67,
      landingRollM: 810,
    },
  },
  {
    id: 'E190',
    name: 'E190',
    class: 'regional_jet',
    lengthM: 36.2,
    spanM: 28.7,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.regional_jet,
      minTurnRadiusM: 15,
      rotationSpeedMps: 66,
      takeoffRollM: 1210,
      climbSpeedMps: 82,
      climbGradient: 0.12,
      approachSpeedMps: 65,
      landingRollM: 710,
    },
  },
  {
    id: 'E175',
    name: 'E175',
    class: 'regional_jet',
    lengthM: 31.7,
    spanM: 26.0,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.regional_jet,
      minTurnRadiusM: 14,
      rotationSpeedMps: 63,
      takeoffRollM: 1170,
      climbSpeedMps: 80,
      climbGradient: 0.13,
      approachSpeedMps: 62,
      landingRollM: 680,
    },
  },
  {
    id: 'CRJ9',
    name: 'CRJ900',
    class: 'regional_jet',
    lengthM: 36.2,
    spanM: 24.9,
    engines: { count: 2, mount: 'rear' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.regional_jet,
      minTurnRadiusM: 15,
      rotationSpeedMps: 71,
      takeoffRollM: 1510,
      climbSpeedMps: 87,
      climbGradient: 0.13,
      approachSpeedMps: 68,
      landingRollM: 780,
    },
  },
  {
    id: 'AT76',
    name: 'ATR 72',
    class: 'propeller',
    lengthM: 27.2,
    spanM: 27.1,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.propeller,
      minTurnRadiusM: 12,
      rotationSpeedMps: 55,
      takeoffRollM: 950,
      climbSpeedMps: 67,
      climbGradient: 0.11,
      approachSpeedMps: 59,
      landingRollM: 620,
    },
  },
  {
    id: 'DH8D',
    name: 'Dash 8-400',
    class: 'propeller',
    lengthM: 32.8,
    spanM: 28.4,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.propeller,
      minTurnRadiusM: 15,
      rotationSpeedMps: 60,
      takeoffRollM: 1070,
      climbSpeedMps: 72,
      climbGradient: 0.15,
      approachSpeedMps: 64,
      landingRollM: 680,
    },
  },
  {
    id: 'SF34',
    name: 'Saab 340',
    class: 'propeller',
    lengthM: 19.7,
    spanM: 21.4,
    engines: { count: 2, mount: 'wing' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.propeller,
      minTurnRadiusM: 11,
      rotationSpeedMps: 51,
      takeoffRollM: 850,
      climbSpeedMps: 64,
      climbGradient: 0.12,
      approachSpeedMps: 55,
      landingRollM: 560,
    },
  },
  {
    id: 'C25C',
    name: 'Citation CJ4',
    class: 'private',
    lengthM: 16.3,
    spanM: 15.5,
    engines: { count: 2, mount: 'rear' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.private,
      minTurnRadiusM: 8,
      rotationSpeedMps: 54,
      takeoffRollM: 760,
      climbSpeedMps: 73,
      climbGradient: 0.15,
      approachSpeedMps: 56,
      landingRollM: 540,
    },
  },
  {
    id: 'PC24',
    name: 'PC-24',
    class: 'private',
    lengthM: 16.9,
    spanM: 17.0,
    engines: { count: 2, mount: 'rear' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.private,
      minTurnRadiusM: 8,
      rotationSpeedMps: 51,
      takeoffRollM: 620,
      climbSpeedMps: 69,
      climbGradient: 0.15,
      approachSpeedMps: 53,
      landingRollM: 500,
    },
  },
  {
    id: 'GLF6',
    name: 'G650',
    class: 'private',
    lengthM: 30.4,
    spanM: 30.4,
    engines: { count: 2, mount: 'rear' },
    performance: {
      kind: 'fixedWing',
      ...groundPerformance.private,
      minTurnRadiusM: 13,
      rotationSpeedMps: 69,
      takeoffRollM: 1280,
      climbSpeedMps: 90,
      climbGradient: 0.15,
      approachSpeedMps: 68,
      landingRollM: 800,
    },
  },
  {
    id: 'EC45',
    name: 'H145',
    class: 'helicopter',
    lengthM: 13.6,
    spanM: 11.0,
    engines: { count: 2, mount: 'none' },
    performance: {
      kind: 'helicopter',
      hoverTaxiMps: 4,
      verticalClimbMps: 5,
      transitionSpeedMps: 18,
    },
  },
  {
    id: 'A139',
    name: 'AW139',
    class: 'helicopter',
    lengthM: 16.7,
    spanM: 13.8,
    engines: { count: 2, mount: 'none' },
    performance: {
      kind: 'helicopter',
      hoverTaxiMps: 4.5,
      verticalClimbMps: 6,
      transitionSpeedMps: 20,
    },
  },
];

/** A fixed-wing type's code from its wingspan; helicopters use helipads and carry none. */
export const aircraftCode = (type: AircraftType): AircraftCode | null =>
  type.class === 'helicopter' ? null : codeForSpan(type.spanM);

/** Synthetic stand times used to schedule each type, in minutes. */
export const aircraftTurnaroundMinutes: Readonly<Partial<Record<string, number>>> = {
  A388: 100,
  B748: 95,
  B77W: 85,
  A359: 85,
  A333: 80,
  B789: 80,
  A20N: 45,
  B738: 40,
  A21N: 50,
  BCS3: 40,
  E190: 35,
  E175: 30,
  CRJ9: 35,
  AT76: 30,
  DH8D: 30,
  SF34: 25,
  C25C: 25,
  PC24: 25,
  GLF6: 35,
  EC45: 15,
  A139: 20,
};
