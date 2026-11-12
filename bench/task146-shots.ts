import { importOsmCached } from './city-cache.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { defaultScenario } from '../src/fixtures/scenarios.ts';
import { placeCamera } from './geometry-shots.ts';

const phase = process.argv[2] ?? 'before';
const out = 'test-results/task146';
const result = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {bbox:[11.525,48.135,11.545,48.148],drivingSide:'right'});
if (!result.ok) throw new Error('Munich import');
const city = result.city;
city.name = 'Munich westbound lane gain';
const scenario = defaultScenario('grid5x5');
scenario.demand.throughTripsPerHour = Array(24).fill(0);
scenario.demand.personsPerResident = 0;
const project = { city, population: [], scenarios: [scenario] };
const { manifest } = JSON.parse(readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'));
manifest.name = city.name;
manifest.schemaVersion = city.schemaVersion;
manifest.files = Object.fromEntries(Object.entries(project).map(([k, v]) => [`${k}.json`, createHash('sha256').update(JSON.stringify(v)).digest('hex')]));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/^https:\/\//, r => r.abort());
try {
  await page.goto('http://127.0.0.1:5346');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 60000 });
  await page.getByLabel('Open project', { exact: true }).setInputFiles({ name: 'lane-gain.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ manifest, ...project })) });
  await page.waitForFunction(name => { try { return window.cityflows?.city?.()?.name === name; } catch { return false; } }, city.name, { timeout: 120000 });
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  for (const label of ['Basemap', 'Places', 'Entrances and exits']) await page.getByLabel(label, { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const caption = async (text: string, labels: { text: string; x: number; y: number }[] = []) => {
    await page.evaluate(({ text, labels }) => {
      document.getElementById('audit-caption')?.remove();
      const overlay = document.createElement('div'); overlay.id = 'audit-caption';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;font:14px system-ui;color:#272b29';
      const title = document.createElement('div'); title.textContent = text;
      title.style.cssText = 'position:absolute;left:18px;top:16px;background:#fffdf3ed;padding:8px 12px;max-width:1120px'; overlay.append(title);
      const compass = document.createElement('div'); compass.textContent = 'N ↑   W ←'; compass.style.cssText = 'position:absolute;right:20px;top:18px;background:#fffdf3ed;padding:8px';overlay.append(compass);
      for (const label of labels) {
        const p = window.cityflows!.worldToScreen!({ x: label.x, y: label.y });
        const canvas = document.querySelector('canvas[aria-label="City map"]')!;
        const rect = canvas.getBoundingClientRect();
        const el = document.createElement('div'); el.textContent = label.text;
        el.style.cssText = `position:absolute;left:${rect.left + p.x}px;top:${rect.top + p.y}px;background:#fffdf3ed;padding:4px 7px;transform:translate(-50%,-100%);white-space:nowrap;font-size:12px`;
        overlay.append(el);
      }
      document.body.append(overlay);
    }, { text, labels });
  };
  const hide = await page.addStyleTag({ content: 'body *{visibility:hidden!important}canvas.map[aria-hidden="false"],canvas.map3d,#audit-caption,#audit-caption *{visibility:visible!important}' });
  for (const shot of [
    { id: 'locator-2d', center: [140, -410] as [number, number], zoom: 2.4, labels: [{ text: 'Donnersbergerbrücke / Landshuter Allee', x: 15, y: -220 }, { text: 'Arnulfstraße westbound ← · 2→3→5 lanes', x: 270, y: -535 }, { text: 'Historical n:638 complex', x: 85, y: -568 }, { text: 'Eastbound → · 2 lanes', x: 220, y: -455 }] },
    { id: 'gain-close-2d', center: [174, -515] as [number, number], zoom: 9, labels: [{ text: '5 lanes · r:654 · way 134171421 · ← WEST', x: 112, y: -554 }, { text: '3 lanes · r:698 · way 146018786 · ← WEST', x: 215, y: -520 }, { text: 'n:652 · 3→5', x: 165, y: -544 }, { text: 'Eastbound → · r:680 · way 134583817 · 2 lanes', x: 178, y: -483 }] },
  ]) {
    await placeCamera(page, shot.center, shot.zoom); await frames();
    await caption(`TASK-146 · ${phase} · Arnulfstraße east of Donnersbergerbrücke · real CityFlows 2D view`, shot.labels);
    await page.screenshot({ path: `${out}/${phase}-${shot.id}.png` });
  }
  await hide.evaluate(el => el.remove());
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.cityflows?.view3D?.(), {}, { timeout: 120000 });
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 170, y: -516 }, 10, 35, 0));
  await frames();
  await page.addStyleTag({ content: 'body *{visibility:hidden!important}canvas.map3d,#audit-caption,#audit-caption *{visibility:visible!important}' });
  await caption(`TASK-146 · ${phase} · real CityFlows 3D view · north up · westbound ← · r:698 (3 lanes) → r:654 (5), OSM 146018786 → 134171421`);
  await page.screenshot({ path: `${out}/${phase}-gain-close-3d.png` });
  writeFileSync(`${out}/${phase}-browser.json`, JSON.stringify({ errors, phase, scenario: 'paused; zero demand; no simulation steps', cameras: { locator: [140, -410, 2.4], close2d: [174, -515, 9], close3d: [170, -516, 10, 35, 0] } }, null, 2));
  console.log(JSON.stringify({ phase, errors }));
} finally { await browser.close(); }
