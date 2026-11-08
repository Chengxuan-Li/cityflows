import { expect, test } from '@playwright/test';
import { buildCity } from '../../src/fixtures/build-city';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { City } from '../../src/schema';
import { compile } from '../../src/network';
import { placeStreet } from '../../src/render/street';
import { button, pageErrors } from './helpers';

test('V117 all access rules change their actual sign faces in both views @smoke', async ({
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page),
    b = buildCity('Access signs', 1);
  for (const [i, rule] of (['no', 'destination', 'delivery', 'private'] as const).entries())
    b.road(b.node(-20, i * 20), b.node(50, i * 20)).access = { all: rule };
  const fixture: {
    city: City;
    manifest: { name: string; schemaVersion: number; files: Record<string, string> };
  } = JSON.parse(readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'));
  fixture.city = b.city;
  fixture.manifest.name = b.city.name;
  fixture.manifest.schemaVersion = b.city.schemaVersion;
  fixture.manifest.files['city.json'] = createHash('sha256')
    .update(JSON.stringify(b.city))
    .digest('hex');
  const project = JSON.stringify(fixture);
  const compiled = compile(b.city);
  if (!compiled.ok) throw Error('compile');
  const signs = placeStreet(compiled.compiled, b.city, []).signs;
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.getByLabel('Open project').setInputFiles({
    name: 'signs.cityflows.json',
    mimeType: 'application/json',
    buffer: Buffer.from(project),
  });
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  await layers.getByLabel('Lane markings', { exact: true }).uncheck();
  await layers.getByLabel('Street lights', { exact: true }).uncheck();
  await button(page, 'Layers').click();
  for (const three of [false, true]) {
    if (three) await button(page, '3D').click();
    const canvas = page.getByLabel(three ? '3D city view' : 'City map', { exact: true });
    const images: Buffer[][] = [];
    for (const theme of ['de', 'us', 'uk'] as const) {
      await button(page, 'Layers').click();
      await layers.getByLabel('Marking style').selectOption(theme);
      await button(page, 'Layers').click();
      await expect(canvas).toHaveAttribute('data-marking-theme', theme);
      const faces: Buffer[] = [];
      for (const sign of signs) {
        if (three)
          await page.evaluate((pos) => window.cityflows!.setView3D!(pos, 55, 25, 270), sign.pos);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const box = (await canvas.boundingBox())!;
        const point = three
          ? { x: box.width / 2, y: box.height / 2 - 110 }
          : await page.evaluate((pos) => window.cityflows!.worldToScreen!(pos), sign.pos);
        const clip = {
          x: box.x + Math.max(0, point.x - 100),
          y: box.y + Math.max(0, point.y - 60),
          width: 200,
          height: 140,
        };
        faces.push(await page.screenshot({ clip }));
      }
      images.push(faces);
      await canvas.screenshot({
        path: testInfo.outputPath(`V117-signs-${theme}${three ? '-3d' : ''}.png`),
      });
    }
    for (let i = 0; i < signs.length; i++) {
      expect(images[0]![i]!.equals(images[1]![i]!)).toBe(false);
      expect(images[1]![i]!.equals(images[2]![i]!)).toBe(false);
    }
  }
  expect(errors).toEqual([]);
});
