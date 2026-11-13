import { expect, test } from '@playwright/test';
import type { Vec2 } from '../../src/geo/vec2';
import { station } from '../../src/fixtures/station';
import { compile } from '../../src/network';
import {
  button,
  city,
  clickVehicle,
  fitted,
  gridPoint,
  metrics,
  sampleQueues,
  setRange,
  tripsByHour,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('demo A: 2 000 residents set in the inspector give a morning peak in the demand panel and on the road @smoke', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const homes = await gridPoint(page, 15, -15);
  await page.mouse.click(homes.x, homes.y);
  await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
  await setRange(page, 'Population', '2000');
  await expect(page.getByLabel('Place demand')).toContainText('2000 residents');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();

  await button(page, 'Demand').click();
  const panel = page.getByRole('region', { name: 'Demand' });
  await expect(panel).toContainText('1,088 persons');
  await panel.getByLabel('Demand seed').fill('1');
  await button(page, 'Regenerate demand').click();
  await expect(panel).toContainText('2,000 persons, 2,000 with a car · 4,000 trips');
  await expect(panel.getByRole('row', { name: /^Homes/ })).toContainText('2,000');
  const trips = await tripsByHour(page);
  expect(trips).toHaveLength(24);
  expect(trips.reduce((sum, count) => sum + count, 0)).toBe(4000);
  // Work starts at 08:00 ± 30 min, so the busiest hours are 07:00 and 08:00 and together they
  // carry more trips than the whole evening return (16:00–18:00), which is spread by a wider
  // work-duration spread.
  const peak = trips.indexOf(Math.max(...trips));
  expect([7, 8]).toContain(peak);
  expect(trips[7]! + trips[8]!).toBeGreaterThan(trips[16]! + trips[17]! + trips[18]!);
  for (const hour of [0, 3, 6, 10, 12, 21, 23]) expect(trips[hour]).toBeLessThan(trips[peak]! / 4);
  await page.screenshot({ path: info.outputPath('demand-panel.png') });

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(36000));
  const at8 = await metrics(page);
  expect(at8.timeS).toBeCloseTo(8 * 3600, 3);
  // Homes has a single exit on a residential street and the junction right after it lets
  // through about one car every four seconds, so the exit, not demand, sets the flow: roughly
  // 15 cars a minute leave and the commute to Offices takes about 90 s, which keeps around 20
  // cars on the road through the peak (measured 22 for this seed). 10 is half that: it fails
  // if the regenerated population is not driving or the exit stalls, and passes while the
  // junction behaves as it does today.
  expect(at8.trips.driving).toBeGreaterThanOrEqual(10);
  expect(at8.trips.queuedOrigin).toBeGreaterThan(100);
  await expect(panel.getByLabel('Last run')).toContainText('through 08:00');
  await expect(panel.getByLabel('Last run').locator('dd').nth(1)).toHaveText(
    at8.trips.queuedOrigin.toLocaleString('en-US'),
  );
  await page.screenshot({ path: info.outputPath('demand-panel-0800.png') });
  expect(errors).toEqual([]);
});

test('demo B: the 08:05 train queues cars at the Station; a second arrival connector lowers the peak', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await button(page, 'New').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Station', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Station', level: 1 })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  const source = station(1);
  const compiled = compile(source);
  if (!compiled.ok) throw new Error('Station fixture must compile');
  const screen = fitted(compiled.compiled, source);
  const place = Object.values(source.places).find(({ kind }) => kind === 'station')!;
  const at = await screen(page, (place.shape as { pos: Vec2 }).pos);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('heading', { name: 'Station', level: 2 })).toBeVisible();
  await page.getByText('Events', { exact: true }).click();
  await expect(page.getByLabel('Name')).toHaveValue('08:05 train');
  await expect(page.getByLabel('Starts at')).toHaveValue('08:05');
  await expect(page.getByLabel('Lasts (min)')).toHaveValue('5');
  await expect(page.getByLabel('Cars arriving')).toHaveValue('80');
  await page.screenshot({ path: info.outputPath('event-list.png') });

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const first = await sampleQueues(page, 8);
  const before = (samples: typeof first) =>
    Math.max(
      ...samples.filter(({ timeS }) => timeS <= 8 * 3600 + 5 * 60).map(({ queue }) => queue),
    );
  const peak = (samples: typeof first) => Math.max(...samples.map(({ queue }) => queue));
  // Only through traffic before the train; afterwards 80 pickups meet a 6 car/min curb and
  // 80 departures wait for their pickups, so the queue climbs past 40 within ten minutes.
  expect(before(first)).toBeLessThanOrEqual(2);

  // A car at the head of the pickup queue explains its wait in the inspector.
  const queued = await page.evaluate(async () => {
    for (let id = 1; id <= 600; id++) {
      const detail = await window.cityflows!.inspect(id);
      if (detail?.state === 'queued_destination') return detail;
    }
    return null;
  });
  expect(queued).not.toBeNull();
  await clickVehicle(page, queued!.id);
  await expect(page.getByText('Waiting because', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText(
    /Waiting for space at the destination|Waiting to enter at the origin|Yielding at a junction|Stopped at a signal/,
  );
  await page.screenshot({ path: info.outputPath('vehicle-waiting.png') });
  first.push(...(await sampleQueues(page, 12)));
  expect(peak(first)).toBeGreaterThan(40);

  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('heading', { name: 'Station', level: 2 })).toBeVisible();
  await page.getByText('Connectors', { exact: true }).click();
  await button(page, 'Add connector').click();
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  let connectors = (await city(page)).places[place.id]!.connectors;
  expect(connectors).toHaveLength(3);
  // The pickup loop is the only lane within reach and both existing connectors sit on it, so
  // the new one lands further along the same curb.
  expect(connectors[2]).toMatchObject({
    roadId: connectors[0]!.roadId,
    lane: 0,
    direction: 'both',
  });
  for (const existing of connectors.slice(0, 2))
    expect(Math.abs(connectors[2]!.positionM - existing.positionM)).toBeGreaterThanOrEqual(15);
  await page.getByLabel('Direction').nth(2).selectOption('in');
  connectors = (await city(page)).places[place.id]!.connectors;
  expect(connectors[2]!.direction).toBe('in');
  await page.screenshot({ path: info.outputPath('station-connectors.png') });
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const second = await sampleQueues(page, 20);
  expect(before(second)).toBeLessThanOrEqual(2);
  expect(peak(second)).toBeLessThan(peak(first));
  expect(errors).toEqual([]);
});

test('profile and event editors commit through the inspector and move trips', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const homes = await gridPoint(page, 15, -15);
  await page.mouse.click(homes.x, homes.y);
  await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
  await page.getByText('Hourly profile', { exact: true }).click();
  await button(page, 'Add profile').click();
  let profile = (await city(page)).places['p:104']!.profile!;
  expect(profile.departures[8]).toBe(8);
  expect(profile.arrivals[17]).toBe(8);
  expect(profile.departures[12]).toBe(0);
  // Drag the 12:00 departures bar up to 70 % of the scale (10): the weight becomes 7.
  const row = (await page.getByLabel('Departures by hour').boundingBox())!;
  const x = row.x + (row.width * 12.5) / 24;
  await page.mouse.move(x, row.y + (row.height * 54) / 64);
  await page.mouse.down();
  await page.mouse.move(x, row.y + (row.height * (54 - 0.7 * 48)) / 64, { steps: 4 });
  await page.mouse.up();
  profile = (await city(page)).places['p:104']!.profile!;
  expect(profile.departures[12]).toBe(7);
  const bar = page.getByRole('slider', { name: 'Arrivals 17:00', exact: true });
  await expect(bar).toHaveAttribute('aria-valuenow', '8');
  await bar.focus();
  await bar.press('ArrowUp');
  await expect(bar).toHaveAttribute('aria-valuenow', '9');
  expect((await city(page)).places['p:104']!.profile!.arrivals[17]).toBe(9);
  await page.screenshot({ path: info.outputPath('profile-editor.png') });
  await button(page, 'Demand').click();
  await expect(page.getByRole('region', { name: 'Demand' })).toBeVisible();
  expect((await tripsByHour(page))[12]).toBe(0);
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const weighted = await tripsByHour(page);
  expect(weighted[12]).toBeGreaterThan(100);
  await button(page, 'Use default timing').click();
  expect((await city(page)).places['p:104']!.profile).toBeNull();
  await button(page, 'Undo').click();
  expect((await city(page)).places['p:104']!.profile!.arrivals[17]).toBe(9);

  await button(page, 'Demand').click();
  const offices = await gridPoint(page, 465, 495);
  await page.mouse.click(offices.x, offices.y);
  await expect(page.getByRole('heading', { name: 'Offices' })).toBeVisible();
  await page.getByText('Events', { exact: true }).click();
  await button(page, 'Add event').click();
  let events = (await city(page)).places['p:107']!.events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    startS: 8 * 3600,
    durationS: 1800,
    arrivals: 50,
    departures: 50,
  });
  await page.getByLabel('Name').fill('Market');
  await page.getByLabel('Name').press('Enter');
  await page.getByLabel('Starts at').fill('12:30');
  await page.getByLabel('Starts at').press('Enter');
  await page.getByLabel('Lasts (min)').fill('20');
  await page.getByLabel('Lasts (min)').press('Enter');
  await page.getByLabel('Cars arriving').fill('40');
  await page.getByLabel('Cars arriving').press('Enter');
  await page.getByLabel('Cars leaving').fill('0');
  await page.getByLabel('Cars leaving').press('Enter');
  events = (await city(page)).places['p:107']!.events;
  expect(events[0]).toEqual({
    id: 'p:107:event-1',
    name: 'Market',
    startS: 12 * 3600 + 30 * 60,
    durationS: 1200,
    arrivals: 40,
    departures: 0,
  });
  await page.screenshot({ path: info.outputPath('event-list-grid.png') });
  await button(page, 'Demand').click();
  const ending = page
    .getByRole('region', { name: 'Demand' })
    .getByRole('row', { name: /^Offices/ });
  await expect(ending).toContainText('1,088');
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await expect(ending).toContainText('1,128');
  expect((await tripsByHour(page))[12]).toBe(weighted[12]! + 40);
  await button(page, 'Remove event').click();
  expect((await city(page)).places['p:107']!.events).toEqual([]);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`place inspector buttons are clickable with Demand open at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const homes = await gridPoint(page, 15, -15);
    await page.mouse.click(homes.x, homes.y);
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector.getByRole('heading', { name: 'Homes' })).toBeVisible();
    await inspector.getByText('Hourly profile', { exact: true }).click();
    await button(page, 'Add profile').click();
    await inspector.getByText('Events', { exact: true }).click();
    await button(page, 'Add event').click();
    await inspector.getByText('Connectors', { exact: true }).click();
    await expect(button(page, 'Restart')).toBeEnabled();

    await button(page, 'Demand').click();
    await expect(page.getByRole('region', { name: 'Demand' })).toBeVisible();
    await expect(button(page, 'Use default timing')).toBeEnabled();
    await expect(button(page, 'Remove event')).toBeEnabled();
    // A disabled action (e.g. moving a connector already at the nearest lane) cannot be clicked.
    for (const action of await inspector.getByRole('button', { disabled: false }).all()) {
      await action.click({ trial: true, timeout: 3000 });
    }
  });
}
