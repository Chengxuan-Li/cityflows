import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, city, importOsm, pageErrors } from './helpers';
import { railFrameTiming, railTimingEnvironment } from './rail-frame-timing';
import { compileRail } from '../../src/network/rail';
import { trainTimetable, trainsAt, trainCensus, trainPoint } from '../../src/network/trains';
import { nearestOnPolyline, polylineCrossings } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';

test.use({
  trace: {
    mode: 'retain-on-failure',
    screenshots: false,
    snapshots: { dom: true, aria: true, screen: false },
  },
});

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
// Lead (TASK-127 merge): CI skips the frame gate, and 150-frame samples on its software GPU would
// take minutes per sample (T62's checkpoint-2026-11-10 timeout), so CI takes short samples.
const sample = process.env.CI ? { frames: 12, warm: 2 } : { frames: 150, warm: 40 };
const frameTiming = (page: Page, measure: string) => railFrameTiming(page, measure, sample);

test('T64 Munich trains stop at both platforms, pass below bridge, select, pause and hide', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    rail = compileRail(source)!,
    table = trainTimetable(rail);
  expect(new Set(table.routes.flatMap((r) => r.stops.map((s) => s.platform))).size).toBe(2);
  expect(table.periodS).toBe(720);
  await writeFile(
    info.outputPath('train-census.json'),
    JSON.stringify(trainCensus(rail, table), null, 2),
  );
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    toggle = layers.getByLabel('Rail', { exact: true });
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    for (const route of table.routes.filter((r) => r.kind === 'sbahn')) {
      const now = await page.evaluate(async () => (await window.cityflows!.metrics()).timeS);
      const d = table.departures.find((d) => table.routes[d.route] === route)!;
      const base = d.timeS + route.stops[0]!.arrivalS + 10;
      const time = base + Math.ceil((now - base + 1) / table.periodS) * table.periodS;
      await seek(page, time);
      const pose = trainsAt(rail, table, Math.round(time * 10) / 10).find(
        (t) => table.routes[t.route] === route,
      )!;
      await centre(page, pose.centre, view);
      const screen = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), pose.cars[2]!);
      await canvas.click({ position: screen });
      await expect(page.getByRole('region', { name: 'Train inspector' })).toContainText('S-Bahn');
      await expect(page.getByRole('region', { name: 'Train inspector' })).toContainText('Stopped');
      await button(page, 'Close inspector').click();
      await canvas.screenshot({
        path: info.outputPath(`sbahn-${route.stops[0]!.platform.replace(':', '-')}-${view}.png`),
      });
    }
    const bridges = Object.values(source.roads).filter(
      (r) => r.name?.includes('Donnersberger') && (r.layer ?? 0) > 0,
    );
    const crossings = table.routes.flatMap((r, route) =>
      r.kind === 'mainline'
        ? r.sections.flatMap((s) =>
            bridges.flatMap((b) =>
              polylineCrossings(rail.tracks[s.track]!.line, b.centerline).map((c) => ({
                route,
                point: c.point,
              })),
            ),
          )
        : [],
    );
    expect(crossings.length).toBeGreaterThan(0);
    const cross = crossings[0]!,
      now = await page.evaluate(async () => (await window.cityflows!.metrics()).timeS);
    let shotTime = 0;
    for (let t = Math.ceil(now + 1); t < now + table.periodS + 300; t++)
      if (
        trainsAt(rail, table, t).some(
          (train) =>
            train.route === cross.route &&
            Math.hypot(train.centre.x - cross.point.x, train.centre.y - cross.point.y) < 18,
        )
      ) {
        shotTime = t;
        break;
      }
    expect(shotTime).toBeGreaterThan(now);
    await seek(page, shotTime);
    await centre(page, cross.point, view);
    await canvas.screenshot({ path: info.outputPath(`mainline-bridge-${view}.png`) });
    await page.waitForTimeout(500);
    const frozen = await canvas.getAttribute('data-frames');
    await page.waitForTimeout(400);
    expect(await canvas.getAttribute('data-frames')).toBe(frozen);
    const hash = await page.evaluate(() => window.cityflows!.hash());
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-trains', '0');
    await expect(canvas).toHaveAttribute('data-rail-tracks', '0');
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  }
  expect(errors).toEqual([]);
});

test('T64 Sindelfingen terminal train occupies level crossing in 2D and 3D', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/sindelfingen-a81.osm', { terrain: false });
  const source = await city(page),
    rail = compileRail(source)!,
    table = trainTimetable(rail);
  expect(table.routes.length).toBeGreaterThan(0);
  expect(table.routes.every((r) => r.terminal !== undefined)).toBe(true);
  await writeFile(
    info.outputPath('train-census.json'),
    JSON.stringify(trainCensus(rail, table), null, 2),
  );
  const clearance = (track: number, trackM: number) =>
    Math.max(
      ...table.routes.map((r) => {
        const section = r.sections.find((s) => s.track === track);
        if (!section) return -Infinity;
        const at =
          section.startM + (section.forward ? trackM : rail.tracks[track]!.lengthM - trackM);
        return Math.min(at, r.lengthM - at);
      }),
    );
  const crossing = rail.crossings
    .filter(
      (c) =>
        table.routes.some((r) => r.sections.some((s) => s.track === c.track)) &&
        rail.tracks[c.track]!.layer === 0,
    )
    .sort((a, b) => clearance(b.track, b.trackM) - clearance(a.track, a.trackM))[0]!;
  expect(crossing).toBeDefined();
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    const now = await page.evaluate(async () => (await window.cityflows!.metrics()).timeS);
    let target = 0;
    for (let t = Math.ceil(now + 1); t < now + table.periodS + 1; t++)
      if (
        trainsAt(rail, table, t).some((train) =>
          train.cars.some(
            (car) =>
              car.track === crossing.track &&
              Math.abs(
                nearestOnPolyline(rail.tracks[car.track]!.line, crossing.pos).along - car.trackM,
              ) < 10 &&
              Math.abs(
                train.positionM -
                  table.routes[train.route]!.sections.find((s) => s.track === crossing.track)!
                    .startM -
                  (table.routes[train.route]!.sections.find((s) => s.track === crossing.track)!
                    .forward
                    ? crossing.trackM
                    : rail.tracks[crossing.track]!.lengthM - crossing.trackM),
              ) < 20,
          ),
        )
      ) {
        target = t;
        break;
      }
    expect(target).toBeGreaterThan(now);
    await seek(page, target);
    await centre(page, crossing.pos, view);
    await page
      .getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true })
      .screenshot({ path: info.outputPath(`level-crossing-${view}.png`) });
  }

  expect(errors).toEqual([]);
});

test('T64 Munich moving-train frame budget in both views, two runs', async ({ page }, info) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const rail = compileRail(await city(page))!,
    table = trainTimetable(rail),
    route = table.routes.find((r) => r.kind === 'sbahn')!,
    focus = trainPoint(rail, route, route.stops[0]!.positionM);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    toggle = layers.getByLabel('Rail', { exact: true });
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('5');
  await writeFile(
    info.outputPath('train-environment.json'),
    JSON.stringify(await railTimingEnvironment(page), null, 2),
  );
  const reports = [];
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    // T62's 1.6 px/m rail-layer camera, with the simulation playing at x5.
    await centre(page, focus, view, 1.6);
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true }),
      runs = [];
    for (let run = 1; run <= 2; run++) {
      const before = await page.evaluate(async () => (await window.cityflows!.metrics()).timeS);
      await button(page, 'Play').click();
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-trains')))
        .toBeGreaterThan(0);
      const on = await frameTiming(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
      await button(page, 'Layers').click();
      await toggle.uncheck();
      await page.keyboard.press('Escape');
      await expect(canvas).toHaveAttribute('data-trains', '0');
      await expect(canvas).toHaveAttribute('data-rail-tracks', '0');
      const off = await frameTiming(
        page,
        view === '2d' ? 'cityflows:render' : 'cityflows:render3d',
      );
      await button(page, 'Pause').click();
      expect(
        await page.evaluate(async () => (await window.cityflows!.metrics()).timeS),
      ).toBeGreaterThan(before);
      runs.push({ run, on, off, ratio: on.frameMs / off.frameMs });
      await button(page, 'Layers').click();
      await toggle.check();
      await page.keyboard.press('Escape');
    }
    reports.push({ view, runs });
    await writeFile(info.outputPath('train-frames.json'), JSON.stringify(reports, null, 2));
  }
  if (!process.env.CI)
    for (const report of reports)
      for (const run of report.runs)
        expect(run.on.frameMs).toBeLessThanOrEqual(run.off.frameMs * 1.1);
  expect(errors).toEqual([]);
});
