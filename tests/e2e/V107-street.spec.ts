import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, city, clickWorld, importOsm, pageErrors } from './helpers';
import { placeCamera } from '../../bench/geometry-shots';
import { compile } from '../../src/network';
import { headingAtDistance, pointAtDistance } from '../../src/geo/polyline';

async function timing(page: Page) {
  return page.evaluate(async () => {
    const frames: number[] = [],
      renders: number[] = [];
    let capture = false,
      last = 0;
    const observer = new PerformanceObserver((entries) => {
      if (capture)
        for (const entry of entries.getEntries())
          if (entry.name === 'cityflows:render' || entry.name === 'cityflows:render3d')
            renders.push(entry.duration);
    });
    observer.observe({ entryTypes: ['measure'] });
    for (let i = 0; i < 24; i++) {
      const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      capture = i >= 5;
      if (capture) frames.push(now - last);
      last = now;
    }
    observer.disconnect();
    const mean = (samples: number[]) => samples.reduce((a, b) => a + b, 0) / samples.length;
    return { frameMs: mean(frames), renderMs: mean(renders), frames: frames.length };
  });
}

test('@smoke V107 street furniture shares counts, responds to edits and meets frame allowance', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const imported = await city(page),
    map = page.getByLabel('City map', { exact: true }),
    three = page.getByLabel('3D city view', { exact: true });
  const counts = await map.getAttribute('data-street-counts');
  const parsed = JSON.parse(counts!);
  expect(parsed.lamps.osm).toBe(113);
  expect(parsed.lamps.generated).toBeGreaterThan(0);
  // TASK-131's preserved geometry ends r:968#3 before the former BUS label at 62 m.
  expect(parsed.busLabels).toBe(6);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  for (const label of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await expect(layers.getByLabel('Street lights', { exact: true })).toBeChecked();
  await expect(layers.getByLabel('Signs', { exact: true })).toBeChecked();
  const report: unknown[] = [];
  for (const view of ['2d-overview', '2d-street', '3d-overview', '3d-street']) {
    const is3d = view.startsWith('3d');
    if (view === '3d-overview') await button(page, '3D').click();
    if (is3d) {
      await expect(three).toHaveAttribute('data-street-counts', counts!);
      await page.evaluate(
        (zoom) => window.cityflows!.setView3D!({ x: -300, y: 290 }, zoom, 55, 30),
        view.endsWith('overview') ? 0.43 : 3,
      );
      await expect(layers.getByLabel('Curbs', { exact: true })).toBeChecked();
    } else
      await placeCamera(
        page,
        view.endsWith('overview') ? [0, 0] : [-300, 290],
        view.endsWith('overview') ? 0.43 : 3,
      );
    const canvas = is3d ? three : map;
    const build = await canvas.getAttribute(is3d ? 'data-build-ms' : 'data-street-placement-ms');
    const states = process.env.CI ? [true, false] : [true, false, true, false];
    const samples: Awaited<ReturnType<typeof timing>>[] = [];
    for (const on of states) {
      for (const label of ['Street lights', 'Signs', ...(is3d ? ['Curbs'] : [])])
        await layers.getByLabel(label, { exact: true }).setChecked(on);
      await expect(canvas).toHaveAttribute(
        'data-street-lights',
        on ? String(parsed.lamps.osm + parsed.lamps.generated) : '0',
      );
      samples.push(await timing(page));
    }
    const mean = (on: boolean) => {
      const picked = samples.filter((_, i) => states[i] === on);
      return picked.reduce((s, v) => s + v.frameMs, 0) / picked.length;
    };
    const onMs = mean(true),
      offMs = mean(false);
    report.push({ view, counts: parsed, build, samples, onMs, offMs, ratio: onMs / offMs });
    await writeFile(info.outputPath('V107-timings.json'), JSON.stringify(report, null, 2));
    await expect(canvas).toHaveAttribute(
      is3d ? 'data-build-ms' : 'data-street-placement-ms',
      build!,
    );
    if (!process.env.CI && view !== '2d-street') expect(onMs).toBeLessThanOrEqual(offMs * 1.2);
    for (const label of ['Street lights', 'Signs', ...(is3d ? ['Curbs'] : [])])
      await layers.getByLabel(label, { exact: true }).check();
    await layers.getByLabel('Lane markings', { exact: true }).uncheck();
    await layers.getByLabel('Lane markings', { exact: true }).check();
  }
  expect(await city(page)).toEqual(imported);
  await button(page, 'Layers').click();
  await button(page, '3D').click();
  // An actual inspector edit must rebuild entry signs immediately, without restarting.
  const result = compile(imported);
  if (!result.ok) throw new Error('Munich must compile');
  const road = result.compiled.roads.find(
    (r) =>
      r.roadClass === 'residential' &&
      !imported.roads[r.id]!.access &&
      r.lengthM > 80 &&
      r.lengthM < 130,
  )!;
  const lane = result.compiled.lanes[road.lanes[0]!]!,
    point = pointAtDistance(lane.polyline, lane.cumulative, lane.lengthM / 2);
  await placeCamera(page, [point.x, point.y], 6);
  await clickWorld(page, point);
  await page.getByText('Lanes and street settings', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption('destination');
  await expect
    .poll(async () => JSON.parse((await map.getAttribute('data-street-counts'))!).signs.destination)
    .toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('V107-local-traffic-2d.png') });
  await button(page, '3D').click();
  await expect
    .poll(
      async () => JSON.parse((await three.getAttribute('data-street-counts'))!).signs.destination,
    )
    .toBeGreaterThan(0);
  await page.evaluate(
    ({ point, bearing }) => window.cityflows!.setView3D!(point, 60, 30, bearing),
    {
      point: lane.polyline[0]!,
      bearing: (-headingAtDistance(lane.polyline, lane.cumulative, 0) * 180) / Math.PI - 90,
    },
  );
  await page.screenshot({ path: info.outputPath('V107-local-traffic-3d.png') });
  expect(errors).toEqual([]);
});
