import { expect, test } from '@playwright/test';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { button, city, fitted, pageErrors, sampleQueues, writeMetrics } from './helpers';

test.use({
  video: { mode: 'on', size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});

type Samples = Awaited<ReturnType<typeof sampleQueues>>;
const eventStartS = 8 * 3600 + 5 * 60;
const beforeEvent = (samples: Samples) =>
  Math.max(...samples.filter(({ timeS }) => timeS <= eventStartS).map(({ queue }) => queue));
const peak = (samples: Samples) => Math.max(...samples.map(({ queue }) => queue));

// The bundled Station city stands in for the airport: a terminal-style place whose timetable
// event lands 80 arrivals in five minutes, each picked up at a curb that serves 6 cars a minute.
test('demo B, terminal access: the 08:05 arrival wave queues cars; a dedicated arrival connector lowers the peak', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'New').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Station', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Station', level: 1 })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  const source = await city(page);
  const compiled = compile(source);
  if (!compiled.ok) throw new Error('Station city must compile');
  const screen = fitted(compiled.compiled, source);
  const place = Object.values(source.places).find(({ kind }) => kind === 'station')!;
  const at = await screen(page, (place.shape as { pos: Vec2 }).pos);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('heading', { name: 'Station', level: 2 })).toBeVisible();
  await page.getByText('Events', { exact: true }).click();
  await expect(page.getByLabel('Starts at')).toHaveValue('08:05');
  await expect(page.getByLabel('Lasts (min)')).toHaveValue('5');
  await expect(page.getByLabel('Cars arriving')).toHaveValue('80');
  await page.screenshot({ path: info.outputPath('event.png') });
  await page.keyboard.press('Escape');

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  await button(page, 'Layers').click();
  await page.getByLabel('Queues', { exact: true }).check();
  await button(page, 'Layers').click();
  const without = await sampleQueues(page, 20);
  expect(beforeEvent(without)).toBeLessThanOrEqual(2);
  expect(peak(without)).toBeGreaterThan(40);
  await page.screenshot({ path: info.outputPath('queue-one-connector.png') });

  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('heading', { name: 'Station', level: 2 })).toBeVisible();
  await page.getByText('Connectors', { exact: true }).click();
  await button(page, 'Add connector').click();
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await page.getByLabel('Direction').nth(2).selectOption('in');
  const connectors = (await city(page)).places[place.id]!.connectors;
  expect(connectors).toHaveLength(3);
  expect(connectors[2]!.direction).toBe('in');
  await page.screenshot({ path: info.outputPath('arrival-connector.png') });
  await page.keyboard.press('Escape');

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const withConnector = await sampleQueues(page, 20);
  expect(beforeEvent(withConnector)).toBeLessThanOrEqual(2);
  expect(peak(withConnector)).toBeLessThan(peak(without));
  const end = await page.evaluate(() => window.cityflows!.metrics());
  expect(end.trips.failed).toBe(0);
  await page.screenshot({ path: info.outputPath('queue-two-connectors.png') });

  await writeMetrics(info, {
    demo: 'B, terminal access (bundled Station city, 08:05 arrival of 80 cars over 5 min)',
    queueBeforeEvent: {
      oneConnector: beforeEvent(without),
      twoConnectors: beforeEvent(withConnector),
    },
    peakQueue: { oneConnector: peak(without), twoConnectors: peak(withConnector) },
    queueByMinute: {
      timeS: without.map(({ timeS }) => timeS),
      oneConnector: without.map(({ queue }) => queue),
      twoConnectors: withConnector.map(({ queue }) => queue),
    },
    addedConnector: connectors[2],
    screenshots: [
      'event.png',
      'queue-one-connector.png',
      'arrival-connector.png',
      'queue-two-connectors.png',
    ],
  });
  expect(errors).toEqual([]);
});
