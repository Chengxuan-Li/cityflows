import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { decode } from 'fast-png';

// TASK-292: compare two production builds in alternating order. Redirect stdout to JSONL.
// node bench/browser-load.mjs <main build dir> <branch build dir> <rounds> [--identity]
// --identity hashes the paused 2D canvas with SwiftShader at two zooms in all six cities.
const [main, branch, rounds, mode] = process.argv.slice(2);
if (!main || !branch || !(Number(rounds) > 0)) throw new Error('Expected two builds and rounds');
const identity = mode === '--identity';
const cities = ['york', 'freiburg', 'philadelphia', 'munich'];
if (identity) cities.push('luebeck', 'sindelfingen');
const builds = [
  { name: 'main', dir: main, port: process.env.CITYFLOWS_TEST_PORT ?? '5492' },
  { name: 'branch', dir: branch, port: process.env.CITYFLOWS_PRODUCTION_TEST_PORT ?? '5592' },
];

async function waitForServer(base) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(base, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) return;
    await setTimeout(250);
  }
  throw new Error(`Preview did not start at ${base}`);
}

async function frameStats(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        const end = performance.now() + 3000;
        const step = (time) => {
          times.push(time);
          if (time < end || times.length < 2) requestAnimationFrame(step);
          else {
            const deltas = times.slice(1).map((t, i) => t - times[i]);
            deltas.sort((a, b) => a - b);
            resolve({ p95Ms: deltas[Math.ceil(deltas.length * 0.95) - 1], samples: deltas.length });
          }
        };
        requestAnimationFrame(step);
      }),
  );
}

async function sceneHashes(page) {
  const canvas = page.locator('canvas[data-view="2d"]');
  // The engine can enable Play before the renderer has consumed its first paused snapshot.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  const hash = async () => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const { width, height, data } = decode(await canvas.screenshot({ animations: 'disabled' }));
    return createHash('sha256').update(`${width}x${height}`).update(data).digest('hex');
  };
  const overview = await hash();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1500);
  await page.mouse.move(1, 1);
  return { overview, street: await hash() };
}

async function sample(browser, city, build) {
  const base = `http://localhost:${build.port}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: identity ? 'reduce' : 'no-preference',
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem(
        'cityflows.appearance',
        JSON.stringify({ appearance: 'light', matchLighting: false }),
      );
      localStorage.setItem(
        'cityflows.lighting',
        JSON.stringify({ mode: 'day', exposure: 1, season: 'equinox' }),
      );
      localStorage.setItem('cityflows.hints', 'done');
    });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/?city=${city}`);
    const ready = await page.waitForFunction(
      () => {
        const first = performance.getEntriesByName('cityflows:first-frame')[0];
        const play = document.querySelector('button[aria-label="Play"]');
        if (!first || !play || play.disabled) return null;
        const start = performance.getEntriesByType('navigation')[0].loadEventEnd;
        return { firstFrameMs: first.startTime - start, readyMs: performance.now() - start };
      },
      null,
      { timeout: 120_000 },
    );
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const load = await ready.jsonValue();
    const result = identity
      ? await sceneHashes(page)
      : await play.click().then(() => frameStats(page));
    if (errors.length) throw new Error(errors.join('\n'));
    return { ...load, ...result };
  } finally {
    await context.close();
  }
}

const servers = builds.map(({ dir, port }) =>
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--outDir',
      dir,
      '--port',
      port,
      '--strictPort',
      '--host',
      'localhost',
    ],
    { stdio: 'ignore', windowsHide: true },
  ),
);
let browser;
try {
  await Promise.all(builds.map(({ port }) => waitForServer(`http://localhost:${port}`)));
  browser = await chromium.launch({
    args: identity
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  for (let round = 0; round < Number(rounds); round++) {
    const order = round % 2 === 0 ? builds : [...builds].reverse();
    for (const city of cities) {
      for (const build of order) {
        const result = await sample(browser, city, build);
        console.log(JSON.stringify({ city, build: build.name, round, ...result }));
      }
    }
  }
} finally {
  await browser?.close();
  for (const server of servers) server.kill();
}
