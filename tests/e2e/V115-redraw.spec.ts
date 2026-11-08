import { expect, test, type Locator, type Page } from '@playwright/test';
import { button, importOsm, pageErrors } from './helpers';

const frames = (canvas: Locator) => canvas.getAttribute('data-frames').then(Number);

async function settled(page: Page, canvas: Locator) {
  await expect.poll(() => frames(canvas)).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const before = await frames(canvas);
      await page.waitForTimeout(400);
      return (await frames(canvas)) === before;
    })
    .toBe(true);
}

async function idle(page: Page, canvas: Locator) {
  await settled(page, canvas);
  const before = await frames(canvas);
  await page.waitForTimeout(2000);
  expect(await frames(canvas)).toBe(before);
}

for (const mode of ['2d', '3d'])
  test(`@smoke V115 Munich draws only visible changes in ${mode}`, async ({ page }, info) => {
    // A Munich import and 3D build on CI's software GPU: the 3D case took 58 s of 60 there.
    test.setTimeout(420_000);
    const errors = pageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    // V98 covers normal camera damping; fixed settling keeps this smoke case short.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('https://**/*', (route) => route.abort());
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    await layers.getByLabel('Basemap', { exact: true }).uncheck();
    await button(page, 'Layers').click();
    const map = page.getByLabel('City map', { exact: true });
    if (mode === '2d') {
      await idle(page, map);
      const before = await frames(map);
      const point = await page.evaluate(() => {
        const api = window.cityflows!;
        const road = Object.values(api.city!().roads).find(
          (road) => road.roadClass === 'residential',
        )!;
        const i = Math.floor((road.centerline.length - 1) / 2);
        const a = road.centerline[i]!,
          b = road.centerline[i + 1]!;
        return api.worldToScreen!({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      });
      await map.click({ position: point });
      await expect(page.getByText('Lanes and street settings', { exact: true })).toBeVisible();
      await expect.poll(() => frames(map)).toBeGreaterThan(before);
    } else await button(page, '3D').click();
    const canvas = mode === '2d' ? map : page.getByLabel('3D city view', { exact: true });
    await idle(page, canvas);
    const hidden2DFrames = mode === '3d' ? await frames(map) : null;
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    let before = await frames(canvas);
    await page.mouse.move(x, y);
    const panButton = mode === '2d' ? 'middle' : 'left';
    await page.mouse.down({ button: panButton });
    await page.mouse.move(x + 70, y + 30, { steps: 8 });
    await page.mouse.up({ button: panButton });
    await expect.poll(() => frames(canvas)).toBeGreaterThan(before);
    await idle(page, canvas);

    before = await frames(canvas);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => frames(canvas)).toBeGreaterThan(before);
    await idle(page, canvas);

    before = await frames(canvas);
    await button(page, 'Layers').click();
    await layers.getByLabel('Places', { exact: true }).uncheck();
    await expect.poll(() => frames(canvas)).toBeGreaterThan(before);
    await layers.getByLabel('Places', { exact: true }).check();
    await button(page, 'Layers').click();
    // Paused vehicles must also stop drawing; playing resumes every animation frame.
    await page.evaluate(() => window.cityflows!.step(6000));
    await idle(page, canvas);
    const startTime = await page.evaluate(() => window.cityflows!.metrics().then((m) => m.timeS));
    const playFrames = await frames(canvas);
    await button(page, 'Play').click();
    await expect(button(page, 'Pause')).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.cityflows!.metrics().then((m) => m.timeS)))
      .toBeGreaterThan(startTime);
    await expect.poll(() => frames(canvas)).toBeGreaterThan(playFrames + 2);
    const drawn = await canvas.evaluate(async (element) => {
      const start = Number(element.getAttribute('data-frames'));
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      return Number(element.getAttribute('data-frames')) - start;
    });
    expect(drawn).toBeGreaterThanOrEqual(11);
    await button(page, 'Pause').click();
    await idle(page, canvas);

    // The timing override is reversible and only exists in test builds.
    await page.evaluate(() => (window.cityflowsRenderContinuously = true));
    const continuousBefore = await frames(canvas);
    await expect.poll(() => frames(canvas)).toBeGreaterThan(continuousBefore + 2);
    await page.evaluate(() => (window.cityflowsRenderContinuously = false));
    await idle(page, canvas);
    if (mode === '3d') {
      expect(await frames(map)).toBe(hidden2DFrames);
      await button(page, '3D').click();
      await idle(page, map);
    }
    expect(errors).toEqual([]);
    await info.attach('idle-frames.json', {
      body: JSON.stringify({ mode, idleFramesPerSecond: 0, playingDrawsOver12Frames: drawn }),
      contentType: 'application/json',
    });
  });
