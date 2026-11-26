import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, expect } from '@playwright/test';
import { button } from '../../tests/e2e/helpers';
import {
  DURATION_S,
  FPS,
  frames,
  layoutSpaced,
  parseShot,
  renderSubtitle,
  simOffset,
  startS,
  sunAt,
  drawTitle,
  title,
  titleAlpha,
  titleBaseline,
  view,
  windowTop,
} from './shot';

// Intro mock (not a product feature): renders the intro shot frame by frame from the real app.
//   node --experimental-strip-types --import ./bench/register.ts bench/intro/render.ts <project.json> <out-dir> [--still=<s>,...] [--mock=<s>] [--shot=<file>]
// The project comes from bench/intro/build-project.ts. With --still only those times render, as
// single PNGs, for framing the shot; --mock renders one PNG at that time without running the
// simulation (the traffic stays at 07:00), for the look and the title; otherwise every frame
// renders and ffmpeg encodes intro.webm.
// Exposure, camera keys and the frame (16:9 or 9:16) come from bench/intro/shot.json (or
// --shot=<file>, such as bench/intro/shot-vertical.json), as the tuner saves them.
const [projectPath, out] = process.argv.slice(2);
const stills = process.argv
  .find((a) => a.startsWith('--still='))
  ?.slice(8)
  .split(',')
  .map(Number);
const mock = Number(process.argv.find((a) => a.startsWith('--mock='))?.slice(7) ?? NaN);
const shotPath =
  process.argv.find((a) => a.startsWith('--shot='))?.slice(7) ?? 'bench/intro/shot.json';
const port = 5296;

function ffmpeg() {
  const root = join(homedir(), 'AppData/Local/ms-playwright');
  const dir = readdirSync(root)
    .filter((d) => d.startsWith('ffmpeg-'))
    .sort()
    .at(-1);
  if (!dir) throw new Error('No Playwright ffmpeg; run npx playwright install ffmpeg');
  return join(root, dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux');
}

async function main() {
  if (!projectPath || !out) throw new Error('Expected <project.json> <out-dir>');
  const shot = parseShot(JSON.parse(readFileSync(shotPath, 'utf8')));
  const frame = frames[shot.format];
  const { W, H, CANVAS_H, FOV } = frame;
  const single = stills ?? (Number.isFinite(mock) ? [mock] : undefined);
  // The app holds exposure to 1.5; past it, the cut's final pass brightens the rest of the way.
  const appExposure = Math.min(1.5, shot.exposure),
    gain = shot.exposure / appExposure;
  const lockup = {
    ...title,
    x: frame.titleX,
    version: `v${(JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version}`,
  };
  // The subtitle's face: the full Cormorant Garamond Italic, with its discretionary ligatures.
  const cormorant = readFileSync(
    'node_modules/.cache/cityflows/intro/cormorant-garamond-italic-full.ttf',
  ).toString('base64');
  mkdirSync(out!, { recursive: true });
  const frameDir = join(out!, 'frames');
  if (!single) {
    rmSync(frameDir, { recursive: true, force: true });
    mkdirSync(frameDir);
  }
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
    const until = Date.now() + 60000;
    for (;;) {
      try {
        if ((await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) })).ok)
          break;
      } catch {
        /* waiting for Vite */
      }
      if (Date.now() > until) throw new Error(log);
      await new Promise((r) => setTimeout(r, 250));
    }
    const page = await browser.newPage({
      // Set up wide (the app's toolbar wants the room), then fitted to the canvas below.
      viewport: { width: Math.max(W, 1920), height: CANVAS_H + 200 },
      // Rendered at twice the size and scaled down: windows, wires and leaves stay crisp without
      // shimmer.
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    // Lighting is a viewer preference in storage: Clock follows the sim clock's sun.
    await page.addInitScript(
      ({ exposure, season }) => {
        localStorage.setItem(
          'cityflows.lighting',
          JSON.stringify({ mode: 'clock', exposure, season }),
        );
        // Stored under the pre-TASK-341 key, which the app migrates (the season becomes a date).
        // The map's colours follow the appearance; light, whatever the machine's theme.
        localStorage.setItem(
          'cityflows.appearance',
          JSON.stringify({ appearance: 'light', matchLighting: false }),
        );
      },
      { exposure: appExposure, season: shot.season },
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?city=grid5x5`);
    await expect(button(page, 'Play')).toBeEnabled();
    await page.getByLabel('Open project').setInputFiles(projectPath!);
    await expect(page.getByRole('heading', { name: 'London City Airport', level: 1 })).toBeVisible({
      timeout: 120000,
    });
    await expect(button(page, 'Play')).toBeEnabled({ timeout: 120000 });
    await button(page, '3D').click();
    const canvas = page.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-view', '3d', { timeout: 60000 });
    await page.getByLabel('Buildings', { exact: true }).setChecked(true);
    await page.evaluate(() => window.cityflows!.setVisual!({ dropLines: false }));
    // The cut's own detail (bench/intro/detail.ts), loaded into the app's page by the dev server.
    await page.evaluate(async () => {
      const url = '/bench/intro/detail.ts';
      const detail = await import(/* @vite-ignore */ url);
      (window as unknown as { introDetail: unknown }).introDetail = detail.install(
        window.cityflows!.scene3D!(),
        window.cityflows!.city!(),
      );
    });
    await page.evaluate(
      (gain) =>
        (window as unknown as { introDetail: { setGain(g: number): void } }).introDetail.setGain(
          gain,
        ),
      gain,
    );
    // The title's drawing (bench/intro/shot.ts) and the subtitle's font, in the page; the
    // subtitle is set once, as an image.
    await page.addScriptTag({
      content:
        `window.layoutSpaced = ${layoutSpaced.toString()};
` +
        `window.introTitle = ${drawTitle.toString()};
` +
        `window.introSubtitle = ${renderSubtitle.toString()};`,
    });
    await page.evaluate(
      async ({ font, lockup }) => {
        const bytes = Uint8Array.from(atob(font), (c) => c.charCodeAt(0));
        const face = new FontFace('Cormorant Garamond', bytes, {
          weight: '300 700',
          style: 'italic',
        });
        document.fonts.add(await face.load());
        await document.fonts.load('700 110px Arimo');
        await document.fonts.load('400 19px Arimo');
        const page = window as unknown as {
          introSubtitle: typeof renderSubtitle;
          introSubtitleImage: unknown;
        };
        page.introSubtitleImage = await page.introSubtitle(lockup, font);
      },
      { font: cormorant, lockup },
    );
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const [name, on] of [
      ['Basemap', false],
      ['Labels', false],
      ['Places', false],
      ['Shadows', true],
      ['Building details', true],
    ] as const)
      await layers.getByLabel(name, { exact: true }).setChecked(on);
    await button(page, 'Layers').click();
    if (await button(page, 'Hide sidebar').isVisible()) await button(page, 'Hide sidebar').click();
    // Make the canvas exactly W x H: grow the viewport by the chrome around it.
    const box = (await canvas.boundingBox())!;
    const viewport = page.viewportSize()!;
    await page.setViewportSize({
      width: viewport.width + (W - Math.round(box.width)),
      height: viewport.height + (CANVAS_H - Math.round(box.height)),
    });
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(CANVAS_H);
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(W);
    // The layout can settle one frame before Three resizes its drawing buffer. A capture
    // during that frame has the wrong projection and crop, even if its output PNG is W?H.
    await expect
      .poll(() => canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height]))
      .toEqual([W * 2, CANVAS_H * 2]);

    const simTime = () => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS ?? 0);
    const stepTo = async (target: number) => {
      const now = await page.evaluate(() => window.cityflows!.snapshot!().then((s) => s.timeS));
      const steps = Math.round((target - now) * 10);
      if (steps > 0) await page.evaluate((n) => window.cityflows!.step(n), steps);
      await expect.poll(simTime, { timeout: 60000 }).toBeGreaterThanOrEqual(target - 0.06);
    };
    if (!Number.isFinite(mock)) {
      for (let now = 25200; now < startS - 600; now += 600) await stepTo(now + 600);
      await stepTo(startS);
    }

    const times = single ?? Array.from({ length: DURATION_S * FPS }, (_, i) => i / FPS);
    for (const [i, t] of times.entries()) {
      if (!Number.isFinite(mock)) await stepTo(startS + simOffset(t));
      const v = view(shot.keys, t);
      await page.evaluate(
        ({ v, fov, sunS, t }) => {
          (window as unknown as { introDetail: { setTime(t: number): void } }).introDetail.setTime(
            t,
          );
          window.cityflows!.setSunTime3D!(sunS);
          window.cityflows!.setView3D!(v.centre, v.zoom, v.pitch, v.bearing, fov);
        },
        { v, fov: FOV, sunS: sunAt(shot.sun, t), t },
      );
      const png = await page.evaluate(
        async ({ alpha, baseline, W, H, top, title, still }) => {
          const [frame] = await window.cityflows!.capture3D!();
          const image = new Image();
          image.src = frame!;
          await image.decode();
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d')!;
          const scale = image.width / W;
          g.imageSmoothingQuality = 'high';
          g.drawImage(image, 0, top * scale, image.width, H * scale, 0, 0, W, H);
          const lockup = window as unknown as {
            introTitle: typeof drawTitle;
            introSubtitleImage: Parameters<typeof drawTitle>[4];
          };
          if (alpha > 0) lockup.introTitle(g, title, baseline, alpha, lockup.introSubtitleImage);
          return c.toDataURL(still ? 'image/png' : 'image/jpeg', 0.95);
        },
        {
          alpha: titleAlpha(t),
          baseline: titleBaseline(frame, t, v.pitch),
          W,
          H,
          top: Math.round(windowTop(frame, t)),
          title: lockup,
          still: !!single,
        },
      );
      const name = single
        ? join(out!, Number.isFinite(mock) ? 'still-mock.png' : `still-${t.toFixed(2)}.png`)
        : join(frameDir, `${String(i).padStart(4, '0')}.jpg`);
      writeFileSync(name, Buffer.from(png.split(',')[1]!, 'base64'));
      if (i % FPS === 0) console.info(`t=${t.toFixed(1)}s sim=${(await simTime()).toFixed(1)}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await browser.close();
    server.kill();
  }
  if (single) return;
  // Playwright's ffmpeg reads JPEG frames only as one concatenated stream (image2pipe, mjpeg)
  // from a file, and writes VP9 WebM.
  const stream = join(out!, 'frames.mjpeg');
  writeFileSync(
    stream,
    Buffer.concat(
      readdirSync(frameDir)
        .sort()
        .map((name) => readFileSync(join(frameDir, name))),
    ),
  );
  const encoded = spawnSync(
    ffmpeg(),
    [
      '-y',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-framerate',
      String(FPS),
      '-i',
      stream,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-row-mt',
      '1',
      join(out!, 'intro.webm'),
    ],
    { stdio: 'inherit' },
  );
  if (encoded.status !== 0) throw new Error('ffmpeg failed');
  console.info(join(out!, 'intro.webm'));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('bench/intro/render.ts')) await main();
