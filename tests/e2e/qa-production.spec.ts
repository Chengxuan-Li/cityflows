import { expect, test } from '@playwright/test';
import { button, pageErrors } from './helpers';

// TASK-198: the budgets are this machine's, with its GPU (as TASK-197 measured); elsewhere the
// browser keeps its default renderer and the figures are reported without the gate. A trace's
// snapshots would be timed too.
test.use({ trace: 'off' });
if (process.platform === 'win32')
  test.use({
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] },
  });

test('QA production Pages build loads and plays with no test API or requests outside /cityflows/', async ({
  page,
  baseURL,
}) => {
  const errors = pageErrors(page);
  const requests: string[] = [];
  const failed: string[] = [];
  page.context().on('request', (request) => requests.push(request.url()));
  page.context().on('requestfailed', (request) => failed.push(request.url()));
  page.context().on('response', (response) => {
    if (response.status() >= 400) failed.push(response.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  // TASK-198: the landing city, drawn within its load budget: the first frame within 3 s of
  // page load, the 3D view within a further 5 s (this machine, idle; CI's software GPU and four
  // cores report the figures without the gate, as T62 does).
  await page.waitForFunction(
    () => performance.getEntriesByName('cityflows:first-frame').length > 0,
    null,
    { timeout: 60_000 },
  );
  const load = await page.evaluate(() => ({
    pageLoadMs: performance.getEntriesByType('navigation')[0]!.toJSON().loadEventEnd as number,
    firstFrameMs: performance.getEntriesByName('cityflows:first-frame')[0]!.startTime,
  }));
  await expect(
    page.getByRole('heading', { name: 'Freiburg im Breisgau', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, '3D').click();
  await page.waitForFunction(
    () => performance.getEntriesByName('cityflows:first-frame-3d').length > 0,
    null,
    { timeout: 60_000 },
  );
  const threeDMs =
    (await page.evaluate(
      () => performance.getEntriesByName('cityflows:first-frame-3d')[0]!.startTime,
    )) - load.firstFrameMs;
  console.info('Freiburg landing load', JSON.stringify({ ...load, threeDMs }));
  if (!process.env.CI) {
    expect(load.firstFrameMs - load.pageLoadMs, 'first frame after page load').toBeLessThanOrEqual(
      3000,
    );
    expect(threeDMs, '3D after the first frame').toBeLessThanOrEqual(5000);
  }
  await button(page, '3D').click();
  expect(await page.evaluate(() => window.cityflows)).toBeUndefined();
  const clock = page.getByLabel('Simulation clock', { exact: true });
  const start = await clock.innerText();
  expect(start).toBe('07:00:00.0');
  await button(page, 'Play').click();
  await expect(clock).not.toHaveText(start);
  await button(page, 'Pause').click();
  await expect(button(page, 'Step')).toBeEnabled();
  expect(requests.some((url) => /worker.*\.js/.test(url))).toBe(true);
  const origin = new URL(baseURL!).origin;
  expect(
    requests.filter((url) => {
      const request = new URL(url);
      return request.origin !== origin || !request.pathname.startsWith('/cityflows/');
    }),
  ).toEqual([]);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
