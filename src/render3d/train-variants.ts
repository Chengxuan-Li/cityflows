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
  /** Drawn body length, centred in the sim's car pose. Omitted, the pose's own length. At the
   * extract edge the body is limited to the visible pose length. Full poses are 21.8 m (S-Bahn),
   * 24.3 m (main line) and 8.3 m (tram) with 0.7 m between them. */
  lengthM?: number;
  /** Move a short car toward its coupled end, leaving this much to the pose joint. */
  coupledGapM?: number;
  /** A panelled gangway door on any plain end without bellows. */
  closedGangway?: boolean;
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
  /** Side buffers on coupled ends without bellows, at the coupler height. */
  buffers?: { halfSpacingM: number; reachM: number };
  /** Destination display above the windscreen (blank: no route numbers). */
  display: { bottomM: number; topM: number; halfWidthM: number } | null;
  /** Central door from the floor to `topM`, on cab fronts and coupled end walls. */
  endDoor?: { topM: number; halfWidthM: number };
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
  /** Shaded horizontal ribs below the livery's skirt height, along the sides. */
  flutedSkirt?: boolean;
  /** A painted band along the upper sides, in metres above the rail top. */
  roofBand?: { bottomM: number; topM: number; colour: number };
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

/** Driverless light metro with two articulated sections and a shared bogie at the joint. The
 * kit's end shape carries a broad passenger window and end lamps. */
const dlr: TrainVariant = {
  id: 'dlr',
  reference: 'B07-like light metro: two articulated sections, 2.65 m wide, on three bogies',
  widthM: 2.65,
  heightM: 3.45,
  floorM: 1.02,
  profile: {
    bottomM: 0.54,
    skirtInsetM: 0.09,
    waistM: 1.3,
    cantM: 3.01,
    cantInsetM: 0.08,
    roofSquareness: 4,
  },
  nose: {
    lengthM: 0.48,
    rakeM: 0.08,
    rakeFromM: 1.52,
    cornerM: 0.24,
    glass: { bottomM: 1.62, topM: 2.94, halfWidthM: 1.01 },
    lamps: { yM: 1.3, zM: 0.88, radiusM: 0.095 },
    couplerM: 0.66,
    display: null,
  },
  windows: { sillM: 1.68, headM: 2.87, paneM: 2.35, pillarM: 0.31, endMarginM: 0.42 },
  doorTopM: 3.0,
  bogie: { wheelbaseM: 1.9, wheelDiameterM: 0.67, shoes: true },
  pantograph: null,
  roofBox: { lengthM: 3.4, widthM: 1.48, heightM: 0.22 },
  bellows: true,
  jacobs: true,
  formation: { unitCars: 2, first: 'section', middle: [], last: 'section' },
  carTypes: {
    section: {
      cabs: 'front',
      bogies: [[1, -2.9]],
      pantographs: [],
      roofBoxes: [[0, 0]],
      doors: [
        [1, -4.7, 1.55],
        [-1, 4.4, 1.55],
      ],
      windows: true,
      livery: {
        body: 0xf1f2f4,
        band: 0x163d79,
        bandTopM: 1.63,
        skirt: 0xc51830,
        skirtTopM: 1.19,
        door: 0xe4e9ee,
        roof: 0x7a828c,
        front: 0xc51830,
        windowBand: 0x282e34,
        gangway: 0x30363a,
      },
    },
  },
};

const elizabethLivery: Livery = {
  body: 0xf3f3f4,
  band: 0x633796,
  bandTopM: 1.54,
  skirt: 0x3e3d46,
  skirtTopM: 0.91,
  door: 0x653999,
  roof: 0xa7a8ad,
  front: 0x25272c,
  windowBand: 0x34353b,
  gangway: 0x2c2c30,
};
const elizabethTrailer: CarType = {
  cabs: 'none',
  bogies: [
    [1, -3.25],
    [-1, 3.25],
  ],
  pantographs: [],
  roofBoxes: [[0, 0]],
  doors: [
    [1, -4.5, 1.65],
    [0, 0, 1.65],
    [-1, 4.5, 1.65],
  ],
  windows: true,
  livery: elizabethLivery,
};

/** One through-gangway EMU, with cabs at the outer ends and two powered middle cars. */
const elizabeth: TrainVariant = {
  id: 'elizabeth',
  reference: 'Class 345-like EMU: 2.77 m wide, 3.76 m over the rail, 25 m pose pitch on mainline',
  widthM: 2.77,
  heightM: 3.76,
  floorM: 1.1,
  profile: {
    bottomM: 0.55,
    skirtInsetM: 0.14,
    waistM: 1.4,
    cantM: 3.23,
    cantInsetM: 0.09,
    roofSquareness: 3.8,
  },
  nose: {
    lengthM: 2.05,
    rakeM: 0.95,
    rakeFromM: 1.43,
    cornerM: 0.55,
    glass: { bottomM: 1.96, topM: 3.19, halfWidthM: 1.01 },
    lamps: { yM: 1.44, zM: 0.73, radiusM: 0.095 },
    couplerM: 0.93,
    display: { bottomM: 3.23, topM: 3.44, halfWidthM: 0.57 },
  },
  windows: { sillM: 1.76, headM: 3.01, paneM: 2.5, pillarM: 0.16, endMarginM: 0.46 },
  doorTopM: 3.08,
  bogie: { wheelbaseM: 2.45, wheelDiameterM: 0.84, shoes: false },
  pantograph: { baseWidthM: 1.21 },
  roofBox: { lengthM: 4.7, widthM: 1.7, heightM: 0.21 },
  bellows: true,
  jacobs: false,
  formation: {
    unitCars: 0,
    first: 'cab',
    middle: ['powered', 'trailer', 'powered', 'trailer', 'trailer', 'trailer'],
    last: 'cab',
  },
  carTypes: {
    cab: { ...elizabethTrailer, cabs: 'front' },
    trailer: elizabethTrailer,
    powered: { ...elizabethTrailer, pantographs: [[0, -6.5]] },
  },
};

const intercityRed = 0xcc1725;
const intercityWhite = 0xf0eeea;
const intercityLivery: Livery = {
  body: intercityWhite,
  band: intercityRed,
  bandTopM: 1.53,
  skirt: intercityWhite,
  skirtTopM: 1.22,
  door: intercityWhite,
  roof: 0x97999d,
  front: intercityWhite,
  windowBand: null,
  gangway: 0x2b2c2d,
};
const intercityCoach: CarType = {
  // Keep a gap for bellows on the simulation's 25 m pitch.
  lengthM: 24.8,
  closedGangway: true,
  cabs: 'none',
  bogies: [
    [1, -3.45],
    [-1, 3.45],
  ],
  pantographs: [],
  roofBoxes: [],
  doors: [
    [1, -1.5, 0.92],
    [-1, 1.5, 0.92],
  ],
  windows: true,
  livery: intercityLivery,
};

/** Push-pull Intercity set: a BR 101-like electric locomotive, coaches and a control car. */
const intercity: TrainVariant = {
  id: 'intercity',
  reference: 'BR 101-like 19 m electric locomotive with 26 m-style Intercity coaches',
  widthM: 2.93,
  heightM: 4.12,
  floorM: 1.23,
  profile: {
    bottomM: 0.77,
    skirtInsetM: 0.12,
    waistM: 1.45,
    cantM: 3.56,
    cantInsetM: 0.13,
    roofSquareness: 3.4,
  },
  nose: {
    lengthM: 1.82,
    rakeM: 0.84,
    rakeFromM: 1.75,
    cornerM: 0.51,
    glass: { bottomM: 2.48, topM: 3.48, halfWidthM: 1.04 },
    lamps: { yM: 1.53, zM: 0.88, radiusM: 0.12 },
    couplerM: 0.99,
    buffers: { halfSpacingM: 0.875, reachM: 0.5 },
    display: null,
  },
  windows: { sillM: 1.98, headM: 3.17, paneM: 1.94, pillarM: 0.41, endMarginM: 0.65 },
  doorTopM: 3.17,
  bogie: { wheelbaseM: 2.65, wheelDiameterM: 1.02, shoes: false },
  pantograph: { baseWidthM: 1.3 },
  roofBox: { lengthM: 3.7, widthM: 1.83, heightM: 0.32 },
  bellows: true,
  jacobs: false,
  formation: { unitCars: 0, first: 'loco', middle: ['coach'], last: 'control' },
  carTypes: {
    loco: {
      lengthM: 19,
      coupledGapM: 1.1,
      cabs: 'both',
      bogies: [
        [0, -5.2],
        [0, 5.2],
      ],
      pantographs: [
        [0, -5.4],
        [0, 5.4],
      ],
      roofBoxes: [
        [0, -1.9],
        [0, 1.9],
      ],
      doors: [],
      windows: false,
      livery: {
        body: intercityRed,
        band: intercityRed,
        bandTopM: 1.38,
        skirt: 0x414347,
        skirtTopM: 1.2,
        door: intercityRed,
        roof: 0x62676c,
        front: intercityRed,
        windowBand: null,
        gangway: 0x2b2c2d,
      },
    },
    coach: intercityCoach,
    control: {
      ...intercityCoach,
      cabs: 'front',
      doors: [
        [1, -3.8, 0.92],
        [-1, 1.5, 0.92],
      ],
    },
  },
};

const tubeCar: CarType = {
  cabs: 'none',
  bogies: [
    [1, -2.7],
    [-1, 2.7],
  ],
  pantographs: [],
  roofBoxes: [],
  doors: [
    [0, -6.2, 0.9],
    [0, -2.35, 1.45],
    [0, 2.35, 1.45],
    [0, 6.2, 0.9],
  ],
  windows: true,
  livery: {
    body: 0xf2f1eb,
    band: 0x193574,
    bandTopM: 1.02,
    skirt: 0x262b34,
    skirtTopM: 0.44,
    door: 0xcc192a,
    roof: 0xc3c6c9,
    front: 0xcc192a,
    windowBand: null,
    gangway: 0x34363b,
  },
};

const tube: TrainVariant = {
  id: 'tube',
  reference: 'Generic London deep-tube stock: 2.6 m wide, roof 2.9 m, close-coupled cars',
  widthM: 2.6,
  heightM: 2.9,
  floorM: 0.65,
  profile: {
    bottomM: 0.32,
    skirtInsetM: 0.19,
    waistM: 1.02,
    cantM: 1.72,
    cantInsetM: 0.045,
    roofSquareness: 2,
  },
  nose: {
    lengthM: 0.36,
    rakeM: 0.035,
    rakeFromM: 1.15,
    cornerM: 0.26,
    glass: { bottomM: 1.47, topM: 2.4, halfWidthM: 0.94 },
    lamps: { yM: 1.06, zM: 0.82, radiusM: 0.095 },
    couplerM: 0.54,
    display: { bottomM: 2.48, topM: 2.66, halfWidthM: 0.46 },
  },
  windows: { sillM: 1.42, headM: 2.12, paneM: 1.7, pillarM: 0.18, endMarginM: 0.5 },
  doorTopM: 2.4,
  bogie: { wheelbaseM: 1.9, wheelDiameterM: 0.68, shoes: true },
  pantograph: null,
  roofBox: { lengthM: 0, widthM: 0, heightM: 0 },
  bellows: false,
  jacobs: false,
  formation: { unitCars: 0, first: 'cab', middle: ['car'], last: 'cab' },
  carTypes: { cab: { ...tubeCar, cabs: 'front' }, car: tubeCar },
};

const nycCar: CarType = {
  cabs: 'none',
  bogies: [
    [1, -2.55],
    [-1, 2.55],
  ],
  pantographs: [],
  roofBoxes: [],
  doors: [
    [0, -5.75, 1.5],
    [0, -1.92, 1.5],
    [0, 1.92, 1.5],
    [0, 5.75, 1.5],
  ],
  windows: true,
  livery: {
    body: 0xc9cdd0,
    band: 0xbbc0c4,
    bandTopM: 1.47,
    skirt: 0x8e969c,
    skirtTopM: 1.06,
    door: 0xd6d9dc,
    roof: 0xafb4b8,
    front: 0xc5cacd,
    windowBand: null,
    gangway: 0x686f74,
  },
};

const nyc: TrainVariant = {
  id: 'nyc',
  reference: 'Generic R46/R68-style subway stock: 75 ft (22.9 m) reference, 3 m wide, roof 3.65 m',
  widthM: 3,
  heightM: 3.65,
  floorM: 1.08,
  profile: {
    bottomM: 0.48,
    skirtInsetM: 0.085,
    waistM: 1.02,
    cantM: 3.26,
    cantInsetM: 0,
    roofSquareness: 4,
  },
  nose: {
    lengthM: 0.26,
    rakeM: 0.015,
    rakeFromM: 1.3,
    cornerM: 0.16,
    glass: { bottomM: 1.91, topM: 2.94, halfWidthM: 1.19 },
    lamps: { yM: 1.48, zM: 1.02, radiusM: 0.105 },
    couplerM: 0.73,
    display: { bottomM: 3.07, topM: 3.28, halfWidthM: 0.48 },
    endDoor: { topM: 3.02, halfWidthM: 0.37 },
  },
  windows: { sillM: 1.96, headM: 2.9, paneM: 1.92, pillarM: 0.16, endMarginM: 0.61 },
  doorTopM: 3.02,
  flutedSkirt: true,
  roofBand: { bottomM: 3.08, topM: 3.25, colour: 0x556c7a },
  bogie: { wheelbaseM: 2.1, wheelDiameterM: 0.86, shoes: true },
  pantograph: null,
  roofBox: { lengthM: 0, widthM: 0, heightM: 0 },
  bellows: false,
  jacobs: false,
  formation: { unitCars: 0, first: 'cab', middle: ['car'], last: 'cab' },
  carTypes: { cab: { ...nycCar, cabs: 'front' }, car: nycCar },
};

/** Every variant, by id. */
export const trainVariants: Partial<Record<TrainVariantId, TrainVariant>> = {
  tram,
  sbahn,
  dlr,
  elizabeth,
  intercity,
  tube,
  nyc,
};

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
  if (left) return 'elizabeth';
  return route.kind === 'mainline' ? 'intercity' : 'sbahn';
}

/** A built variant; the S-Bahn stands in for one not built yet. */
export const builtVariant = (id: TrainVariantId): TrainVariant =>
  trainVariants[id] ?? trainVariants.sbahn!;
