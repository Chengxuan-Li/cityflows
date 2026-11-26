import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Page } from '@playwright/test';
import { encodeMp4, encodeWebm } from './encode';
import { formatsOf, frameOf, parseShot, simAt, simStart, type FormatName, type Shot } from './shot';
import type { Stage } from './stage';

// Capture (cinematic-captures branch only): renders a shot from the real app, frame by frame.
//   npm run capture -- <shot.json> [--still=<t>,...] [--mock=<t>,...] [--format=landscape|portrait|all]
//                      [--mp4] [--project=<file>] [--out=<dir>] [--port=<n>]
// Each frame is drawn at twice the size and scaled down. --still renders PNGs at those video
// times with the simulation run to them; --mock renders PNGs without running it (the traffic stays
// at the project's start), for the look and the title. Otherwise every frame renders as JPEG and
// ffmpeg encodes a WebM, and with --mp4 also an H.264 MP4 (see ./encode.ts). --project overrides
// the shot's project file. The output goes to --out, by default
// node_modules/.cache/cityflows/capture/<location>/<shot name>.

const args = process.argv.slice(2);
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const times = (name: string) => option(name)?.split(',').map(Number);

async function main() {
  const shotPath = args.find((a) => !a.startsWith('--'));
  if (!shotPath)
    throw new Error(
      'Usage: npm run capture -- <shot.json> [--still=t,..] [--mock=t,..] [--format=landscape|portrait|all] [--mp4]',
    );
  const shot = parseShot(JSON.parse(readFileSync(shotPath, 'utf8')));
  const project = option('project') ?? shot.project;
  const stills = times('still'),
    mocks = times('mock');
  const wanted = option('format') ?? 'all';
  const formats = wanted === 'all' ? formatsOf(shot) : [wanted as FormatName];
  for (const f of formats) frameOf(shot, f);
  const out = resolve(
    option('out') ??
      join('node_modules/.cache/cityflows/capture', shot.location, basename(shotPath, '.json')),
  );
  if (!project.startsWith('bundled:') && !existsSync(project))
    throw new Error(
      `No project at ${project}. Build it with the location's build-project.ts, or pass --project=<file>.`,
    );
  if (shot.title?.subtitleFont && !existsSync(shot.title.subtitleFont))
    throw new Error(
      `No subtitle font at ${shot.title.subtitleFont}: copy the full TTF there (downloads need the owner's approval).`,
    );
  if (args.includes('--mp4') && (stills || mocks)) throw new Error('--mp4 needs a full render');
  if (args.includes('--mp4')) (await import('./encode')).h264Ffmpeg();
  mkdirSync(out, { recursive: true });

  const port = Number(option('port') ?? 5296);
  const server = spawn(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      '--mode',
      'test',
      '--host',
      'localhost',
      '--port',
      String(port),
      '--strictPort',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += String(d)));
  server.stderr.on('data', (d) => (log += String(d)));
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
  try {
    for (const until = Date.now() + 60000; ;) {
      try {
        if ((await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) })).ok)
          break;
      } catch {
        /* waiting for Vite */
      }
      if (Date.now() > until) throw new Error(log);
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const format of formats) {
      const started = Date.now();
      await renderFormat(shot, format, project, `http://localhost:${port}`, out, stills, mocks);
      console.info(`${format}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  async function renderFormat(
    shot: Shot,
    format: FormatName,
    project: string,
    origin: string,
    out: string,
    stills: number[] | undefined,
    mocks: number[] | undefined,
  ) {
    const frame = frameOf(shot, format);
    const { width: W, canvasHeight: CANVAS_H } = frame;
    const page = await browser.newPage({
      // Set up wide (the app's toolbar wants the room), then fitted to the canvas below.
      viewport: { width: Math.max(W, 1920), height: CANVAS_H + 200 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    try {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // The map's colours follow the appearance: light, whatever the machine's theme.
      await page.addInitScript(() =>
        localStorage.setItem(
          'cityflows.appearance',
          JSON.stringify({ appearance: 'light', matchLighting: false }),
        ),
      );
      await openProject(page, origin, project);
      await page.evaluate(
        async ({ shot, format }) => {
          const url = '/capture/core/stage.ts';
          const { createStage } = (await import(
            /* @vite-ignore */ url
          )) as typeof import('./stage');
          const state = window.cityflows!.appStore!.getState();
          if (state.sidebarOpen) state.toggleSidebar();
          (window as unknown as { captureStage: Stage }).captureStage = await createStage(
            shot,
            format,
          );
        },
        { shot, format },
      );
      await fitCanvas(page, W, CANVAS_H);

      const simTime = () => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS ?? 0);
      const stepTo = async (target: number) => {
        // The run's clock, which the store reads from the engine after every step.
        let now = await page.evaluate(() => window.cityflows!.appStore!.getState().run!.timeS);
        // In chunks, so a long run to the first frame reports progress and never times out.
        while (now < target - 0.05) {
          const next = Math.min(target, now + 600);
          const steps = Math.round((next - now) * 10);
          if (steps > 0) await page.evaluate((n) => window.cityflows!.step(n), steps);
          now = next;
        }
        for (const until = Date.now() + 60000; (await simTime()) < target - 0.06;) {
          if (Date.now() > until) throw new Error(`The sim did not reach ${target}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      const mock = !!mocks;
      if (!mock) await stepTo(simStart(shot));
      const single = stills ?? mocks;
      const frameDir = join(out, format, 'frames');
      if (!single) {
        rmSync(frameDir, { recursive: true, force: true });
        mkdirSync(frameDir, { recursive: true });
      }
      const list =
        single ??
        Array.from({ length: Math.round(shot.duration * shot.fps) }, (_, i) => i / shot.fps);
      for (const [i, t] of list.entries()) {
        if (!mock) await stepTo(simAt(shot, t));
        const data = await page.evaluate(
          async ({ t, type }) => {
            const stage = (window as unknown as { captureStage: Stage }).captureStage;
            stage.show(t);
            return stage.grab(t, type);
          },
          { t, type: single ? ('image/png' as const) : ('image/jpeg' as const) },
        );
        const name = single
          ? join(out, `${format}-${mock ? 'mock' : 'still'}-${t.toFixed(2)}.png`)
          : join(frameDir, `${String(i).padStart(4, '0')}.jpg`);
        writeFileSync(name, Buffer.from(data.split(',')[1]!, 'base64'));
        if (single) console.info(name);
        else if (i % shot.fps === 0)
          console.info(`${format} t=${t.toFixed(1)}s sim=${(await simTime()).toFixed(1)}`);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      if (single) return;
      const name = join(out, `${basename(shotPath!, '.json')}-${format}`);
      encodeWebm(frameDir, shot.fps, `${name}.webm`);
      console.info(`${name}.webm`);
      if (args.includes('--mp4')) {
        const { kbps, size } = encodeMp4(frameDir, shot.fps, `${name}.mp4`);
        console.info(`${name}.mp4 (${kbps} kbit/s, ${(size / 1048576).toFixed(1)} MiB)`);
      }
    } finally {
      await page.close();
    }
  }
}

/** Opens a bundled city by id, or a project file through the toolbar's Open, and waits until
 * the app has it loaded and idle. */
async function openProject(page: Page, origin: string, project: string) {
  const bundled = project.startsWith('bundled:') ? project.slice(8) : undefined;
  await page.goto(`${origin}/?city=${bundled ?? 'grid5x5'}`);
  const ready = () =>
    page.waitForFunction(
      () => {
        const s = window.cityflows?.appStore?.getState();
        return !!s?.session && !s.busy;
      },
      undefined,
      { timeout: 180000 },
    );
  await ready();
  if (bundled) return;
  const before = await page.evaluate(
    () => window.cityflows!.appStore!.getState().session!.project.city.name,
  );
  await page.getByLabel('Open project').setInputFiles(project);
  await page.waitForFunction(
    (before) => {
      const s = window.cityflows!.appStore!.getState();
      return !s.busy && s.session?.project.city.name !== before;
    },
    before,
    { timeout: 180000 },
  );
  await ready();
}

/** Makes the 3D canvas exactly `W` x `H` CSS pixels: the viewport grows by the chrome around it.
 * The layout can settle a frame before three resizes its drawing buffer, and a capture in that
 * frame has the wrong projection, so it waits for the buffer too. */
async function fitCanvas(page: Page, W: number, H: number) {
  const canvas = page.getByLabel('3D city view', { exact: true });
  await canvas.and(page.locator('[data-view="3d"]')).waitFor({ timeout: 60000 });
  const box = (await canvas.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width + (W - Math.round(box.width)),
    height: viewport.height + (H - Math.round(box.height)),
  });
  await page.waitForFunction(
    ({ W, H }) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[aria-label="3D city view"]')!;
      const r = c.getBoundingClientRect();
      return (
        Math.round(r.width) === W &&
        Math.round(r.height) === H &&
        c.width === W * 2 &&
        c.height === H * 2
      );
    },
    { W, H },
    { timeout: 30000 },
  );
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('capture/core/render.ts')) await main();
