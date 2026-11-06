import { expect, test, type Page } from '@playwright/test';
import { basename } from 'node:path';
import { compile } from '../../src/network';
import { button, city, fitted, metrics, pageErrors, stateHash, writeMetrics } from './helpers';

const viewport = { width: 1440, height: 900 };
const video = { width: 1440, height: 900 };
test.use({ video: { mode: 'on', size: video }, viewport });

/** Fixed 0.1 s steps replayed on both sides of the share: 15 simulated minutes. */
const replaySteps = 9000;

async function replay(page: Page) {
  await page.evaluate((steps) => window.cityflows!.step(steps), replaySteps);
  return { hash: await stateHash(page), metrics: await metrics(page) };
}

test('demo D, import-edit-share: import OSM, fix a turn restriction, save, reopen elsewhere and replay with equal hashes', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Import').click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await dialog.getByLabel('OSM file').setInputFiles('fixtures/osm/downtown.osm');
  await dialog.getByRole('button', { name: 'Import roads' }).click();
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    /\d+ roads · 0 errors · \d+ warnings/,
    { timeout: 60_000 },
  );
  const summary = await dialog.getByRole('status').innerText();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Accept city' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.attribution')).toContainText('OpenStreetMap');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('imported.png') });

  // Pick a junction where the import turned an OSM restriction into banned movements and lift
  // one of them in the Turns list, as a player fixing a mapped restriction would. Signalized
  // junctions are skipped: there the editor rightly rejects a lifted ban that merges two lanes
  // into one under the same green.
  const imported = await city(page);
  const compiled = compile(imported);
  if (!compiled.ok) throw new Error('Imported city must compile');
  const screen = fitted(compiled.compiled, imported);
  const candidates = Object.values(imported.nodes).filter(
    ({ control, turnRules }) =>
      control !== 'signal' &&
      turnRules.some(({ allowed, provenance }) => !allowed && provenance.source === 'osm'),
  );
  expect(candidates.length).toBeGreaterThan(0);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  let node: (typeof candidates)[number] | undefined;
  for (const candidate of candidates.sort((a, b) => a.id.localeCompare(b.id))) {
    const at = await screen(page, candidate.pos);
    await page.mouse.click(at.x, at.y);
    const heading = inspector.getByRole('heading', { level: 2 });
    if ((await heading.count()) && (await heading.innerText()).endsWith(` ${candidate.id}`)) {
      node = candidate;
      break;
    }
    await page.keyboard.press('Escape');
  }
  expect(node, 'a restricted junction that a click selects').toBeDefined();
  const at = await screen(page, node!.pos);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.getByText('Turns', { exact: true }).click();
  const ban = node!.turnRules.find(
    ({ allowed, provenance }) => !allowed && provenance.source === 'osm',
  )!;
  // OSM restrictions may name a lane; the Turns list numbers lanes from 1.
  const lane = (index?: number) => (index === undefined ? '\\d+' : String(index + 1));
  const turn = inspector
    .getByRole('button', {
      name: new RegExp(
        `^${ban.from} lane ${lane(ban.fromLane)} → ${ban.to} lane ${lane(ban.toLane)}$`,
      ),
    })
    .first();
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  const label = (await turn.getAttribute('aria-label'))!;
  await turn.click();
  await expect(turn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  const [, fromLane, toLane] = label.match(/lane (\d+) → .* lane (\d+)$/)!;
  const fix = {
    from: ban.from,
    to: ban.to,
    fromLane: Number(fromLane) - 1,
    toLane: Number(toLane) - 1,
    allowed: true,
    provenance: { source: 'authored' },
  };
  expect((await city(page)).nodes[node!.id]!.turnRules).toContainEqual(fix);
  await page.screenshot({ path: info.outputPath('turn-fixed.png') });

  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.cityflows$/);
  const archive = info.outputPath(download.suggestedFilename());
  await download.saveAs(archive);
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const here = await replay(page);
  expect(here.metrics.trips.completed + here.metrics.trips.driving).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('replayed-here.png') });

  // Someone else: a fresh browser context with its own storage opens the shared file.
  const elsewhere = await browser.newContext({
    baseURL,
    viewport,
    recordVideo: { dir: info.outputPath('reopened'), size: video },
  });
  const other = await elsewhere.newPage();
  const otherErrors = pageErrors(other);
  await other.route('https://**/*', (route) => route.abort());
  await other.goto('/');
  await expect(button(other, 'Play')).toBeEnabled();
  await other.getByLabel('Open project').setInputFiles(archive);
  await expect(other.getByRole('heading', { name: imported.name, level: 1 })).toBeVisible();
  await expect(button(other, 'Play')).toBeEnabled();
  await expect(other.locator('.attribution')).toContainText('OpenStreetMap');
  expect((await city(other)).nodes[node!.id]!.turnRules).toContainEqual(fix);
  const there = await replay(other);
  await other.screenshot({ path: info.outputPath('replayed-elsewhere.png') });
  const otherVideo = other.video()!;
  await elsewhere.close();
  expect(there.hash).toBe(here.hash);
  expect(there.metrics.trips).toEqual(here.metrics.trips);
  expect(there.metrics.meanTravelTimeS).toBe(here.metrics.meanTravelTimeS);
  expect(otherErrors).toEqual([]);

  await writeMetrics(info, {
    demo: 'D, import-edit-share (fixtures/osm/downtown.osm)',
    importSummary: summary,
    restrictedJunctions: candidates.length,
    junction: node!.id,
    osmRestriction: ban,
    fixedTurn: fix,
    savedFile: download.suggestedFilename(),
    replaySteps,
    replayedSimTimeS: here.metrics.timeS,
    hash: { here: here.hash, elsewhere: there.hash },
    trips: { here: here.metrics.trips, elsewhere: there.metrics.trips },
    failedByReason: here.metrics.failedByReason,
    meanTravelTimeS: {
      here: here.metrics.meanTravelTimeS,
      elsewhere: there.metrics.meanTravelTimeS,
    },
    videos: ['video.webm', `reopened/${basename(await otherVideo.path())}`],
  });
  expect(errors).toEqual([]);
});
