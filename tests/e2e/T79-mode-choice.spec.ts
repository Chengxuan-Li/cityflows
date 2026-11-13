import { expect, test, type Page } from '@playwright/test';
import { button, metrics, pageErrors, setRange } from './helpers';

/** Person trips started on foot and by car after an hour and a half of the default morning. */
async function startedModes(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 9; i++) await window.cityflows!.step(6000);
  });
  return (await metrics(page)).persons!.modes.started;
}

// TASK-113: the demand sheet's mode choice sliders change the mode shares after a restart.
test('T79 a slider in the demand sheet moves the mode shares after a restart', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();

  const before = await startedModes(page);
  expect(before.walk).toBeGreaterThan(0);
  expect(before.car).toBeGreaterThan(0);
  await button(page, 'Chart').click();
  const shares = page
    .getByRole('region', { name: 'Traffic over time' })
    .getByRole('figure', { name: 'Mode shares' });
  const total = before.walk + before.car;
  await expect(shares.getByText(/^Person trips by mode/)).toContainText(
    `walk ${Math.round((100 * before.walk) / total)}%`,
  );
  await expect(shares.locator('[data-hour]').first()).toBeAttached();
  await page.keyboard.press('Escape');

  await button(page, 'Demand').click();
  const demand = page.getByRole('region', { name: 'Demand', exact: true });
  const choice = demand.getByRole('group', { name: 'Mode choice' });
  await expect(choice.getByRole('slider', { name: 'Walk preference' })).toHaveValue('12');
  await setRange(page, 'Walk preference', '30');
  await expect(choice.getByText('Walk preference 30 min')).toBeVisible();
  await expect(page.getByRole('status').getByText('Restart to apply changes')).toBeVisible();
  await page.keyboard.press('Escape');
  await button(page, 'Restart').click();
  await expect(button(page, 'Play')).toBeEnabled();
  const more = await startedModes(page);
  expect(more.walk).toBeGreaterThan(before.walk);
  expect(more.car).toBeLessThan(before.car);

  // Off, everyone with a free household car drives (the default city gives everyone one).
  await button(page, 'Demand').click();
  const toggle = choice.getByRole('checkbox', { name: 'Choose walk or car per trip' });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(choice.getByRole('slider', { name: 'Walk preference' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await button(page, 'Restart').click();
  await expect(button(page, 'Play')).toBeEnabled();
  const off = await startedModes(page);
  expect(off.walk).toBe(0);
  expect(off.car).toBeGreaterThan(before.car);
  expect(errors).toEqual([]);
});
