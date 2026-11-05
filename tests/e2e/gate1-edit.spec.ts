import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { City, Scenario } from '../../src/schema';

const fixtureUrl = new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url);

async function pick(page: Page, x: number, y: number) {
  const map = page.getByLabel('City map');
  const bounds = (await map.boundingBox())!;
  const scale = (bounds.height - 144) / 510;
  await map.click({
    position: {
      x: bounds.width / 2 + (x - 240) * scale,
      y: bounds.height / 2 + (y - 240) * scale,
    },
  });
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const stale = (page: Page) => page.getByText('Restart to apply changes', { exact: true });
const metrics = (page: Page) => page.evaluate(() => window.cityflows!.metrics());

async function routes(page: Page, ids: number[]) {
  return page.evaluate(async (vehicleIds) => {
    const engine = window.cityflows!;
    const vehicles = await Promise.all(vehicleIds.map((id) => engine.inspect(id)));
    return vehicles.map((vehicle) =>
      vehicle?.route?.movements.map((index) => engine.movementId(index)),
    );
  }, ids);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('T17 applies an edit while playing and keeps its vehicles inspectable', async ({
  page,
}, testInfo) => {
  await pick(page, 60, 2);
  await expect(page.getByLabel('Speed limit (km/h)')).toBeHidden();
  await page.getByText('Lanes and street settings', { exact: true }).click();
  await expect(page.getByLabel('Speed limit (km/h)')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('street-inspector.png') });
  await pick(page, 120, 0);
  await page.getByText('Turns', { exact: true }).click();
  const turn = button(page, 'r:26 lane 1 → r:30 lane 1');
  await expect(turn).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).trips.driving).toBeGreaterThan(0);
  await expect(button(page, 'Pause')).toBeEnabled();
  await turn.click();
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await expect(stale(page)).toBeHidden();
  await expect(button(page, 'Pause')).toBeEnabled();
  await expect(button(page, 'Play')).toBeDisabled();
  const liveTime = (await metrics(page)).timeS;
  const vehicle = await page.evaluate(() => window.cityflows!.inspect(1));
  expect(vehicle?.state).toBe('driving');
  await page.screenshot({ path: testInfo.outputPath('live-edit-status.png') });
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(liveTime);
  expect((await page.evaluate(() => window.cityflows!.inspect(1)))?.id).toBe(vehicle?.id);
  await button(page, 'Restart').click();
  await expect(stale(page)).toBeHidden();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect.poll(async () => (await metrics(page)).trips.driving).toBe(0);
});

test('the first departing vehicle reroutes after banning a movement on its route', async ({
  page,
}) => {
  await button(page, 'Step').click();
  const [route] = await routes(page, [1]);
  expect(route).toContain('r:26#0>r:30#0');
  const banned = route![0]!;
  const advance = (steps: number) => page.evaluate((steps) => window.cityflows!.step(steps), steps);
  const baselineMetrics = await metrics(page);
  await pick(page, 120, 0);
  await page.getByText('Turns', { exact: true }).click();
  await button(page, 'r:26 lane 1 → r:30 lane 1').click();
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await expect(stale(page)).toBeHidden();
  expect((await metrics(page)).timeS).toBe(baselineMetrics.timeS);
  await advance(200);
  const inspected = await routes(page, [1]);
  expect(inspected[0]?.length).toBeGreaterThan(0);
  expect(inspected.flat()).not.toContain(banned);
  expect(['edit', 'missed_turn']).toContain(
    (await page.evaluate(() => window.cityflows!.inspect(1)))?.routeReason,
  );
});

test('a five-second phase changes the queue at the same simulation time', async ({ page }) => {
  const fixture: {
    city: City;
    scenarios: Scenario[];
    manifest: { name: string; files: Record<string, string> };
  } = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  // A departure burst through the center signal gives the phase a measurable queue.
  const origin = fixture.city.places['p:104']!.connectors.find(({ id }) => id === 'c:105')!;
  const destination = fixture.city.places['p:107']!.connectors.find(({ id }) => id === 'c:109')!;
  Object.assign(origin, { roadId: 'r:52', lane: 1 });
  Object.assign(destination, { roadId: 'r:65', lane: 1, throughputPerMin: 10 });
  // A small burst keeps the central signal, not the origin connector, as the bottleneck.
  fixture.city.places['p:104']!.population = 150;
  fixture.city.name = fixture.manifest.name = 'Signal queue';
  const scenario = fixture.scenarios[0]!;
  scenario.demand.workStart = { meanS: scenario.startS, sdS: 0 };
  for (const [name, data] of [
    ['city.json', fixture.city],
    ['scenarios.json', fixture.scenarios],
  ] as const) {
    fixture.manifest.files[name] = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }
  await page.getByLabel('Open project').setInputFiles({
    name: 'signal-queue.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('heading', { name: 'Signal queue' })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  await pick(page, 240, 240);
  await page.getByText('Signal phases', { exact: true }).click();
  const phase = page.getByLabel('Phase 1 green (s)');
  await expect(phase).toBeVisible();
  const step = () => page.evaluate(() => window.cityflows!.step(1500));
  await step();
  const baseline = await metrics(page);
  await phase.fill('5');
  await phase.press('Enter');
  await button(page, 'Apply signal program').click();
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await expect(stale(page)).toBeHidden();
  await button(page, 'Restart').click();
  await expect(stale(page)).toBeHidden();
  await step();
  const edited = await metrics(page);
  expect(edited.timeS).toBe(baseline.timeS);
  expect(edited.trips.queuedOrigin).not.toBe(baseline.trips.queuedOrigin);
});

test('a rejected signal edit preserves history and valid edits can be undone and redone', async ({
  page,
}, testInfo) => {
  await pick(page, 240, 240);
  await page.getByText('Signal phases', { exact: true }).click();
  const phase = page.getByLabel('Phase 1 green (s)');
  const undo = button(page, 'Undo');
  const redo = button(page, 'Redo');
  const conflict = page.getByLabel('Phase 1 movement r:64 → r:53', { exact: true });
  await expect(phase).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('signal-selected.png') });

  await page.getByText('Phase 1 road pairs', { exact: true }).click();
  await conflict.click();
  await expect(page.getByRole('alert')).toContainText('serves conflicting movements');
  await expect(conflict).toBeChecked();
  await expect(button(page, 'Apply signal program')).toBeDisabled();
  await conflict.click();
  await expect(undo).toBeDisabled();
  await expect(stale(page)).toBeHidden();
  await expect(phase).toHaveValue('25');

  await phase.fill('5');
  await phase.press('Enter');
  await button(page, 'Apply signal program').click();
  await expect(undo).toBeEnabled();
  await page.getByText('Phase 1 road pairs', { exact: true }).click();
  await conflict.click();
  await expect(page.getByRole('alert')).toContainText('serves conflicting movements');
  await expect(phase).toHaveValue('5');
  await undo.click();
  await expect(phase).toHaveValue('25');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(phase).toHaveValue('5');
});
