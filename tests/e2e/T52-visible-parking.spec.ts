import { expect, test } from '@playwright/test';
import { compile } from '../../src/network';
import { button, city, clickWorld, pageErrors } from './helpers';

test('T52 edit a roadside strip, undo, and select parked cars in both views @smoke', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const original = await city(page);
  const road = Object.values(original.roads).find(
    (road) =>
      road.from !== road.to &&
      road.centerline[0]!.x === 120 &&
      road.centerline[0]!.y === 0 &&
      road.centerline.at(-1)!.x === 240 &&
      road.centerline.at(-1)!.y === 0,
  )!;
  expect(road).toBeDefined();
  await clickWorld(page, { x: 180, y: 0 });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByText('Roadside parking', { exact: true }).click();
  const layout = inspector.getByRole('combobox', { name: 'Right parking layout', exact: true });
  await expect(layout).toHaveValue('none');
  await layout.selectOption('parallel');
  const runs = () =>
    city(page).then((city) =>
      Object.values(city.parking!).filter(
        (p) => p.strip?.roadId === road.id && p.strip.side === 'right',
      ),
    );
  await expect.poll(async () => (await runs()).length).toBeGreaterThan(0);
  const added = await runs();
  const capacity = added.reduce((sum, p) => sum + p.capacity, 0);
  await expect(inspector.getByRole('group', { name: 'Right roadside parking' })).toContainText(
    `${capacity} spaces`,
  );
  await layout.selectOption('perpendicular');
  await expect
    .poll(async () => (await runs()).reduce((sum, p) => sum + p.capacity, 0))
    .toBeGreaterThan(capacity);
  await button(page, 'Undo').click();
  await expect.poll(runs).toEqual(added);
  await inspector
    .getByRole('combobox', { name: 'Right parking access', exact: true })
    .selectOption('private');
  await expect.poll(async () => (await runs())[0]?.access).toBe('private');
  await button(page, 'Undo').click();
  await expect.poll(runs).toEqual(added);
  await layout.selectOption('none');
  await expect.poll(runs).toEqual([]);
  await button(page, 'Undo').click();
  await expect.poll(runs).toEqual(added);
  await button(page, 'Close inspector').click();
  await button(page, 'Restart').click();
  await expect(button(page, 'Play')).toBeEnabled();
  const edited = await city(page);
  const compiled = compile(edited);
  if (!compiled.ok) throw new Error('Edited parking city failed to compile');
  const slot = compiled.compiled.parkingSpaces!.find(
    (slot) => compiled.compiled.parking[slot.parking]!.source.strip?.roadId === road.id,
  )!;
  expect(slot).toBeDefined();
  const map = page.getByLabel('City map', { exact: true });
  await expect
    .poll(async () => Number(await map.getAttribute('data-parked-cars')))
    .toBeGreaterThan(0);
  await clickWorld(page, slot.position);
  await expect(inspector.getByRole('heading', { name: /^Parked vehicle / })).toBeVisible();
  await expect(inspector.locator('dt', { hasText: /^Class$/ }).locator('+ dd')).toHaveText(
    /car|van/,
  );
  await map.screenshot({ path: info.outputPath('parking-2d.png') });
  await button(page, 'Close inspector').click();
  await button(page, 'Layers').click();
  const toggle = page
    .getByRole('region', { name: 'Map layers' })
    .getByLabel('Parked cars', { exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(map).toHaveAttribute('data-parked-cars', '0');
  await toggle.check();
  await button(page, 'Layers').click();
  await button(page, '3D').click();
  const map3d = page.getByLabel('3D city view', { exact: true });
  await expect
    .poll(async () => Number(await map3d.getAttribute('data-parked-cars')))
    .toBeGreaterThan(0);
  const position = await page.evaluate(
    (point) => window.cityflows!.worldToScreen!(point),
    slot.position,
  );
  await map3d.click({ position });
  await expect(inspector.getByRole('heading', { name: /^Parked vehicle / })).toBeVisible();
  await map3d.screenshot({ path: info.outputPath('parking-3d.png') });
  await button(page, 'Layers').click();
  await toggle.uncheck();
  await expect(map3d).toHaveAttribute('data-parked-cars', '0');
  expect(await city(page)).toEqual(edited);
  expect(errors).toEqual([]);
});
