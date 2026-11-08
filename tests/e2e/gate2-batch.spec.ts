import { expect, test, type Page } from '@playwright/test';
import { city } from './helpers';

async function point(page: Page, x: number, y: number) {
  const bounds = (await page.getByLabel('City map').boundingBox())!;
  const scale = (bounds.height - 144) / 510;
  return {
    x: bounds.x + bounds.width / 2 + (x - 240) * scale,
    y: bounds.y + bounds.height / 2 + (y - 240) * scale,
  };
}

test('box selection edits street speeds in one undoable batch @smoke', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const start = await point(page, 30, -15);
  const end = await point(page, 210, 135);
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByRole('heading', { name: /streets selected/ })).toBeVisible();
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.screenshot({ path: testInfo.outputPath('box-selection-batch.png') });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.getByLabel('Speed limit (km/h)').fill('45');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  const road = await point(page, 60, 1.5);
  await page.mouse.click(road.x, road.y);
  await page.getByText('Lanes and street settings', { exact: true }).click();
  await expect(page.getByLabel('Speed limit (km/h)')).toHaveValue('45');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Speed limit (km/h)')).toHaveValue('50');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('opposite-direction batches keep the edited survivors selected and can restore two-way streets', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const before = await page.evaluate(() => window.cityflows!.city!());
  const first = await point(page, 60, 1.5);
  const second = await point(page, -1.5, 60);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(page.getByRole('heading', { name: '2 streets selected' })).toBeVisible();
  await page.getByLabel('Speed limit (km/h)').fill('45');
  await page.getByLabel('Lanes per direction').fill('2');
  await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('reverse');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2 streets selected' })).toBeVisible();
  await expect(page.getByLabel('Speed limit (km/h)')).toHaveValue('45');
  await expect(page.getByLabel('Lanes per direction')).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue('one');
  const oneWay = await page.evaluate(() => window.cityflows!.city!());
  expect(Object.keys(oneWay.roads)).toHaveLength(Object.keys(before.roads).length - 2);
  expect(oneWay.roads['r:26']).toBeUndefined();
  expect(oneWay.roads['r:28']).toBeUndefined();
  expect(oneWay.roads['r:27']!.speedLimitMps).toBe(12.5);
  expect(oneWay.roads['r:29']!.speedLimitMps).toBe(12.5);
  await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('both');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue('both');
  const twoWay = await page.evaluate(() => window.cityflows!.city!());
  expect(Object.keys(twoWay.roads)).toHaveLength(Object.keys(before.roads).length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await page.evaluate(() => window.cityflows!.city!());
  expect(undone).toEqual({ ...before, version: undone.version });
});

test('a crossing centerline is box-selected without endpoints inside; Shift-click toggles roads', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const start = await point(page, 30, -5);
  const end = await point(page, 90, 5);
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '2 streets selected' })).toBeVisible();
  // Start another box to capture the live marquee alongside the batch inspector.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.screenshot({ path: testInfo.outputPath('box-selection-inspector.png') });
  await page.mouse.up();
  const road = await point(page, 60, 1.5);
  await page.mouse.click(road.x, road.y);
  await expect(page.getByRole('heading', { name: /streets selected/ })).toBeHidden();
  await expect(page.getByText('Lanes and street settings', { exact: true })).toBeVisible();
  await page.mouse.click(road.x, road.y);
  await expect(page.getByRole('heading', { name: '2 streets selected' })).toBeVisible();
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page.getByLabel('Inspector', { exact: true })).toBeHidden();
});

test('mixed fields preserve untouched values, and lanes, class and direction commit together', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const first = await point(page, 60, 1.5);
  await page.mouse.click(first.x, first.y);
  await page.getByText('Lanes and street settings', { exact: true }).click();
  await page.getByLabel('Speed limit (km/h)').fill('40');
  await page.getByLabel('Speed limit (km/h)').press('Enter');
  await page.getByLabel('Road class').selectOption('primary');
  await page.getByLabel('Lanes in this direction').fill('3');
  await page.getByLabel('Lanes in this direction').press('Enter');
  // The map takes clicks once its frame loop has drawn the recompiled city (TASK-115 made
  // clicks fast enough to land before that frame).
  await expect
    .poll(async () => Object.values((await city(page)).roads).some((r) => r.lanes.length === 3))
    .toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const second = await point(page, 180, 0);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(page.getByRole('heading', { name: '2 streets selected' })).toBeVisible();
  for (const label of ['Speed limit (km/h)', 'Lanes per direction']) {
    await expect(page.getByLabel(label)).toHaveValue('');
    await expect(page.getByLabel(label)).toHaveAttribute('placeholder', 'Mixed');
  }
  await expect(page.getByLabel('Road class')).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue('');
  await expect(page.getByText('1 primary · 1 residential', { exact: true })).toBeVisible();
  const before = await page.evaluate(() => window.cityflows!.city!());
  await page.getByLabel('Lanes per direction').fill('2');
  await page.getByLabel('Road class').selectOption('secondary');
  await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('one');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Road class')).toHaveValue('secondary');
  const after = await page.evaluate(() => window.cityflows!.city!());
  expect(after.version).toBe(before.version + 1);
  expect(after.roads['r:26']!.lanes).toHaveLength(2);
  expect(after.roads['r:30']!.lanes).toHaveLength(2);
  expect(after.roads['r:26']!.speedLimitMps).toBe(before.roads['r:26']!.speedLimitMps);
  expect(after.roads['r:30']!.speedLimitMps).toBe(before.roads['r:30']!.speedLimitMps);
  expect(after.roads['r:27']).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await page.evaluate(() => window.cityflows!.city!());
  expect(undone).toEqual({ ...before, version: undone.version });
});
