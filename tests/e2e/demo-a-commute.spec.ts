import { expect, test } from '@playwright/test';
import {
  button,
  gridPoint,
  metrics,
  pageErrors,
  setRange,
  tripsByHour,
  writeMetrics,
} from './helpers';

test.use({
  video: { mode: 'on', size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});

/** Road speed ratios at the current time: how many roads run below half their free speed. */
const slowRoads = (page: Parameters<typeof metrics>[0]) =>
  page.evaluate(async () => {
    const ratios = Array.from((await window.cityflows!.metrics()).roadSpeedRatio);
    return {
      roads: ratios.length,
      belowHalfSpeed: ratios.filter((ratio) => ratio < 0.5).length,
      slowest: Math.min(...ratios),
    };
  });

test('demo A, morning commute: 2 000 residents drive to the offices at 08:00 and home in the evening', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const homes = await gridPoint(page, 15, -15);
  await page.mouse.click(homes.x, homes.y);
  await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
  await setRange(page, 'Population', '2000');
  await expect(page.getByLabel('Place demand')).toContainText('2000 residents');

  await button(page, 'Demand').click();
  const panel = page.getByRole('region', { name: 'Demand' });
  await panel.getByLabel('Demand seed').fill('1');
  await button(page, 'Regenerate demand').click();
  await expect(panel).toContainText('2,000 persons, 2,000 with a car · 4,000 trips');
  const trips = await tripsByHour(page);
  expect(trips.reduce((sum, count) => sum + count, 0)).toBe(4000);
  const peakHour = trips.indexOf(Math.max(...trips));
  const morning = trips[7]! + trips[8]!;
  const evening = trips[16]! + trips[17]! + trips[18]!;
  expect([7, 8]).toContain(peakHour);
  expect(morning).toBeGreaterThan(evening);
  expect(evening).toBeGreaterThan(trips[12]! * 4);
  await page.screenshot({ path: info.outputPath('trips-by-hour.png') });
  await button(page, 'Demand').click();
  await page.keyboard.press('Escape');

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(36000));
  const at8 = await metrics(page);
  expect(at8.timeS).toBeCloseTo(8 * 3600, 3);
  // The Homes exit, not demand, sets the flow (see gate3-places): cars on the road and a long
  // queue waiting to leave at the peak.
  expect(at8.trips.driving).toBeGreaterThanOrEqual(10);
  expect(at8.trips.queuedOrigin).toBeGreaterThan(100);
  const slowAt8 = await slowRoads(page);
  expect(slowAt8.belowHalfSpeed).toBeGreaterThan(0);
  await button(page, 'Layers').click();
  const heat = page.getByLabel('Road speeds', { exact: true });
  await heat.check();
  await page.getByLabel('Queues', { exact: true }).check();
  await expect(page.getByText('Darker roads are slower')).toBeVisible();
  await button(page, 'Layers').click();
  await page.screenshot({ path: info.outputPath('heat-0800.png') });

  // On to the evening return: everyone who left in the morning has arrived and the homeward
  // trips have started.
  await page.evaluate(() => window.cityflows!.step(342000));
  const at1730 = await metrics(page);
  expect(at1730.timeS).toBeCloseTo(17.5 * 3600, 3);
  expect(at1730.trips.completed).toBeGreaterThan(at8.trips.completed + 1500);
  expect(at1730.trips.failed).toBe(0);
  await page.screenshot({ path: info.outputPath('heat-1730.png') });

  // A few wall-clock seconds of motion for the recording; numbers above are already taken.
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('5');
  await button(page, 'Play').click();
  await page.waitForTimeout(4000);
  await button(page, 'Pause').click();

  await writeMetrics(info, {
    demo: 'A, morning commute',
    city: '5 × 5 grid, Homes population 2 000, demand seed 1',
    tripsByHour: trips,
    peakHour,
    tripsMorning0700to0900: morning,
    tripsEvening1600to1900: evening,
    at0800: { ...at8.trips, meanTravelTimeS: at8.meanTravelTimeS, ...slowAt8 },
    at1730: { ...at1730.trips, meanTravelTimeS: at1730.meanTravelTimeS },
    screenshots: ['trips-by-hour.png', 'heat-0800.png', 'heat-1730.png'],
  });
  expect(errors).toEqual([]);
});
