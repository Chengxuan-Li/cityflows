import { expect, test, type Page } from '@playwright/test';
import { button, city, pageErrors, stateHash } from './helpers';

const panel = (page: Page) => page.getByRole('region', { name: 'Visual quality' });
const preset = (page: Page, name: string) =>
  panel(page).getByRole('group', { name: 'Light' }).getByRole('button', { name, exact: true });

// TASK-163: the scene lighting is a per-viewer view preference. It persists across reloads, falls
// back to Day on bad storage, and never reaches the simulation or the project. TASK-340 moved it
// from Layers into Visual quality.
test('V163 lighting persists per viewer and leaves the simulation and project untouched', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Play')).toBeEnabled();
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-lighting', /"mode":"day","artificial":0/);
  const project = await city(page);
  await page.evaluate(() => window.cityflows!.step(600));
  const dayHash = await stateHash(page);

  await button(page, 'Visual quality').click();
  await expect(preset(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
  await preset(page, 'Night').click();
  await expect(preset(page, 'Night')).toHaveAttribute('aria-pressed', 'true');
  await panel(page).getByRole('slider', { name: 'Exposure' }).fill('0.8');
  await expect(map).toHaveAttribute('data-lighting', /"mode":"night","artificial":1/);
  expect(await stateHash(page)).toBe(dayHash);

  // A fresh visit keeps Night; the same steps reach the same state as by day.
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(map).toHaveAttribute('data-lighting', /"mode":"night"/);
  await page.evaluate(() => window.cityflows!.step(600));
  expect(await stateHash(page)).toBe(dayHash);
  expect(await city(page)).toEqual(project);
  await button(page, 'Visual quality').click();
  await expect(panel(page).getByRole('slider', { name: 'Exposure' })).toHaveValue('0.8');
  await expect(preset(page, 'Night')).toHaveAttribute('aria-pressed', 'true');

  await button(page, '3D').click();
  const view = page.getByLabel('3D city view', { exact: true });
  await expect(view).toHaveAttribute('data-lighting', /"mode":"night","artificial":1/);
  await expect(view).toHaveAttribute('data-lighting', /"shadows":false/);
  expect(await stateHash(page)).toBe(dayHash);

  // Broken storage opens at Day.
  await page.evaluate(() => localStorage.setItem('cityflows.visual', '{oops'));
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(map).toHaveAttribute('data-lighting', /"mode":"day"/);
  expect(errors).toEqual([]);
});

// TASK-184: Clock follows the time of year; TASK-340 gave it a date for the season. In winter a run
// that ends at 18:00 passes dusk, and lighting stored before the date existed still loads.
test('V184 the clock follows the date and a bundled run reaches evening in winter', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('cityflows.visual'))
      localStorage.setItem(
        'cityflows.lighting',
        '{"mode":"clock","exposure":1,"season":"equinox"}',
      );
  });
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Play')).toBeEnabled();
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":0/);
  await button(page, 'Visual quality').click();
  const date = panel(page).getByLabel('Date', { exact: true });
  await expect(date).toHaveValue('2026-03-21');
  // At 17:00 in March it is still day; in December the sun set at 16:22.
  await page.evaluate(() => window.cityflows!.step(360_000));
  await expect
    .poll(async () => (await page.evaluate(() => window.cityflows!.metrics())).timeS)
    .toBe(61_200);
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":0/);
  await date.fill('2026-12-21');
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":1/);
  expect(await page.evaluate(() => localStorage.getItem('cityflows.visual'))).toContain(
    '"date":"2026-12-21"',
  );
  // In 2D, Day needs no date: the control goes away.
  await preset(page, 'Day').click();
  await expect(date).toBeHidden();
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Visual quality').click();
  await preset(page, 'Clock').click();
  await expect(date).toHaveValue('2026-12-21');
  expect(errors).toEqual([]);
});
