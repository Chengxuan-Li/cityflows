import { expect, test } from '@playwright/test';
import { button, clickGrid as click, gridPoint as point, runMorning } from './helpers';

test('demo C: draw an expressway and ramps, restart, use the bypass and reduce travel time', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const baseline = await runMorning(page);
  expect(baseline.trips.completed).toBeGreaterThan(100);
  await button(page, 'Road').click();
  await page.getByLabel('Two-way').uncheck();
  await page.getByRole('combobox', { name: 'Class', exact: true }).selectOption('motorway');
  await page.getByLabel('Lanes per direction').selectOption('2');
  // Start inside the map area: (90, -30) sits under the top bar once Export is in it.
  await click(page, 135, 15);
  await click(page, 450, 330);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await button(page, 'Ramp').click();
  const ramps = () =>
    page.evaluate(
      () =>
        Object.values(window.cityflows!.city!().roads).filter((r) => r.roadClass === 'ramp').length,
    );
  await click(page, 60, 1.5);
  const hover = await point(page, 180, 60);
  await page.mouse.move(hover.x, hover.y);
  await page.screenshot({ path: testInfo.outputPath('ramp-preview.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  expect(await ramps()).toBe(0);
  await click(page, 60, 1.5);
  await page.mouse.move(hover.x, hover.y);
  await page.keyboard.press('Enter');
  await expect.poll(ramps).toBe(1);
  await click(page, 360, 240);
  await click(page, 478.5, 250);
  await expect.poll(ramps).toBe(2);
  const built = await page.evaluate(() => window.cityflows!.city!());
  const motorwayIds = Object.values(built.roads)
    .filter((r) => r.roadClass === 'motorway')
    .map((r) => r.id);
  expect(motorwayIds.length).toBe(4);
  expect(
    Object.values(built.roads)
      .filter((r) => r.roadClass === 'motorway')
      .map((r) => r.lanes.length)
      .sort(),
  ).toEqual([2, 2, 2, 3]);
  await button(page, 'Select').click();
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const after = await runMorning(page);
  const routes = await page.evaluate(async (ids) => {
    let inspected = 0,
      expressway = 0;
    for (let id = 1; id <= 300; id++) {
      const vehicle = await window.cityflows!.inspect(id);
      if (!vehicle?.route) continue;
      inspected++;
      if (
        vehicle.route.movements.some((m) =>
          ids.some((road) => window.cityflows!.movementId(m).includes(`${road}#`)),
        )
      )
        expressway++;
    }
    return { inspected, expressway };
  }, motorwayIds);
  expect(routes.inspected).toBeGreaterThanOrEqual(100);
  expect(routes.expressway / routes.inspected).toBeGreaterThanOrEqual(0.2);
  expect(after.trips.failed).toBe(0);
  expect(after.trips.completed).toBeGreaterThanOrEqual(baseline.trips.completed);
  expect(after.meanTravelTimeS).toBeLessThan(baseline.meanTravelTimeS);
  console.log({
    baselineMeanS: baseline.meanTravelTimeS,
    bypassMeanS: after.meanTravelTimeS,
    ...routes,
  });
  await page.screenshot({ path: testInfo.outputPath('built-interchange.png') });
  expect(errors).toEqual([]);
});
