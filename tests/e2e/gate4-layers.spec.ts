import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { City, Scenario } from '../../src/schema';

test('layer toggles leave the simulation unchanged; minute charts show the morning peak', async ({
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
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
  Object.values(fixture.city.places).find(({ kind }) => kind === 'residential')!.population = 2000;
  // Include the whole departure curve rather than releasing pre-07:00 trips in a startup burst.
  fixture.scenarios[0]!.startS = 6 * 3600;
  fixture.manifest.files['city.json'] = createHash('sha256')
    .update(JSON.stringify(fixture.city))
    .digest('hex');
  fixture.manifest.files['scenarios.json'] = createHash('sha256')
    .update(JSON.stringify(fixture.scenarios))
    .digest('hex');
  await page.getByLabel('Open project').setInputFiles({
    name: 'grid-2000.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.cityflows!.metrics().then((metrics) => metrics.trips.pending)),
    )
    .toBe(4000);
  await page.evaluate(() => window.cityflows!.step(6000));
  const hash = await page.evaluate(() => window.cityflows!.hash());
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  await expect(layers.getByLabel('Road classes', { exact: true })).not.toBeChecked();
  // Wait for the paused snapshot throttle before comparing presentation-only changes.
  await page.waitForTimeout(550);
  const screenshotOptions = {
    // The floating sheet can paint outside its box after a checkbox scrolls into view.
    style: '.layers-sheet { opacity: 0 !important; }',
    mask: [page.getByRole('button', { name: 'Layers', exact: true })],
  };
  const asphalt = await page.getByLabel('City map', { exact: true }).screenshot(screenshotOptions);
  await layers.getByLabel('Road classes', { exact: true }).check();
  await expect
    .poll(async () =>
      (await page.getByLabel('City map', { exact: true }).screenshot(screenshotOptions)).equals(
        asphalt,
      ),
    )
    .toBe(false);
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  await layers.getByLabel('Road classes', { exact: true }).uncheck();
  await expect
    .poll(async () =>
      (await page.getByLabel('City map', { exact: true }).screenshot(screenshotOptions)).equals(
        asphalt,
      ),
    )
    .toBe(true);
  for (const checkbox of await layers.getByRole('checkbox').all()) {
    await checkbox.click();
    expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
    await checkbox.click();
  }
  await layers.getByLabel('Road speeds', { exact: true }).check();
  await layers.getByLabel('Queues', { exact: true }).check();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.evaluate(() => window.cityflows!.step(174000)); // Through 11:00, including the falling side.
  const finalHash = await page.evaluate(() => window.cityflows!.hash());
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Traffic over time' });
  await expect(chart.getByText('Through 11:00 · every simulated minute')).toBeVisible();
  const points = await chart
    .getByRole('img', { name: 'Driving over simulated time', exact: true })
    .locator('polyline')
    .getAttribute('points');
  const values = points!.split(' ').map((point) => point.split(',').map(Number));
  expect(values).toHaveLength(301);
  const peak = values.reduce(
    (best, point, index) => (point[1]! < values[best]![1]! ? index : best),
    0,
  );
  expect(peak).toBeGreaterThan(15);
  expect(peak).toBeLessThan(240); // Morning peak before 10:00; recovered trips can queue past 09:00.
  expect(values[peak]![1]).toBeLessThan(values.at(-1)![1]! - 20);
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(finalHash);
  await page.screenshot({ path: testInfo.outputPath('morning-chart.png') });
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.evaluate((steps) => window.cityflows!.step(steps), peak * 600);
  // Allow the 500 ms snapshot heat throttle to deliver the paused peak frame.
  await page.waitForTimeout(550);
  await page.screenshot({ path: testInfo.outputPath('morning-heat.png') });
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('layer-list.png') });
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(layers).toBeHidden();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(
    chart.getByText('Run for a simulated minute, then refresh to see the curves.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
