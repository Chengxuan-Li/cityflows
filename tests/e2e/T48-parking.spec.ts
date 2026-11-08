import { expect, test } from '@playwright/test';
import { button, city, clickWorld, metrics, pageErrors } from './helpers';

test('T48 garage occupancy, editable capacity and access, and both views @smoke', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const source = await city(page);
  const garage = Object.values(source.parking!).find((facility) => facility.name === 'Homes')!;
  expect(garage).toBeDefined();
  const point = garage.shape!.kind === 'point' ? garage.shape!.pos : { x: 15, y: -15 };
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  await layers.getByLabel('Parking occupancy', { exact: true }).check();
  await button(page, 'Layers').click();
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-parking-facilities', '2');
  await clickWorld(page, point);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const occupancy = inspector.locator('dt', { hasText: /^Occupancy now$/ }).locator('+ dd');
  await expect(occupancy).toHaveText(/\d+ \/ \d+/);
  const glyph = async (view = map) => {
    const screen = await page.evaluate((point) => window.cityflows!.worldToScreen!(point), point);
    const box = (await view.boundingBox())!;
    return page.screenshot({
      clip: {
        x: Math.round(box.x + screen.x - 2),
        y: Math.round(box.y + screen.y - 2),
        width: 4,
        height: 4,
      },
    });
  };
  const full = await glyph();
  const capacity = inspector.getByRole('spinbutton', { name: 'Parking capacity', exact: true });
  await capacity.fill(String(garage.capacity * 2));
  await capacity.press('Enter');
  await expect
    .poll(async () => (await city(page)).parking![garage.id]!.capacity)
    .toBe(garage.capacity * 2);
  await expect.poll(async () => (await glyph()).equals(full)).toBe(false);
  await inspector
    .getByRole('combobox', { name: 'Parking access', exact: true })
    .selectOption('public');
  await expect.poll(async () => (await city(page)).parking![garage.id]!.access).toBe('public');
  await button(page, 'Undo').click();
  await expect(
    inspector.getByRole('combobox', { name: 'Parking access', exact: true }),
  ).toHaveValue(garage.access);
  await button(page, 'Undo').click();
  await expect(capacity).toHaveValue(String(garage.capacity));
  await map.screenshot({ path: info.outputPath('parking-2d.png') });
  await button(page, '3D').click();
  const map3D = page.getByLabel('3D city view', { exact: true });
  await expect(map3D).toHaveAttribute('data-parking-facilities', '2');
  await expect(capacity).toBeDisabled();
  await button(page, 'Close inspector').click();
  const screen = await page.evaluate((point) => window.cityflows!.worldToScreen!(point), point);
  await map3D.click({ position: screen });
  await expect(occupancy).toHaveText(/\d+ \/ \d+/);
  await map3D.screenshot({ path: info.outputPath('parking-3d.png') });
  const full3D = await glyph(map3D);
  await button(page, 'Layers').click();
  await layers.getByLabel('Parking occupancy', { exact: true }).uncheck();
  await button(page, 'Layers').click();
  await expect(map3D).toHaveAttribute('data-parking-facilities', '0');
  await expect.poll(async () => (await glyph(map3D)).equals(full3D)).toBe(false);
  await button(page, '3D').click();
  await page.evaluate(() => window.cityflows!.step(600));
  await button(page, 'Chart').click();
  const chart = page.getByRole('region', { name: 'Traffic over time' });
  await expect(chart.getByLabel('Parking metrics')).toBeVisible();
  await expect(
    chart.getByRole('img', { name: 'Parking occupancy over simulated time' }),
  ).toBeVisible();
  expect((await metrics(page)).parking.facilities).toHaveLength(2);
  expect(errors).toEqual([]);
});
