import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, pageErrors, toolbarAction } from './helpers';
import { railFrameTiming, railTimingEnvironment } from './rail-frame-timing';

// TASK-258: the real places of the New city panel (TASK-284 adds Lübeck; TASK-286 York; TASK-295
// London City Airport). Each opens from the
// panel and by `?city=<id>`, paused at 07:00, and every place but Freiburg reports its frame
// figures as the Freiburg landing spec measures them (render CPU p95 in 2D and 3D while the
// morning plays, and the 3D build).
// Places held out of the panel (`heldOutOfPanel` in bench/bundled-cities.ts) open by `?city=`.

test.use({ trace: 'off' });
if (process.platform === 'win32')
  test.use({
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] },
  });

/** The panel's real places (`realPlaces` in src/ui/bundled-projects.ts, which the city tier
 * checks against the builder). */
const realPlaces = [
  { id: 'freiburg', name: 'Freiburg im Breisgau' },
  { id: 'munich', name: 'Munich Donnersbergerbrücke' },
  { id: 'sindelfingen', name: 'Sindelfingen A81' },
  { id: 'philadelphia', name: 'Philadelphia Center City' },
  { id: 'luebeck', name: 'Lübeck Altstadt' },
  { id: 'york', name: 'York city centre' },
  { id: 'london-city-airport', name: 'London City Airport' },
  { id: 'heathrow', name: 'London Heathrow Airport' },
  { id: 'zurich-airport', name: 'Zurich Airport' },
];
/** Boston has scene-load checks while its throughput gate is pending. */
const heldOut = [{ id: 'boston-logan', name: 'Boston Logan Airport' }];

const opened = async (page: Page, name: string, timeout = 60_000) => {
  // Sindelfingen's first frame takes 8 to 13 s on a busy machine (its rail clipping), longer than
  // the 20 s default once another city is drawn and the machine is loaded.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout });
  await expect(button(page, 'Play')).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByLabel('Simulation clock', { exact: true })).toHaveText('07:00:00.0');
};

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const)
  test(`the New city panel groups real places and test layouts at ${width} px, and opens each place`, async ({
    page,
  }, info) => {
    // TASK-357: Heathrow opens twice here, in up to 180 s each on a loaded machine.
    test.setTimeout(600_000);
    const errors = pageErrors(page);
    await page.setViewportSize({ width, height });
    await page.goto('/?city=grid5x5');
    await opened(page, '5 × 5 grid');
    for (const { id, name } of realPlaces) {
      await (await toolbarAction(page, 'New')).click();
      const panel = page.getByRole('dialog', { name: 'New city', exact: true });
      const real = panel.getByRole('region', { name: 'Real places', exact: true });
      const layouts = panel.getByRole('region', { name: 'Test layouts', exact: true });
      await expect(real.getByRole('button')).toHaveCount(realPlaces.length);
      await expect(
        layouts.getByRole('button', { name: 'Four-way signal', exact: true }),
      ).toBeVisible();
      const place = real.getByRole('button', { name, exact: true });
      // Each place carries a one-line note of what it shows.
      await expect(place).toHaveAccessibleDescription(/\w+ .+/);
      // The panel fits the window: no part of it is cut off at the sides.
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (id === realPlaces[0]!.id) {
        await panel.evaluate((sheet) =>
          Promise.all(sheet.getAnimations({ subtree: true }).map((a) => a.finished)),
        );
        await page.screenshot({ path: info.outputPath(`new-city-${width}.png`) });
      }
      // Heathrow's and Zurich's 180 s to open, as in their render check below (TASK-302: Zurich
      // ready 31 to 42 s on a quiet machine).
      const timeout = id === 'heathrow' || id === 'zurich-airport' ? 180_000 : undefined;
      await place.click();
      await opened(page, name, timeout);
      await page.goto(`/?city=${id}`);
      await opened(page, name, timeout);
    }
    expect(errors).toEqual([]);
  });

for (const { id, name } of heldOut)
  test(`${name} opens by URL and builds its 2D and 3D scenes`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = pageErrors(page);
    await page.goto(`/?city=${id}`);
    await opened(page, name, 180_000);
    const canvas = page.locator('canvas[data-airside-areas]');
    await expect(canvas).toHaveAttribute('data-airside-areas', /^[1-9]\d*$/);
    await button(page, '3D').click();
    await page.waitForFunction(
      () => performance.getEntriesByName('cityflows:first-frame-3d').length > 0,
      null,
      { timeout: 120_000 },
    );
    await expect(page.locator('canvas[data-view="3d"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

for (const { id, name } of realPlaces.filter((place) => place.id !== 'freiburg'))
  test(`${name} renders in 2D and 3D while its morning plays`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const sample = process.env.CI ? { frames: 12, warm: 2 } : { frames: 180, warm: 30 };
    const p95 = (values: number[]) =>
      [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * 0.95))
      ]!;
    const errors = pageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?city=${id}`);
    // Zurich's and Heathrow's archives load longest (TASK-302); CI runners need longer.
    await opened(page, name, id === 'zurich-airport' || id === 'heathrow' ? 180_000 : undefined);
    // TASK-295: an airport's airside is drawn as paving (aprons, taxiways, the runway).
    if (id === 'london-city-airport' || id === 'zurich-airport')
      expect(
        Number(await page.locator('canvas[data-airside-areas]').getAttribute('data-airside-areas')),
      ).toBeGreaterThan(2);
    await page.screenshot({ path: info.outputPath(`${id}-2d.png`) });
    await button(page, 'Play').click();
    await expect
      .poll(async () => (await page.evaluate(() => window.cityflows!.metrics())).trips.driving)
      .toBeGreaterThan(0);
    const twoD = await railFrameTiming(page, 'cityflows:render', sample);
    const click = await page.evaluate(() => performance.now());
    await button(page, '3D').click();
    await page.waitForFunction(
      () => performance.getEntriesByName('cityflows:first-frame-3d').length > 0,
      null,
      { timeout: 120_000 },
    );
    const threeDMs =
      (await page.evaluate(
        () => performance.getEntriesByName('cityflows:first-frame-3d')[0]!.startTime,
      )) - click;
    // The 3D scene's build (`setCity`), as the Freiburg landing spec reports it (TASK-278).
    const buildMs = Number(
      await page.locator('canvas[data-view="3d"]').getAttribute('data-build-ms'),
    );
    const threeD = await railFrameTiming(page, 'cityflows:render3d', sample);
    await button(page, 'Pause').click();
    await page.screenshot({ path: info.outputPath(`${id}-3d.png`) });
    const report = {
      environment: await railTimingEnvironment(page),
      threeDMs,
      '2d': { frameMs: twoD.frameMs, renderMs: twoD.renderMs, renderP95Ms: p95(twoD.renders) },
      '3d': {
        frameMs: threeD.frameMs,
        renderMs: threeD.renderMs,
        renderP95Ms: p95(threeD.renders),
        buildMs,
      },
    };
    console.info(`${name} frames`, JSON.stringify(report));
    await writeFile(info.outputPath(`${id}-frames.json`), JSON.stringify(report, null, 2));
    // Freiburg's frame budgets (freiburg-landing.spec.ts); CI's software GPU skips them.
    if (!process.env.CI) {
      // TASK-357: Heathrow is held to Freiburg's 4 ms too (4.9 ms when it joined the panel; its
      // aircraft are no longer triangulated every frame).
      expect(report['2d'].renderP95Ms, '2D render CPU p95').toBeLessThanOrEqual(4);
      const threeDBudget = id === 'london-city-airport' ? 4 : 6;
      expect(report['3d'].renderP95Ms, '3D render CPU p95').toBeLessThanOrEqual(threeDBudget);
    }
    expect(errors).toEqual([]);
  });
