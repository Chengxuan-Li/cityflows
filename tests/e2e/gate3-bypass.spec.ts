import { expect, test, type Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function point(page: Page, x: number, y: number) {
  const bounds = (await page.getByLabel('City map').boundingBox())!;
  const scale = (bounds.height - 144) / 510;
  return {
    x: bounds.x + bounds.width / 2 + (x - 240) * scale,
    y: bounds.y + bounds.height / 2 + (y - 240) * scale,
  };
}
async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function runMorning(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) await window.cityflows!.step(6000);
  });
  return page.evaluate(() => window.cityflows!.metrics());
}

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
  await click(page, 90, -30);
  await click(page, 450, 330);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
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
  await click(page, 478.5, 300);
  await expect.poll(ramps).toBe(2);
  const built = await page.evaluate(() => window.cityflows!.city!());
  const motorwayIds = Object.values(built.roads)
    .filter((r) => r.roadClass === 'motorway')
    .map((r) => r.id);
  expect(motorwayIds.length).toBe(3);
  expect(
    Object.values(built.roads)
      .filter((r) => r.roadClass === 'motorway')
      .every((r) => r.lanes.length === 2),
  ).toBe(true);
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
