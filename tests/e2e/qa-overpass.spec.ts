import { expect, test, type Page } from '@playwright/test';
import { button, city, metrics, pageErrors, stateHash } from './helpers';

const bounds = [-75.171, 39.945, -75.159, 39.954];
const endpoint = 'https://overpass-api.de/api/interpreter';

async function chooseArea(page: Page, west = bounds[0]!, drag = false) {
  await button(page, 'Import').click();
  await button(page, 'Choose map area').click();
  await expect(page.getByLabel('Area map', { exact: true })).toBeVisible();
  if (drag) {
    const canvas = page.getByLabel('Area map', { exact: true }).locator('canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const previous = await page.getByRole('spinbutton', { name: 'West', exact: true }).inputValue();
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByRole('spinbutton', { name: 'West', exact: true })).not.toHaveValue(
      previous,
    );
    await expect(button(page, 'Next')).toBeEnabled();
  }
  for (const [index, label] of ['West', 'South', 'East', 'North'].entries()) {
    await page
      .getByRole('spinbutton', { name: label, exact: true })
      .fill(String(index ? bounds[index] : west));
  }
  await button(page, 'Next').click();
  await page.getByLabel('Overpass endpoint').fill(endpoint);
  await button(page, 'Import roads').click();
}

test('QA area picker downloads, accepts, plays and reuses the persisted Overpass cache', async ({
  page,
}) => {
  const errors = pageErrors(page);
  let requests = 0;
  await page.route('https://**/*', (route) => route.abort());
  await page.route(endpoint, async (route) => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(new URLSearchParams(route.request().postData()!).get('data')).toContain(
      '(39.945,-75.171,39.954,-75.159)',
    );
    await route.fulfill({
      path: 'tests/e2e/fixtures/overpass-downtown.osm',
      contentType: 'application/xml',
    });
  });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await chooseArea(page, bounds[0], true);
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await expect(dialog.getByText('Downloaded from Overpass', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    '0 errors',
  );
  await button(page, 'Continue').click();
  await expect(dialog).toContainText('OpenStreetMap contributors');
  await button(page, 'Accept city').click();
  await expect(dialog).toBeHidden();
  const imported = await city(page);
  expect(imported.geo?.bbox).toEqual(bounds);
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await button(page, 'Pause').click();
  // Reload proves the cache survives the wizard and a new application instance.
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await chooseArea(page);
  await expect(dialog.getByText('Loaded from cache', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    '0 errors',
  );
  await button(page, 'Continue').click();
  await button(page, 'Accept city').click();
  await expect(dialog).toBeHidden();
  expect(await city(page)).toEqual(imported);
  expect(requests).toBe(1);
  expect(errors).toEqual([]);
});

test('QA failed Overpass response leaves the current city and simulation alone', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    await route.fulfill({ status: 503, body: 'Recorded service unavailable' });
  });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(100));
  const before = {
    city: await city(page),
    hash: await stateHash(page),
    metrics: await metrics(page),
  };
  await chooseArea(page, -75.172);
  await expect(page.getByRole('alert')).toHaveText(
    'Overpass returned 503. Try again later or choose another endpoint.',
  );
  await button(page, 'Close Import city').click();
  expect(await city(page)).toEqual(before.city);
  expect(await stateHash(page)).toBe(before.hash);
  expect(await metrics(page)).toEqual(before.metrics);
  expect(requests).toBe(1);
  expect(errors).toEqual([]);
});
