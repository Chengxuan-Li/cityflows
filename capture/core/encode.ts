import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

// Capture: video files from a render's JPEG frames. WebM (VP9) with Playwright's own ffmpeg,
// which the browsers install brings; MP4 (H.264) with an ffmpeg that has libx264, which
// Playwright's does not: `CITYFLOWS_FFMPEG`, or `ffmpeg` on PATH.

function playwrightFfmpeg() {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright'));
  const dir = existsSync(root)
    ? readdirSync(root)
        .filter((d) => d.startsWith('ffmpeg-'))
        .sort()
        .at(-1)
    : undefined;
  if (!dir) throw new Error('No Playwright ffmpeg; run npx playwright install ffmpeg');
  const name = { win32: 'ffmpeg-win64.exe', darwin: 'ffmpeg-mac' }[process.platform as string];
  return join(root, dir, name ?? 'ffmpeg-linux');
}

/** An ffmpeg with libx264, or a clear error saying where to put one. */
export function h264Ffmpeg() {
  const candidates = [process.env.CITYFLOWS_FFMPEG, 'ffmpeg'].filter((c): c is string => !!c);
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (probe.status === 0 && /\blibx264\b/.test(probe.stdout)) return bin;
  }
  throw new Error(
    "--mp4 needs an ffmpeg built with libx264 (Playwright's has no H.264). Put one on PATH or " +
      'set CITYFLOWS_FFMPEG to its path' +
      (process.env.CITYFLOWS_FFMPEG ? ` (${process.env.CITYFLOWS_FFMPEG} has no libx264)` : '') +
      '.',
  );
}

function run(bin: string, args: string[]) {
  const result = spawnSync(bin, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed (${bin} ${args.join(' ')})`);
}

/** VP9 WebM. Playwright's ffmpeg reads JPEG frames only as one concatenated stream (image2pipe,
 * mjpeg) from a file. */
export function encodeWebm(frameDir: string, fps: number, out: string) {
  const stream = join(frameDir, '..', 'frames.mjpeg');
  writeFileSync(
    stream,
    Buffer.concat(
      readdirSync(frameDir)
        .filter((n) => n.endsWith('.jpg'))
        .sort()
        .map((name) => readFileSync(join(frameDir, name))),
    ),
  );
  run(playwrightFfmpeg(), [
    '-y',
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-framerate',
    String(fps),
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
    out,
  ]);
  rmSync(stream);
}

const MP4_LIMIT = 30 * 1024 * 1024;
/** H.264 MP4 under 30 MB (so it reaches a phone): libx264 two-pass at up to 16 Mbit/s, BT.709
 * limited range, moov first. A second try at a lower rate if the first lands over the limit. */
export function encodeMp4(frameDir: string, fps: number, out: string) {
  const bin = h264Ffmpeg();
  const frames = readdirSync(frameDir).filter((n) => n.endsWith('.jpg')).length;
  const seconds = frames / fps;
  const log = join(frameDir, '..', 'x264-pass');
  let kbps = Math.min(16000, Math.floor((0.94 * MP4_LIMIT * 8) / seconds / 1000));
  for (let attempt = 0; attempt < 2; attempt++) {
    const common = [
      '-y',
      '-f',
      'image2',
      '-framerate',
      String(fps),
      '-i',
      join(frameDir, '%04d.jpg'),
      // The frames are full-range sRGB JPEGs; the video is BT.709 limited range.
      '-vf',
      'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-profile:v',
      'high',
      '-b:v',
      `${kbps}k`,
      '-maxrate',
      `${Math.round(kbps * 1.5)}k`,
      '-bufsize',
      `${kbps * 2}k`,
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-passlogfile',
      log,
    ];
    run(bin, [
      ...common,
      '-pass',
      '1',
      '-an',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    run(bin, [...common, '-pass', '2', '-movflags', '+faststart', out]);
    for (const f of readdirSync(join(frameDir, '..')).filter((n) => n.startsWith('x264-pass')))
      rmSync(join(frameDir, '..', f));
    const size = statSync(out).size;
    if (size < MP4_LIMIT) return { kbps, size };
    kbps = Math.floor((kbps * MP4_LIMIT * 0.9) / size);
  }
  throw new Error(`${out} is still over 30 MB`);
}
