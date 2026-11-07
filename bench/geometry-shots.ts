import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Page } from '@playwright/test';

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
}[] = [
  { id: 'overview', cases: [], centre: [0, 0], zoom: 0.5 },
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
  { id: 'X-n79', cases: [], centre: [405, 534], zoom: 12 },
  { id: 'X-n189', cases: [], centre: [200.5, 373], zoom: 12 },
  // TASK-091 (B46, B50, B52): crossings set back from the curb, centre lines ending at the mouth.
  { id: 'B52-n291', cases: [], centre: [-524.5, 466.5], zoom: 14 },
  { id: 'B46-n182', cases: [], centre: [424.5, 371], zoom: 12 },
  // TASK-094 (B53): a signalized node's crossings set back, its stop lines behind them.
  {
    id: 'B53-sindelfingen-n110',
    cases: [],
    centre: [310, 604.5],
    zoom: 16,
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
async function placeCamera(page: Page, centre: [number, number], zoom: number) {
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
  const only = list?.split(',');
  const unknown = only?.filter((id) => !shots.some((shot) => shot.id === id)) ?? [];
  if (unknown.length) throw new Error(`Unknown shots: ${unknown.join(', ')}`);
  const selected = only ? shots.filter((shot) => only.includes(shot.id)) : shots;
  mkdirSync(out, { recursive: true });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(
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
  server.stdout.on('data', (d) => (log += String(d)));
  server.stderr.on('data', (d) => (log += String(d)));
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
      await page.route(/^https:\/\//, (route) => route.abort());
      await page.goto(url);
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      await button('Play').waitFor();
      await button('Import').click();
      const dialog = page.getByRole('dialog', { name: 'Import city' });
      await dialog.getByLabel('OSM file').setInputFiles(osm);
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
      await button('Layers').click();
      // Only the map: every panel and control is hidden, the canvas keeps its place.
      await page.addStyleTag({
        content:
          'body * { visibility: hidden !important; } canvas.map { visibility: visible !important; }',
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
      const canvas = page.locator('canvas[aria-label="City map"]');
      for (const shot of selected) {
        if ((shot.osm ?? MUNICH) !== osm) continue;
        const placed = await placeCamera(page, shot.centre, shot.zoom);
        await frames(page, 3);
        const path = join(out, `${shot.id}.png`);
        await canvas.screenshot({ path, animations: 'disabled' });
        records.push({
          ...shot,
          file: `${shot.id}.png`,
          centreErrorPx: placed.error,
          zoom: placed.zoom,
          canvas: placed.size,
        });
        console.info(
          `${shot.id}: centre ${shot.centre.join(', ')} zoom ${shot.zoom} px/m (error ${placed.error.toExponential(1)} px) -> ${path}`,
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
    server.kill();
  }
}
