import { expect, test } from '@playwright/test';
import { placeCamera } from '../../bench/geometry-shots';
import { button, importOsm, metrics, pageErrors, stateHash } from './helpers';

test('V97 shadows expose changing under-deck signals and remove all effects when off @smoke', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  const shadows = layers.getByLabel('Shadows', { exact: true });
  await expect(shadows).toBeChecked();
  for (const label of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await button(page, 'Layers').click();
  await placeCamera(page, [-28, 172], 10);
  const canvas = page.getByLabel('City map', { exact: true });
  await expect
    .poll(async () => JSON.parse((await canvas.getAttribute('data-grade-effects'))!).tunnels)
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe((await metrics(page)).timeS);
  // TASK-094's hidden west-approach through head, inside the grade-2 deck at n:967.
  const head = await page.evaluate(() =>
    window.cityflows!.worldToScreen!({ x: -43.852613777, y: 173.895385456 }),
  );
  const box = (await canvas.boundingBox())!;
  const clip = {
    x: Math.round(box.x + head.x - 4),
    y: Math.round(box.y + head.y - 4),
    width: 8,
    height: 8,
  };
  const green = await page.screenshot({ clip, path: info.outputPath('n967-green-head.png') });
  await canvas.screenshot({ path: info.outputPath('n967-green.png') });
  const hash = await stateHash(page);
  await button(page, 'Layers').click();
  await shadows.uncheck();
  await expect(canvas).toHaveAttribute(
    'data-grade-effects',
    JSON.stringify({ graphics: 0, ghosts: 0, tunnels: 0 }),
  );
  expect(await stateHash(page)).toBe(hash);
  await button(page, 'Layers').click();
  const covered = await page.screenshot({ clip });
  expect(covered.equals(green)).toBe(false);
  await page.evaluate(() => window.cityflows!.step(300));
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe((await metrics(page)).timeS);
  // With the ghost removed the signal's state cannot change the opaque deck pixels.
  expect((await page.screenshot({ clip })).equals(covered)).toBe(true);
  await button(page, 'Layers').click();
  await shadows.check();
  await button(page, 'Layers').click();
  const red = await page.screenshot({ clip, path: info.outputPath('n967-red-head.png') });
  expect(red.equals(green)).toBe(false);
  expect(red.equals(covered)).toBe(false);
  await canvas.screenshot({ path: info.outputPath('n967-red.png') });
  await button(page, 'Layers').click();
  await layers.getByLabel('Signals', { exact: true }).uncheck();
  await button(page, 'Layers').click();
  expect((await page.screenshot({ clip })).equals(covered)).toBe(true);
  await button(page, 'Layers').click();
  await layers.getByLabel('Signals', { exact: true }).check();
  await button(page, 'Layers').click();
  // Keep the same ghost objects alive through another phase change.
  await page.evaluate(() => window.cityflows!.step(720));
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe((await metrics(page)).timeS);
  const greenAgain = await page.screenshot({
    clip,
    path: info.outputPath('n967-green-again-head.png'),
  });
  expect(greenAgain.equals(red)).toBe(false);
  expect(greenAgain.equals(covered)).toBe(false);
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await placeCamera(page, [5, -285], 1);
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start + 1);
  await placeCamera(page, [-28, 172], 10);
  await canvas.screenshot({ path: info.outputPath('n967-playing.png') });
  await button(page, 'Pause').click();
  expect(errors).toEqual([]);
});
