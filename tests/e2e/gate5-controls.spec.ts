import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { City, Scenario } from '../../src/schema';
import { compile } from '../../src/network';
import { button, city, clickGrid, gridPoint, metrics, pageErrors, fitted } from './helpers';

const step = (page: Page, n: number) => page.evaluate((n) => window.cityflows!.step(n), n);
async function openTraffic(page: Page, mode: 'stop' | 'red' | 'roundabout') {
  const project = JSON.parse(
    await readFile('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
  ) as {
    city: City;
    scenarios: Scenario[];
    manifest: { files: Record<string, string> };
  };
  const source = project.city;
  source.name = `Junction ${mode}`;
  const junction = source.nodes['n:13']!;
  if (mode !== 'red') {
    junction.control = 'uncontrolled';
    junction.signal = null;
    junction.minorRoads = ['r:64'];
  } else junction.signal!.phases[0]!.durationS = 120;
  const homes = source.places['p:104']!,
    work = source.places['p:107']!;
  homes.population = mode === 'roundabout' ? 20 : 40;
  Object.assign(homes.connectors[0]!, {
    roadId: 'r:64',
    lane: 1,
    positionM: 10,
    throughputPerMin: 120,
  });
  Object.assign(work.connectors[1]!, {
    roadId: mode === 'red' ? 'r:70' : 'r:68',
    lane: 1,
    positionM: 90,
    throughputPerMin: 120,
  });
  const scenario = project.scenarios[0]!;
  scenario.startS = 0;
  scenario.demand.workStart = { meanS: 0, sdS: 0 };
  for (const [name, data] of [
    ['city.json', source],
    ['scenarios.json', project.scenarios],
  ] as const)
    project.manifest.files[name] = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await page.getByLabel('Open project').setInputFiles({
    name: 'controls.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByRole('heading', { name: source.name })).toBeVisible();
  return source;
}
async function queue(page: Page, source: City) {
  const result = compile(source);
  if (!result.ok) throw new Error('Traffic fixture must compile');
  const lanes = result.compiled.roads[result.compiled.index.road.get('r:64')!]!.lanes;
  return page.evaluate(async (lanes) => {
    const api = window.cityflows!;
    const cars = await Promise.all(Array.from({ length: 40 }, (_, i) => api.inspect(i + 1)));
    const m = await api.metrics();
    return {
      timeS: m.timeS,
      failed: m.trips.failed,
      completed: m.trips.completed,
      queued:
        m.trips.queuedOrigin +
        cars.filter((c) => c?.state === 'driving' && lanes.includes(c.lane) && c.speedMps < 0.1)
          .length,
    };
  }, lanes);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('stop control and restart grow the side-street queue', async ({ page }, info) => {
  const errors = pageErrors(page);
  const source = await openTraffic(page, 'stop');
  await step(page, 1000);
  const baseline = await queue(page, source);
  await clickGrid(page, 240, 240);
  await page.getByRole('combobox', { name: 'Control', exact: true }).selectOption('stop');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  await button(page, 'Restart').click();
  await step(page, 1000);
  const stopped = await queue(page, source);
  expect(stopped.timeS).toBe(baseline.timeS);
  expect(stopped.queued).toBeGreaterThan(baseline.queued);
  expect(stopped.failed).toBe(0);
  await page.getByLabel('City map').hover();
  await page.mouse.wheel(0, -700);
  await expect(page.getByRole('combobox', { name: 'Control', exact: true })).toHaveValue('stop');
  await page.screenshot({ path: info.outputPath('stop-signs.png') });
  await info.attach('stop-queue.json', {
    body: JSON.stringify({ baseline, stopped }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('turn on red and restart shrink the right-turn queue', async ({ page }, info) => {
  const errors = pageErrors(page);
  const source = await openTraffic(page, 'red');
  await step(page, 650);
  const baseline = await queue(page, source);
  await clickGrid(page, 240, 240);
  await page.getByText('Signal phases', { exact: true }).click();
  await page.getByLabel('Right turn on red').check();
  await button(page, 'Apply signal program').click();
  await button(page, 'Restart').click();
  await step(page, 650);
  const permitted = await queue(page, source);
  expect(permitted.timeS).toBe(baseline.timeS);
  expect(permitted.queued).toBeLessThan(baseline.queued);
  expect(permitted.completed).toBeGreaterThan(baseline.completed);
  expect(permitted.failed).toBe(0);
  await info.attach('red-turn-queue.json', {
    body: JSON.stringify({ baseline, permitted }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('draw a roundabout, restart, inspect circulating routes and restore the junction', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  const original = await openTraffic(page, 'roundabout');
  const center = await gridPoint(page, 240, 240),
    edge = await gridPoint(page, 265, 240);
  await button(page, 'Roundabout').click();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y, { steps: 8 });
  await page.screenshot({ path: info.outputPath('roundabout-building.png') });
  await page.mouse.up();
  await expect
    .poll(async () => (await city(page)).nodes['n:13']!.roundabout?.ringRoads.length)
    .toBe(8);
  const built = await city(page);
  const ring = built.nodes['n:13']!.roundabout!.ringRoads;
  await button(page, 'Restart').click();
  await step(page, 3000);
  const routes = await page.evaluate(async (ring) => {
    const api = window.cityflows!;
    const cars = await Promise.all(Array.from({ length: 20 }, (_, i) => api.inspect(i + 1)));
    return cars.filter((c) =>
      c?.route?.movements.some((m) => ring.some((r) => api.movementId(m).includes(`${r}#`))),
    ).length;
  }, ring);
  expect(routes).toBe(20);
  const m = await metrics(page);
  expect(m.trips.completed).toBe(20);
  expect(m.trips.failed).toBe(0);
  expect(m.trips.driving + m.trips.queuedOrigin + m.trips.queuedDestination).toBe(0);
  await button(page, 'Select').click();
  await clickGrid(page, 245, 150);
  await page.getByText('Lanes and street settings', { exact: true }).click();
  const speed = page.getByLabel('Speed limit (km/h)');
  await speed.fill('18');
  await speed.blur();
  const editedRoad = () =>
    city(page).then((draft) => Object.values(draft.roads).find((road) => road.speedLimitMps === 5));
  await expect.poll(async () => (await editedRoad())?.id).toBeDefined();
  const approach = (await editedRoad())!;
  const originalApproach = Object.values(original.roads).find(
    (road) =>
      (road.from === approach.from && road.to === 'n:13') ||
      (road.to === approach.to && road.from === 'n:13'),
  )!;
  originalApproach.speedLimitMps = 5;
  await button(page, 'Roundabout').click();

  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -700);
  // The center stays at the zoom anchor, keeping the roundabout legible in the evidence.
  await page.screenshot({ path: info.outputPath('roundabout-yield-signs.png') });
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => !!(await city(page)).nodes['n:13']!.roundabout).toBe(false);
  const restored = await city(page);
  expect(restored.roads).toEqual(original.roads);
  expect(restored.nodes).toEqual(original.nodes);
  expect(errors).toEqual([]);
});

test('open a main-branch project with a v1 roundabout and remove it', async ({ page }) => {
  await page.getByLabel('Open project').setInputFiles('tests/editor/main-v1-roundabout.cityflows');
  await expect(page.getByRole('heading', { name: '5 × 5 grid' })).toBeVisible();
  await expect
    .poll(async () => (await city(page)).nodes['n:13']!.roundabout?.ringRoads.length)
    .toBe(8);
  expect((await city(page)).schemaVersion).toBe(2);
  await button(page, 'Roundabout').click();
  await clickGrid(page, 240, 240);
  await expect.poll(async () => (await city(page)).nodes['n:13']!.control).toBe('signal');
  expect((await city(page)).nodes['n:13']!.roundabout).toBeUndefined();
});

test('Import OSM file preserves Sindelfingen roundabouts and yield entries', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await button(page, 'Import').click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await dialog.getByLabel('OSM file').setInputFiles('fixtures/osm/sindelfingen-a81.osm');
  await dialog.getByRole('button', { name: 'Import roads' }).click();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    /\d+ roads.*0 errors.*\d+ warnings/,
  );
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Accept city' }).click();
  await expect(dialog).toBeHidden();
  const imported = await city(page);
  const entries = Object.values(imported.nodes).filter(
    (n) => n.control === 'yield' && n.minorRoads.length,
  );
  expect(entries.length).toBeGreaterThan(0);
  const result = compile(imported);
  if (!result.ok) throw new Error('Imported city must compile');
  const point = await fitted(result.compiled, imported)(page, entries[0]!.pos);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -1400);
  await page.screenshot({ path: info.outputPath('sindelfingen-roundabout.png') });
  expect(errors).toEqual([]);
});
