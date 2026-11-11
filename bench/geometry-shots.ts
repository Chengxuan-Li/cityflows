import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Page } from '@playwright/test';
import { fixtureTerrain } from '../tests/e2e/terrain-fixture';
import { cumulativeLengths, pointAtDistance, polylineLength } from '../src/geo/polyline';
import type { City } from '../src/schema';
import { lonLatToLocal, type GeoReference } from '../src/geo/projection';
import type { Vec2 } from '../src/geo/vec2';
import { drivableClass } from '../src/importers/osm/filter';
import { parseOsm } from '../src/importers/osm/parse';
import { compile } from '../src/network';

// Fixed-camera images of the geometry rework's cases (TASK-081, docs/plan.md "Geometry rework"):
// starts the dev server on a free port, imports the Munich extract (or a shot's own, TASK-094)
// through the app's import dialog, hides the basemap, places and entrances, and captures each
// shot at the camera below, so images of two trees line up pixel for pixel. Usage:
// npm run geometry-shots -- <out-dir> [--only <id,id>] (TASK-090: only the named shots).

const MUNICH = 'fixtures/osm/munich-donnersberger.osm';
const SINDELFINGEN = 'fixtures/osm/sindelfingen-a81.osm';
/** Pairs across the zebras at n:180 and n:212 and the signals at n:963 and n:262 (among T53's
 * Munich pairs; TASK-131 re-rooted them to the places of the same OSM sources). */
const v111Walkers = [
  ['p:1664', 'p:1814'],
  ['p:1814', 'p:1664'],
  ['p:1566', 'p:1814'],
  ['p:1664', 'p:1698'],
  ['p:1558', 'p:1836'],
  ['p:1836', 'p:1558'],
].map(([fromPlaceId, toPlaceId]) => ({
  fromPlaceId: fromPlaceId!,
  toPlaceId: toPlaceId!,
  perHour: 600,
}));

/** TASK-131 reference cases: shot id, main's node there, the camera centre (main's node
 * position), label, extract. */
const T131_CASES = [
  ['n138', 'n:138', [-18.85, -540.61], 'reference: Arnulfstraße x Donnersbergerstraße'],
  ['n638', 'n:638', [90.29, -526.03], 'reference: Arnulfstraße x Landshuter Allee'],
  ['n247', 'n:247', [-19.28, 166.81], 'reference (n:967 before TASK-101): Landsberger Straße'],
  ['n263', 'n:263', [-21.4, 106.86], 'reference: Landsberger ramps'],
  ['n936', 'n:936', [37.81, 163.9], 'reference: Landsberger Straße'],
  ['n570', 'n:570', [-571.33, -530.29], 'worst cluster 1, an arm turned 120 degrees'],
  ['n894', 'n:894', [-5.8, -183.37], 'worst cluster 2, an arm turned 76 degrees'],
  ['n446', 'n:446', [-464.79, -642.32], 'worst cluster 3, an arm turned 70 degrees'],
  ['sindelfingen-n841', 'n:841', [312.7, -595.66], 'reference: B55', SINDELFINGEN],
  ['sindelfingen-n68', 'n:68', [349.82, -487.76], 'reference: B55', SINDELFINGEN],
  [
    'sindelfingen-n139',
    'n:139',
    [-174.64, -599.95],
    'worst cluster 4, an arm turned 60 degrees',
    SINDELFINGEN,
  ],
  [
    'sindelfingen-n911',
    'n:911',
    [-324.65, -667.96],
    'worst cluster 5, an arm turned 58 degrees',
    SINDELFINGEN,
  ],
] as [string, string, [number, number], string, string?][];

/** World centre (m, the city's frame) and zoom (screen px per m) of each image; the case ids are
 * bench/geometry-audit.ts's. The map canvas is 1280 x 800 px. */
export const shots: {
  id: string;
  cases: string[];
  centre: [number, number];
  zoom: number;
  osm?: string;
  view?: '3d';
  theme?: 'de' | 'us' | 'uk';
  terrain?: boolean;
  pitch?: number;
  bearing?: number;
  buildings?: boolean;
  details?: boolean;
  /** TASK-111: test pedestrians set (restarting the run) before the shot, then `steps` steps. All
   * walker shots of an extract share one run: the union of their sources, the largest `steps`. */
  walkers?: { fromPlaceId: string; toPlaceId: string; perHour: number }[];
  steps?: number;
  timeS?: number;
  demandScale?: number;
  parkingTarget?: 'street' | 'inferred-lot';
  /** TASK-131: the extract's raw drivable OSM way lines and junction nodes drawn on top, with
   * this label; `node` is the city node the camera is centred on (checked against the import). */
  osmLines?: string;
  node?: string;
  /** TASK-131 Phase 1: the junction groups on top of the OSM overlay. */
  groups?: boolean;
}[] = [
  ...(['2d', '3d'] as const).flatMap((view) => [
    {
      id: `V112-munich-street${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [-300, 290] as [number, number],
      zoom: 8,
      timeS: 7.5 * 3600,
      demandScale: 0.15,
      ...(view === '3d' && { view, terrain: true, pitch: 60, bearing: 30 }),
    },
    {
      id: `V112-munich-lot${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [135.7, 305.3] as [number, number],
      zoom: 7,
      timeS: 8.5 * 3600,
      demandScale: 0.15,
      ...(view === '3d' && { view, terrain: true, pitch: 55 }),
    },
  ]),
  // TASK-111: walkers on sidewalks and crossings, cars held before zebra stripes at n:180 and the
  // walk lights at Landsberger Straße by the Donnersbergerbrücke (n:963, n:262), at 07:30.
  ...[
    { id: 'V111-munich-zebra', centre: [478, 362] as [number, number], zoom: 13 },
    { id: 'V111-munich-signal', centre: [-79, 154] as [number, number], zoom: 7 },
  ].flatMap((shot) =>
    [false, true].map((three) => ({
      ...shot,
      id: `${shot.id}${three ? '-3d' : ''}`,
      cases: [],
      walkers: v111Walkers,
      steps: 18000,
      ...(three ? { view: '3d' as const, pitch: 50, bearing: 30 } : {}),
    })),
  ),
  ...(['de', 'us', 'uk'] as const).flatMap((theme) =>
    [false, true].map((three) => ({
      id: `V117-munich-signs${theme === 'de' ? '' : `-${theme}`}${three ? '-3d' : ''}`,
      cases: [],
      centre: (three ? [-20, -222] : [-35, -222]) as [number, number],
      zoom: 24,
      theme,
      ...(three ? { view: '3d' as const, pitch: 20, bearing: 270 } : {}),
    })),
  ),
  { id: 'V117-munich-motorway-uk', cases: [], centre: [0, -256], zoom: 4, theme: 'uk' },
  ...(['2d', '3d'] as const).flatMap((view) => [
    {
      id: `V118-munich-lot${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [135.7, 305.3] as [number, number],
      zoom: 7,
      timeS: 8 * 3600,
      ...(view === '3d' && { view, terrain: true, pitch: 55 }),
    },
    {
      id: `V118-munich-street${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [-300, 290] as [number, number],
      zoom: 8,
      timeS: 8 * 3600,
      ...(view === '3d' && { view, terrain: true, pitch: 60, bearing: 30 }),
    },
    {
      id: `V103-munich-street${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [-300, 290] as [number, number],
      zoom: 8,
      ...(view === '3d' && { view, terrain: true, pitch: 60, bearing: 30 }),
      timeS: 8 * 3600,
      parkingTarget: 'street' as const,
    },
    {
      id: `V103-munich-lot${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [135.7, 305.3] as [number, number],
      zoom: 7,
      ...(view === '3d' && { view, terrain: true, pitch: 55 }),
      timeS: 8 * 3600,
    },
    {
      id: `V103-sindelfingen-lot${view === '3d' ? '-3d' : ''}`,
      cases: [],
      centre: [-379, -498.4] as [number, number],
      zoom: 5,
      osm: 'fixtures/osm/sindelfingen-a81.osm',
      ...(view === '3d' && { view, terrain: true, pitch: 55 }),
      timeS: 8 * 3600,
      parkingTarget: 'inferred-lot' as const,
    },
  ]),
  ...[true, false].flatMap((details) => [
    {
      id: `V109-munich-roofs${details ? '' : '-off'}`,
      cases: [],
      centre: [610, 425] as [number, number],
      zoom: 4,
      view: '3d' as const,
      terrain: true,
      pitch: 62,
      bearing: 30,
      details,
    },
    {
      id: `V109-munich-overview${details ? '' : '-off'}`,
      cases: [],
      centre: [0, 0] as [number, number],
      zoom: 0.55,
      view: '3d' as const,
      terrain: true,
      pitch: 40,
      bearing: 15,
      details,
    },
  ]),
  {
    id: 'V109-sindelfingen-terrain',
    cases: [],
    centre: [515, 520],
    zoom: 3,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
    view: '3d',
    terrain: true,
    pitch: 65,
    bearing: 30,
    buildings: false,
  },
  {
    id: 'V109-sindelfingen-canopies',
    cases: [],
    centre: [615, 65],
    zoom: 7,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
    view: '3d',
    terrain: true,
    pitch: 62,
    bearing: 30,
  },
  { id: 'V104-munich-lot', cases: [], centre: [135.7, 305.3], zoom: 7 },
  {
    id: 'V104-munich-lot-3d',
    cases: [],
    centre: [135.7, 305.3],
    zoom: 7,
    view: '3d',
    terrain: true,
    pitch: 45,
  },
  {
    id: 'V104-sindelfingen-lot',
    cases: [],
    centre: [-379, -498.4],
    zoom: 5,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'V104-sindelfingen-lot-3d',
    cases: [],
    centre: [-379, -498.4],
    zoom: 5,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
    view: '3d',
    terrain: true,
    pitch: 45,
  },
  { id: 'V110-munich-sidewalks', cases: [], centre: [-300, 290], zoom: 4 },
  { id: 'V110-munich-crossings', cases: [], centre: [-19, 167], zoom: 6 },
  {
    id: 'V110-sindelfingen-paths',
    cases: [],
    centre: [470, 590],
    zoom: 4,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'V110-munich-sidewalks-3d',
    cases: [],
    centre: [-300, 290],
    zoom: 4,
    view: '3d',
    terrain: true,
    pitch: 55,
    bearing: 30,
  },
  {
    id: 'V110-munich-crossings-3d',
    cases: [],
    centre: [-19, 167],
    zoom: 6,
    view: '3d',
    terrain: true,
    pitch: 55,
    bearing: 30,
  },
  ...[
    { id: 'V107-munich-street', centre: [-300, 290] as [number, number], zoom: 8, bearing: 30 },
    { id: 'V107-munich-bus-lane', centre: [10, -305] as [number, number], zoom: 16, bearing: 0 },
    { id: 'V107-munich-zone', centre: [-408, -466] as [number, number], zoom: 20, bearing: 180 },
  ].flatMap((shot) => [
    { ...shot, cases: [] },
    {
      ...shot,
      id: `${shot.id}-3d`,
      cases: [],
      view: '3d' as const,
      terrain: true,
      pitch: shot.id.endsWith('zone') ? 30 : 45,
      zoom: shot.id.endsWith('zone') ? 55 : shot.zoom,
    },
  ]),
  ...(['de', 'us', 'uk'] as const).flatMap((theme) =>
    [false, true].flatMap((three) => [
      {
        id: `V114-munich-${theme}${three ? '-3d' : ''}`,
        cases: [],
        centre: [0, -256] as [number, number],
        zoom: 10,
        theme,
        ...(three ? { view: '3d' as const, pitch: 60, bearing: 0 } : {}),
      },
      {
        id: `V114-downtown-${theme}${three ? '-3d' : ''}`,
        cases: [],
        centre: [0, 0] as [number, number],
        zoom: 4,
        osm: 'fixtures/osm/downtown.osm',
        theme,
        ...(three ? { view: '3d' as const, pitch: 60, bearing: 0 } : {}),
      },
      {
        id: `V114-munich-arrows-${theme}${three ? '-3d' : ''}`,
        cases: [],
        centre: [10, 170] as [number, number],
        zoom: 12,
        theme,
        ...(three ? { view: '3d' as const, pitch: 60, bearing: 0 } : {}),
      },
    ]),
  ),
  { id: 'V108-munich-exit', cases: [], centre: [0, -256], zoom: 10 },
  { id: 'V108-munich-arrows', cases: [], centre: [10, 170], zoom: 12 },
  {
    id: 'V108-sindelfingen-exit',
    cases: [],
    centre: [685, 247],
    zoom: 14,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  { id: 'V106-munich-streets', cases: [], centre: [-300, 290], zoom: 3 },
  { id: 'V106-munich-park', cases: [], centre: [-430, 390], zoom: 4 },
  {
    id: 'V106-sindelfingen-wood',
    cases: [],
    centre: [-721, 491],
    zoom: 6,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'V106-munich-streets-3d',
    cases: [],
    centre: [-300, 290],
    zoom: 3,
    view: '3d' as const,
    pitch: 55,
    bearing: 30,
  },
  {
    id: 'V106-munich-park-3d',
    cases: [],
    centre: [-430, 390],
    zoom: 4,
    view: '3d' as const,
    pitch: 55,
    bearing: 30,
  },
  {
    id: 'V106-sindelfingen-wood-3d',
    cases: [],
    centre: [-721, 491],
    zoom: 6,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
    view: '3d' as const,
    pitch: 55,
    bearing: 30,
  },
  {
    id: 'R6-n138-3d',
    cases: [],
    centre: [-16.5, -535.5],
    zoom: 6,
    view: '3d' as const,
    pitch: 55,
    bearing: 30,
  },
  ...['on', 'off'].flatMap((state) => [
    {
      id: `V105-sindelfingen-overview-${state}`,
      cases: [],
      centre: [0, 0] as [number, number],
      zoom: 0.27,
      osm: 'fixtures/osm/sindelfingen-a81.osm',
      view: '3d' as const,
      terrain: state === 'on',
      pitch: 40,
    },
    {
      id: `V105-sindelfingen-a81-${state}`,
      cases: [],
      centre: [66, 203] as [number, number],
      zoom: 2.5,
      osm: 'fixtures/osm/sindelfingen-a81.osm',
      view: '3d' as const,
      terrain: state === 'on',
      pitch: 35,
      bearing: 55,
    },
    {
      id: `V105-sindelfingen-bridge-${state}`,
      cases: [],
      centre: [66, 203] as [number, number],
      zoom: 6,
      osm: 'fixtures/osm/sindelfingen-a81.osm',
      view: '3d' as const,
      terrain: state === 'on',
      pitch: 30,
      bearing: -65,
    },
    {
      id: `V105-munich-overview-${state}`,
      cases: [],
      centre: [0, 0] as [number, number],
      zoom: 0.43,
      view: '3d' as const,
      terrain: state === 'on',
      pitch: 40,
    },
    {
      id: `V105-munich-detail-${state}`,
      cases: [],
      centre: [5, -285] as [number, number],
      zoom: 1.5,
      view: '3d' as const,
      terrain: state === 'on',
      pitch: 40,
    },
    {
      id: `V105-sindelfingen-hillshade-${state}`,
      cases: [],
      centre: [0, 0] as [number, number],
      zoom: 0.27,
      osm: 'fixtures/osm/sindelfingen-a81.osm',
      terrain: state === 'on',
    },
    {
      id: `V105-munich-hillshade-${state}`,
      cases: [],
      centre: [0, 0] as [number, number],
      zoom: 0.43,
      terrain: state === 'on',
    },
  ]),
  { id: 'V96-munich-overview', cases: [], centre: [0, 0], zoom: 0.43 },
  { id: 'V96-hbf-tracks', cases: [], centre: [250, -140], zoom: 1.8 },
  {
    id: 'V96-sindelfingen',
    cases: [],
    centre: [0, 0],
    zoom: 0.27,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  { id: 'overview', cases: [], centre: [0, 0], zoom: 0.5 },
  // TASK-097: grade separation, including both abutments of the A81 crossing.
  { id: 'V97-n967', cases: [], centre: [-28, 172], zoom: 10 },
  { id: 'V97-donnersberger', cases: [], centre: [5, -285], zoom: 1 },
  { id: 'V97-deck-south-end', cases: [], centre: [-43, 280], zoom: 10 },
  { id: 'V97-deck-north-end', cases: [], centre: [105, -608], zoom: 10 },
  {
    id: 'V97-sindelfingen-a81',
    cases: [],
    centre: [66, 203],
    zoom: 4.5,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'V97-sindelfingen-north-end',
    cases: [],
    centre: [26, 142],
    zoom: 14,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'V97-sindelfingen-south-end',
    cases: [],
    centre: [107, 264],
    zoom: 14,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  { id: 'G1', cases: ['G1'], centre: [-613, 18], zoom: 5 },
  { id: 'G1-n919', cases: ['G1'], centre: [-520, 28.5], zoom: 14 },
  { id: 'G2', cases: ['G2'], centre: [173, 182], zoom: 6 },
  { id: 'G2-n774', cases: ['G2'], centre: [112, 179], zoom: 14 },
  { id: 'G2-n719', cases: ['G2'], centre: [234, 187], zoom: 14 },
  { id: 'B38-r1025', cases: ['B38-munich'], centre: [-23, -166], zoom: 14 },
  { id: 'B38-r839', cases: ['B38-munich'], centre: [312, 100], zoom: 8 },
  { id: 'B38-r866', cases: ['B38-munich'], centre: [-67, -351], zoom: 12 },
  { id: 'B39-n312-n305', cases: ['B39', 'R3-4', 'R3-5'], centre: [-34, -66], zoom: 10 },
  { id: 'B39-n201', cases: ['B39'], centre: [-21, 260], zoom: 10 },
  { id: 'B39-n194', cases: ['B39'], centre: [-33.5, 438.5], zoom: 10 },
  { id: 'Mars', cases: ['Mars', 'R3-7', 'R3-8'], centre: [488, -427], zoom: 10 },
  { id: 'R3-1-n1181', cases: ['R3-1'], centre: [-511, 124], zoom: 10 },
  { id: 'R3-3-n711', cases: ['R3-3'], centre: [564, -369], zoom: 12 },
  { id: 'R3-4-n308', cases: ['R3-4'], centre: [-12.5, -184.5], zoom: 8 },
  { id: 'R3-4-n726', cases: ['R3-4'], centre: [-482, 114.5], zoom: 10 },
  { id: 'R3-6-n138', cases: ['R3-6'], centre: [-21, -536], zoom: 10 },
  // TASK-087 (B41): carriageways of one street converging on a node.
  { id: 'B41-n104', cases: [], centre: [-278.5, 142], zoom: 10 },
  { id: 'B41-n324', cases: [], centre: [556, 218], zoom: 6 },
  { id: 'B41-n721', cases: [], centre: [305.5, 194], zoom: 10 },
  { id: 'B41-n446', cases: [], centre: [-462, -643.5], zoom: 10 },
  { id: 'B41-n949', cases: ['R3-7'], centre: [478, -405.5], zoom: 10 },
  // TASK-089: the other converging nodes, n:1181's crossings close up, two ordinary four-ways.
  { id: 'B41-n823', cases: ['R3-8'], centre: [497.5, -449], zoom: 12 },
  { id: 'B41-n382', cases: [], centre: [-540, -697.5], zoom: 10 },
  { id: 'B41-n1181', cases: ['R3-1'], centre: [-505, 128], zoom: 18 },
  { id: 'B41-n967', cases: [], centre: [-19.5, 172], zoom: 8 },
  { id: 'B41-n638', cases: [], centre: [75, -535], zoom: 6 },
  { id: 'B41-n33', cases: [], centre: [663, -605], zoom: 8 },
  { id: 'B41-n1375', cases: [], centre: [-706.5, 97.5], zoom: 8 },
  { id: 'B41-n1303', cases: [], centre: [266, -486.5], zoom: 8 },
  { id: 'B41-n328', cases: [], centre: [502, 213.5], zoom: 8 },
  // TASK-093: n:967's east carriageways (B49), Landsberger's median n:721 to n:328 (B45),
  // Westendstraße's one-way lane continuing into a two-way street at n:212 and n:55 (B47).
  { id: 'T93-n967', cases: [], centre: [10, 170], zoom: 12 },
  { id: 'T93-n721-n328', cases: [], centre: [404, 204], zoom: 5.5 },
  { id: 'T93-n721', cases: [], centre: [340, 198], zoom: 12 },
  { id: 'T93-n328', cases: [], centre: [470, 210], zoom: 12 },
  { id: 'T93-n212', cases: [], centre: [415, 370], zoom: 16 },
  { id: 'T93-n55', cases: [], centre: [285, 378], zoom: 16 },
  { id: 'X-n79', cases: [], centre: [405, 534], zoom: 12 },
  { id: 'X-n189', cases: [], centre: [200.5, 373], zoom: 12 },
  // TASK-091 (B46, B50, B52): crossings set back from the curb, centre lines ending at the mouth.
  { id: 'B52-n291', cases: [], centre: [-524.5, 466.5], zoom: 14 },
  { id: 'B46-n182', cases: [], centre: [424.5, 371], zoom: 12 },
  // TASK-092 (B48, B51, B52): the owner's sharp corners and the n:104 median nose, close up.
  { id: 'B48-n262', cases: [], centre: [-68.5, 137.5], zoom: 14 },
  { id: 'B48-n967', cases: [], centre: [-19.5, 172], zoom: 14 },
  { id: 'B48-n291', cases: [], centre: [-524.5, 466.5], zoom: 18 },
  { id: 'B51-n104', cases: [], centre: [-283, 141], zoom: 18 },
  // TASK-094 (B53): a signalized node's crossings set back, its stop lines behind them.
  {
    id: 'B53-sindelfingen-n110',
    cases: [],
    centre: [310, 604.5],
    zoom: 16,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  // Owner round 6: carriageways and roads approaching a node at a small angle or parallel.
  { id: 'R6-n138', cases: [], centre: [-16.5, -535.5], zoom: 6 },
  { id: 'R6-n638', cases: [], centre: [90.5, -526], zoom: 6 },
  {
    id: 'R6-sindelfingen-n841',
    cases: [],
    centre: [310.5, -584.5],
    zoom: 10,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  {
    id: 'R6-sindelfingen-n68',
    cases: [],
    centre: [350, -488],
    zoom: 10,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
  // TASK-131 Phase 0: the import against the raw OSM ways, one scale (5 px/m), centred on the
  // reference nodes as main placed them (n:967 is n:247 since TASK-101) and the five clusters
  // whose arms turn most (bench/task131-audit.ts).
  ...T131_CASES.map(([id, node, centre, label, osm]) => ({
    id: `T131-${id}`,
    cases: [],
    centre,
    zoom: 5,
    node,
    osmLines: `${osm ? 'Sindelfingen' : 'Munich'} ${node}, ${label}`,
    ...(osm && { osm }),
  })),
  // TASK-131 Phase 1: the same framing with the junction groups drawn on top; the members keep
  // their OSM positions, so the camera no longer sits on a merged node.
  ...T131_CASES.map(([id, node, centre, label, osm]) => ({
    id: `T131-p1-${id}`,
    cases: [],
    centre,
    zoom: 5,
    osmLines: `${osm ? 'Sindelfingen' : 'Munich'} ${node} (main's), ${label}`,
    groups: true,
    ...(osm && { osm }),
  })),
  // The signalised group at n:247 closer: the signal heads and stop lines drawn now.
  { id: 'T131-p1-n247-signals', cases: [], centre: [-19.28, 166.81], zoom: 10 },
  // TASK-131 Phase 2 (owner, checkpoint 1): n:638's eastbound lane gain and ramp branch, and the
  // n:138 group's curbs, at 10 px/m.
  {
    id: 'T131-p2-n638-east',
    cases: [],
    centre: [125, -520],
    zoom: 10,
    osmLines: 'Munich, Arnulfstraße east of n:638 (main), lane gain and ramp',
    groups: true,
  },
  ...(
    [
      ['n247', [-19.28, 166.81]],
      ['n638', [90.29, -526.03]],
      ['n138', [-18.85, -540.61]],
    ] as [string, [number, number]][]
  ).map(([id, centre]) => ({
    id: `T131-p2-3d-${id}`,
    cases: [],
    centre,
    zoom: 5,
    view: '3d' as const,
    pitch: 50,
    bearing: 0,
    buildings: false,
  })),
  // Checkpoint 2 (lead): one surface per group, curbs only on its outside, rounded median noses;
  // at 10 px/m without the group overlay so the curbs show, and n:138 in 3D at the same scale.
  ...(
    [
      ['n247', [-19.28, 166.81], 'Landsberger Strasse x Donnersberger Bruecke'],
      ['n638', [90.29, -526.03], 'Arnulfstrasse x Landshuter Allee'],
      ['n138', [-18.85, -540.61], 'Arnulfstrasse x Donnersbergerstrasse'],
    ] as [string, [number, number], string][]
  ).map(([id, centre, label]) => ({
    id: `T131-p2-curbs-${id}`,
    cases: [],
    centre,
    zoom: 10,
    osmLines: `Munich ${id.replace('n', 'n:')} (main), ${label}: one surface per group`,
  })),
  {
    id: 'T131-p2-3d-curbs-n138',
    cases: [],
    centre: [-18.85, -540.61] as [number, number],
    zoom: 10,
    view: '3d' as const,
    pitch: 50,
    bearing: 0,
    buildings: false,
  },
  // Checkpoint 2 (lead), B55 on the new geometry: n:68 (the service road around the fire station
  // beside the main road) and the two largest overlaps of a service road and a street.
  ...(
    [
      ['n68', [352, -494], 'n:68, the fire-station service road beside the main road'],
      ['r1029', [-74, 406], 'r:1029 x service r:1178 (largest overlap)'],
      ['r13', [-73, 226], 'service r:13 x r:439 at n:10 (second)'],
    ] as [string, [number, number], string][]
  ).map(([id, centre, label]) => ({
    id: `T131-p2-b55-${id}`,
    cases: [],
    centre,
    zoom: 10,
    osmLines: `Sindelfingen ${label}`,
    osm: SINDELFINGEN,
  })),
  // Checkpoint 2 (owner): lane lines on a group's inner roads, n:247 under the bridge.
  {
    id: 'T131-p2-lanes-n247',
    cases: [],
    centre: [-45.6, 163.8] as [number, number],
    zoom: 10,
    osmLines: 'Munich n:247 (main), the group under Donnersberger Bruecke: inner road lane lines',
  },
  // Checkpoint 2 (coordinator): the 30-degree limit, n:68 in 3D, and the doubtful new cases.
  {
    id: 'T131-p2-b55-3d-n68',
    cases: [],
    centre: [352, -494] as [number, number],
    zoom: 10,
    view: '3d' as const,
    pitch: 50,
    bearing: 0,
    buildings: false,
    osm: SINDELFINGEN,
  },
  {
    id: 'T131-p2-b55-r636',
    cases: [],
    centre: [456, -426] as [number, number],
    zoom: 10,
    osmLines: 'Munich r:636 Arnulfstrasse x r:933 Marsstrasse, 26 degrees',
  },
  {
    id: 'T131-p2-b55-r442',
    cases: [],
    centre: [185, 78] as [number, number],
    zoom: 10,
    osmLines: 'Sindelfingen service r:13 beside r:442, 94 m, no overlap',
    osm: SINDELFINGEN,
  },
  // Checkpoint 2 (lead): the A 81 carriageways r:464 and r:543 (different end nodes) pushed apart
  // only where their blocks overlap: the lane gain at n:542, the widest overlap, the bbox cut.
  ...(
    [
      ['east', [400, 300], 'n:542, where r:543 gains a lane into r:1254'],
      ['mid', [-15, 494], 'the widest overlap (1.15 m on the OSM lines)'],
      ['west', [-140, 615], 'the bbox cut ends n:463 and n:541'],
    ] as [string, [number, number], string][]
  ).map(([id, centre, label]) => ({
    id: `T131-p2-a81-${id}`,
    cases: [],
    centre,
    zoom: 5,
    osmLines: `Sindelfingen A 81 r:464 / r:543, ${label}`,
    osm: SINDELFINGEN,
  })),
  // TASK-131 fix round (lead), 10 px/m: Marsstrasse's lanes and arrows at n:366/n:417, the split
  // n:478, n:471's outline, the curbs at n:638's members.
  ...(
    [
      ['mars', [479, -406]],
      ['n478', [498, -451]],
      ['n471', [26, -237]],
      ['n638-members', [67, -531]],
    ] as [string, [number, number]][]
  ).map(([id, centre]) => ({ id: `T131-p2fix-${id}`, cases: [], centre, zoom: 10 })),
];

/** TASK-131: an extract's drivable OSM ways (the importer's filter) and the nodes where they
 * meet or end, in the city's frame. */
function osmWayLines(osm: string, geo: GeoReference) {
  const data = parseOsm(readFileSync(osm, 'utf8'));
  if (typeof data === 'string') throw new Error(data);
  const nodes = new Map(data.node.map((n) => [n.id, n]));
  const ways = data.way.filter((way) => drivableClass(way));
  const uses = new Map<number, number>();
  for (const { nd } of ways)
    nd.forEach((id, i) =>
      uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === nd.length - 1 ? 2 : 1)),
    );
  const at = (id: number): Vec2[] => {
    const node = nodes.get(id);
    return node ? [lonLatToLocal(geo, node)] : [];
  };
  return {
    lines: ways.map(({ nd }) => nd.flatMap(at)),
    junctions: [...uses].filter(([, count]) => count >= 2).flatMap(([id]) => at(id)),
  };
}

/** TASK-131 Phase 1: per junction group, its member positions, inner roads with their lengths
 * and midpoints, and its entry and exit road ends 4 m out from the member, in a colour each. */
function junctionGroupMarks(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error('Group overlay city must compile');
  const net = result.compiled;
  const colours = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#d55e00', '#56b4e9', '#7a5c00'];
  return (net.groups ?? []).map((group) => {
    const atM = (line: Vec2[], m: number) => {
      const lengths = cumulativeLengths(line);
      return pointAtDistance(line, lengths, Math.min(m, lengths.at(-1)!));
    };
    return {
      id: group.id,
      colour: colours[group.idx % colours.length]!,
      members: group.nodes.map((n) => net.nodes[n]!.pos),
      inner: group.innerRoads
        .map((r) => city.roads[net.roads[r]!.id]!.centerline)
        .map((line) => {
          const lengthM = polylineLength(line);
          return { line, lengthM, middle: atM(line, lengthM / 2) };
        }),
      ends: [
        ...group.entries.map((r) => ({
          pos: atM([...city.roads[net.roads[r]!.id]!.centerline].reverse(), 4),
          entry: true,
        })),
        ...group.exits.map((r) => ({
          pos: atM(city.roads[net.roads[r]!.id]!.centerline, 4),
          entry: false,
        })),
      ],
    };
  });
}

export const VIEWPORT = { width: 1280, height: 800 };

/** Node positions the cameras were placed by, per extract; a run on a tree that moves them says
 * so. */
const anchors: Record<string, Record<string, [number, number]>> = {
  'fixtures/osm/sindelfingen-a81.osm': { 'n:110': [309.96, 604.74] },
  [MUNICH]: {
    'n:919': [-519.99, 28.53],
    'n:774': [112.06, 176.53],
    'n:719': [233.66, 187.16],
    'n:312': [-42.26, -62.35],
    'n:949': [477.79, -405.43],
    'n:823': [497.5, -448.85],
    'n:1181': [-509.67, 128.4],
    'n:138': [-16.37, -535.48],
    'n:104': [-278.45, 141.89],
    'n:324': [610.01, 223.17],
    'n:721': [305.64, 194.23],
    'n:446': [-462.12, -643.47],
    'n:291': [-524.33, 466.57],
    'n:182': [424.39, 370.93],
  },
};

async function freePort(): Promise<number> {
  if (process.env.CITYFLOWS_TEST_PORT) return Number(process.env.CITYFLOWS_TEST_PORT);
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server at ${url} did not start within ${timeoutMs} ms`);
}

/** Places the camera exactly. The map applies a wheel event at once under reduced motion
 * (`map-view.tsx`): it zooms by exp(-0.0015 deltaY) about the pointer, and deltaY keeps its
 * fraction while the pointer is rounded to whole pixels. A zoom by f about p followed by one by
 * 1/f about q moves the view by (q - p)(1 - 1/f) at the same zoom, so: one wheel at the canvas
 * centre sets the zoom; f = 1/2 with q - p the needed shift rounded to whole pixels moves the
 * centre to within a pixel; then for each axis q - p = 100 px along it and f = 1/(1 - r/100)
 * removes the remainder r. Returns the remaining error of the centre, px. */
export async function placeCamera(page: Page, centre: [number, number], zoom: number) {
  return page.evaluate(
    ({ centre, zoom }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="City map"]')!;
      const rect = canvas.getBoundingClientRect();
      const toScreen = window.cityflows!.worldToScreen!;
      const middle = { x: Math.round(rect.width / 2), y: Math.round(rect.height / 2) };
      const wheel = (x: number, y: number, factor: number) =>
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(factor) / 0.0015,
            deltaMode: 0,
            clientX: rect.left + middle.x + x,
            clientY: rect.top + middle.y + y,
            bubbles: true,
            cancelable: true,
          }),
        );
      const move = (dx: number, dy: number, factor: number) => {
        wheel(0, 0, factor);
        wheel(dx, dy, 1 / factor);
      };
      const scale = () => toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x;
      const remainder = () => {
        const at = toScreen({ x: centre[0], y: centre[1] });
        return { x: middle.x - at.x, y: middle.y - at.y };
      };
      wheel(0, 0, zoom / scale());
      const coarse = remainder();
      // (q - p)(1 - 2) = shift: q - p = -shift.
      move(-Math.round(coarse.x), -Math.round(coarse.y), 1 / 2);
      for (let round = 0; round < 2; round++) {
        move(100, 0, 1 / (1 - remainder().x / 100));
        move(0, 100, 1 / (1 - remainder().y / 100));
      }
      const left = remainder();
      return {
        error: Math.hypot(left.x, left.y),
        zoom: scale(),
        size: [rect.width, rect.height],
      };
    },
    { centre, zoom },
  );
}

const frames = (page: Page, count: number) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, count);

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/geometry-shots.ts')) {
  const [out, flag, list, ...rest] = process.argv.slice(2);
  if (!out || (flag !== undefined && (flag !== '--only' || !list)) || rest.length)
    throw new Error('Usage: npm run geometry-shots -- <out-dir> [--only <id,id>]');
  const only = list?.split(',').flatMap((id) => {
    if (shots.some((shot) => shot.id === id)) return [id];
    const pair = shots.filter((shot) => shot.id === `${id}-on` || shot.id === `${id}-off`);
    return pair.length ? pair.map((shot) => shot.id) : [id];
  });
  const unknown = only?.filter((id) => !shots.some((shot) => shot.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown shots: ${unknown.join(', ')}`);
  const selected = only ? shots.filter((shot) => only.includes(shot.id)) : shots;
  if (only?.some((id) => id.startsWith('V105-')))
    selected.sort((a, b) =>
      a.id.replace(/-(on|off)$/, '').localeCompare(b.id.replace(/-(on|off)$/, '')),
    );
  // The fixture has no destination zone. Capture its inspector edit after the unchanged city;
  // walker shots run the simulation, so they come last too.
  selected.sort(
    (a, b) =>
      Number(a.id.startsWith('V107-munich-zone')) - Number(b.id.startsWith('V107-munich-zone')) ||
      Number(!!a.walkers) - Number(!!b.walkers),
  );
  mkdirSync(out, { recursive: true });
  const port = Number(process.env.CITYFLOWS_TEST_PORT) || (await freePort());
  const url = process.env.CITYFLOWS_SHOTS_URL ?? `http://127.0.0.1:${port}/`;
  const server = process.env.CITYFLOWS_SHOTS_URL
    ? undefined
    : spawn(
        process.execPath,
        [
          resolve('node_modules/vite/bin/vite.js'),
          '--mode',
          'test',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
  let log = '';
  server?.stdout?.on('data', (d) => (log += String(d)));
  server?.stderr?.on('data', (d) => (log += String(d)));
  const browser = await chromium.launch();
  const records: unknown[] = [];
  try {
    await waitForServer(url, 60_000);
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    for (const osm of new Set(selected.map((shot) => shot.osm ?? MUNICH))) {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
        console.error(error.message);
      });
      await page.route(/^https:\/\//, (route) => route.abort());
      page.setDefaultTimeout(420_000);
      const wantsTerrain = selected.some((shot) => (shot.osm ?? MUNICH) === osm && shot.terrain);
      if (wantsTerrain) await fixtureTerrain(page, osm);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 420_000 });
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      await button('Play').waitFor();
      await button('Import').click();
      const dialog = page.getByRole('dialog', { name: 'Import city' });
      await dialog.getByLabel('OSM file').setInputFiles(osm);
      const includeTerrain = dialog.getByLabel('Include terrain', { exact: true });
      if (await includeTerrain.count()) await includeTerrain.setChecked(wantsTerrain);
      await button('Import roads').click();
      await dialog
        .getByRole('region', { name: 'Import diagnostics' })
        .getByText('0 errors')
        .waitFor({ timeout: 420_000 });
      await button('Continue').click();
      const demandScale = selected.find(
        (shot) => (shot.osm ?? MUNICH) === osm && shot.demandScale !== undefined,
      )?.demandScale;
      if (demandScale !== undefined)
        await dialog.getByRole('slider', { name: 'Demand', exact: true }).fill(String(demandScale));
      await button('Accept city').click();
      await dialog.waitFor({ state: 'hidden', timeout: 420_000 });
      await page.waitForFunction(() => !!window.cityflows?.city?.());
      await button('Layers').click();
      const layers = page.getByRole('region', { name: 'Map layers' });
      const importedTheme = await layers.getByLabel('Marking style').inputValue();
      console.info(`${osm}: imported marking style ${importedTheme}`);
      for (const label of ['Basemap', 'Places', 'Entrances and exits'])
        await layers.getByLabel(label, { exact: true }).uncheck();
      if (process.env.CITYFLOWS_TREES === '0')
        for (const label of ['Trees', 'Street trees']) {
          const toggle = layers.getByLabel(label, { exact: true });
          if (await toggle.count()) await toggle.uncheck();
        }
      if (process.env.CITYFLOWS_SHADOWS === '0')
        await layers.getByLabel('Shadows', { exact: true }).uncheck();
      await button('Layers').click();
      // Only the map: every panel and control is hidden, the canvas keeps its place.
      await page.addStyleTag({
        content:
          'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"] { visibility: visible !important; }',
      });
      const anchored = anchors[osm] ?? {};
      const positions = await page.evaluate((ids) => {
        const city = window.cityflows!.city!();
        return Object.fromEntries(ids.map((id) => [id, city.nodes[id as never]?.pos ?? null]));
      }, Object.keys(anchored));
      const moved = Object.entries(anchored).filter(([id, [x, y]]) => {
        const p = positions[id];
        return !p || Math.hypot(p.x - x, p.y - y) > 0.05;
      });
      if (moved.length)
        console.warn('camera anchors moved on this tree:', moved.map(([id]) => id).join(', '));
      const three = process.env.CITYFLOWS_SHOTS_3D === '1';
      if (three) {
        await page.addStyleTag({ content: 'button { visibility: visible !important; }' });
        await button('3D').click();
        await page.addStyleTag({ content: 'button { visibility: hidden !important; }' });
        await page.waitForFunction(() => !!window.cityflows?.view3D?.());
        await page.addStyleTag({ content: 'canvas.map3d { visibility: visible !important; }' });
      }
      const canvas = page.getByLabel(three ? '3D city view' : 'City map', { exact: true });
      let localTraffic = false;
      let walking = false;
      for (const shot of selected) {
        if ((shot.osm ?? MUNICH) !== osm) continue;
        // Hidden controls remain operable for the fixed-camera harness.
        await page.addStyleTag({
          content:
            'body * { visibility: visible !important; } canvas.map[aria-hidden="true"] { visibility: hidden !important; }',
        });
        // V108's CITYFLOWS_SHOTS_3D renders every shot in 3D (pitch 60, bearing 0); cameras with
        // `view: '3d'` render in 3D at their own pitch and bearing.
        const in3d = three || shot.view === '3d';
        const mode = button('3D');
        if (shot.timeS !== undefined) {
          const time = await page.evaluate(() => window.cityflows!.metrics().then((m) => m.timeS));
          if (time > shot.timeS) await button('Restart').click();
          const current = await page.evaluate(() =>
            window.cityflows!.metrics().then((m) => m.timeS),
          );
          const steps = Math.round((shot.timeS - current) / 0.1);
          if (steps > 0) await page.evaluate((steps) => window.cityflows!.step(steps), steps);
          await page.waitForFunction(
            (time) => (window.cityflows?.drawnSnapshot?.()?.timeS ?? -1) >= time,
            shot.timeS,
            { timeout: 420_000 },
          );
        }
        let centre = shot.centre;
        if (shot.parkingTarget) {
          const source = await page.evaluate(() => window.cityflows!.city!());
          const result = compile(source);
          if (!result.ok) throw new Error('Parking camera city must compile');
          const net = result.compiled;
          const candidates =
            shot.parkingTarget === 'street'
              ? (net.strips ?? [])
                  .filter((strip) =>
                    source.parking?.[strip.id]?.provenance.inferred?.includes('strip'),
                  )
                  .map(
                    (strip) =>
                      net.parkingSpaces![strip.slots[Math.floor(strip.slots.length / 2)]!]!
                        .position,
                  )
              : net.parking
                  .filter(
                    (p) => p.kind === 'lot' && p.source.provenance.inferred?.includes('driveway'),
                  )
                  .map((p) => p.centroid);
          candidates.sort(
            (a, b) =>
              Math.hypot(a.x - centre[0], a.y - centre[1]) -
              Math.hypot(b.x - centre[0], b.y - centre[1]),
          );
          if (!candidates.length) throw new Error(`No ${shot.parkingTarget} camera target`);
          centre = [candidates[0]!.x, candidates[0]!.y];
        }
        if (shot.id.startsWith('V107-munich-zone') && !localTraffic) {
          if ((await mode.getAttribute('aria-pressed')) === 'true') await mode.click();
          const source = await page.evaluate(() => window.cityflows!.city!());
          const result = compile(source);
          if (!result.ok) throw new Error('Zone camera city must compile');
          const road = result.compiled.roads.find((road) => road.id === 'r:1229')!;
          const lane = result.compiled.lanes[road.lanes[0]!]!;
          const point = pointAtDistance(
            lane.polyline,
            lane.cumulative,
            Math.min(8, lane.lengthM / 2),
          );
          await placeCamera(page, [point.x, point.y], 20);
          await page.getByLabel('City map', { exact: true }).click({
            position: await page.evaluate(
              (point) => window.cityflows!.worldToScreen!(point),
              point,
            ),
          });
          await page.getByText('Lanes and street settings', { exact: true }).click();
          await page
            .getByRole('combobox', { name: 'Access', exact: true })
            .selectOption('destination');
          await page.waitForFunction(() =>
            Object.values(window.cityflows!.city!().roads).some(
              (road) => road.id === 'r:1229' && road.access?.all === 'destination',
            ),
          );
          await page.keyboard.press('Escape');
          localTraffic = true;
        }
        if (shot.walkers && !walking) {
          const extract = selected.filter((s) => (s.osm ?? MUNICH) === osm && s.walkers);
          const sources = [
            ...new Map(
              extract.flatMap((s) => s.walkers!).map((w) => [`${w.fromPlaceId}>${w.toPlaceId}`, w]),
            ).values(),
          ];
          const steps = Math.max(...extract.map((s) => s.steps ?? 0));
          await page.evaluate(
            async ({ sources, steps }) => {
              await window.cityflows!.setWalkers!(sources);
              await window.cityflows!.step(steps);
            },
            { sources, steps },
          );
          walking = true;
        }
        if (((await mode.getAttribute('aria-pressed')) === 'true') !== in3d) await mode.click();
        if (in3d)
          await page.waitForFunction(
            () =>
              document.querySelector('canvas[data-view="3d"]')?.getAttribute('data-build-ms') &&
              window.cityflows?.view3D?.(),
            undefined,
            { timeout: 60_000 },
          );
        await button('Layers').click();
        await layers
          .getByLabel('Marking style')
          .selectOption(shot.theme ?? ((shot.osm ?? MUNICH).includes('downtown') ? 'us' : 'de'));
        const terrainToggle = layers.getByLabel('Terrain', { exact: true });
        if (await terrainToggle.count()) await terrainToggle.setChecked(shot.terrain ?? false);
        if (in3d) {
          await page.getByLabel('Buildings', { exact: true }).setChecked(shot.buildings ?? true);
          const detailsToggle = layers.getByLabel('Building details', { exact: true });
          if (await detailsToggle.count()) await detailsToggle.setChecked(shot.details ?? true);
        }
        await button('Layers').click();
        const placed = in3d
          ? await page.evaluate(
              ({ centre, zoom, pitch, bearing }) => {
                window.cityflows!.setView3D!({ x: centre[0], y: centre[1] }, zoom, pitch, bearing);
                return { error: 0, zoom, size: [1280, 800] };
              },
              {
                centre,
                zoom: shot.zoom,
                pitch: shot.pitch ?? (shot.view ? undefined : 60),
                bearing: shot.bearing ?? (shot.view ? undefined : 0),
              },
            )
          : await placeCamera(page, centre, shot.zoom);
        await page.addStyleTag({
          content:
            'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"] { visibility: visible !important; }',
        });
        await frames(page, 30);
        if (errors.length) throw new Error(errors.join('\n'));
        const target = in3d ? page.getByLabel('3D city view', { exact: true }) : canvas;
        const sampleTiming = () =>
          page.evaluate(async () => {
            window.cityflowsRenderContinuously = true;
            const renders: number[] = [],
              times: number[] = [];
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                if (entry.name === 'cityflows:render' || entry.name === 'cityflows:render3d')
                  renders.push(entry.duration);
            });
            observer.observe({ entryTypes: ['measure'] });
            let last = performance.now();
            for (let i = 0; i < 90; i++) {
              const now = await new Promise<number>((r) => requestAnimationFrame(r));
              times.push(now - last);
              last = now;
            }
            observer.disconnect();
            window.cityflowsRenderContinuously = false;
            if (!renders.length) throw new Error('No drawn frames in timing sample');
            const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
            return { frameMs: mean(times), renderMs: mean(renders) };
          });
        const timing = await sampleTiming();
        let parkedOffTiming: typeof timing | undefined;
        if (shot.id.startsWith('V103-')) {
          const setParked = async (checked: boolean) => {
            await page.addStyleTag({ content: 'body * { visibility: visible !important; }' });
            await button('Layers').click();
            await layers.getByLabel('Parked cars', { exact: true }).setChecked(checked);
            await button('Layers').click();
            await page.addStyleTag({
              content:
                'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"], canvas.map3d { visibility: visible !important; }',
            });
            await frames(page, 30);
          };
          await setParked(false);
          parkedOffTiming = await sampleTiming();
          await setParked(true);
        }
        let nodeOffsetM: number | null = null;
        if (shot.osmLines) {
          const city = await page.evaluate(() => window.cityflows!.city!());
          const { lines, junctions } = osmWayLines(osm, city.geo!);
          if (shot.node) {
            const pos = city.nodes[shot.node as never]?.pos;
            nodeOffsetM = pos ? Math.hypot(pos.x - centre[0], pos.y - centre[1]) : null;
            if (nodeOffsetM === null || nodeOffsetM > 0.05)
              console.warn(
                `${shot.id}: ${shot.node} is not at the camera centre (${nodeOffsetM} m)`,
              );
          }
          const near = (p: Vec2) =>
            Math.abs(p.x - centre[0]) < 300 && Math.abs(p.y - centre[1]) < 200;
          const groups = shot.groups
            ? junctionGroupMarks(city).filter((g) => g.members.some(near))
            : [];
          await page.evaluate(
            ({ lines, junctions, label, zoom, groups }) => {
              const map = document.querySelector<HTMLCanvasElement>(
                'canvas[aria-label="City map"]',
              )!;
              const rect = map.getBoundingClientRect();
              const overlay = document.createElement('canvas');
              overlay.id = 'osm-overlay';
              overlay.width = rect.width;
              overlay.height = rect.height;
              Object.assign(overlay.style, {
                position: 'fixed',
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                pointerEvents: 'none',
                zIndex: '1000',
              });
              overlay.style.setProperty('visibility', 'visible', 'important');
              const ctx = overlay.getContext('2d')!;
              const at = window.cityflows!.worldToScreen!;
              ctx.strokeStyle = 'rgba(214, 0, 128, 0.85)';
              ctx.lineWidth = 1.5;
              for (const line of lines) {
                ctx.beginPath();
                line.forEach((p, i) => {
                  const q = at(p);
                  if (i) ctx.lineTo(q.x, q.y);
                  else ctx.moveTo(q.x, q.y);
                });
                ctx.stroke();
              }
              for (const p of junctions) {
                const q = at(p);
                ctx.beginPath();
                ctx.arc(q.x, q.y, 3.5, 0, 2 * Math.PI);
                ctx.stroke();
              }
              // TASK-131: inner roads (with lengths), entry ends (filled) and exit ends (hollow),
              // members (circles), one colour per group, labelled with the group id.
              ctx.font = '12px sans-serif';
              ctx.lineCap = 'round';
              for (const group of groups) {
                ctx.strokeStyle = group.colour;
                ctx.fillStyle = group.colour;
                for (const road of group.inner) {
                  ctx.globalAlpha = 0.45;
                  ctx.lineWidth = 7;
                  ctx.beginPath();
                  road.line.forEach((p, i) => {
                    const q = at(p);
                    if (i) ctx.lineTo(q.x, q.y);
                    else ctx.moveTo(q.x, q.y);
                  });
                  ctx.stroke();
                  ctx.globalAlpha = 1;
                  const m = at(road.middle);
                  ctx.fillText(`${road.lengthM.toFixed(1)} m`, m.x + 5, m.y - 5);
                }
                ctx.lineWidth = 2;
                for (const { pos, entry } of group.ends) {
                  const q = at(pos);
                  ctx.beginPath();
                  ctx.rect(q.x - 3, q.y - 3, 6, 6);
                  if (entry) ctx.fill();
                  else ctx.stroke();
                }
                for (const p of group.members) {
                  const q = at(p);
                  ctx.beginPath();
                  ctx.arc(q.x, q.y, 9, 0, 2 * Math.PI);
                  ctx.stroke();
                }
                const top = group.members.map((p) => at(p)).reduce((a, b) => (b.y < a.y ? b : a));
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(group.id, top.x + 11, top.y - 11);
                ctx.font = '12px sans-serif';
              }
              ctx.font = '14px sans-serif';
              const text = groups.length
                ? `${label}. Magenta: OSM ways. Colours: junction groups (members, inner roads, entries filled, exits hollow).`
                : `${label}. Magenta: OSM ways and their junction nodes.`;
              ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
              ctx.fillRect(8, 8, ctx.measureText(text).width + 12, 24);
              ctx.fillRect(8, rect.height - 36, 20 * zoom + 70, 28);
              ctx.fillStyle = '#222';
              ctx.fillText(text, 14, 25);
              ctx.fillRect(14, rect.height - 18, 20 * zoom, 3);
              ctx.fillText('20 m', 20 * zoom + 22, rect.height - 14);
              document.body.appendChild(overlay);
            },
            {
              lines: lines.filter((line) => line.some(near)),
              junctions: junctions.filter(near),
              label: shot.osmLines,
              zoom: shot.zoom,
              groups,
            },
          );
        }
        const path = join(out, `${shot.id}.png`);
        await target.screenshot({ path, animations: 'disabled' });
        await page.evaluate(() => document.getElementById('osm-overlay')?.remove());
        const walkerCount =
          shot.walkers || shot.id.startsWith('V112-')
            ? await page.evaluate(() => window.cityflows!.drawnSnapshot?.()?.walkers?.count ?? null)
            : undefined;
        const personMetrics = shot.id.startsWith('V112-')
          ? await page.evaluate(async () => {
              const { timeS, persons, walkers } = await window.cityflows!.metrics();
              return { timeS, persons, walkers };
            })
          : undefined;
        records.push({
          ...shot,
          ...(walkerCount !== undefined && { walkerCount }),
          ...(personMetrics && { personMetrics }),
          ...(localTraffic && { accessEdit: 'r:1229 destination, through street inspector' }),
          importedTheme,
          file: `${shot.id}.png`,
          view: in3d ? '3d' : '2d',
          timing,
          parkedOffTiming,
          parkedCars: await target.getAttribute('data-parked-cars'),
          actualCentre: centre,
          ...(nodeOffsetM !== null && { nodeOffsetM }),
          centreErrorPx: placed.error,
          zoom: placed.zoom,
          canvas: placed.size,
          ...timing,
          buildMs: await target.getAttribute('data-build-ms'),
          triangles: await target.getAttribute('data-triangles'),
          contextBuildMs: await target.getAttribute('data-context-build-ms'),
          buildingTriangles: await target.getAttribute('data-building-triangles'),
          roofStats: await target.getAttribute('data-roof-stats'),
          gpu: in3d
            ? await target.evaluate((canvas: HTMLCanvasElement) => {
                const gl = canvas.getContext('webgl2')!;
                const debug = gl.getExtension('WEBGL_debug_renderer_info');
                return gl.getParameter(
                  debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
                ) as string;
              })
            : null,
        });
        console.info(
          `${shot.id}: ${timing.frameMs.toFixed(2)} ms/frame, ${timing.renderMs.toFixed(2)} ms/render -> ${path}`,
        );
      }
      await page.close();
    }
    writeFileSync(join(out, 'shots.json'), JSON.stringify(records, null, 1));
    await context.close();
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    await browser.close();
    server?.kill();
  }
}
