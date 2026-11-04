import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compile, signalStateAt } from '../../src/network';
import { generateSignalProgram } from '../../src/importers/signal-program';
import { unzipSync, strFromU8 } from 'fflate';
import type { City, Scenario } from '../../src/schema';

const fixtureUrl = new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const apply = (page: Page) => button(page, 'Apply signal program');
const metrics = (page: Page) => page.evaluate(() => window.cityflows!.metrics());
const step = (page: Page, n: number) => page.evaluate((n) => window.cityflows!.step(n), n);
const preview = (page: Page) =>
  page
    .getByLabel('City map')
    .getAttribute('data-signal-preview')
    .then(
      (s) =>
        JSON.parse(s ?? 'null') as {
          nodeId: string;
          timeS: number;
          phase: number;
          state: string;
          movements: string[];
        } | null,
    );

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
    city: City;
    scenarios: Scenario[];
    manifest: { files: Record<string, string> };
  };
}
async function selectSignal(page: Page) {
  const map = page.getByLabel('City map');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('Signal phases', { exact: true }).click();
  await expect(page.getByLabel('Phase 1 green (s)')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('T13 drafts conflict-free programs with timeline, schematic and shared defaults', async ({
  page,
}, info) => {
  await selectSignal(page);
  await page.screenshot({ path: info.outputPath('signal-timeline.png') });
  const conflicting = page.getByRole('checkbox', {
    name: 'Phase 1 arrow r:64 → r:53',
    exact: true,
  });
  const arrowPoint = await conflicting
    .locator('path')
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength() * 0.35);
      return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!).toJSON();
    });
  await page.mouse.click(arrowPoint.x, arrowPoint.y);
  await expect(page.getByRole('alert')).toContainText('serves conflicting movements');
  await expect(apply(page)).toBeDisabled();
  await expect(button(page, 'Undo')).toBeDisabled();
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('signal-conflict.png') });
  await conflicting.press('Space');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(apply(page)).toBeEnabled();

  const duration = page.getByRole('slider', { name: 'Phase 1 duration', exact: true });
  const bounds = (await duration.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect(page.getByLabel('Phase 1 green (s)')).not.toHaveValue('25');
  await button(page, 'Add phase').click();
  await expect(page.getByLabel('Phase 5 green (s)')).toHaveValue('15');
  await button(page, 'Remove phase').click();
  await expect(page.getByLabel('Phase 5 green (s)')).toBeHidden();
  await button(page, 'Select phase 1').click();
  const served = page.getByRole('checkbox', { name: 'Phase 1 arrow r:52 → r:65', exact: true });
  await served.press('Space');
  await page.getByText(/^Unserved movements/).click();
  await expect(page.getByText(/never serves movement r:52#1>r:65#1/)).toBeVisible();
  await expect(apply(page)).toBeEnabled();
  await served.press('Space');
  await page.getByLabel('Amber (s)').fill('4');
  await page.getByLabel('Amber (s)').press('Enter');
  await page.getByLabel('All red (s)').fill('2');
  await page.getByLabel('All red (s)').press('Enter');
  await page.getByLabel('Offset (s)').fill('7');
  await page.getByLabel('Offset (s)').press('Enter');
  await apply(page).click();
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Offset (s)')).toHaveValue('7');
  await expect(page.getByLabel('Amber (s)')).toHaveValue('4');
  await expect(page.getByLabel('All red (s)')).toHaveValue('2');

  await button(page, 'Generate default program').click();
  await expect(page.getByRole('alert')).toBeHidden();
  await apply(page).click();
  const downloadPromise = page.waitForEvent('download');
  await button(page, 'Save').click();
  const download = await downloadPromise;
  const archive = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const savedCity = JSON.parse(strFromU8(archive['city.json']!)) as City;
  const original = (await fixture()).city;
  const compiled = compile(original);
  if (!compiled.ok) throw new Error('Fixture must compile');
  expect(savedCity.nodes['n:13']!.signal).toEqual(
    generateSignalProgram(original, original.nodes['n:13']!, 4, compiled.compiled, []),
  );
});

test('preview follows the loaded engine phase through green, amber and all-red', async ({
  page,
}, info) => {
  const city = (await fixture()).city;
  const result = compile(city);
  if (!result.ok) throw new Error('Fixture must compile');
  const compiled = result.compiled;
  const signal = compiled.nodes[compiled.index.node.get('n:13')!]!.signal!;
  await selectSignal(page);
  const map = page.getByLabel('City map');
  await map.hover();
  await page.mouse.wheel(0, -850);
  await button(page, 'Play').click();
  await expect.poll(async () => (await preview(page))?.timeS ?? 0).toBeGreaterThan(25200);
  await expect.poll(async () => (await preview(page))?.state).toBe('green');
  await page.screenshot({ path: info.outputPath('signal-preview-playing.png') });
  await button(page, 'Pause').click();

  async function matches() {
    const { timeS } = await metrics(page);
    const expected = signalStateAt(signal, timeS);
    await expect
      .poll(() => preview(page))
      .toEqual({
        nodeId: 'n:13',
        timeS,
        ...expected,
        movements:
          expected.state === 'green'
            ? signal.phases[expected.phase]!.movements.map((i) => compiled.movements[i]!.id)
            : [],
      });
    return timeS;
  }
  let time = await matches();
  // Visit green, amber, all-red and the next phase in one cycle using exact fixed steps.
  const nextCycle = Math.ceil(time / signal.cycleS) * signal.cycleS;
  for (const delta of [
    1,
    signal.phases[0]!.durationS + 1,
    signal.phases[0]!.durationS + signal.amberS + 0.5,
    signal.phases[0]!.durationS + signal.amberS + signal.allRedS + 1,
  ]) {
    await step(page, Math.round((nextCycle + delta - time) / 0.1));
    time = await matches();
  }
  await page.getByLabel('Phase 1 green (s)').fill('5');
  await page.getByLabel('Phase 1 green (s)').press('Enter');
  await matches(); // Drafts do not change the loaded preview.
  await apply(page).click();
  await expect.poll(() => preview(page)).toBeNull();
  await button(page, 'Restart').click();
  signal.phases[0]!.durationS = 5;
  signal.cycleS -= 20;
  await matches();
});

test('shortening the main-street phase and restarting reduces the side-street queue', async ({
  page,
}, info) => {
  const project = await fixture();
  const { city } = project;
  city.name = 'Side-street queue';
  city.nodes['n:13']!.signal!.phases[0]!.durationS = 90;
  const homes = city.places['p:104']!;
  const work = city.places['p:107']!;
  homes.population = 80;
  Object.assign(homes.connectors[0]!, { roadId: 'r:64', lane: 1, throughputPerMin: 120 });
  Object.assign(work.connectors[1]!, {
    roadId: 'r:68',
    lane: 1,
    positionM: 90,
    throughputPerMin: 120,
  });
  const scenario = project.scenarios[0]!;
  scenario.startS = 0;
  scenario.demand.workStart = { meanS: 0, sdS: 0 };
  for (const [name, data] of [
    ['city.json', city],
    ['scenarios.json', project.scenarios],
  ] as const) {
    project.manifest.files[name] = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }
  await page.getByLabel('Open project').setInputFiles({
    name: 'side-street.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByRole('heading', { name: city.name })).toBeVisible();
  await selectSignal(page);
  const result = compile(city);
  if (!result.ok) throw new Error('Queue fixture must compile');
  const lanes = result.compiled.roads[result.compiled.index.road.get('r:64')!]!.lanes;
  async function queue() {
    return page.evaluate(async (lanes) => {
      const engine = window.cityflows!;
      const metrics = await engine.metrics();
      const vehicles = await Promise.all(
        Array.from({ length: 80 }, (_, i) => engine.inspect(i + 1)),
      );
      return {
        timeS: metrics.timeS,
        failed: metrics.trips.failed,
        queued:
          metrics.trips.queuedOrigin +
          vehicles.filter(
            (v) => v?.state === 'driving' && lanes.includes(v.lane) && v.speedMps < 0.1,
          ).length,
      };
    }, lanes);
  }
  await step(page, 650);
  const baseline = await queue();
  await page.getByLabel('Phase 1 green (s)').fill('5');
  await page.getByLabel('Phase 1 green (s)').press('Enter');
  await apply(page).click();
  await button(page, 'Restart').click();
  await step(page, 650);
  const edited = await queue();
  expect(edited.timeS).toBe(baseline.timeS);
  expect(baseline.failed).toBe(0);
  expect(edited.failed).toBe(0);
  expect(baseline.queued).toBeGreaterThan(0);
  expect(edited.queued).toBeLessThan(baseline.queued);
  await info.attach('side-street-queue.json', {
    body: JSON.stringify({ baseline, edited }),
    contentType: 'application/json',
  });
});
