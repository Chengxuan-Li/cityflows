import { test, expect } from '@playwright/test';
import { button, pageErrors, stateHash } from './helpers';

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

test('developer views restore the paused scene and preserve the simulation hash', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(button(page, 'Debug')).toHaveCount(0);
  await button(page, 'Visual quality').click();
  await button(page, 'Render').click();
  const tools = page.getByRole('switch', { name: 'Developer tools' });
  await tools.check();
  await expect(page.getByLabel('Wireframe', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Shading', { exact: true }).locator('option')).toHaveText([
    'Normal',
    'Heights and grades',
  ]);
  await button(page, '3D').click();
  const canvas = page.getByLabel('3D city view', { exact: true });
  await expect(canvas).toHaveAttribute('data-debug-rendered', 'true');
  const original = await page.evaluate(async () => (await window.cityflows!.capture3D!())[0]);
  const hash = await stateHash(page);
  const rendered = page.getByLabel('Rendered view', { exact: true });
  const shading = page.getByLabel('Shading', { exact: true });
  await rendered.uncheck();
  await expect(shading).toBeDisabled();
  await page.getByLabel('Road graph', { exact: true }).check();
  await page.getByLabel('Wireframe', { exact: true }).check();
  await expect(canvas).toHaveAttribute('data-debug-overlays', 'roadGraph,wireframe');
  await expect(canvas).toHaveAttribute('data-debug-rendered', 'false');
  const lines = await page.evaluate(async () => (await window.cityflows!.capture3D!())[0]);
  expect(lines === original).toBe(false);
  await rendered.check();
  await shading.selectOption('unlit');
  await expect(canvas).toHaveAttribute('data-debug-shading', 'unlit');
  await shading.selectOption('normal');
  await expect(canvas).toHaveAttribute('data-debug-shading', 'normal');
  // Render settings have their own disclosure state in each dimension.
  if (!(await tools.isVisible())) await button(page, 'Render').click();
  await tools.uncheck();
  await expect(button(page, 'Debug')).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('data-debug-rendered', /.+/);
  const restored = await page.evaluate(async () => (await window.cityflows!.capture3D!())[0]);
  expect(restored === original).toBe(true);
  expect(await stateHash(page)).toBe(hash);
  expect(errors).toEqual([]);
});

test('a debug URL exposes the section for this visit and keeps overlay preferences', async ({
  page,
}) => {
  await page.goto('/?city=grid5x5&debug');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.getByLabel('Rail graph', { exact: true }).check();
  await expect(page.getByLabel('City map', { exact: true })).toHaveAttribute(
    'data-debug-overlays',
    'railGraph',
  );
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Debug')).toHaveCount(0);
  await page.goto('/?city=grid5x5&debug');
  await expect(page.getByLabel('Rail graph', { exact: true })).toBeChecked();
});
