import { expect, test, type Page } from '@playwright/test';
import { button, pageErrors, sidebarSection, stateHash } from './helpers';

// TASK-379: developer tools turn on the sidebar's Debug section. Rendered view off with Road graph
// and Wireframe leaves only those on the plain canvas; Shading Unlit colour and back to Normal
// changes the scene and restores it; with developer tools off again the default view is back
// unchanged and the simulation never moved.
const frame = (page: Page) => page.evaluate(async () => (await window.cityflows!.capture3D!())[1]!);
/** The share of pixels two frames differ in clearly (more than 48 over three channels): a still
 *  3D view repeats within about 0.1% (its animations). */
const changed = (page: Page, a: string, b: string) =>
  page.evaluate(
    async ([a, b]) => {
      const pixels = async (src: string) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [image.width, image.height];
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [x, y] = [await pixels(a!), await pixels(b!)];
      let count = 0;
      for (let i = 0; i < x.length; i += 4)
        if (
          Math.abs(x[i]! - y[i]!) +
            Math.abs(x[i + 1]! - y[i + 1]!) +
            Math.abs(x[i + 2]! - y[i + 2]!) >
          48
        )
          count++;
      return count / (x.length / 4);
    },
    [a, b],
  );

test('V379 debug views: rendered view off, road graph and wireframe, unlit shading and back', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.goto('/?city=grid5x5');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.evaluate(() => window.cityflows!.step(600));
  const hash = await stateHash(page);
  await button(page, '3D').click();
  const view = page.getByLabel('3D city view', { exact: true });
  await expect(view).toHaveAttribute('data-frames', /[1-9]/);
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 120, y: 120 }, 2.5, 40, 25));
  const before = await frame(page);
  await expect(page.locator('.debug-overlay')).toHaveCount(0);
  expect(await view.getAttribute('data-debug-rendered')).toBeNull();

  // The switch sits in Visual quality's Render section; the Debug section follows it.
  await (await sidebarSection(page, 'Visual quality')).click();
  const quality = page.getByRole('region', { name: 'Visual quality' });
  await quality.getByRole('button', { name: 'Render', exact: true }).click();
  const tools = quality.getByRole('switch', { name: 'Developer tools' });
  await expect(button(page, 'Debug')).toHaveCount(0);
  await tools.check();
  const debug = page.getByRole('region', { name: 'Debug views' });
  await expect(debug).toBeVisible();
  await expect(view).toHaveAttribute('data-debug-rendered', 'true');
  await expect(view).toHaveAttribute('data-debug-shading', 'normal');
  // 3D-only views are offered in 3D.
  await expect(debug.getByRole('checkbox', { name: 'Wireframe', exact: true })).toBeVisible();

  await debug.getByRole('checkbox', { name: 'Road graph', exact: true }).check();
  await debug.getByRole('checkbox', { name: 'Wireframe', exact: true }).check();
  await debug.getByRole('checkbox', { name: 'Rendered view', exact: true }).uncheck();
  await expect(debug.getByLabel('Shading', { exact: true })).toBeDisabled();
  await expect(view).toHaveAttribute('data-debug-rendered', 'false');
  await expect(view).toHaveAttribute('data-debug-overlays', 'roadGraph,wireframe');
  await expect
    .poll(async () => JSON.parse((await view.getAttribute('data-debug-items')) ?? '{}').roadGraph)
    .toBeGreaterThan(0);
  expect(await changed(page, before, await frame(page))).toBeGreaterThan(0.2);

  await debug.getByRole('checkbox', { name: 'Rendered view', exact: true }).check();
  await debug.getByRole('checkbox', { name: 'Road graph', exact: true }).uncheck();
  await debug.getByRole('checkbox', { name: 'Wireframe', exact: true }).uncheck();
  const shading = debug.getByLabel('Shading', { exact: true });
  await shading.selectOption({ label: 'Unlit colour' });
  await expect(view).toHaveAttribute('data-debug-shading', 'unlit');
  expect(await changed(page, before, await frame(page))).toBeGreaterThan(0.01);
  await shading.selectOption({ label: 'Normal' });
  await expect(view).toHaveAttribute('data-debug-shading', 'normal');

  // Developer tools off: no Debug section, no debug attributes, the default view as before.
  await tools.uncheck();
  await expect(debug).toHaveCount(0);
  await expect.poll(() => view.getAttribute('data-debug-rendered')).toBeNull();
  await expect(page.locator('.debug-overlay')).not.toBeVisible();
  expect(await changed(page, before, await frame(page))).toBeLessThan(0.005);
  expect(await stateHash(page)).toBe(hash);

  // In 2D the 3D-only views are hidden, not disabled.
  await tools.check();
  await button(page, '3D').click();
  await expect(debug.getByRole('checkbox', { name: 'Road graph', exact: true })).toBeVisible();
  await expect(debug.getByRole('checkbox', { name: 'Wireframe', exact: true })).toHaveCount(0);
  await expect(shading.locator('option')).toHaveText(['Normal', 'Heights and grades']);
  await tools.uncheck();
  expect(errors).toEqual([]);
});
