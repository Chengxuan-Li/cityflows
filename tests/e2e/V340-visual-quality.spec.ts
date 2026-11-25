import { expect, test, type Page } from '@playwright/test';
import { button, pageErrors, sidebarSection, stateHash } from './helpers';

// TASK-340: the Visual quality section. A preset, a category 4 value behind its confirmation and a
// fixed date and time each change the 3D view; none of them reaches the simulation.
const frame = (page: Page) => page.evaluate(async () => (await window.cityflows!.capture3D!())[1]!);
const quality = async (page: Page) =>
  JSON.parse(
    (await page.getByLabel('3D city view', { exact: true }).getAttribute('data-quality'))!,
  );

test('V340 presets, an offline value and a fixed date and time change the 3D view', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(600));
  const hash = await stateHash(page);
  await button(page, '3D').click();
  const view = page.getByLabel('3D city view', { exact: true });
  await expect(view).toHaveAttribute('data-tree-kits', /"round"/);
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 120, y: 120 }, 2.5, 40, 25));

  await (await sidebarSection(page, 'Visual quality')).click();
  const panel = page.getByRole('region', { name: 'Visual quality' });
  const preset = panel.getByLabel('Preset', { exact: true });
  await expect(preset).toHaveValue('balanced');
  // Balanced draws the map's two tree shapes.
  expect(JSON.parse((await view.getAttribute('data-tree-kits'))!)).toMatchObject({
    spreading: 0,
    columnar: 0,
  });
  const balanced = await frame(page);

  await preset.selectOption('high');
  await expect(view).toHaveAttribute('data-quality', /"shadowResolution":4096/);
  expect(await quality(page)).toMatchObject({ shadowRange: 'medium', shadowSoft: true });
  await expect
    .poll(async () => JSON.parse((await view.getAttribute('data-tree-kits'))!).spreading)
    .toBeGreaterThan(0);
  const high = await frame(page);
  expect(high).not.toBe(balanced);

  // A category 4 value asks first: cancelled, nothing changes; confirmed, it applies and warns.
  await panel.getByRole('button', { name: 'Render', exact: true }).click();
  const scale = panel.getByLabel('Render scale', { exact: true });
  const sheet = page.getByRole('dialog', { name: 'Offline rendering' });
  await scale.selectOption('2');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(scale).toHaveValue('1');
  expect((await quality(page)).renderScale).toBe(1);
  await scale.selectOption('2');
  await sheet.getByRole('button', { name: 'Use it' }).click();
  await expect(view).toHaveAttribute('data-quality', /"renderScale":2/);
  const ratio = await page.evaluate(() => Math.min(2, window.devicePixelRatio) * 2);
  expect((await quality(page)).pixelRatio).toBe(ratio);
  await expect(panel.getByText('Offline rendering: very slow').first()).toBeVisible();
  await expect(preset).toHaveValue('custom');
  // Once confirmed, the session does not ask again.
  await panel.getByRole('button', { name: 'Shadows', exact: true }).click();
  await panel.getByLabel('Shadow resolution', { exact: true }).selectOption('8192');
  await expect(sheet).toBeHidden();
  await expect(view).toHaveAttribute('data-quality', /"shadowResolution":8192/);
  await preset.selectOption('balanced');
  await expect(view).toHaveAttribute('data-quality', /"renderScale":1,/);

  // Fixed: a December dawn at the default place (Munich) is dark, its noon is lit.
  await panel.getByRole('group', { name: 'Light' }).getByRole('button', { name: 'Fixed' }).click();
  await panel.getByLabel('Date', { exact: true }).fill('2026-12-21');
  await panel.getByLabel('Time', { exact: true }).fill('06:30');
  await expect(view).toHaveAttribute('data-lighting', /"mode":"fixed","artificial":1/);
  const dawn = await frame(page);
  await panel.getByLabel('Time', { exact: true }).fill('12:00');
  await expect(view).toHaveAttribute('data-lighting', /"mode":"fixed","artificial":0,/);
  const noon = await frame(page);
  expect(dawn).not.toBe(noon);
  expect(noon).not.toBe(balanced);
  await expect(panel.getByLabel('Time zone', { exact: true })).toHaveValue('');
  await expect(panel.getByText('Auto: Europe/Berlin')).toBeAttached();

  // The settings are the viewer's: stored, and the simulation is untouched.
  const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('cityflows.visual')))!);
  expect(stored).toMatchObject({ mode: 'fixed', date: '2026-12-21', time: '12:00' });
  expect(await stateHash(page)).toBe(hash);
  expect(errors).toEqual([]);
});
