import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { placeCamera } from '../../bench/geometry-shots';
import { compile, signalStateAt } from '../../src/network';
import { cityGrades } from '../../src/render/grades';
import { DeckCoverage } from '../../src/render/layers/shadows';
import { signalHeads } from '../../src/render/layers/signals';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { button, city, clockTimeS, importOsm, metrics, pageErrors, stateHash } from './helpers';

test('V97 shadows expose changing under-deck signals and remove all effects when off @smoke', async ({
  page,
}, info) => {
  // CI's runner imports Munich and steps two signal phases on a software GPU; 120 s timed out there.
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  // TASK-131's approach heads are outside the deck. Add a controlled ground signal to the
  // cloned map at OSM node 20925330; all imported positions and road geometry stay intact.
  const source = structuredClone(await city(page));
  const before = compile(source);
  if (!before.ok) throw new Error('Munich must compile');
  const node = Object.values(source.nodes).find((n) => n.provenance.osmIds?.includes(20925330))!;
  expect(node.layer).toBe(0);
  const approach = before.compiled.nodes[before.compiled.index.node.get(node.id)!]!;
  const movement = before.compiled.movements[approach.movements[0]!]!;
  const roadId = (lane: number) => before.compiled.roads[before.compiled.lanes[lane]!.road]!.id;
  node.control = 'signal';
  node.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 30, groups: [{ from: roadId(movement.fromLane), to: roadId(movement.toLane) }] },
      { durationS: 60, groups: [] },
    ],
  };
  const result = compile(source);
  if (!result.ok) throw new Error('Controlled under-deck signal must compile');
  const net = result.compiled,
    signalNode = net.nodes[net.index.node.get(node.id)!]!,
    grades = cityGrades(net, source),
    coverage = new DeckCoverage(net, grades.roadGrades, grades.nodeGrades);
  const head = signalHeads(net, signalNode).find((h) => coverage.covers(h.x, h.y, 0))!;
  expect(head, 'a generated ground signal head covered by a higher deck').toBeDefined();
  const scenario = defaultScenario('grid5x5', 97);
  const colors = [0, 30, 102].map((offset) => {
    const state = signalStateAt(signalNode.signal!, scenario.startS + offset);
    return (
      state.state === 'green' &&
      signalNode.signal!.phases[state.phase]!.movements.includes(head.movement)
    );
  });
  expect(colors).toEqual([true, false, true]);
  await info.attach('Covered signal fixture', {
    body: JSON.stringify({ node: node.id, osmNodeId: 20925330, head, green: colors }),
    contentType: 'application/json',
  });
  const { manifest } = JSON.parse(readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'));
  const project = { city: source, population: [], scenarios: [scenario] };
  manifest.name = source.name;
  manifest.schemaVersion = source.schemaVersion;
  manifest.files = Object.fromEntries(
    Object.entries(project).map(([key, value]) => [
      `${key}.json`,
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ]),
  );
  await page.getByLabel('Open project').setInputFiles({
    name: 'under-deck-signal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  const shadows = layers.getByLabel('Shadows', { exact: true });
  await expect(shadows).toBeChecked();
  for (const label of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await button(page, 'Layers').click();
  await placeCamera(page, [head.x, head.y], 10);
  const canvas = page.getByLabel('City map', { exact: true });
  await expect
    .poll(async () => JSON.parse((await canvas.getAttribute('data-grade-effects'))!).tunnels)
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe((await metrics(page)).timeS);
  const screen = await page.evaluate((head) => window.cityflows!.worldToScreen!(head), head);
  const box = (await canvas.boundingBox())!;
  const clip = {
    x: Math.round(box.x + screen.x - 4),
    y: Math.round(box.y + screen.y - 4),
    width: 8,
    height: 8,
  };
  const green = await page.screenshot({ clip, path: info.outputPath('under-deck-green-head.png') });
  await canvas.screenshot({ path: info.outputPath('under-deck-green.png') });
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
  const red = await page.screenshot({ clip, path: info.outputPath('under-deck-red-head.png') });
  expect(red.equals(green)).toBe(false);
  expect(red.equals(covered)).toBe(false);
  await canvas.screenshot({ path: info.outputPath('under-deck-red.png') });
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
    path: info.outputPath('under-deck-green-again-head.png'),
  });
  expect(greenAgain.equals(red)).toBe(false);
  expect(greenAgain.equals(covered)).toBe(false);
  const start = (await metrics(page)).timeS;
  await button(page, 'Play').click();
  await placeCamera(page, [5, -285], 1);
  await expect.poll(() => clockTimeS(page)).toBeGreaterThan(start + 1);
  await placeCamera(page, [head.x, head.y], 10);
  await canvas.screenshot({ path: info.outputPath('under-deck-playing.png') });
  await button(page, 'Pause').click();
  await expect(button(page, 'Play')).toBeEnabled();
  expect((await metrics(page)).timeS).toBeGreaterThan(start + 1);
  expect(errors).toEqual([]);
});
