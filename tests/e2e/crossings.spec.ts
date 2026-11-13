import { expect, test, type Page } from '@playwright/test';
import { button, city, gridPoint, pageErrors } from './helpers';

/** Marking-coloured pixels (0xfffcf3, brighter than the 0xf2f1ee canvas and, zoomed in this far,
 * the asphalt tint of the white streets, TASK-162) of the map alone (the
 * panels hidden, as bench/geometry-shots.ts does) within `radius` px of `centre`: the crossings'
 * stripes and lane lines, which a crossing edit leaves. */
async function markingPixels(page: Page, centre: { x: number; y: number }, radius = 160) {
  const hide = await page.addStyleTag({
    content:
      'body * { visibility: hidden !important; } canvas.map { visibility: visible !important; }',
  });
  const png = await page.screenshot({
    clip: { x: centre.x - radius, y: centre.y - radius, width: 2 * radius, height: 2 * radius },
  });
  await hide.evaluate((element) => (element as HTMLElement).remove());
  return page.evaluate(async (data) => {
    const image = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${data}`)).blob(),
    );
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i]! > 249 && pixels[i + 1]! > 246 && pixels[i + 2]! > 236) count++;
    return count;
  }, png.toString('base64'));
}

test('TASK-091: a crossing toggled in the node inspector is redrawn, and undo restores it @smoke', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  // The grid's T-junction n at (120, 0), zoomed in about it so the stripes are drawn in full.
  const node = await gridPoint(page, 120, 0);
  await page.mouse.move(node.x, node.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  const centre = await page.evaluate(() => window.cityflows!.worldToScreen!({ x: 120, y: 0 }));
  const box = (await page.getByLabel('City map').boundingBox())!;
  const at = { x: box.x + centre.x, y: box.y + centre.y };
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('heading', { name: /^Junction n:/ })).toBeVisible();
  await page.getByText('Crossings', { exact: true }).click();
  const boxes = page.getByRole('checkbox', { name: /^Crossing on / });
  await expect(boxes).toHaveCount(3);
  const first = boxes.first();
  await expect(first).toBeChecked();
  // Let the zoom settle before measuring.
  await expect.poll(() => markingPixels(page, at)).toBeGreaterThan(0);
  const before = await markingPixels(page, at);

  await first.uncheck();
  await expect(first).not.toBeChecked();
  await expect(page.getByText(/^Edit applied/)).toBeVisible();
  const overridden = Object.values((await city(page)).roads).filter((road) => road.crossings);
  expect(overridden.length).toBe(2);
  for (const road of overridden) expect(Object.values(road.crossings!)).toEqual([false]);
  await expect.poll(() => markingPixels(page, at)).toBeLessThan(before - 100);

  await button(page, 'Undo').click();
  await expect(first).toBeChecked();
  expect(Object.values((await city(page)).roads).some((road) => road.crossings)).toBe(false);
  await expect.poll(() => markingPixels(page, at)).toBe(before);
  expect(errors).toEqual([]);
});
