import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pointAtDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { clickClearMapPoint, clickVehicle, departVehicle } from './helpers';

async function metrics(page: Page) {
  return page.evaluate(() => window.cityflows!.metrics());
}

let errors: string[];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '5 × 5 grid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
});

test.afterEach(() => expect(errors).toEqual([]));

test('the grid has no validation issues and lists its 15 lane drops under Notes @smoke', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Validation (0)', exact: true }).click();
  const validation = page.getByRole('region', { name: 'Validation', exact: true });
  await expect(validation).toContainText('No network issues found.');
  const notes = validation.getByRole('region', { name: 'Notes', exact: true });
  await expect(notes.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(notes.getByRole('listitem')).toHaveCount(15);
  await expect(notes.getByRole('listitem').first()).toContainText('must merge upstream');
});

test('runs, pauses, replays the same steps, and inspects the map @smoke', async ({
  page,
}, testInfo) => {
  const start = await metrics(page);
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('20');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // The first worker tick must finish without relying on slow map redraws during the click.
  await expect.poll(async () => (await metrics(page)).trips.driving).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await metrics(page);
  const hash = await page.evaluate(() => window.cityflows!.hash());
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  const restart = page.getByRole('button', { name: 'Restart', exact: true });

  await restart.click();
  await expect.poll(async () => (await metrics(page)).timeS).toBe(start.timeS);
  await page.evaluate(
    (steps) => window.cityflows!.step(steps),
    Math.round((paused.timeS - start.timeS) / 0.1),
  );
  await expect.poll(() => page.evaluate(() => window.cityflows!.hash())).toBe(hash);

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  // Validation is a sidebar section (TASK-160); its header opens and closes it.
  await page.getByRole('button', { name: /^Validation/ }).click();
  const validation = page.getByRole('region', { name: 'Validation', exact: true });
  await expect(validation.getByText(String(hash), { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('diagnostics-open.png') });
  await page.getByRole('button', { name: /^Validation/ }).click();

  // TASK-112: the first owner reaches their car before this repeatable vehicle click.
  await restart.click();
  await departVehicle(page, 1);
  expect((await metrics(page)).timeS).toBeGreaterThan(start.timeS);
  const map = page.getByLabel('City map');
  const bounds = (await map.boundingBox())!;
  // The demo is centered on (240, 240), with 510 m north to south including the two places.
  const scale = (bounds.height - 144) / 510;
  async function pick(x: number, y: number) {
    await map.click({
      position: {
        x: bounds.width / 2 + (x - 240) * scale,
        y: bounds.height / 2 + (y - 240) * scale,
      },
    });
  }
  await clickVehicle(page, 1);
  await expect(inspector.getByRole('heading', { name: 'Vehicle 1' })).toBeVisible();
  await expect(inspector.getByText(/^initial$/i)).toBeVisible();
  await expect(inspector.getByText(/\d+ roads/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('vehicle-selected.png') });
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();

  const network = compile(await page.evaluate(() => window.cityflows!.city!()));
  if (!network.ok) throw new Error('The displayed grid must compile');
  await clickClearMapPoint(
    page,
    network.compiled.lanes.map((lane) =>
      pointAtDistance(lane.polyline, lane.cumulative, lane.lengthM / 2),
    ),
  );
  await expect(inspector.getByRole('heading', { name: /^Street / })).toBeVisible();
  await pick(240, 240);
  await expect(inspector.getByRole('heading', { name: /^Signal / })).toBeVisible();
  await pick(465, 495);
  await expect(inspector.getByRole('heading', { name: 'Offices' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('20');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await metrics(page)).stepsPerSecond).toBeGreaterThan(50);
  await page.getByText('Trip counts', { exact: true }).click();
  await expect(page.getByText(/achieved ×[1-9]\d\./)).toBeVisible();
  await page.getByText('Trip counts', { exact: true }).click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(paused.timeS + 8);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const stoppedHash = await page.evaluate(() => window.cityflows!.hash());
  await page.keyboard.press('Escape');
  await page.screenshot({ path: testInfo.outputPath('overview.png') });
  // Sample across two 100 ms worker ticks to verify that Pause stops the loop.
  await page.waitForTimeout(250);
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.metrics().then((m) => m.stepsPerSecond)))
    .toBe(0);
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(stoppedHash);
});

test('opens JSON, downloads ZIP, and reopens the saved project', async ({ page }, testInfo) => {
  const fixture: {
    city: { name: string };
    manifest: { name: string; files: Record<string, string> };
  } = JSON.parse(
    await readFile(
      new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url),
      'utf8',
    ),
  );
  fixture.city.name = fixture.manifest.name = 'Saved traffic run';
  fixture.manifest.files['city.json'] = createHash('sha256')
    .update(JSON.stringify(fixture.city))
    .digest('hex');
  const open = page.getByLabel('Open project');
  await open.setInputFiles({
    name: 'scenario.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('heading', { name: 'Saved traffic run' })).toBeVisible();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.cityflows$/);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'New city' });
  await expect(picker.getByRole('button', { name: 'Four-way signal' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('new-picker.png') });
  await picker.getByRole('button', { name: '5 × 5 grid', exact: true }).click();
  await expect(page.getByRole('heading', { name: '5 × 5 grid' })).toBeVisible();
  await open.setInputFiles((await download.path())!);
  await expect(page.getByRole('heading', { name: 'Saved traffic run' })).toBeVisible();
});
