import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, importOsm, pageErrors } from './helpers';
import { compile } from '../../src/network';
import { catenary } from '../../src/network/catenary';
import { cityGrades } from '../../src/render/grades';
import type { Vec2 } from '../../src/geo/vec2';

/** Saves a shot with the test output and, when CITYFLOWS_SHOT_DIR is set, into that folder. */
async function shot(canvas: Locator, info: TestInfo, name: string) {
  await canvas.screenshot({ path: info.outputPath(name) });
  const dir = process.env.CITYFLOWS_SHOT_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await canvas.screenshot({ path: join(dir, name) });
  }
}

/** Centres the view on `point`: the 3D camera directly, the 2D map by wheel zoom and a pan. */
async function centre(page: Page, point: Vec2, view: '2d' | '3d', zoom: number, pitch = 40) {
  if (view === '3d') {
    const canvas = page.getByLabel('3D city view', { exact: true });
    const frames = Number(await canvas.getAttribute('data-frames'));
    await page.evaluate(
      ({ point, zoom, pitch }) => window.cityflows!.setView3D!(point, zoom, pitch, 20),
      { point, zoom, pitch },
    );
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frames')))
      .toBeGreaterThan(frames);
    return;
  }
  await page.evaluate(
    ({ point: p, zoom }) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
        r = c.getBoundingClientRect();
      const scale = () =>
        window.cityflows!.worldToScreen!({ x: 1, y: 0 }).x -
        window.cityflows!.worldToScreen!({ x: 0, y: 0 }).x;
      const wheel = (to: number, x: number, y: number) =>
        c.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(to / scale()) / 0.0015,
            clientX: r.x + x,
            clientY: r.y + y,
            bubbles: true,
            cancelable: true,
          }),
        );
      // Zoom out about the centre first, so the target is on screen.
      if (scale() > 0.5) wheel(0.5, r.width / 2, r.height / 2);
      const v = window.cityflows!.worldToScreen!(p);
      wheel(zoom, v.x, v.y);
    },
    { point, zoom },
  );
  const map = page.getByLabel('City map', { exact: true }),
    box = (await map.boundingBox())!;
  const v = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
  await page.mouse.move(box.x + v.x, box.y + v.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
}

// Munich places (metres, x east, y south): the main-line field west of Donnersbergerbrücke, the
// single and double track leaving it to the north-west, the bridges over Landsberger Straße and
// the tram on Arnulfstraße at Donnersbergerstraße.
const places = [
  { name: 'track-field', point: { x: -170, y: -30 }, zoom2d: 3.2, zoom3d: 5, pitch: 50 },
  { name: 'cantilevers', point: { x: -350, y: -285 }, zoom2d: 7, zoom3d: 12, pitch: 45 },
  { name: 'bridge', point: { x: -560, y: 112 }, zoom2d: 6, zoom3d: 10, pitch: 45 },
  { name: 'arnulfstrasse-tram', point: { x: 20, y: -537 }, zoom2d: 8, zoom3d: 14, pitch: 45 },
];

test('T74 Munich overhead lines in 2D and 3D: counts, the layer toggle, shots', async ({
  page,
}, info) => {
  test.setTimeout(400_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const source = await city(page),
    compiled = compile(source);
  if (!compiled.ok) throw Error('compile');
  const { roadGrades, nodeGrades } = cityGrades(compiled.compiled);
  const lines = catenary(compiled.compiled, roadGrades, nodeGrades);
  const expected = JSON.stringify({
    supports: lines.supports.length,
    masts: lines.supports.reduce((n, s) => n + s.masts.length, 0),
    wires: lines.wires.filter((w) => !w.hidden).length,
  });
  expect(lines.supports.filter((s) => s.kind === 'portal').length).toBeGreaterThan(50);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    rail = layers.getByLabel('Rail', { exact: true }),
    overhead = layers.getByLabel('Overhead lines', { exact: true });
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await expect(overhead).toBeChecked();
  await button(page, 'Layers').click();
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-catenary', expected);
    // The sub-layer hides the overhead lines alone; Rail hides them with the tracks.
    await button(page, 'Layers').click();
    await overhead.uncheck();
    await expect(canvas).toHaveAttribute('data-catenary', '');
    await expect(canvas).not.toHaveAttribute('data-rail-tracks', '0');
    await overhead.check();
    await expect(canvas).toHaveAttribute('data-catenary', expected);
    await rail.uncheck();
    await expect(overhead).toBeDisabled();
    await expect(canvas).toHaveAttribute('data-catenary', '');
    await rail.check();
    await expect(canvas).toHaveAttribute('data-catenary', expected);
    await button(page, 'Layers').click();
    for (const p of places) {
      await centre(page, p.point, view, view === '2d' ? p.zoom2d : p.zoom3d, p.pitch);
      await shot(canvas, info, `${p.name}-${view}.png`);
    }
  }
  expect(errors).toEqual([]);
});
