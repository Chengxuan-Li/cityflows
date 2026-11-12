import { expect, test, type Page } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, importOsm, pageErrors } from './helpers';
import { compileRail } from '../../src/network/rail';
import { railTimetable, tramCensus } from '../../src/network/trams';
import { trainsAt, trainPoint, type TrainPose } from '../../src/network/trains';
import type { Vec2 } from '../../src/geo/vec2';
async function centre(page: Page, point: Vec2, view: '2d' | '3d', zoom = 2.3) {
  if (view === '3d') {
    const canvas = page.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-view', '3d');
    const frames = Number(await canvas.getAttribute('data-frames'));
    await page.evaluate(({ point, zoom }) => window.cityflows!.setView3D!(point, zoom, 40, 0), {
      point,
      zoom,
    });
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frames')))
      .toBeGreaterThan(frames);
    return;
  }
  await page.evaluate(
    ({ point: p, zoom }) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
        r = c.getBoundingClientRect();
      const a = window.cityflows!.worldToScreen!({ x: 0, y: 0 }),
        b = window.cityflows!.worldToScreen!({ x: 1, y: 0 });
      const v = window.cityflows!.worldToScreen!(p);
      c.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -Math.log(zoom / (b.x - a.x)) / 0.0015,
          clientX: r.x + v.x,
          clientY: r.y + v.y,
          bubbles: true,
          cancelable: true,
        }),
      );
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
async function seek(page: Page, target: number) {
  await page.evaluate(async (target) => {
    const api = window.cityflows!,
      now = (await api.metrics()).timeS;
    await api.step(Math.max(1, Math.round((target - now) * 10)));
  }, target);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          window.cityflows!.drawnSnapshot!()?.timeS === (await window.cityflows!.metrics()).timeS,
      ),
    )
    .toBe(true);
}

test('T76 Munich synthetic tram stops and inspector agree in 2D and 3D, then depart', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    rail = compileRail(source)!,
    table = railTimetable(rail);
  const now = (await page.evaluate(() => window.cityflows!.metrics())).timeS;
  const candidates = table.departures
    .flatMap((d, index) =>
      table.routes[d.route]!.kind !== 'tram'
        ? []
        : table.routes[d.route]!.stops.filter((s) => s.name === 'Trappentreustra\u00dfe').map(
            (s) => {
              const first = d.timeS + s.arrivalS;
              const cycle = Math.ceil((now - first) / table.periodS);
              return { index, d, s, cycle, time: first + cycle * table.periodS + 5 };
            },
          ),
    )
    .sort((a, b) => a.time - b.time);
  const event = candidates[0]!,
    route = table.routes[event.d.route]!,
    focus = trainPoint(rail, route, event.s.positionM);
  await seek(page, event.time);
  const currentPose = async () => {
    const snapshot = await page.evaluate(async () => window.cityflows!.snapshot!());
    const controlled = (snapshot as typeof snapshot & { rail?: { trains: TrainPose[] } }).rail;
    return (controlled?.trains ?? trainsAt(rail, table, snapshot.timeS)).find(
      (p) =>
        p.route === event.d.route &&
        Math.abs(p.positionM - event.s.positionM) < 0.05 &&
        p.speedMps < 0.01,
    );
  };
  let pose = await currentPose();
  for (let i = 0; !pose && i < 120; i++) {
    await page.evaluate(() => window.cityflows!.step(50));
    pose = await currentPose();
  }
  expect(pose).toBeTruthy();
  const time = (await page.evaluate(() => window.cityflows!.metrics())).timeS;
  await writeFile(
    info.outputPath('T76-munich-tram-census.json'),
    JSON.stringify(tramCensus(rail), null, 2),
  );
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') {
      await button(page, '3D').click();
      await page.getByLabel('Buildings', { exact: true }).uncheck();
    }
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await centre(page, focus, view, view === '2d' ? 8 : 26);
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-trams')))
      .toBeGreaterThan(0);
    const screen = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), pose!.cars[1]!);
    await canvas.click({ position: screen });
    const inspector = page.getByRole('region', { name: 'Train inspector' });
    await expect(inspector).toContainText('Synthetic service');
    await expect(inspector).toContainText('Stopped');
    await expect(inspector).toContainText('city edge');
    const name = `T76-munich-trappentreustrasse-dwell-${view}.png`;
    await page.screenshot({ path: info.outputPath(name) });
    if (process.env.CITYFLOWS_SHOT_DIR) {
      await mkdir(process.env.CITYFLOWS_SHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.CITYFLOWS_SHOT_DIR, name) });
    }
    await button(page, 'Layers').click();
    const toggle = page
      .getByRole('region', { name: 'Map layers' })
      .getByLabel('Rail', { exact: true });
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-trams', '0');
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
    await canvas.click({ position: screen });
  }
  await seek(page, time + 10);
  await expect(page.getByRole('region', { name: 'Train inspector' })).toContainText('Stopped');
  await seek(page, time + 25);
  await expect(page.getByRole('region', { name: 'Train inspector' })).toContainText('Running');
  await page.screenshot({
    path: info.outputPath('T76-munich-trappentreustrasse-departure-3d.png'),
  });
  expect(errors).toEqual([]);
});
