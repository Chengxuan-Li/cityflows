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
  await layers.getByLabel('Exposure').fill('0.8');
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
  await expect(layers.getByLabel('Exposure')).toHaveValue('0.8');
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
