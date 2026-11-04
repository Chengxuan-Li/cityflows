import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import type { City } from '../../src/schema';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function mapPoint(page: Page, x: number, y: number) {
  const bounds = (await page.getByLabel('City map').boundingBox())!;
  const scale = (bounds.height - 144) / 510;
  return {
    x: bounds.x + bounds.width / 2 + (x - 240) * scale,
    y: bounds.y + bounds.height / 2 + (y - 240) * scale,
  };
}
async function clickWorld(page: Page, x: number, y: number) {
  const point = await mapPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}
async function savedCity(page: Page): Promise<City> {
  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const archive = unzipSync(await readFile((await (await downloading).path())!));
  return JSON.parse(strFromU8(archive['city.json']!)) as City;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('T12 draws a snapped two-way bypass and an inspected vehicle uses it after restart', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const original = await savedCity(page);
  await button(page, 'Road').click();
  await expect(button(page, 'Road')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Class', exact: true }).selectOption('motorway');
  await expect(page.getByLabel('Drawing speed (km/h)')).toHaveValue('100');
  await page.getByLabel('Lanes per direction').selectOption('2');
  const start = await mapPoint(page, 120, 0);
  await page.mouse.move(start.x + 3, start.y + 2);
  await page.screenshot({ path: testInfo.outputPath('01-node-snap.png') });
  await page.mouse.click(start.x + 3, start.y + 2);
  const end = await mapPoint(page, 480, 360);
  await page.mouse.move(end.x - 3, end.y + 2);
  await page.screenshot({ path: testInfo.outputPath('02-bypass-preview.png') });
  await page.mouse.click(end.x - 3, end.y + 2);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  const edited = await savedCity(page);
  const added = Object.values(edited.roads).filter((road) => !original.roads[road.id]);
  expect(added).toHaveLength(2);
  expect(added[0]!.streetGroupId).toBe(added[1]!.streetGroupId);
  expect(added.map((r) => r.lanes.length)).toEqual([2, 2]);
  expect(Object.keys(edited.nodes)).toEqual(Object.keys(original.nodes));
  expect(added.map((r) => [r.from, r.to])).toEqual([
    ['n:2', 'n:20'],
    ['n:20', 'n:2'],
  ]);
  await button(page, 'Select').click();
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await button(page, 'Step').click();
  const movements = await page.evaluate(async () => {
    const vehicle = await window.cityflows!.inspect(1);
    return vehicle!.route!.movements.map((index) => window.cityflows!.movementId(index));
  });
  expect(movements.some((movement) => added.some((road) => movement.includes(`${road.id}#`)))).toBe(
    true,
  );
  await clickWorld(page, 6, 2);
  await expect(page.getByRole('heading', { name: 'Vehicle 1' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('03-vehicle-bypass-route.png') });
  expect(errors).toEqual([]);
});

test('road snapping, double-click, split, node dragging, merge and delete are undoable', async ({
  page,
}, testInfo) => {
  const original = await savedCity(page);
  await button(page, 'Road').click();
  await clickWorld(page, 60, 0);
  await clickWorld(page, 60, 60);
  const end = await mapPoint(page, 120, 120);
  await page.mouse.dblclick(end.x, end.y);
  await expect(button(page, 'Undo')).toBeEnabled();
  const drawn = await savedCity(page);
  expect(Object.keys(drawn.nodes)).toHaveLength(Object.keys(original.nodes).length + 1);
  expect(Object.keys(drawn.roads)).toHaveLength(Object.keys(original.roads).length + 4);
  await button(page, 'Undo').click();
  const undone = await savedCity(page);
  expect(undone).toEqual({ ...original, version: undone.version });
  await button(page, 'Select').click();
  await clickWorld(page, 60, 1.5);
  await button(page, 'Split').click();
  const split = await savedCity(page);
  const node = Object.values(split.nodes).find((n) => !original.nodes[n.id])!;
  expect(node.pos.x).toBeCloseTo(60, 4);
  expect(node.pos.y).toBe(0);
  await clickWorld(page, 60, 0);
  const start = await mapPoint(page, 60, 0);
  const moved = await mapPoint(page, 60, 25);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(moved.x, moved.y, { steps: 5 });
  await page.screenshot({ path: testInfo.outputPath('04-node-drag-preview.png') });
  await page.mouse.up();
  const reshaped = await savedCity(page);
  expect(reshaped.nodes[node.id]!.pos.y).toBeCloseTo(25, 4);
  await button(page, 'Undo').click();
  await button(page, 'Merge streets').click();
  const merged = await savedCity(page);
  expect(merged.roads).toEqual(original.roads);
  expect(merged.nodes).toEqual(original.nodes);
  await clickWorld(page, 60, 1.5);
  await button(page, 'Delete street').click();
  const removed = await savedCity(page);
  expect(Object.keys(removed.roads)).toHaveLength(Object.keys(original.roads).length - 2);
  await button(page, 'Undo').click();
  expect((await savedCity(page)).roads).toEqual(original.roads);
});

test('Escape cancels drawing and middle-button or Space gestures navigate without drawing', async ({
  page,
}) => {
  const original = await savedCity(page);
  await button(page, 'Road').click();
  await clickWorld(page, 120, 0);
  await clickWorld(page, 480, 360);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(button(page, 'Undo')).toBeDisabled();
  const center = await mapPoint(page, 240, 240);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x + 40, center.y + 20, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.mouse.wheel(0, -100);
  await page.keyboard.press('Enter');
  await expect(button(page, 'Undo')).toBeDisabled();
  expect(await savedCity(page)).toEqual(original);
});
