import { expect, test } from '@playwright/test';
import { button, city, metrics, pageErrors } from './helpers';

// TASK-111: test pedestrians from the demand sheet with undo, walkers drawn in 2D and 3D, and a
// phase's walk group edited in the signal inspector.
test('@smoke T53 test pedestrians walk, wait and cross; walk groups edit with undo', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();

  await button(page, 'Demand').click();
  const sheet = page.getByRole('region', { name: 'Demand' });
  await sheet.getByRole('combobox', { name: 'From', exact: true }).selectOption({ label: 'Homes' });
  await sheet.getByRole('combobox', { name: 'To', exact: true }).selectOption({ label: 'Offices' });
  await sheet.getByRole('spinbutton', { name: 'Per hour', exact: true }).fill('600');
  await button(page, 'Add pedestrians').click();
  const list = sheet.getByRole('table', { name: 'Test pedestrians' });
  await expect(list.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('status').getByText('Restart to apply changes')).toBeVisible();
  await button(page, 'Undo').click();
  await expect(list.getByRole('row')).toHaveCount(1);
  await button(page, 'Redo').click();
  await expect(list.getByRole('row')).toHaveCount(2);
  await expect(
    sheet.getByLabel('Pedestrians per hour from Homes to Offices', { exact: true }),
  ).toHaveValue('600');
  await page.keyboard.press('Escape');

  await button(page, 'Restart').click();
  await expect(button(page, 'Play')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(3000));
  const walkers = (await metrics(page)).walkers!;
  expect(walkers.spawned).toBeGreaterThan(20);
  expect(walkers.crossings.zebra + walkers.crossings.signal).toBeGreaterThan(0);
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).not.toHaveAttribute('data-walkers', '0');
  await button(page, 'Layers').click();
  const pedestrians = page
    .getByRole('region', { name: 'Map layers' })
    .getByLabel('Pedestrians', { exact: true });
  await expect(pedestrians).toBeChecked();
  await button(page, 'Layers').click();

  // A walker opens its inspector.
  const snapshot = await page.evaluate(() => window.cityflows!.drawnSnapshot!()!.walkers!);
  // A test-source walker: TASK-113's walking persons open the person view instead.
  const source = Array.from(snapshot.tripLeg.subarray(0, snapshot.count)).indexOf(0);
  const point = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), {
    x: snapshot.x[source]!,
    y: snapshot.y[source]!,
  });
  await map.click({ position: point });
  await expect(page.getByRole('heading', { name: /^Pedestrian \d+$/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // The signal's first phase: switch a crossing's walk green off, apply, undo.
  const before = await city(page);
  const nodeId = Object.values(before.nodes).find((n) => n.signal)!.id;
  const centre = await page.evaluate(
    (id) => window.cityflows!.worldToScreen!(window.cityflows!.city!().nodes[id]!.pos),
    nodeId,
  );
  await map.click({ position: centre });
  await page.getByText('Signal phases', { exact: true }).click();
  await page.getByText('Phase 1 road pairs', { exact: true }).click();
  // Derived: every arm but the one served in phase 1 has walk green; switch one of them off.
  const walk = page
    .getByRole('listitem')
    .getByRole('checkbox', { name: /^Phase 1 crossing /, checked: true })
    .first();
  await walk.click();
  await button(page, 'Apply signal program').click();
  await expect
    .poll(async () => (await city(page)).nodes[nodeId]!.signal!.phases[0]!.walk?.length)
    .toBe(2);
  await button(page, 'Undo').click();
  await expect
    .poll(async () => (await city(page)).nodes[nodeId]!.signal!.phases[0]!.walk)
    .toBeUndefined();

  // 3D draws the walkers as instances.
  await button(page, '3D').click();
  await expect(page.getByLabel('3D city view', { exact: true })).not.toHaveAttribute(
    'data-walkers',
    '0',
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
});
