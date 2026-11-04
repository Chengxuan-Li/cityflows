import { expect, test } from '@playwright/test';
import { button, buildBypass, city, pageErrors, runMorning, writeMetrics } from './helpers';

test.use({
  video: { mode: 'on', size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});

test('demo C, bypass: an expressway with ramps carries a share of the commute and cuts mean travel time', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const baseline = await runMorning(page);
  expect(baseline.trips.completed).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath('baseline.png') });

  await buildBypass(page);
  const built = await city(page);
  const motorways = Object.values(built.roads).filter(({ roadClass }) => roadClass === 'motorway');
  const ramps = Object.values(built.roads).filter(({ roadClass }) => roadClass === 'ramp');
  expect(motorways).toHaveLength(4);
  expect(ramps).toHaveLength(2);
  expect(motorways.filter(({ lanes }) => lanes.length === 3)).toHaveLength(1);
  expect(motorways.filter(({ lanes }) => lanes.length === 2)).toHaveLength(3);
  await page.screenshot({ path: info.outputPath('interchange.png') });

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const after = await runMorning(page);
  const routes = await page.evaluate(
    async (ids) => {
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
    },
    motorways.map(({ id }) => id),
  );
  expect(routes.inspected).toBeGreaterThanOrEqual(100);
  expect(routes.expressway / routes.inspected).toBeGreaterThanOrEqual(0.2);
  expect(after.trips.failed).toBe(0);
  expect(after.trips.completed).toBeGreaterThanOrEqual(baseline.trips.completed);
  expect(after.meanTravelTimeS).toBeLessThan(baseline.meanTravelTimeS);

  // A selected car on the expressway shows its route; then a few seconds of motion for the
  // recording.
  await button(page, 'Layers').click();
  await page.getByLabel('Road speeds', { exact: true }).check();
  await button(page, 'Layers').click();
  await page.screenshot({ path: info.outputPath('bypass-0900.png') });
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('5');
  await button(page, 'Play').click();
  await page.waitForTimeout(4000);
  await button(page, 'Pause').click();

  await writeMetrics(info, {
    demo: 'C, bypass (5 × 5 grid, 07:00 to 09:00)',
    expresswayRoads: motorways.map(({ id }) => id),
    rampRoads: ramps.map(({ id }) => id),
    routesInspected: routes.inspected,
    routesUsingExpressway: routes.expressway,
    expresswayShare: routes.expressway / routes.inspected,
    meanTravelTimeS: { baseline: baseline.meanTravelTimeS, bypass: after.meanTravelTimeS },
    completed: { baseline: baseline.trips.completed, bypass: after.trips.completed },
    failed: { baseline: baseline.trips.failed, bypass: after.trips.failed },
    screenshots: ['baseline.png', 'interchange.png', 'bypass-0900.png'],
  });
  expect(errors).toEqual([]);
});
