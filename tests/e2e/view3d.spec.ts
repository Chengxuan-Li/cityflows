import { expect, test, type Page } from '@playwright/test';
import { button, clockTimeS, importOsm, metrics, pageErrors } from './helpers';

test.use({ reducedMotion: 'no-preference' });

async function centrePixel(page: Page) {
  return page.evaluate(async () => {
    const image = (await window.cityflows!.capture3D!())[0]!;
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixel = [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data];
    bitmap.close();
    return pixel.slice(0, 3);
  });
}

test('@smoke V98 Munich switches views, keeps playback and camera centre, and selects a 3D vehicle', async ({
  page,
}) => {
  // CI's runner renders three.js on a software GPU; 120 s timed out there (d3502d8)
  // and the local run takes 84 s.
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#a4b7be';
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(tile, 'base64'),
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
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
  await expect(map).toHaveAttribute('data-active', 'false');
  await expect.poll(() => map3D.getAttribute('data-tiles').then(Number)).toBeGreaterThan(0);
  await expect.poll(() => map3D.getAttribute('data-crossings').then(Number)).toBeGreaterThan(0);
  const buildings = page.getByLabel('Buildings', { exact: true });
  await expect(buildings).toBeChecked();
  const buildingCount = Number(await map3D.getAttribute('data-buildings'));
  expect(buildingCount).toBeGreaterThan(1000);
  const buildMs = await map3D.getAttribute('data-build-ms');
  await buildings.uncheck();
  await expect(map3D).toHaveAttribute('data-buildings', '0');
  await expect
    .poll(() => map3D.getAttribute('data-context-features').then(Number))
    .toBeGreaterThan(0);
  await buildings.check();
  await expect(map3D).toHaveAttribute('data-buildings', String(buildingCount));
  await expect(map3D).toHaveAttribute('data-build-ms', buildMs!);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  await layers.getByLabel('Basemap', { exact: true }).uncheck();
  await expect(map3D).toHaveAttribute('data-tiles', '0');
  await layers.getByLabel('Basemap', { exact: true }).check();
  await expect.poll(() => map3D.getAttribute('data-tiles').then(Number)).toBeGreaterThan(0);
  await layers.getByLabel('Surroundings', { exact: true }).uncheck();
  await expect(map3D).toHaveAttribute('data-context-features', '0');
  await expect(map3D).toHaveAttribute('data-buildings', '0');
  await expect(buildings).toBeDisabled();
  await layers.getByLabel('Surroundings', { exact: true }).check();
  await expect(map3D).toHaveAttribute('data-buildings', String(buildingCount));
  await button(page, 'Layers').click();
  for (const name of ['Select', 'Road', 'Place', 'Ramp', 'Roundabout']) {
    await expect(button(page, name)).toBeDisabled();
    await expect(button(page, name)).toHaveAttribute('title', 'Editing is available in 2D');
  }
  const entered = await page.evaluate(() => window.cityflows!.view3D!()!.centre);
  expect(Math.hypot(entered.x - centre.x, entered.y - centre.y)).toBeLessThan(0.01);
  const beforePixel = await page.evaluate(() => window.cityflows!.view3D!()!);
  await buildings.uncheck();
  await button(page, 'Layers').click();
  await layers.getByLabel('Places', { exact: true }).uncheck();
  // A grass patch clear of roads/buildings must cover the solid blue tile stub.
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 595.8, y: -277.3 }, 8, 85));
  await page.waitForTimeout(1500);
  const grass = await centrePixel(page);
  await layers.getByLabel('Surroundings', { exact: true }).uncheck();
  await expect(map3D).toHaveAttribute('data-context-features', '0');
  const tilePixel = await centrePixel(page);
  expect(
    grass.reduce((difference, value, i) => difference + Math.abs(value - tilePixel[i]!), 0),
  ).toBeGreaterThan(20);
  await layers.getByLabel('Surroundings', { exact: true }).check();
  await layers.getByLabel('Places', { exact: true }).check();
  await button(page, 'Layers').click();
  await buildings.check();
  await page.evaluate((view) => window.cityflows!.setView3D!(view.centre, view.zoom), beforePixel);
  await page.getByLabel('See below ground').check();
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await expect.poll(() => clockTimeS(page)).toBeGreaterThan(start);
  await button(page, 'Pause').click();
  await expect(button(page, 'Play')).toBeEnabled();
  expect((await metrics(page)).timeS).toBeGreaterThan(start);
  // Reach the morning through the same worker used by both renderers.
  await page.evaluate(() => window.cityflows!.step(6000));
  await expect.poll(() => map3D.getAttribute('data-vehicles').then(Number)).toBeGreaterThan(0);
  const target = await page.evaluate(async () => {
    const snapshot = await window.cityflows!.snapshot!();
    return { id: snapshot.id[0]!, x: snapshot.x[0]!, y: snapshot.y[0]! };
  });
  await page.evaluate(
    (target) => window.cityflows!.setView3D!({ x: target.x, y: target.y }, 3, 55),
    target,
  );
  await page.waitForTimeout(250);
  const point = await page.evaluate(
    (target) => window.cityflows!.vehicleToScreen!(target.id)!,
    target,
  );
  await map3D.click({ position: { x: point.x + 4, y: point.y } });
  await expect(
    page.getByRole('heading', { name: `Vehicle ${target.id}`, exact: true }),
  ).toBeVisible();
  // Pan through MapControls and hand the resulting ground target back to 2D.
  await buildings.uncheck();
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
  await expect(map).toHaveAttribute('data-active', 'true');
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
  await expect(buildings).not.toBeChecked();
  await expect(map3D).toHaveAttribute('data-buildings', '0');
  await buildings.check();
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
  await expect.poll(() => map3D.getAttribute('data-buildings').then(Number)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
