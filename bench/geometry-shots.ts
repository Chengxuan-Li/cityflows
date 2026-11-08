import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Page } from '@playwright/test';
import { fixtureTerrain } from '../tests/e2e/terrain-fixture';

// Fixed-camera images of the geometry rework's cases (TASK-081, docs/plan.md "Geometry rework"):
// starts the dev server on a free port, imports the Munich extract (or a shot's own, TASK-094)
// through the app's import dialog, hides the basemap, places and entrances, and captures each
// shot at the camera below, so images of two trees line up pixel for pixel. Usage:
// npm run geometry-shots -- <out-dir> [--only <id,id>] (TASK-090: only the named shots).

const MUNICH = 'fixtures/osm/munich-donnersberger.osm';

/** World centre (m, the city's frame) and zoom (screen px per m) of each image; the case ids are
 * bench/geometry-audit.ts's. The map canvas is 1280 x 800 px. */
export const shots: {
  id: string;
  cases: string[];
  centre: [number, number];
  zoom: number;
  osm?: string;
  view?: '3d';
  terrain?: boolean;
  pitch?: number;
  bearing?: number;
}[] = [
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
];

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
  mkdirSync(out, { recursive: true });
  const port = await freePort();
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
        .waitFor({ timeout: 60_000 });
      await button('Continue').click();
      await button('Accept city').click();
      await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
      await page.waitForFunction(() => !!window.cityflows?.city?.());
      await button('Layers').click();
      const layers = page.getByRole('region', { name: 'Map layers' });
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
      for (const shot of selected) {
        if ((shot.osm ?? MUNICH) !== osm) continue;
        // Hidden controls remain operable for the fixed-camera harness.
        await page.addStyleTag({ content: 'body * { visibility: visible !important; }' });
        // V108's CITYFLOWS_SHOTS_3D renders every shot in 3D (pitch 60, bearing 0); cameras with
        // `view: '3d'` render in 3D at their own pitch and bearing.
        const in3d = three || shot.view === '3d';
        const mode = button('3D');
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
        const terrainToggle = layers.getByLabel('Terrain', { exact: true });
        if (await terrainToggle.count()) await terrainToggle.setChecked(shot.terrain ?? false);
        await button('Layers').click();
        const placed = in3d
          ? await page.evaluate(
              ({ centre, zoom, pitch, bearing }) => {
                window.cityflows!.setView3D!({ x: centre[0], y: centre[1] }, zoom, pitch, bearing);
                return { error: 0, zoom, size: [1280, 800] };
              },
              {
                centre: shot.centre,
                zoom: shot.zoom,
                pitch: shot.pitch ?? (shot.view ? undefined : 60),
                bearing: shot.bearing ?? (shot.view ? undefined : 0),
              },
            )
          : await placeCamera(page, shot.centre, shot.zoom);
        await page.addStyleTag({
          content:
            'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"] { visibility: visible !important; }',
        });
        await frames(page, 30);
        if (errors.length) throw new Error(errors.join('\n'));
        const target = in3d ? page.getByLabel('3D city view', { exact: true }) : canvas;
        const timing = await page.evaluate(async () => {
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
          const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
          return { frameMs: mean(times), renderMs: mean(renders) };
        });
        const path = join(out, `${shot.id}.png`);
        await target.screenshot({ path, animations: 'disabled' });
        records.push({
          ...shot,
          file: `${shot.id}.png`,
          view: in3d ? '3d' : '2d',
          timing,
          centreErrorPx: placed.error,
          zoom: placed.zoom,
          canvas: placed.size,
          ...timing,
          buildMs: await target.getAttribute('data-build-ms'),
          triangles: await target.getAttribute('data-triangles'),
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
