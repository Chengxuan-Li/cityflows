import { expect, test, type Locator, type Page } from '@playwright/test';
import { button, clickGrid, clickVehicle, pageErrors } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const hint = (page: Page) => page.getByRole('region', { name: 'Hint' });

/** The soft ring sits around the control the hint is about, and that control is usable. */
async function ringed(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  await expect
    .poll(async () => {
      const ring = (await page.locator('.hint-ring').boundingBox())!;
      const box = (await target.boundingBox())!;
      return [ring.x - box.x, ring.y - box.y, ring.width - box.width, ring.height - box.height].map(
        Math.round,
      );
    })
    .toEqual([-3, -3, 6, 6]);
}

test('a new player following only the hints completes the loop once', async ({ page }, info) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  // Test builds start without hints; the query reopens them.
  await expect(hint(page)).toBeHidden();
  await expect(button(page, 'Show hints')).toBeVisible();

  await page.goto('/?hints');
  await expect(button(page, 'Play')).toBeEnabled();
  const shot = (step: number | string) =>
    page.screenshot({ path: info.outputPath(`hint-${step}.png`) });

  await expect(hint(page)).toContainText('Choose a city to start from.');
  await expect(hint(page)).toContainText('1 of 6');
  await expect(button(page, 'Show hints')).toBeHidden();
  await ringed(page, button(page, 'New'));
  await shot(1);
  await button(page, 'New').click();
  await page
    .getByRole('dialog', { name: 'New city' })
    .getByRole('button', { name: '5 × 5 grid', exact: true })
    .click();

  await expect(hint(page)).toContainText('Press Play to start the day.');
  await ringed(page, button(page, 'Play'));
  await shot(2);
  await button(page, 'Play').click();

  await expect(hint(page)).toContainText('Click a car to see its trip and why it waits.');
  await shot(3);
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.count ?? 0))
    .toBeGreaterThan(0);
  const id = await page.evaluate(() => window.cityflows!.drawnSnapshot!()!.id[0]!);
  await clickVehicle(page, id);

  await expect(hint(page)).toContainText('Click a street, then open its settings');
  await shot(4);
  await clickGrid(page, 60, 2);
  await expect(page.getByRole('heading', { name: /^Street / })).toBeVisible();
  const settings = page.getByText('Lanes and street settings', { exact: true });
  await ringed(page, settings);
  await shot('4-settings');
  await settings.click();
  const lanes = page.getByLabel('Lanes in this direction');
  await lanes.fill('2');
  await lanes.press('Enter');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();

  await expect(hint(page)).toContainText('Restart to replay the day with your edits.');
  await ringed(page, button(page, 'Restart'));
  await shot(5);
  await button(page, 'Restart').click();
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeHidden();

  await expect(hint(page)).toContainText('Compare runs before and after an edit.');
  await expect(hint(page)).toContainText('6 of 6');
  await ringed(page, button(page, 'Compare'));
  await shot(6);
  await button(page, 'Compare').click();
  await expect(page.getByRole('region', { name: 'Scenario comparison' })).toBeVisible();
  await expect(hint(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('cityflows.hints'))).toBe('done');

  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.waitForTimeout(500);
  await expect(hint(page)).toBeHidden();
  await expect(button(page, 'Show hints')).toBeVisible();
  expect(errors).toEqual([]);
});

test('hints can be skipped, reopened, and resume after a reload', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Show hints').click();
  await expect(hint(page)).toContainText('Choose a city to start from.');
  await hint(page).getByRole('button', { name: 'Skip' }).click();
  await expect(hint(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('cityflows.hints'))).toBe('done');

  await page.evaluate(() => window.cityflows!.resetHints!());
  await expect(hint(page)).toContainText('Choose a city to start from.');
  await hint(page).getByRole('button', { name: 'Next' }).click();
  await expect(hint(page)).toContainText('Press Play to start the day.');
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(hint(page)).toContainText('Press Play to start the day.');
  await expect(hint(page)).toContainText('2 of 6');
  // A selected street hides "Show hints" behind its sheet but leaves an active hint in place.
  await clickGrid(page, 60, 2);
  await expect(page.getByRole('heading', { name: /^Street / })).toBeVisible();
  await expect(hint(page)).toBeVisible();
  await hint(page).getByRole('button', { name: 'Skip' }).click();
  await expect(hint(page)).toBeHidden();
  await expect(button(page, 'Show hints')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Show hints')).toBeVisible();
  expect(errors).toEqual([]);
});
