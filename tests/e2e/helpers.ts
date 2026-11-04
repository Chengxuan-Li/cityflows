import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Vec2 } from '../../src/geo/vec2';
import type { CompiledCity } from '../../src/network';
import type { City } from '../../src/schema';

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const metrics = (page: Page) => page.evaluate(() => window.cityflows!.metrics());
export const city = (page: Page) => page.evaluate(() => window.cityflows!.city!());
export const stateHash = (page: Page) => page.evaluate(() => window.cityflows!.hash());

/** Collects uncaught page errors; assert the array is empty at the end of a scenario. */
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The map fits the city with a 72 px margin on load (see fitCity in map-view.tsx). */
export function fitted(compiled: CompiledCity, source: City) {
  const points = [
    ...compiled.roads.flatMap(({ surface }) => surface),
    ...compiled.nodes.map(({ pos }) => pos),
    ...Object.values(source.places).flatMap(({ shape }) =>
      shape.kind === 'polygon' ? shape.ring : [shape.pos],
    ),
  ];
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  return async (page: Page, world: Vec2) => {
    const box = (await page.getByLabel('City map').boundingBox())!;
    const scale = Math.min(
      32,
      (box.width - 144) / (bounds.maxX - bounds.minX),
      (box.height - 144) / (bounds.maxY - bounds.minY),
    );
    return {
      x: box.x + world.x * scale + (box.width - (bounds.minX + bounds.maxX) * scale) / 2,
      y: box.y + world.y * scale + (box.height - (bounds.minY + bounds.maxY) * scale) / 2,
    };
  };
}

/** Grid places: Homes sits at (15, −15), Offices at (465, 495); the map centers on (240, 240). */
export async function gridPoint(page: Page, x: number, y: number) {
  const box = (await page.getByLabel('City map').boundingBox())!;
  const scale = (box.height - 144) / 510;
  return {
    x: box.x + box.width / 2 + (x - 240) * scale,
    y: box.y + box.height / 2 + (y - 240) * scale,
  };
}

export async function clickGrid(page: Page, x: number, y: number) {
  const p = await gridPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

export async function setRange(page: Page, name: string, value: string) {
  const slider = page.getByRole('slider', { name, exact: true });
  await slider.fill(value);
  await slider.blur();
}

export const tripsByHour = (page: Page) =>
  page
    .getByRole('region', { name: 'Demand' })
    .locator('[data-hour]')
    .evaluateAll((bars) => bars.map((bar) => Number((bar as HTMLElement).dataset.trips)));

/** Steps a simulated minute at a time and records queued trips at origins and destinations. */
export const sampleQueues = (page: Page, minutes: number) =>
  page.evaluate(async (minutes) => {
    const samples: { timeS: number; queue: number }[] = [];
    for (let i = 0; i < minutes; i++) {
      await window.cityflows!.step(600);
      const { timeS, trips } = await window.cityflows!.metrics();
      samples.push({ timeS, queue: trips.queuedOrigin + trips.queuedDestination });
    }
    return samples;
  }, minutes);

/** Two simulated hours in 10-minute steps. */
export async function runMorning(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) await window.cityflows!.step(6000);
  });
  return metrics(page);
}

/** Draws the one-way two-lane expressway across the grid and its two ramps (demo C). */
export async function buildBypass(page: Page) {
  await button(page, 'Road').click();
  await page.getByLabel('Two-way').uncheck();
  await page.getByRole('combobox', { name: 'Class', exact: true }).selectOption('motorway');
  await page.getByLabel('Lanes per direction').selectOption('2');
  await clickGrid(page, 135, 15);
  await clickGrid(page, 450, 330);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  await button(page, 'Ramp').click();
  await clickGrid(page, 60, 1.5);
  const hover = await gridPoint(page, 180, 60);
  await page.mouse.move(hover.x, hover.y);
  await page.keyboard.press('Enter');
  await clickGrid(page, 360, 240);
  // Leave 60 m for the taper and 50 m to change lanes before the grid's next lane drop.
  await clickGrid(page, 478.5, 250);
  await button(page, 'Select').click();
}

/** Writes the numbers that prove a demo next to its video and attaches them to the report. */
export async function writeMetrics(info: TestInfo, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  await writeFile(info.outputPath('metrics.json'), body);
  await info.attach('metrics', { body, contentType: 'application/json' });
}
