import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import type { City, Person, Scenario } from '../../src/schema';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function mapPoint(page: Page, x: number, y: number) {
  const bounds = (await page.getByLabel('City map').boundingBox())!;
  const scale = (bounds.height - 144) / 510;
  return {
    x: bounds.x + bounds.width / 2 + (x - 240) * scale,
    y: bounds.y + bounds.height / 2 + (y - 240) * scale,
  };
}
async function stroke(page: Page, from: [number, number], to: [number, number], preview?: string) {
  const start = await mapPoint(page, ...from);
  const end = await mapPoint(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  if (preview) await page.screenshot({ path: preview });
  await page.mouse.up();
}
async function saved(page: Page) {
  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const archive = unzipSync(await readFile((await (await downloading).path())!));
  return {
    city: JSON.parse(strFromU8(archive['city.json']!)) as City,
    population: JSON.parse(strFromU8(archive['population.json']!)) as Person[],
    scenarios: JSON.parse(strFromU8(archive['scenarios.json']!)) as Scenario[],
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('painted work attracts inspected vehicles and same-seed regeneration replays identically', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await button(page, 'Place').click();
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('work');
  await stroke(page, [160, 175], [205, 175], info.outputPath('01-painting.png'));
  await expect(page.getByRole('heading', { name: 'Work 3' })).toBeVisible();
  const created = Object.values((await saved(page)).city.places).find((p) => p.name === 'Work 3')!;
  expect(created.shape.kind).toBe('polygon');
  expect(created.connectors).toHaveLength(1);
  expect(created.jobs).toBeGreaterThan(100);
  await page.getByText('Connectors', { exact: true }).click();
  await page.screenshot({ path: info.outputPath('02-place-controls.png') });
  await button(page, 'Demand').click();
  const seed = page.getByLabel('Demand seed');
  await expect(seed).toHaveValue('1');
  await seed.fill('23');
  await button(page, 'Regenerate demand').click();
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  const generated = await saved(page);
  expect(generated.scenarios[0]!.seed).toBe(23);
  expect(generated.scenarios[0]!.demand.seed).toBe(23);
  expect(generated.population.some((p) => p.workPlaceId === created.id)).toBe(true);
  await expect(page.getByLabel('Place demand')).toContainText(/\b[1-9]\d* attracted/);
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await button(page, 'Step').click();
  await page.evaluate(() => window.cityflows!.step(1999));
  const firstHash = await page.evaluate(() => window.cityflows!.hash());
  const vehicle = await page.evaluate(async (destination) => {
    for (let id = 1; id <= 80; id++) {
      const detail = await window.cityflows!.inspect(id);
      if (
        detail?.destinationPlace === destination &&
        detail.departedS !== null &&
        !detail.failReason
      )
        return detail;
    }
    return null;
  }, created.id);
  expect(vehicle?.destinationPlace).toBe(created.id);
  await button(page, 'Regenerate demand').click();
  expect((await saved(page)).population).toEqual(generated.population);
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(2000));
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(firstHash);
  await page.evaluate(() => window.cityflows!.step(4000));
  expect(
    (await page.evaluate((id) => window.cityflows!.inspect(id), vehicle!.id))!.arrivedS,
  ).not.toBeNull();
  await button(page, 'Demand').click();
  await button(page, 'Add connector').click();
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  expect((await saved(page)).population).toEqual(generated.population);
  expect(errors).toEqual([]);
});

test('extend, demographic controls, connectors and delete remain undoable', async ({ page }) => {
  await button(page, 'Place').click();
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('retail');
  await stroke(page, [40, 55], [70, 55]);
  await expect(page.getByRole('heading', { name: 'Retail 3' })).toBeVisible();
  const before = (await saved(page)).city;
  const place = Object.values(before.places).find((p) => p.name === 'Retail 3')!;
  await stroke(page, [70, 55], [90, 85]);
  const after = (await saved(page)).city;
  expect(Object.keys(after.places)).toEqual(Object.keys(before.places));
  expect(after.places[place.id]!.jobs).toBeGreaterThan(place.jobs);
  expect(after.places[place.id]!.connectors).toEqual(place.connectors);
  await page.getByText('Connectors', { exact: true }).click();
  await button(page, 'Move to nearest lane').click();
  expect((await saved(page)).city.places[place.id]!.connectors).not.toEqual(place.connectors);
  await button(page, 'Undo').click();
  await button(page, 'Undo').click();
  expect((await saved(page)).city.places[place.id]).toEqual(place);
  const jobs = page.getByRole('slider', { name: 'Jobs' });
  await jobs.focus();
  await jobs.press('ArrowRight');
  await expect(jobs).toHaveValue(String(place.jobs + 1));
  await page.getByLabel('Capacity', { exact: true }).fill('12');
  await page.getByLabel('Capacity', { exact: true }).press('Enter');
  await button(page, 'Add connector').click();
  const connected = (await saved(page)).city.places[place.id]!;
  expect(connected.capacity).toBe(12);
  expect(connected.connectors).toHaveLength(2);
  expect(new Set(connected.connectors.map((c) => `${c.roadId}#${c.lane}`)).size).toBe(2);
  await button(page, 'Remove').last().click();
  expect((await saved(page)).city.places[place.id]!.connectors).toHaveLength(1);
  await button(page, 'Delete place').click();
  expect((await saved(page)).city.places[place.id]).toBeUndefined();
  await button(page, 'Undo').click();
  expect((await saved(page)).city.places[place.id]).toBeDefined();
});

test('disconnected painting and cancelled gestures leave no dangling place', async ({ page }) => {
  const original = (await saved(page)).city;
  await button(page, 'Place').click();
  await stroke(page, [-180, 200], [-140, 220]);
  await expect(page.getByText('No lane within 60 m. Paint closer to a street.')).toBeVisible();
  expect((await saved(page)).city).toEqual(original);
  const start = await mapPoint(page, 60, 60);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await saved(page)).city).toEqual(original);
  await expect(button(page, 'Undo')).toBeDisabled();
});
