import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { City, Scenario } from '../../src/schema';

test('baseline comparison detects a banned center turn and paints road usage differences @smoke', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await expect(button('Play')).toBeEnabled();
  const fixture = JSON.parse(
    await readFile(
      new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url),
      'utf8',
    ),
  ) as {
    city: City;
    scenarios: Scenario[];
    manifest: { files: Record<string, string> };
  };
  // Keep the grid, but place the commute across its central signal so this turn is used.
  Object.assign(
    fixture.city.places['p:104']!.connectors.find(({ id }) => id === 'c:105')!,
    { roadId: 'r:52', lane: 1 },
  );
  Object.assign(
    fixture.city.places['p:107']!.connectors.find(({ id }) => id === 'c:109')!,
    { roadId: 'r:65', lane: 1 },
  );
  fixture.city.places['p:104']!.population = 150;
  const scenario = fixture.scenarios[0]!;
  scenario.demand.workStart = { meanS: scenario.startS, sdS: 0 };
  scenario.endS = scenario.startS + 900;
  // TASK-113: car traffic as before mode choice (every driver drives).
  scenario.demand.modeChoice = { enabled: false };
  for (const [name, data] of [
    ['city.json', fixture.city],
    ['scenarios.json', fixture.scenarios],
  ] as const) {
    fixture.manifest.files[name] = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }
  await page.getByLabel('Open project').setInputFiles({
    name: 'comparison-grid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.cityflows!.metrics().then((metrics) => metrics.trips.pending)),
    )
    .toBe(300);
  await button('Compare').click();
  await button('Save as baseline').click();
  await expect(page.getByText(/Baseline saved/)).toBeVisible();
  await button('Compare').click();
  const map = page.getByLabel('City map');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByText('Turns', { exact: true }).click();
  const turn = button('r:52 lane 2 → r:65 lane 2');
  await expect(turn).toHaveAttribute('aria-pressed', 'true');
  await turn.click();
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  await button('Compare').click();
  const initialHash = await page.evaluate(() => window.cityflows!.hash());
  await button('Run comparison').click();
  await expect(page.getByLabel('Comparison progress')).toBeVisible();
  const table = page.getByRole('table', { name: 'Comparison results' });
  await expect(table).toBeVisible({ timeout: 120_000 });
  const row = table.getByRole('row', { name: /Mean travel time/ });
  const values = await row.getByRole('cell').allTextContents();
  expect(values[0]).not.toBe(values[1]);
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(initialHash);
  await expect
    .poll(async () => Number(await map.getAttribute('data-difference-roads')))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('comparison-panel.png') });
  await button('Compare').click();
  await button('Layers').click();
  const toggle = page.getByLabel('Comparison road usage', { exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(map).toHaveAttribute('data-difference-roads', '0');
  await toggle.check();
  await expect
    .poll(async () => Number(await map.getAttribute('data-difference-roads')))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('comparison-difference-layer.png') });
  await button('Layers').click();
  await button('Compare').click();
  await button('Restore baseline').click();
  await expect(turn).toHaveAttribute('aria-pressed', 'true');
  await expect(table).toBeHidden();
  await button('Undo').click();
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
