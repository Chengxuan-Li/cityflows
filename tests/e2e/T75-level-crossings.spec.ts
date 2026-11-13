import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, importOsm, pageErrors } from './helpers';
import { compile } from '../../src/network';
import { crossingCounts, noLevelCrossings } from '../../src/render/level-crossings';
import type { Vec2 } from '../../src/geo/vec2';

async function shot(canvas: Locator, info: TestInfo, name: string) {
  await canvas.screenshot({ path: info.outputPath(name) });
  if (process.env.CITYFLOWS_SHOT_DIR) {
    await mkdir(process.env.CITYFLOWS_SHOT_DIR, { recursive: true });
    await canvas.screenshot({ path: join(process.env.CITYFLOWS_SHOT_DIR, name) });
  }
}
async function centre(page: Page, point: Vec2, view: '2d' | '3d', zoom: number) {
  if (view === '3d') {
    const canvas = page.getByLabel('3D city view', { exact: true }),
      frames = Number(await canvas.getAttribute('data-frames'));
    await page.evaluate(({ point, zoom }) => window.cityflows!.setView3D!(point, zoom, 48, 20), {
      point,
      zoom,
    });
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frames')))
      .toBeGreaterThan(frames);
    return;
  }
  await page.evaluate(
    ({ point: p, zoom }) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
        r = c.getBoundingClientRect();
      const scale = () =>
        window.cityflows!.worldToScreen!({ x: 1, y: 0 }).x -
        window.cityflows!.worldToScreen!({ x: 0, y: 0 }).x;
      const wheel = (to: number, x: number, y: number) =>
        c.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(to / scale()) / 0.0015,
            clientX: r.x + x,
            clientY: r.y + y,
            bubbles: true,
            cancelable: true,
          }),
        );
      if (scale() > 0.5) wheel(0.5, r.width / 2, r.height / 2);
      const v = window.cityflows!.worldToScreen!(p);
      wheel(zoom, v.x, v.y);
    },
    { point, zoom },
  );
  const map = page.getByLabel('City map', { exact: true }),
    box = (await map.boundingBox())!,
    v = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
  await page.mouse.move(box.x + v.x, box.y + v.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
}
for (const place of [
  { extract: 'munich-donnersberger', kind: 'tram', name: 'schrenkstrasse', node: 82762922 },
  { extract: 'sindelfingen-a81', kind: 'rail', name: 'sindelfingen-rail', node: 344711048 },
  { extract: 'sindelfingen-a81', kind: 'rail', name: 'sindelfingen-quiet-rail', node: 352953663 },
] as const)
  test(`T75 ${place.name} crossing in both views, shared equipment and Rail toggle`, async ({
    page,
  }, info) => {
    test.setTimeout(400_000);
    page.setDefaultTimeout(20_000);
    const errors = pageErrors(page);
    await page.route('https://**/*', (route) => route.abort());
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await importOsm(page, `fixtures/osm/${place.extract}.osm`);
    const source = await city(page),
      result = compile(source);
    if (!result.ok) throw Error('compile');
    const facilities = result.compiled.rail!.facilities!;
    const crossing = facilities.find((f) =>
      f.nodes.some((id) => source.rail!.nodes[id]!.osmId === place.node),
    )!;
    expect(crossing.kind).toBe(place.kind);
    const point = source.rail!.nodes[crossing.nodes[0]!]!.pos;
    const expected = JSON.stringify(crossingCounts(facilities));
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' }),
      toggle = layers.getByLabel('Rail', { exact: true });
    for (const label of ['Basemap', 'Entrances and exits', 'Overhead lines'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    await button(page, 'Layers').click();
    for (const view of ['2d', '3d'] as const) {
      if (view === '3d') await button(page, '3D').click();
      const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
      await expect(canvas).toHaveAttribute('data-level-crossings', expected);
      await centre(page, point, view, view === '2d' ? 14 : 24);
      await shot(canvas, info, `${place.name}-${view}.png`);
      const middle = crossing.approaches.reduce(
        (p, a) => ({ x: p.x + a.pos.x, y: p.y + a.pos.y }),
        { ...point },
      );
      middle.x /= crossing.approaches.length + 1;
      middle.y /= crossing.approaches.length + 1;
      if (view === '3d') await page.getByLabel('Buildings', { exact: true }).uncheck();
      await centre(page, middle, view, view === '2d' ? 20 : 28);
      await shot(canvas, info, `${place.name}-detail-${view}.png`);
      await button(page, 'Layers').click();
      await toggle.uncheck();
      await expect(canvas).toHaveAttribute(
        'data-level-crossings',
        JSON.stringify(noLevelCrossings),
      );
      await toggle.check();
      await expect(canvas).toHaveAttribute('data-level-crossings', expected);
      await button(page, 'Layers').click();
    }
    expect(errors).toEqual([]);
  });
