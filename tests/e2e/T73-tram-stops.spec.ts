import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, clickWorld, importOsm, pageErrors } from './helpers';
import { compile } from '../../src/network';
import { placeTramStops, tramStopCounts } from '../../src/render/tram-stops';
import type { Vec2 } from '../../src/geo/vec2';

test.use({
  trace: {
    mode: 'retain-on-failure',
    screenshots: false,
    snapshots: { dom: true, aria: true, screen: false },
  },
});

/** Saves a shot with the test output and, when CITYFLOWS_SHOT_DIR is set, into that folder. */
async function shot(canvas: Locator, info: TestInfo, name: string) {
  await canvas.screenshot({ path: info.outputPath(name) });
  const dir = process.env.CITYFLOWS_SHOT_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await canvas.screenshot({ path: join(dir, name) });
  }
}

async function centre(
  page: Page,
  point: Vec2,
  view: '2d' | '3d',
  zoom: number,
  pitch = 40,
  bearing = 0,
) {
  if (view === '3d') {
    const canvas = page.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-view', '3d');
    const frames = Number(await canvas.getAttribute('data-frames'));
    await page.evaluate(
      ({ point, zoom, pitch, bearing }) =>
        window.cityflows!.setView3D!(point, zoom, pitch, bearing),
      { point, zoom, pitch, bearing },
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
      // Zoom out about the canvas centre first: all of Munich is on screen at 0.4 px/m.
      if (scale() > 0.4) wheel(0.4, r.width / 2, r.height / 2);
      const v = window.cityflows!.worldToScreen!(p);
      wheel(zoom, v.x, v.y);
    },
    { point, zoom },
  );
  // Drag the point to the middle of the canvas; inertia may carry it on, so drag again until it
  // stands within 3 px.
  const map = page.getByLabel('City map', { exact: true }),
    box = (await map.boundingBox())!;
  for (let attempt = 0; attempt < 5; attempt++) {
    const v = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
    if (Math.hypot(v.x - box.width / 2, v.y - box.height / 2) < 3) return;
    await page.mouse.move(box.x + v.x, box.y + v.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(500);
  }
  throw Error('the point did not reach the middle of the map');
}

const counts = async (canvas: Locator) =>
  JSON.parse((await canvas.getAttribute('data-tram-stops'))!) as Record<string, number>;

test('T73 tram stops in Munich: both views, the Rail layer carries them, shots', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    compiled = compile(source);
  if (!compiled.ok) throw Error('compile');
  const placements = placeTramStops(compiled.compiled, source);
  const expected = tramStopCounts(placements);
  expect(expected.stops).toBe(14);
  const stop = (id: string) => placements.find((p) => p.stop === id)!;
  // Trappentreustraße on Landsberger Straße beside the junction group of `n:246`, and
  // Donnersbergerstraße in Arnulfstraße's median beside the group of `n:640`.
  const sites = {
    trappentreustrasse: { at: { x: 17, y: 170 }, stops: ['ts:10812', 'ts:10815'] },
    'donnersbergerstrasse-east': { at: { x: 113, y: -520 }, stops: ['ts:10819'] },
    'donnersbergerstrasse-west': { at: { x: 18, y: -540 }, stops: ['ts:10825'] },
  };
  for (const { stops } of Object.values(sites))
    for (const id of stops) expect(stop(id)).toBeTruthy();
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    toggle = layers.getByLabel('Rail', { exact: true });
  await layers.getByLabel('Entrances and exits', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-tram-stops', /"stops":14/);
    expect(await counts(canvas)).toEqual(expected);
    for (const [name, { at, stops }] of Object.entries(sites)) {
      await centre(page, at, view, view === '2d' ? 16 : 40, 45, 0);
      await shot(canvas, info, `T73-${name}-${view}.png`);
      // The close shots stand at the first canopy of the site.
      const shelter = stop(stops.find((id) => stop(id).shelters.length)!).shelters[0]!;
      if (view === '2d') {
        // Name and lines at high zoom, at most 12 labels.
        await centre(page, shelter, view, 28);
        expect(Number(await canvas.getAttribute('data-tram-stop-labels'))).toBeGreaterThan(0);
        expect(Number(await canvas.getAttribute('data-tram-stop-labels'))).toBeLessThanOrEqual(12);
        await shot(canvas, info, `T73-${name}-close-2d.png`);
      } else {
        await centre(page, shelter, view, 70, 16, 20);
        await shot(canvas, info, `T73-${name}-close-3d.png`);
      }
    }
    if (view === '2d') {
      // A mapped island is its platform: the inspector names the stop, its lines and amenities.
      const strip = stop('ts:10812').tactile!,
        kerb = strip[Math.floor(strip.length / 2)]!;
      await centre(page, kerb, view, 16);
      await clickWorld(page, kerb);
      await expect(page.getByRole('region', { name: 'Platform inspector' })).toContainText(
        'Tram stop · lines 18, 19, N19 · shelter, bench',
      );
      await page.keyboard.press('Escape');
    }
    // The Rail layer carries the stops.
    const hash = await page.evaluate(() => window.cityflows!.hash());
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    expect((await counts(canvas)).stops).toBe(0);
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
    expect(await counts(canvas)).toEqual(expected);
    // Tram stops are visual only: the run's state hash does not move.
    expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  }
  expect(await city(page)).toEqual(source);
  expect(errors).toEqual([]);
});
