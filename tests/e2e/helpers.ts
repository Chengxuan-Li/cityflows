import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Vec2 } from '../../src/geo/vec2';
import type { CompiledCity } from '../../src/network';
import type { City } from '../../src/schema';

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const metrics = (page: Page) => page.evaluate(() => window.cityflows!.metrics());

// Read playback progress without cloning every trip's metrics through the busy worker.
export async function clockTimeS(page: Page) {
  const [hours, minutes, seconds] = (
    await page.getByLabel('Simulation clock', { exact: true }).innerText()
  )
    .split(':')
    .map(Number);
  return hours! * 3600 + minutes! * 60 + seconds!;
}

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

/** Advance a paused run until this driver's access walk and origin queue have cleared. */
export async function departVehicle(page: Page, id: number) {
  await page.evaluate(async (id) => {
    const api = window.cityflows!;
    for (let step = 0; step < 600; step++) {
      const detail = await api.inspect(id);
      if (detail?.state === 'driving') return;
      if (detail?.state === 'failed' || detail?.state === 'completed')
        throw new Error(`Vehicle ${id} ended before departure could be observed`);
      await api.step(10);
    }
    throw new Error(`Vehicle ${id} did not depart within ten simulated minutes`);
  }, id);
}

/** TASK-113: every person with a free household car drives, as before mode choice, for specs
 * about car traffic on the default city. Turns the demand sheet's mode choice off and restarts. */
export async function driveEveryone(page: Page) {
  await button(page, 'Demand').click();
  const toggle = page
    .getByRole('region', { name: 'Demand', exact: true })
    .getByRole('checkbox', { name: 'Choose walk or car per trip', exact: true });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press('Escape');
  await button(page, 'Restart').click();
  await expect(button(page, 'Play')).toBeEnabled();
}

/** Picks an exposed part of a road without selecting a vehicle or pedestrian over it. */
export async function clickClearMapPoint(page: Page, points: Vec2[]) {
  const timeS = (await metrics(page)).timeS;
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(timeS);
  const point = await page.evaluate((points) => {
    const api = window.cityflows!;
    const snapshot = api.drawnSnapshot!()!;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="City map"]')!;
    const bounds = canvas.getBoundingClientRect();
    for (const point of points) {
      const screen = api.worldToScreen!(point);
      if (document.elementFromPoint(bounds.left + screen.x, bounds.top + screen.y) !== canvas)
        continue;
      const overlaps = [snapshot, snapshot.walkers].some((agents) => {
        if (!agents) return false;
        for (let i = 0; i < agents.count; i++) {
          const agent = api.worldToScreen!({ x: agents.x[i]!, y: agents.y[i]! });
          if (Math.hypot(agent.x - screen.x, agent.y - screen.y) < 16) return true;
        }
        return false;
      });
      if (!overlaps) return screen;
    }
    return null;
  }, points);
  expect(point, 'an exposed map point clear of vehicles and pedestrians').not.toBeNull();
  await page.getByLabel('City map', { exact: true }).click({ position: point! });
}

/** Picks from the paused renderer snapshot through the map's real pointer path. */
export async function clickVehicle(page: Page, id: number) {
  if (await button(page, 'Pause').isEnabled()) await button(page, 'Pause').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const timeS = (await metrics(page)).timeS;
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(timeS);

  const heading = page.getByRole('heading', { name: `Vehicle ${id}`, exact: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const point = await page.evaluate((id) => {
      const api = window.cityflows!;
      const snapshot = api.drawnSnapshot!();
      const index = snapshot?.id.subarray(0, snapshot.count).indexOf(id) ?? -1;
      if (!snapshot || index < 0) throw new Error(`Vehicle ${id} is not in the drawn snapshot`);
      return api.worldToScreen!({ x: snapshot.x[index]!, y: snapshot.y[index]! });
    }, id);
    await page.getByLabel('City map').click({ position: point });
    try {
      await expect(heading).toBeVisible({ timeout: 1000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
  }
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
  const ramps = () =>
    city(page).then(
      (source) => Object.values(source.roads).filter((r) => r.roadClass === 'ramp').length,
    );
  const drawn = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await button(page, 'Road').click();
  await page.getByLabel('Two-way').uncheck();
  await page.getByRole('combobox', { name: 'Class', exact: true }).selectOption('motorway');
  await page.getByLabel('Lanes per direction').selectOption('2');
  await clickGrid(page, 135, 15);
  await clickGrid(page, 450, 330);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await drawn();
  await button(page, 'Ramp').click();
  await clickGrid(page, 60, 1.5);
  const hover = await gridPoint(page, 180, 60);
  await page.mouse.move(hover.x, hover.y);
  await page.keyboard.press('Enter');
  await expect.poll(ramps).toBe(1);
  await expect(button(page, 'Ramp')).toBeEnabled();
  await drawn();
  await clickGrid(page, 360, 240);
  // Leave 60 m for the taper and 50 m to change lanes before the grid's next lane drop.
  await clickGrid(page, 478.5, 250);
  await expect.poll(ramps).toBe(2);
  await button(page, 'Select').click();
}

/** Writes the numbers that prove a demo next to its video and attaches them to the report. */
export async function writeMetrics(info: TestInfo, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  await writeFile(info.outputPath('metrics.json'), body);
  await info.attach('metrics', { body, contentType: 'application/json' });
}

export async function importOsm(
  page: Page,
  path: string,
  options: { surroundings?: boolean; terrain?: boolean } = {},
) {
  await button(page, 'Import').click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await dialog.getByLabel('OSM file').setInputFiles(path);
  if (options.surroundings !== undefined)
    await dialog.getByLabel('Include surroundings').setChecked(options.surroundings);
  if (options.terrain !== undefined)
    await dialog.getByLabel('Include terrain').setChecked(options.terrain);
  await button(page, 'Import roads').click();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    '0 errors',
    { timeout: 60_000 },
  );
  await button(page, 'Continue').click();
  await button(page, 'Accept city').click();
  await expect(dialog).toBeHidden({ timeout: 120_000 });
  await expect(button(page, 'Play')).toBeEnabled();
}

/** Uses the current camera, including the width-limited fit on a phone. */
export async function clickWorld(page: Page, point: Vec2) {
  const position = await page.evaluate((point) => window.cityflows!.worldToScreen!(point), point);
  await page.getByLabel('City map').click({ position });
}

export async function downloadText(page: Page, label: string, keyboard = false) {
  const downloading = page.waitForEvent('download');
  if (keyboard) await button(page, label).press('Enter');
  else await button(page, label).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}
