import { expect, test } from '@playwright/test';
import { button, importOsm, metrics, pageErrors } from './helpers';

test.use({ reducedMotion: 'no-preference' });

test('@smoke V98 Munich switches views, keeps playback and camera centre, and selects a 3D vehicle', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const map = page.getByLabel('City map', { exact: true });
  const map3D = page.getByLabel('3D city view', { exact: true });
  const centre = await page.evaluate(() => {
    const p = window.cityflows!.worldToScreen!({ x: 0, y: 0 });
    const q = window.cityflows!.worldToScreen!({ x: 1, y: 0 });
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!;
    return {
      x: (canvas.clientWidth / 2 - p.x) / (q.x - p.x),
      y: (canvas.clientHeight / 2 - p.y) / (q.x - p.x),
    };
  });
  await button(page, 'Road').click();
  await button(page, '3D').click();
  await expect(map3D).toHaveAttribute('data-view', '3d');
  await expect.poll(() => map3D.getAttribute('data-meshes').then(Number)).toBeGreaterThan(0);
  await expect(map).toHaveAttribute('data-ticker', 'stopped');
  for (const name of ['Select', 'Road', 'Place', 'Ramp', 'Roundabout']) {
    await expect(button(page, name)).toBeDisabled();
    await expect(button(page, name)).toHaveAttribute('title', 'Editing is available in 2D');
  }
  const entered = await page.evaluate(() => window.cityflows!.view3D!()!.centre);
  expect(Math.hypot(entered.x - centre.x, entered.y - centre.y)).toBeLessThan(0.01);
  await page.getByLabel('See below ground').check();
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await button(page, 'Pause').click();
  // Reach the morning through the same worker used by both renderers.
  await page.evaluate(() => window.cityflows!.step(6000));
  await expect.poll(() => map3D.getAttribute('data-vehicles').then(Number)).toBeGreaterThan(0);
  const target = await page.evaluate(async () => {
    const snapshot = await window.cityflows!.snapshot!();
    return { id: snapshot.id[0]!, x: snapshot.x[0]!, y: snapshot.y[0]! };
  });
  await page.evaluate(
    (target) => window.cityflows!.setView3D!({ x: target.x, y: target.y }, 12, 55),
    target,
  );
  await page.waitForTimeout(250);
  const point = await page.evaluate((target) => window.cityflows!.worldToScreen!(target), target);
  await map3D.click({ position: point });
  await expect(
    page.getByRole('heading', { name: `Vehicle ${target.id}`, exact: true }),
  ).toBeVisible();
  // Pan through MapControls and hand the resulting ground target back to 2D.
  const box = (await map3D.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const leaving = await page.evaluate(() => {
    const view = window.cityflows!.view3D!()!;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    return view;
  });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute('data-ticker', 'running');
  await expect(button(page, 'Road')).toBeEnabled();
  const screen = await page.evaluate(
    (point) => window.cityflows!.worldToScreen!(point),
    leaving.centre,
  );
  expect(Math.abs(screen.x - box.width / 2)).toBeLessThan(1);
  expect(Math.abs(screen.y - box.height / 2)).toBeLessThan(1);
  // Returning to 3D must not carry the previous pan's damping into the new target.
  await page.keyboard.press('v');
  await expect(map3D).toBeVisible();
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => window.cityflows!.view3D!()!.centre);
  expect(Math.hypot(restored.x - leaving.centre.x, restored.y - leaving.centre.y)).toBeLessThan(
    0.01,
  );
  // A new project fits the visible 3D camera, even after flying far from the previous city.
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 10000, y: 10000 }, 12));
  await importOsm(page, 'fixtures/osm/sindelfingen-a81.osm');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { centre } = window.cityflows!.view3D!()!;
        return Math.hypot(centre.x, centre.y);
      }),
    )
    .toBeLessThan(1000);
  expect(errors).toEqual([]);
});
