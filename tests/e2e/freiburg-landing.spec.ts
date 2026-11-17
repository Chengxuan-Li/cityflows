import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, pageErrors } from './helpers';
import { railFrameTiming, railTimingEnvironment } from './rail-frame-timing';

// TASK-198: the budgets are this machine's, with its GPU (as TASK-197 measured); elsewhere the
// browser keeps its default renderer and the figures are reported without the gate. A trace's
// snapshots would be timed too.
test.use({ trace: 'off' });
if (process.platform === 'win32')
  test.use({
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] },
  });

// TASK-198: the landing view. The app opens on Freiburg, paused at 07:00; the map's render CPU
// stays within its frame budget in 2D and 3D while the morning plays. The load budget is
// measured on the production bundle (qa-production.spec.ts).

const sample = process.env.CI ? { frames: 12, warm: 2 } : { frames: 180, warm: 30 };
/** Render CPU p95 per frame, ms: TASK-197 measured 1.5 in both views on this city. */
const budget = { '2d': 4, '3d': 6 };

const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;

test('the app opens on Freiburg, paused, and renders it within its frame budget in 2D and 3D', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Freiburg im Breisgau', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect(page.getByLabel('Simulation clock', { exact: true })).toHaveText('07:00:00.0');
  expect((await page.evaluate(() => window.cityflows!.metrics())).trips.driving).toBe(0);
  expect(
    await page.evaluate(() => performance.getEntriesByName('cityflows:first-frame').length),
  ).toBeGreaterThan(0);

  await button(page, 'Play').click();
  await expect
    .poll(async () => (await page.evaluate(() => window.cityflows!.metrics())).trips.driving)
    .toBeGreaterThan(0);
  const twoD = await railFrameTiming(page, 'cityflows:render', sample);
  await button(page, '3D').click();
  await page.waitForFunction(
    () => performance.getEntriesByName('cityflows:first-frame-3d').length > 0,
  );
  const threeD = await railFrameTiming(page, 'cityflows:render3d', sample);
  await button(page, 'Pause').click();
  const report = {
    environment: await railTimingEnvironment(page),
    '2d': { frameMs: twoD.frameMs, renderMs: twoD.renderMs, renderP95Ms: p95(twoD.renders) },
    '3d': { frameMs: threeD.frameMs, renderMs: threeD.renderMs, renderP95Ms: p95(threeD.renders) },
  };
  console.info('Freiburg landing frames', JSON.stringify(report));
  await writeFile(info.outputPath('freiburg-frames.json'), JSON.stringify(report, null, 2));
  // As T62: CI's software GPU skips the local budget.
  if (!process.env.CI) {
    expect(report['2d'].renderP95Ms, '2D render CPU p95').toBeLessThanOrEqual(budget['2d']);
    expect(report['3d'].renderP95Ms, '3D render CPU p95').toBeLessThanOrEqual(budget['3d']);
  }
  expect(errors).toEqual([]);
});
