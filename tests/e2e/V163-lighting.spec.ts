import { expect, test } from '@playwright/test';
import { button, city, pageErrors, stateHash } from './helpers';

// TASK-163: the scene lighting is a per-viewer view preference. It persists across reloads, falls
// back to Day on bad storage, and never reaches the simulation or the project.
test('V163 lighting persists per viewer and leaves the simulation and project untouched', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-lighting', /"mode":"day","artificial":0/);
  const project = await city(page);
  await page.evaluate(() => window.cityflows!.step(600));
  const dayHash = await stateHash(page);

  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  const preset = (name: string) =>
    layers.getByRole('group', { name: 'Time of day' }).getByRole('button', { name });
  await expect(preset('Day')).toHaveAttribute('aria-pressed', 'true');
  await preset('Night').click();
  await expect(preset('Night')).toHaveAttribute('aria-pressed', 'true');
  await layers.getByRole('slider', { name: 'Exposure' }).fill('0.8');
  await button(page, 'Layers').click();
  await expect(map).toHaveAttribute('data-lighting', /"mode":"night","artificial":1/);
  expect(await stateHash(page)).toBe(dayHash);

  // A fresh visit keeps Night; the same steps reach the same state as by day.
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(map).toHaveAttribute('data-lighting', /"mode":"night"/);
  await page.evaluate(() => window.cityflows!.step(600));
  expect(await stateHash(page)).toBe(dayHash);
  expect(await city(page)).toEqual(project);
  await button(page, 'Layers').click();
  await expect(layers.getByRole('slider', { name: 'Exposure' })).toHaveValue('0.8');
  await expect(preset('Night')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Layers').click();

  await button(page, '3D').click();
  const view = page.getByLabel('3D city view', { exact: true });
  await expect(view).toHaveAttribute('data-lighting', /"mode":"night","artificial":1/);
  await expect(view).toHaveAttribute('data-lighting', /"shadows":false/);
  expect(await stateHash(page)).toBe(dayHash);

  // Broken storage opens at Day.
  await page.evaluate(() => localStorage.setItem('cityflows.lighting', '{oops'));
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(map).toHaveAttribute('data-lighting', /"mode":"day"/);
  expect(errors).toEqual([]);
});

// TASK-184: Follow clock has a season. In Winter a run that ends at 18:00 passes dusk, and an older
// stored value without a season still loads.
test('V184 the clock follows the season and a bundled run reaches evening in Winter', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('cityflows.lighting'))
      localStorage.setItem('cityflows.lighting', '{"mode":"clock","exposure":1}');
  });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":0/);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  const season = layers.getByRole('combobox', { name: 'Season' });
  await expect(season).toHaveValue('equinox');
  // At 17:00 Spring/autumn is still lit by day; Winter's sun set at 16:20.
  await page.evaluate(() => window.cityflows!.step(360_000));
  await expect
    .poll(async () => (await page.evaluate(() => window.cityflows!.metrics())).timeS)
    .toBe(61_200);
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":0/);
  await season.selectOption('winter');
  await expect(map).toHaveAttribute('data-lighting', /"mode":"clock","artificial":1/);
  expect(await page.evaluate(() => localStorage.getItem('cityflows.lighting'))).toContain(
    '"season":"winter"',
  );
  // Day is not a clock: the season control goes away.
  await layers
    .getByRole('group', { name: 'Time of day' })
    .getByRole('button', { name: 'Day' })
    .click();
  await expect(season).toBeHidden();
  await page.reload();
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Layers').click();
  await layers
    .getByRole('group', { name: 'Time of day' })
    .getByRole('button', { name: 'Clock', exact: true })
    .click();
  await expect(season).toHaveValue('winter');
  expect(errors).toEqual([]);
});
