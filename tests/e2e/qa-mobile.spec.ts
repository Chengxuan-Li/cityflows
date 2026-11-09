import { expect, test, type Locator } from '@playwright/test';
import {
  button,
  city,
  clickVehicle,
  clickWorld,
  departVehicle,
  metrics,
  pageErrors,
} from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function reachable(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const inside =
          box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
        return inside && hit && element.contains(hit)
          ? 'reachable'
          : JSON.stringify({ box: box.toJSON(), hit: hit?.outerHTML.slice(0, 180) });
      }),
    )
    .toBe('reachable');
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('QA phone plays and selects a rendered car', async ({ page }) => {
  const errors = pageErrors(page);
  await reachable(button(page, 'Play'));
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).trips.driving).toBeGreaterThan(0);
  await reachable(button(page, 'Pause'));
  await button(page, 'Pause').click();
  await departVehicle(page, 1);
  await clickVehicle(page, 1);
  await reachable(page.getByRole('heading', { name: 'Vehicle 1', exact: true }));
  expect(errors).toEqual([]);
});

test('QA phone selects a street', async ({ page }) => {
  const errors = pageErrors(page);
  await clickWorld(page, { x: 60, y: 2 });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await reachable(inspector.getByRole('heading', { name: /^Street / }));
  await reachable(inspector.getByText('Lanes and street settings', { exact: true }));
  expect(errors).toEqual([]);
});

test('QA phone selects a junction', async ({ page }) => {
  const errors = pageErrors(page);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await clickWorld(page, { x: 240, y: 240 });
  await reachable(inspector.getByRole('heading', { name: /^Signal / }));
  await reachable(inspector.getByText('Turns', { exact: true }));
  expect(errors).toEqual([]);
});

for (const [label, content] of [
  ['Compare', 'compare'],
  ['Layers', 'layers'],
  ['Chart', 'metrics-chart'],
  ['Demand', 'demand'],
] as const) {
  test(`QA phone ${label} run-bar sheet is reachable`, async ({ page }) => {
    const errors = pageErrors(page);
    await reachable(button(page, label));
    await button(page, label).click();
    const sheet = page.locator(`#${content}`);
    await reachable(sheet);
    for (const control of await sheet
      .locator('button:enabled, input:enabled, select:enabled, summary')
      .all()) {
      if (!(await control.isVisible())) continue;
      // A sheet taller than the phone scrolls; reach each control as a user would.
      await control.scrollIntoViewIfNeeded();
      await reachable(control);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('QA phone trip counts sheet is reachable', async ({ page }) => {
  await reachable(page.getByText('Trip counts', { exact: true }));
  await page.getByText('Trip counts', { exact: true }).click();
  await reachable(page.locator('.metrics-sheet'));
  await page.getByText('Trip counts', { exact: true }).click();
});

test('QA phone validation is reachable', async ({ page }) => {
  const validation = page.getByRole('button', { name: /^Validation/ });
  await reachable(validation);
  await validation.click();
  await reachable(page.getByRole('heading', { name: 'Diagnostics', exact: true }));
});

test('QA phone imports a small OSM file through diagnostics and acceptance', async ({ page }) => {
  const errors = pageErrors(page);
  await reachable(button(page, 'Import'));
  await button(page, 'Import').click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await reachable(dialog.getByLabel('OSM file'));
  await dialog.getByLabel('OSM file').setInputFiles('fixtures/osm/acute-y.osm');
  await reachable(button(page, 'Import roads'));
  await button(page, 'Import roads').click();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    '0 errors',
    { timeout: 60_000 },
  );
  await reachable(button(page, 'Continue'));
  await button(page, 'Continue').click();
  await reachable(button(page, 'Accept city'));
  await button(page, 'Accept city').click();
  await expect(dialog).toBeHidden();
  expect(Object.keys((await city(page)).roads).length).toBeGreaterThan(0);
  await reachable(button(page, 'Play'));
  expect(errors).toEqual([]);
});

test('QA phone play, pause and step controls are reachable', async ({ page }) => {
  await reachable(button(page, 'Play'));
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await reachable(button(page, 'Pause'));
  await button(page, 'Pause').click();
  const paused = (await metrics(page)).timeS;
  await reachable(button(page, 'Step'));
  await button(page, 'Step').click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeCloseTo(paused + 0.1, 6);
});
