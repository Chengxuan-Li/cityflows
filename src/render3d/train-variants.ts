import type { RailGraph } from '../network/rail';
import type { TrainRoute } from '../network/trains';
import type { DrivingSide } from '../schema/city';
import type { RailKind } from '../schema/rail';

/** TASK-332: the train models, one per kind of rolling stock, each chosen per route by
 * `trainVariantFor`. All are drawn by one builder (`train-kit.ts`) from the records below. */
export type TrainVariantId = 'tram' | 'dlr' | 'tube' | 'nyc' | 'elizabeth' | 'sbahn' | 'intercity';

/** Positions along a car are `[anchor, offsetM]`: x = anchor × drawn length / 2 + offset, so a
 * part keeps its distance from the end it belongs to (-1 the car's rear end, 0 its middle, 1 its
 * front end) at any drawn length. The car's front is its cab end, if it has one. */
export type CarPosition = readonly [anchor: -1 | 0 | 1, offsetM: number];

/** Colours (sRGB hex) the body shader paints by height and by part. Heights in metres above the
 * rail top. */
export interface Livery {
  body: number;
  /** The band from `skirtTopM` to `bandTopM`. */
  band: number;
  bandTopM: number;
  /** Below `skirtTopM`. */
  skirt: number;
  skirtTopM: number;
  door: number;
  /** Upward-facing surfaces above the cant rail. */
  roof: number;
  /** A cab's front below its windscreen. */
  front: number;
  /** Painted behind and between the side windows, from sill to head; null keeps the body's. */
  windowBand: number | null;
  /** The gangway opening (or end door) in a coupled end wall. */
  gangway: number;
}

/** One kind of car of a variant: a cab car, a middle car, a locomotive. All car types of a
 * variant share its profile, nose, bogie and pantograph designs (one body geometry per variant
 * keeps the near level at two draw calls); they differ in length, cabs, running gear, doors,
 * windows and livery. */
export interface CarType {
  /** Drawn body length, centred in the sim's car pose and leaving the rest of the pose as
   * gangway space; omitted, the pose's own length. The sim's poses are 21.8 m (S-Bahn), 24.3 m
   * (main line) and 8.3 m (tram) with 0.7 m between them. */
  lengthM?: number;
  /** Driver's cabs: at the car's front, at both ends, or none. The formation turns a unit's last
   * car round, so its front cab faces the unit's rear. A cab is drawn as the variant's nose. */
  cabs: 'none' | 'front' | 'both';
  /** Bogie centres; at most 3 per car with the joint bogie `TrainVariant.jacobs` adds. */
  bogies: readonly CarPosition[];
  /** Raised pantographs, at most 2. */
  pantographs: readonly CarPosition[];
  /** Roof equipment housings (`TrainVariant.roofBox`), at most 2. */
  roofBoxes: readonly CarPosition[];
  /** Doors on each side, centre and width in metres, at most 6; double-leaf when wider than
   * 1.2 m. */
  doors: readonly (readonly [anchor: -1 | 0 | 1, offsetM: number, widthM: number])[];
  /** Passenger windows along the sides (false for a locomotive). */
  windows: boolean;
  livery: Livery;
}

/** The variant's cross-section, extruded along every car. Metres above the rail top and across
 * the car. */
export interface Profile {
  /** Underside of the body's skirt. */
  bottomM: number;
  /** How far the side curves in at the skirt from the widest point. */
  skirtInsetM: number;
  /** Height of the widest point. */
  waistM: number;
  /** Top of the side wall, where the roof starts. */
  cantM: number;
  /** How far the side has curved in at the cant rail. */
  cantInsetM: number;
  /** Shape of the roof between the cant rails: 2 an ellipse (a tube's roof following its
   * tunnel); higher values flatten the roof and tighten its shoulders. */
  roofSquareness: number;
}

/** A cab end, lofted from the profile: the sides round in towards the front face and the front
 * leans back above `rakeFromM`. */
export interface Nose {
  /** From where the body's side ends to the front face's foot. Must be at least `rakeM` +
   * `cornerM`. A plain end (no driver's cab, TASK-333's DLR) is a short nose. */
  lengthM: number;
  /** How far the top of the front sets back from its foot (the windscreen's lean). */
  rakeM: number;
  rakeFromM: number;
  /** Radius of the front corners in plan. */
  cornerM: number;
  /** The windscreen (or a plain end's large window) on the front face. */
  glass: { bottomM: number; topM: number; halfWidthM: number };
  /** Head lamps, white, either side of the centre at `zM`; tail lamps, red, just inside them. */
  lamps: { yM: number; zM: number; radiusM: number };
  /** Height of the coupler's middle, drawn where the car is coupled without bellows. */
  couplerM: number;
  /** Destination display above the windscreen (blank: no route numbers). */
  display: { bottomM: number; topM: number; halfWidthM: number } | null;
}

/** How cars make up a train, counted from the route's forward end, so the make-up keeps its
 * order whichever way the train runs (a push-pull train's locomotive stays at one end). */
export interface Formation {
  /** Cars per unit; 0, the whole train is one unit. A train's last unit may be shorter. */
  unitCars: number;
  /** Car types from a unit's front: `first`, the middle cars cycling through `middle`, and
   * `last`, turned round. A one-car unit is `first` with a cab at each end. */
  first: string;
  middle: readonly string[];
  last: string;
}

export interface TrainVariant {
  id: TrainVariantId;
  /** What the model is like, with the reference dimensions it uses. */
  reference: string;
  widthM: number;
  /** Rail top to the roof's top, without the pantograph and roof equipment. */
  heightM: number;
  /** Floor above the rail top: the doors' sills. */
  floorM: number;
  profile: Profile;
  nose: Nose;
  windows: {
    sillM: number;
    headM: number;
    /** Pane pitch along the car, and the pillar between panes. */
    paneM: number;
    pillarM: number;
    /** No panes this close to a car end or behind a cab. */
    endMarginM: number;
  };
  doorTopM: number;
  bogie: {
    wheelbaseM: number;
    wheelDiameterM: number;
    /** Third- or fourth-rail collector shoes beside the bogie (TASK-333, TASK-334). */
    shoes: boolean;
  };
  /** Pantographs reach the contact wire (`catenaryRule.contactM`); null: the variant has none. */
  pantograph: { baseWidthM: number } | null;
  roofBox: { lengthM: number; widthM: number; heightM: number };
  /** Bellows close the gap between coupled cars of a unit where neither has a cab. */
  bellows: boolean;
  /** Jacobs bogies: one bogie under each joint inside a unit, shared by both cars. */
  jacobs: boolean;
  formation: Formation;
  /** At most four car types. */
  carTypes: Readonly<Record<string, CarType>>;
}

const etRed = 0xc8141e;

/** Low-floor articulated tram in 9 m modules, like Freiburg's and Munich's (Combino, Avenio):
 * 2.30 m wide, roof 3.40 m above the rail (the pantograph's base), floor 0.35 m. Modules on a
 * bogie alternate with modules hung between them; the pantograph sits on a hung module. Red and
 * white, with a dark window band. */
const tramLivery: Livery = {
  body: 0xf3f2ee,
  band: 0xc4161c,
  bandTopM: 0.9,
  skirt: 0x3b3e42,
  skirtTopM: 0.24,
  door: 0xc4161c,
  roof: 0xdedfdc,
  front: 0xc4161c,
  windowBand: 0x1f2226,
  gangway: 0x2a2c2e,
};
const tram: TrainVariant = {
  id: 'tram',
  reference: 'Low-floor tram (Combino/Avenio-like): 9 m modules, 2.30 m wide, roof 3.40 m',
  widthM: 2.3,
  heightM: 3.4,
  floorM: 0.35,
  profile: {
    bottomM: 0.12,
    skirtInsetM: 0.05,
    waistM: 0.95,
    cantM: 2.95,
    cantInsetM: 0.09,
    roofSquareness: 4,
  },
  nose: {
    lengthM: 1.5,
    rakeM: 0.4,
    rakeFromM: 1.1,
    cornerM: 0.7,
    glass: { bottomM: 1.12, topM: 2.72, halfWidthM: 0.92 },
    lamps: { yM: 0.72, zM: 0.8, radiusM: 0.11 },
    couplerM: 0.5,
    display: { bottomM: 2.8, topM: 3.08, halfWidthM: 0.72 },
  },
  windows: { sillM: 1.05, headM: 2.6, paneM: 1.75, pillarM: 0.14, endMarginM: 0.35 },
  doorTopM: 2.45,
  bogie: { wheelbaseM: 1.8, wheelDiameterM: 0.6, shoes: false },
  pantograph: { baseWidthM: 1.1 },
  roofBox: { lengthM: 4.4, widthM: 1.7, heightM: 0.32 },
  bellows: true,
  jacobs: false,
  formation: { unitCars: 0, first: 'cab', middle: ['hung', 'module'], last: 'cab' },
  carTypes: {
    cab: {
      cabs: 'front',
      bogies: [[0, -1.7]],
      pantographs: [],
      roofBoxes: [[0, -1.3]],
      doors: [[1, -3.3, 1.3]],
      windows: true,
      livery: tramLivery,
    },
    hung: {
      bogies: [],
      cabs: 'none',
      pantographs: [[0, 0]],
      roofBoxes: [],
      doors: [[0, 0, 1.3]],
      windows: true,
      livery: tramLivery,
    },
    module: {
      cabs: 'none',
      bogies: [[0, 0]],
      pantographs: [],
      roofBoxes: [[0, 0]],
      doors: [],
      windows: true,
      livery: tramLivery,
    },
  },
};

/** S-Bahn EMU like DB's ET 423: a 67.4 m four-car unit, 3.02 m wide, roof 4.0 m above the
 * rail, floor 1.0 m (for 96 cm platforms), on Jacobs bogies. The sim's 135 m train is two such
 * units, 134.8 m: each unit is drawn over three of the sim's 22.5 m car poses, its cabs meeting
 * the other unit's in the middle of the train. Three double doors per side per car, a
 * pantograph per unit on its middle car. Light grey, with a red band, doors and front. */
const etLivery: Livery = {
  body: 0xeceeed,
  band: etRed,
  bandTopM: 1.55,
  skirt: 0x3a3d40,
  skirtTopM: 0.72,
  door: etRed,
  roof: 0x9ca1a5,
  front: etRed,
  windowBand: 0x1f2226,
  gangway: 0x2a2c2e,
};
const sbahn: TrainVariant = {
  id: 'sbahn',
  reference: 'ET 423-like EMU: 67.4 m four-car unit, 3.02 m wide, roof 4.0 m, floor 1.0 m',
  widthM: 3.02,
  heightM: 4.0,
  floorM: 1.0,
  profile: {
    bottomM: 0.5,
    skirtInsetM: 0.14,
    waistM: 1.35,
    cantM: 3.35,
    cantInsetM: 0.12,
    roofSquareness: 3,
  },
  nose: {
    lengthM: 2.1,
    rakeM: 0.95,
    rakeFromM: 1.85,
    cornerM: 0.75,
    glass: { bottomM: 2.0, topM: 3.2, halfWidthM: 1.12 },
    lamps: { yM: 1.25, zM: 1.05, radiusM: 0.13 },
    couplerM: 1.0,
    display: { bottomM: 3.27, topM: 3.55, halfWidthM: 0.78 },
  },
  windows: { sillM: 1.9, headM: 3.0, paneM: 2.1, pillarM: 0.2, endMarginM: 0.45 },
  doorTopM: 3.05,
  bogie: { wheelbaseM: 2.5, wheelDiameterM: 0.85, shoes: false },
  pantograph: { baseWidthM: 1.3 },
  roofBox: { lengthM: 3.2, widthM: 1.7, heightM: 0.38 },
  bellows: true,
  jacobs: true,
  formation: { unitCars: 3, first: 'cab', middle: ['middle'], last: 'cab' },
  carTypes: {
    cab: {
      cabs: 'front',
      bogies: [[1, -3.1]],
      pantographs: [],
      roofBoxes: [[0, -1.5]],
      doors: [
        [1, -5.4, 1.3],
        [0, -1.0, 1.3],
        [-1, 3.7, 1.3],
      ],
      windows: true,
      livery: etLivery,
    },
    middle: {
      cabs: 'none',
      bogies: [],
      pantographs: [[0, 0]],
      roofBoxes: [
        [0, -5.2],
        [0, 5.2],
      ],
      doors: [
        [1, -3.7, 1.3],
        [0, 0, 1.3],
        [-1, 3.7, 1.3],
      ],
      windows: true,
      livery: etLivery,
    },
  },
};

/** The variants built so far. TASK-333 and TASK-334 add the others as records. */
export const trainVariants: Partial<Record<TrainVariantId, TrainVariant>> = { tram, sbahn };

/** The variant a route is drawn with, by its kind, the rail kind covering most of its length and
 * the city's driving side (standing in for the country; projects carry none). */
export function trainVariantFor(
  route: TrainRoute,
  rail: RailGraph,
  drivingSide: DrivingSide,
): TrainVariantId {
  if (route.kind === 'tram') return 'tram';
  const lengths = new Map<RailKind, number>();
  for (const s of route.sections) {
    const track = rail.tracks[s.track]!;
    lengths.set(track.kind, (lengths.get(track.kind) ?? 0) + track.lengthM);
  }
  let mostly: RailKind = 'rail',
    most = -1;
  for (const [kind, m] of lengths)
    if (m > most) {
      most = m;
      mostly = kind;
    }
  const left = drivingSide === 'left';
  if (mostly === 'light_rail') return 'dlr';
  if (mostly === 'subway') return left ? 'tube' : 'nyc';
  if (route.kind === 'mainline') return 'intercity';
  return left ? 'elizabeth' : 'sbahn';
}

/** A built variant; the S-Bahn stands in for one not built yet. */
export const builtVariant = (id: TrainVariantId): TrainVariant =>
  trainVariants[id] ?? trainVariants.sbahn!;
