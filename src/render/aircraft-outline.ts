import models from '../../fixtures/aircraft/models.json';
import type { Vec2 } from '../geo/vec2';
import type { AircraftClass, AircraftType } from '../schema/aircraft';

const bodyWidth: Record<AircraftClass, number> = {
  double_decker: 0.097,
  widebody: 0.09,
  narrowbody: 0.101,
  regional_jet: 0.087,
  propeller: 0.106,
  private: 0.089,
  helicopter: 0.17,
};

/** TASK-315: wingtip devices by type. Raked tips sweep the outer wing further back; the others
 * rise from the tip inside the published span. */
export type WingtipKind = 'none' | 'raked' | 'sharklet' | 'blended' | 'winglet' | 'fence';
const wingtips: Partial<Record<string, WingtipKind>> = {
  A388: 'fence',
  B748: 'raked',
  B77W: 'raked',
  A359: 'sharklet',
  A333: 'winglet',
  B789: 'raked',
  A20N: 'sharklet',
  B738: 'blended',
  A21N: 'sharklet',
  BCS3: 'raked',
  E190: 'winglet',
  E175: 'winglet',
  CRJ9: 'winglet',
  GLF6: 'blended',
};
export const wingtipKind = (type: AircraftType): WingtipKind => wingtips[type.id] ?? 'none';

/** Passenger and service doors, as fractions of the length from the nose, on the main deck
 * unless `upper`. The first is the boarding door a jet bridge docks at (TASK-315). */
const doorFractions: Record<AircraftClass, { from: number; upper?: true; small?: true }[]> = {
  double_decker: [
    { from: 0.13 },
    { from: 0.3 },
    { from: 0.49 },
    { from: 0.66 },
    { from: 0.86 },
    { from: 0.25, upper: true },
    { from: 0.53, upper: true },
  ],
  widebody: [{ from: 0.12 }, { from: 0.3 }, { from: 0.62 }, { from: 0.86 }],
  narrowbody: [{ from: 0.125 }, { from: 0.47, small: true }, { from: 0.86 }],
  regional_jet: [{ from: 0.12 }, { from: 0.86 }],
  propeller: [{ from: 0.13 }, { from: 0.8 }],
  private: [{ from: 0.17 }],
  helicopter: [{ from: 0.38 }],
};

/** Local metres, with +x forward, +y up, +z to starboard, and the ground at y = 0.
 * The top view uses {x, y: z}. These proportions are visual approximations. */
export function aircraftLayout(type: AircraftType) {
  const { class: category, lengthM: length, spanM: span } = type;
  const helicopter = category === 'helicopter';
  const turboprop = category === 'propeller';
  const doubleDecker = category === 'double_decker';
  const radius = (length * bodyWidth[category]) / 2;
  const halfSpan = span / 2;
  const rotorX = length / 2 - halfSpan;
  const tTail = type.engines.mount === 'rear' || type.id === 'AT76' || type.id === 'DH8D';
  const highWing = type.id === 'AT76' || type.id === 'DH8D';
  // TASK-315: high-wing turboprops and rear-engined jets sit lower on their gear than jets
  // with engines (or propellers) under a low wing.
  const bodyY =
    radius *
    (helicopter
      ? 1.65
      : highWing
        ? 1.75
        : turboprop
          ? 2.25
          : type.engines.mount === 'rear'
            ? 1.6
            : 1.95);
  const rotorY = bodyY + radius * 1.42;
  // Each station is [position along the length, width radius, vertical radius, vertical offset].
  const stations: [x: number, width: number, height: number, rise: number][] = helicopter
    ? [
        [-0.5, 0, 0, 0.48],
        [-0.46, 0.14, 0.16, 0.42],
        [-0.27, 0.22, 0.24, 0.21],
        [-0.15, 0.47, 0.54, 0.03],
        [-0.04, 0.96, 0.88, 0],
        [0.14, 1, 0.93, 0],
        [0.23, 0.96, 0.89, -0.05],
        [0.29, 0.77, 0.68, -0.13],
        [0.34, 0.42, 0.44, -0.23],
        [0.36, 0, 0, -0.27],
      ]
    : [
        [-0.5, 0, 0, 0.27],
        [-0.47, 0.18, 0.2, 0.4],
        [-0.43, 0.43, 0.5, 0.3],
        [-0.35, 0.78, 0.87, 0.08],
        [-0.25, 0.98, 1, 0],
        [-0.14, 1, 1, 0],
        [0.11, 1, 1, 0],
        [0.21, 1, type.id === 'B748' ? 1.16 : 1, type.id === 'B748' ? 0.16 : 0],
        [0.32, 1, type.id === 'B748' ? 1.2 : 0.99, type.id === 'B748' ? 0.2 : 0],
        [0.38, 0.91, 0.9, 0.01],
        [0.425, 0.75, 0.73, -0.04],
        [0.465, 0.49, 0.51, -0.11],
        [0.488, 0.24, 0.27, -0.16],
        [0.5, 0, 0, -0.19],
      ];
  const body = stations.map(([x, width, height, rise]) => ({
    x: x * length,
    y: bodyY + rise * radius,
    width: width * radius,
    height: height * radius * (doubleDecker ? 1.26 : 1),
  }));
  const section = (x: number, chord: number, z: number, y: number, thickness: number) => ({
    x: x * length,
    chord: chord * length,
    z: z * halfSpan,
    y,
    thickness: thickness * radius,
  });
  const wingY = bodyY + radius * (highWing ? 0.6 : -0.43);
  const dihedral = halfSpan * (turboprop ? 0.026 : 0.065);
  const tip = wingtipKind(type);
  const raked = tip === 'raked';
  const wing = helicopter
    ? []
    : [
        section(turboprop ? 0.14 : 0.18, turboprop ? 0.16 : 0.36, 0, wingY, 0.21),
        section(
          turboprop ? 0.115 : 0.065,
          turboprop ? 0.12 : 0.23,
          0.37,
          wingY + dihedral * 0.4,
          0.14,
        ),
        section(
          turboprop ? 0.048 : -0.14,
          turboprop ? 0.055 : raked ? 0.075 : 0.068,
          raked ? 0.86 : 0.91,
          wingY + dihedral * (raked ? 0.86 : 0.91),
          0.045,
        ),
        section(
          turboprop ? 0.034 : raked ? -0.215 : -0.18,
          turboprop ? 0.033 : raked ? 0.024 : 0.037,
          1,
          wingY + dihedral,
          0.022,
        ),
      ];
  const finY = bodyY + radius * (helicopter ? 0.56 : 0.67);
  const finTop = bodyY + radius * (helicopter ? 1.47 : 2.93);
  const tailY = tTail ? finTop - radius * 0.12 : finY;
  const tailplane = [
    section(helicopter ? -0.31 : -0.29, helicopter ? 0.075 : 0.18, 0, tailY, 0.105),
    section(
      helicopter ? -0.361 : -0.418,
      helicopter ? 0.033 : 0.062,
      helicopter ? 0.21 : 0.31,
      tailY + radius * 0.05,
      0.028,
    ),
  ];
  const fin = {
    baseX: length * (helicopter ? -0.365 : -0.3),
    tipX: length * (helicopter ? -0.47 : -0.422),
    baseChord: length * (helicopter ? 0.12 : 0.184),
    tipChord: length * (helicopter ? 0.025 : 0.057),
    baseY: finY - radius * 0.38,
    tipY: finTop,
  };
  const engines =
    type.engines.mount === 'none'
      ? []
      : Array.from({ length: type.engines.count }, (_, index) => {
          const outer = index >= 2;
          const side = index % 2 === 0 ? -1 : 1;
          const rear = type.engines.mount === 'rear';
          const z = rear ? radius * 1.13 : halfSpan * (outer ? 0.68 : turboprop ? 0.36 : 0.34);
          const size = radius * (turboprop ? 0.45 : rear ? 0.48 : outer ? 0.56 : 0.62);
          return {
            x: length * (rear ? -0.29 : turboprop ? 0.125 : outer ? -0.055 : 0.105),
            y: rear
              ? bodyY + radius * 0.26
              : wingY + dihedral * (z / halfSpan) - size * (turboprop ? 0.25 : 1.08),
            z: z * side,
            length: length * (turboprop ? 0.123 : 0.102),
            radius: size,
            propRadius: turboprop ? span * 0.075 : 0,
          };
        });
  /** The fuselage section at `x`: centre height, half width and half height. */
  function bodyAt(x: number) {
    const i = Math.max(
      1,
      body.findIndex((station) => station.x >= x),
    );
    const a = body[i - 1]!;
    const b = body[i]!;
    const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
    const lerp = (from: number, to: number) => from + (to - from) * t;
    return { y: lerp(a.y, b.y), width: lerp(a.width, b.width), height: lerp(a.height, b.height) };
  }
  const doorSize: [width: number, height: number] = {
    double_decker: [1.07, 1.93],
    widebody: [1.07, 1.89],
    narrowbody: [0.81, 1.85],
    regional_jet: [0.81, 1.75],
    propeller: [0.72, 1.6],
    private: [0.61, 1.3],
    helicopter: [1.25, 1.25],
  }[category] as [number, number];
  const doors = doorFractions[category].map(({ from, upper, small }) => {
    const x = length * (0.5 - from);
    const at = bodyAt(x);
    // Cabin floors: one deck a third of the way below the centreline, or the A380 and 747 decks.
    const sillM = cabinFloor(type, at, !!upper);
    const [widthM, heightM] = small ? [0.51, 0.97] : doorSize;
    return { x, sillM: small ? sillM + 0.75 : sillM, widthM, heightM, upper: !!upper };
  });
  return {
    body,
    bodyAt,
    radius,
    bodyY,
    wing,
    tailplane,
    fin,
    engines,
    rotorX,
    rotorY,
    tip,
    doors,
  };
}

/** TASK-315: the classes a jet bridge serves; turboprops, business jets and helicopters board
 * by stairs. */
export const bridgeable = (type: AircraftType) =>
  type.class === 'double_decker' ||
  type.class === 'widebody' ||
  type.class === 'narrowbody' ||
  type.class === 'regional_jet';

/** Cabin floors: one deck a third of the way below the centreline, or the A380 and 747 decks. */
export function cabinFloor(type: AircraftType, at: { y: number; height: number }, upper: boolean) {
  const factor = upper
    ? 0.12
    : type.class === 'double_decker'
      ? -0.45
      : type.class === 'helicopter'
        ? -0.55
        : -0.33;
  return at.y + at.height * factor;
}

const modelProfiles = models as unknown as Record<string, { profile: number[][] }>;

/** TASK-318: the fuselage section of a type's real model at `x` (`bench/aircraft-models.ts`
 * measures one every 2.5% of the length), or null for a type drawn procedurally only. */
export function modelSection(type: AircraftType, x: number) {
  const profile = modelProfiles[type.id]?.profile;
  if (!profile) return null;
  const f = Math.min(
    profile.length - 1,
    Math.max(0, (x / type.lengthM + 0.5) * (profile.length - 1)),
  );
  const a = profile[Math.floor(f)]!,
    b = profile[Math.min(profile.length - 1, Math.floor(f) + 1)]!;
  const t = f - Math.floor(f);
  const lerp = (i: number) => a[i]! + (b[i]! - a[i]!) * t;
  return { y: lerp(1), height: lerp(2), width: lerp(3) };
}

/** The boarding door (first main-deck door, port side) in local metres: x forward, the sill's
 * height, and z where the door's middle meets the fuselage side, on the real model where the
 * type has one (TASK-318), else on the procedural body. */
export function boardingDoor(type: AircraftType) {
  const layout = aircraftLayout(type);
  const door = layout.doors[0]!;
  const at = modelSection(type, door.x) ?? layout.bodyAt(door.x);
  const sillM = door.upper ? door.sillM : cabinFloor(type, at, false);
  // Where the sill height meets the elliptical section.
  const c = Math.min(1, Math.abs(sillM + door.heightM / 2 - at.y) / at.height);
  return { x: door.x, sillM, z: -at.width * Math.sqrt(1 - c * c) };
}

type PolygonPart = 'fuselage' | 'wing' | 'tailplane' | 'fin' | 'engine';
export type AircraftOutlinePart =
  | { kind: PolygonPart; points: Vec2[] }
  | { kind: 'propeller' | 'rotor'; center: Vec2; radiusM: number };

/** Paint order for a top view, with each component in local metres. Discs give the swept areas. */
export function buildAircraftOutline(type: AircraftType): AircraftOutlinePart[] {
  const { body, wing, tailplane, engines, fin, radius, rotorX } = aircraftLayout(type);
  const parts: AircraftOutlinePart[] = [];
  for (const [kind, sections] of [
    ['wing', wing],
    ['tailplane', tailplane],
  ] as const) {
    if (sections.length) {
      for (const side of [-1, 1]) {
        parts.push({
          kind,
          points: [
            ...sections.map(({ x, z }) => ({ x, y: z * side })),
            ...sections.toReversed().map(({ x, z, chord }) => ({ x: x - chord, y: z * side })),
          ],
        });
      }
    }
  }
  for (const engine of engines) {
    parts.push({
      kind: 'engine',
      points: Array.from({ length: 16 }, (_, i) => {
        const angle = (i * Math.PI) / 8;
        return {
          x: engine.x + (Math.cos(angle) * engine.length) / 2,
          y: engine.z + Math.sin(angle) * engine.radius,
        };
      }),
    });
  }
  parts.push({
    kind: 'fuselage',
    points: [
      ...body.map(({ x, width }) => ({ x, y: -width })),
      ...body
        .slice(1, -1)
        .reverse()
        .map(({ x, width }) => ({ x, y: width })),
    ],
  });
  parts.push({
    kind: 'fin',
    points: [
      { x: fin.baseX, y: 0 },
      { x: fin.baseX - fin.baseChord * 0.23, y: radius * 0.15 },
      { x: fin.baseX - fin.baseChord, y: radius * 0.05 },
      { x: fin.baseX - fin.baseChord, y: -radius * 0.05 },
      { x: fin.baseX - fin.baseChord * 0.23, y: -radius * 0.15 },
    ],
  });
  for (const { x, z, length, propRadius } of engines) {
    if (propRadius)
      parts.push({ kind: 'propeller', center: { x: x + length / 2, y: z }, radiusM: propRadius });
  }
  if (type.class === 'helicopter') {
    parts.push({ kind: 'rotor', center: { x: rotorX, y: 0 }, radiusM: type.spanM / 2 });
  }
  return parts;
}
