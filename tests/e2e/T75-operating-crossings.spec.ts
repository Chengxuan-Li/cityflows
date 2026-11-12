import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { button, metrics, pageErrors } from './helpers';

async function synced(page: Page) {
  const time = (await metrics(page)).timeS;
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(time);
}
async function capture(page: Page, info: TestInfo, name: string, view: '2d' | '3d') {
  const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
  await canvas.screenshot({ path: info.outputPath(`${name}-${view}.png`) });
  if (process.env.CITYFLOWS_SHOT_DIR) {
    await mkdir(process.env.CITYFLOWS_SHOT_DIR, { recursive: true });
    await canvas.screenshot({ path: join(process.env.CITYFLOWS_SHOT_DIR, `${name}-${view}.png`) });
  }
}
async function bothViews(page: Page, info: TestInfo, name: string, state: number) {
  for (const view of ['2d', '3d'] as const) {
    const toggle = button(page, '3D');
    if ((await toggle.getAttribute('aria-pressed')) !== String(view === '3d')) await toggle.click();
    await synced(page);
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-level-crossing-states', JSON.stringify([state]));
    if (view === '3d') {
      const frames = Number(await canvas.getAttribute('data-frames'));
      await page.evaluate(() => window.cityflows!.setView3D!({ x: 0, y: 0 }, 20, 48, 155));
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-frames')))
        .toBeGreaterThan(frames);
    } else {
      await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
          r = c.getBoundingClientRect();
        const p = window.cityflows!.worldToScreen!({ x: 0, y: 0 }),
          unit = window.cityflows!.worldToScreen!({ x: 1, y: 0 });
        c.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(20 / (unit.x - p.x)) / 0.0015,
            clientX: r.x + p.x,
            clientY: r.y + p.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    const trainCount = await page.evaluate(
      async () => (await window.cityflows!.snapshot!()).rail!.trains.length,
    );
    await expect(canvas).toHaveAttribute('data-trains', String(trainCount));
    await capture(page, info, name, view);
    await page.waitForTimeout(500);
    const frozen = await canvas.screenshot();
    await page.waitForTimeout(250);
    expect(await canvas.screenshot()).toEqual(frozen);
    await button(page, 'Layers').click();
    const rail = page
      .getByRole('region', { name: 'Map layers' })
      .getByLabel('Rail', { exact: true });
    await rail.uncheck();
    await expect(canvas).toHaveAttribute('data-level-crossing-states', '[]');
    await rail.check();
    await expect(canvas).toHaveAttribute('data-level-crossing-states', JSON.stringify([state]));
    await page.keyboard.press('Escape');
  }
}

for (const kind of ['rail', 'tram'] as const)
  test(`T75 operating ${kind} crossing stops a car and releases it after the last carriage`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    const errors = pageErrors(page),
      source = operatingCrossing(kind),
      scenario = defaultScenario('grid5x5', 136);
    const home = Object.values(source.places).find((p) => p.kind === 'residential')!,
      work = Object.values(source.places).find((p) => p.kind === 'work')!;
    home.population = work.jobs = 1;
    scenario.startS = kind === 'rail' ? 120 : 60;
    scenario.endS = 720;
    scenario.simParams = { streetParkingShare: 0 };
    scenario.demand.workStart = { meanS: scenario.startS + 5, sdS: 0 };
    scenario.demand.workDuration = { meanS: 3600, sdS: 0 };
    scenario.demand.chains = { schoolShare: 0, shopShare: 0, leisureShare: 0 };
    scenario.demand.classShares = {
      local: { car: 1, van: 0, truck: 0, bus: 0 },
      through: { car: 1, van: 0, truck: 0, bus: 0 },
    };
    await page.route('https://**/*', (route) => route.abort());
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    const project = {
      city: source,
      scenarios: [scenario],
      population: [
        { id: 'driver', homePlaceId: home.id, workPlaceId: work.id, hasCar: true, agenda: [] },
      ],
    };
    const { manifest } = JSON.parse(
      await readFile('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
    );
    manifest.name = source.name;
    manifest.files = Object.fromEntries(
      Object.entries(project).map(([key, value]) => [
        `${key}.json`,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ]),
    );
    await page.getByLabel('Open project', { exact: true }).setInputFiles({
      name: `operating-${kind}.cityflows.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
    });
    await expect.poll(async () => (await metrics(page)).timeS).toBe(scenario.startS);
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of ['Street trees', 'Overhead lines'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await synced(page);
    await bothViews(page, info, `operating-${kind}-open`, 0);
    await page.evaluate(async () => {
      const api = window.cityflows!;
      for (let i = 0; i < 180; i++) {
        await api.step(10);
        if ((await api.snapshot!()).rail?.crossings[0] === 1) return;
      }
      throw new Error('The served crossing never warned approaching road traffic');
    });
    await synced(page);
    await bothViews(page, info, `operating-${kind}-warning`, 1);
    const stopped = await page.evaluate(async () => {
      const api = window.cityflows!;
      for (let i = 0; i < 180; i++) {
        await api.step(10);
        const s = await api.snapshot!();
        for (let j = 0; j < s.count; j++)
          if (s.rail?.crossings[0] === 2 && s.speed[j]! < 0.1 && s.x[j]! > -30 && s.x[j]! < -4)
            return { id: s.id[j]!, x: s.x[j]!, timeS: s.timeS };
      }
      throw new Error('The served crossing never held the approaching car');
    });
    const passage = await page.evaluate(async () => {
      const api = window.cityflows!;
      for (let i = 0; i < 120; i++) {
        const s = await api.snapshot!();
        if (
          s.rail?.crossings[0] === 2 &&
          s.rail.trains.some((t) => Math.abs(t.centre.y) < 8 && Math.abs(t.centre.x) < 1)
        )
          return s.timeS;
        await api.step(10);
      }
      throw new Error('No rail vehicle passed the crossing while the car waited');
    });
    await synced(page);
    await bothViews(page, info, `operating-${kind}-protected`, 2);
    const released = await page.evaluate(async (id) => {
      const api = window.cityflows!;
      for (let i = 0; i < 180; i++) {
        await api.step(10);
        const s = await api.snapshot!(),
          j = s.id.subarray(0, s.count).indexOf(id);
        if (s.rail?.crossings[0] === 0 && j >= 0 && s.x[j]! > 8 && s.speed[j]! > 1)
          return { timeS: s.timeS, x: s.x[j]! };
      }
      throw new Error('The held car never resumed after rail clearance');
    }, stopped.id);
    expect(released.timeS).toBeGreaterThan(stopped.timeS);
    await synced(page);
    await bothViews(page, info, `operating-${kind}-released`, 0);
    await info.attach('car-interaction', {
      body: JSON.stringify({ kind, stopped, passage, released }),
      contentType: 'application/json',
    });
    await button(page, 'Restart').click();
    await expect.poll(async () => (await metrics(page)).timeS).toBe(scenario.startS);
    await synced(page);
    await expect(page.getByLabel('3D city view', { exact: true })).toHaveAttribute(
      'data-level-crossing-states',
      '[0]',
    );
    expect(errors).toEqual([]);
  });
