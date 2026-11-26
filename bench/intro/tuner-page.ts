import {
  DURATION_S,
  FPS,
  frames,
  parseShot,
  renderSubtitle,
  simOffset,
  startS,
  sunAt,
  drawTitle as drawLockup,
  title,
  titleAlpha,
  titleBaseline,
  view,
  windowTop,
  type Frame,
  type Key,
  type Season,
  type Shot,
  type SubtitleImage,
} from './shot';

// Intro mock (not a product feature): the tuner page bench/intro/tuner.ts serves. It runs the real
// app in a frame the size of the render's canvas and shows the 1080-row window the video keeps.

type Vec2 = { x: number; y: number };
interface Layers {
  [layer: string]: boolean;
}
interface AppState {
  busy: boolean;
  session: { project: { city: { name: string } } } | null;
  viewMode: '2d' | '3d';
  buildings: boolean;
  layers: Layers;
  sidebarOpen: boolean;
  open(source: File): Promise<void>;
  control(command: 'restart' | 'step', steps?: number): Promise<void>;
  toggleView(): void;
  toggleBuildings(): void;
  toggleLayer(layer: string): void;
  toggleSidebar(): void;
}
interface Debug {
  appStore?: { getState(): AppState };
  step(steps: number): Promise<void>;
  snapshot?: () => Promise<{ timeS: number }>;
  view3D?: () => { centre: Vec2; zoom: number; pitch: number; bearing: number } | null;
  setView3D?: (centre: Vec2, zoom: number, pitch: number, bearing: number, fov: number) => void;
  setVisual?: (next: { exposure?: number; date?: string; dropLines?: boolean }) => void;
  setSunTime3D?: (timeS: number | null) => void;
}
interface IntroDetail {
  setTime(t: number): void;
  setEnabled(on: boolean): void;
  setGain(gain: number): void;
}
type AppWindow = Window & {
  cityflows?: Debug & { scene3D?: () => unknown };
  introDetail?: IntroDetail;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLDivElement>('frame'),
  iframe = $<HTMLIFrameElement>('app'),
  overlay = $<HTMLCanvasElement>('overlay'),
  windowBox = $<HTMLDivElement>('window'),
  status = $<HTMLDivElement>('status'),
  time = $<HTMLInputElement>('time'),
  clock = $<HTMLDivElement>('clock'),
  play = $<HTMLButtonElement>('play'),
  rewind = $<HTMLButtonElement>('rewind'),
  snap = $<HTMLButtonElement>('snap'),
  full = $<HTMLInputElement>('full'),
  exposure = $<HTMLInputElement>('exposure'),
  exposureValue = $<HTMLInputElement>('exposureValue'),
  sunStart = $<HTMLInputElement>('sunStart'),
  sunStartValue = $<HTMLSpanElement>('sunStartValue'),
  sunEnd = $<HTMLInputElement>('sunEnd'),
  sunEndValue = $<HTMLSpanElement>('sunEndValue'),
  sunChange = $<HTMLInputElement>('sunChange'),
  sunNow = $<HTMLSpanElement>('sunNow'),
  season = $<HTMLSelectElement>('season'),
  keysBody = $<HTMLTableSectionElement>('keys'),
  addKey = $<HTMLButtonElement>('addKey'),
  viewReadout = $<HTMLDivElement>('viewReadout'),
  save = $<HTMLButtonElement>('save'),
  revert = $<HTMLButtonElement>('revert');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The app's Clock light takes a day of the year (TASK-341); the shot keeps its season.
const seasonDates: Record<Season, string> = {
  summer: '2026-06-21',
  equinox: '2026-03-21',
  winter: '2026-12-21',
};
async function until<T>(get: () => T | null | undefined | false, what: string, ms = 180000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = get();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(100);
  }
}
const clockText = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

let shot: Shot;
let saved = '';
let t = 0;
let canvasOffset = { left: 0, top: 0 };
let scale = 0.5;
const app = () => iframe.contentWindow as AppWindow;
const debug = () => app().cityflows!;
const store = () => debug().appStore!.getState();

function say(text: string) {
  status.textContent = text;
}
function markDirty() {
  const dirty = JSON.stringify(shot) !== saved;
  save.disabled = !dirty;
  revert.disabled = !dirty;
}

// ---- traffic: the sim only steps forward; Rewind restarts the run and steps back to the shot.
let simS = 0;
let stepping: Promise<void> = Promise.resolve();
async function readSim() {
  simS = (await debug().snapshot!()).timeS;
  return simS;
}
async function stepTo(target: number, report = false) {
  const now = await readSim();
  let steps = Math.round((target - now) * 10);
  while (steps > 0) {
    const n = Math.min(steps, 6000);
    await debug().step(n);
    steps -= n;
    if (report) say(`Running traffic to the shot… ${clockText(await readSim())}`);
  }
  await readSim();
}
function followSim() {
  const target = startS + simOffset(t);
  stepping = stepping.then(() => (target > simS + 0.05 ? stepTo(target) : undefined));
  return stepping.then(updateClock);
}
async function rewindTraffic() {
  setBusy(true);
  say('Rewinding traffic…');
  await store().control('restart');
  await until(() => !store().busy, 'restart');
  await stepTo(startS + simOffset(t), true);
  say('Ready.');
  setBusy(false);
  updateClock();
}

// ---- camera and frame
function applyCamera() {
  const v = view(shot.keys, t);
  debug().setView3D!(v.centre, v.zoom, v.pitch, v.bearing, fmt.FOV);
}
function layout() {
  const { W, H, CANVAS_H } = fmt;
  const showFull = full.checked;
  const rows = showFull ? CANVAS_H : H;
  scale = Math.min(1, (frame.parentElement!.clientWidth - 2) / W, (innerHeight - 90) / rows);
  frame.style.width = `${W * scale}px`;
  frame.style.height = `${rows * scale}px`;
  const top = showFull ? 0 : Math.round(windowTop(fmt, t));
  iframe.style.transform = `scale(${scale})`;
  iframe.style.left = `${-canvasOffset.left * scale}px`;
  iframe.style.top = `${(-canvasOffset.top - top) * scale}px`;
  windowBox.hidden = !showFull;
  windowBox.style.top = `${Math.round(windowTop(fmt, t)) * scale}px`;
  windowBox.style.width = `${W * scale}px`;
  windowBox.style.height = `${H * scale}px`;
  drawTitle();
}
function drawTitle() {
  const top = full.checked ? Math.round(windowTop(fmt, t)) : 0;
  overlay.width = fmt.W;
  overlay.height = full.checked ? fmt.CANVAS_H : fmt.H;
  overlay.style.width = `${fmt.W * scale}px`;
  overlay.style.height = `${overlay.height * scale}px`;
  const g = overlay.getContext('2d')!;
  const alpha = titleAlpha(t);
  if (alpha <= 0) return;
  drawLockup(
    g,
    lockup,
    top + titleBaseline(fmt, t, view(shot.keys, t).pitch),
    alpha,
    subtitleImage,
  );
}
const lockup = { ...title };
let subtitleImage: SubtitleImage | undefined;
// The shot's frame, 16:9 or 9:16.
let fmt: Frame = frames.landscape;
function updateClock() {
  const target = startS + simOffset(t);
  const behind = simS > target + 0.2;
  clock.textContent =
    `t ${t.toFixed(2)} s · frame ${Math.round(t * FPS)} · shot clock ${clockText(target)} · ` +
    `traffic ${clockText(simS)}${behind ? ' (ahead: Rewind to replay)' : ''}`;
}
function setTime(next: number, follow = true) {
  t = Math.min(DURATION_S, Math.max(0, next));
  time.value = String(t);
  applyCamera();
  applySun();
  app().introDetail?.setTime(t);
  layout();
  renderKeys();
  updateClock();
  if (follow) void followSim();
}

// ---- keys table
const fields = ['t', 'x', 'y', 'zoom', 'pitch', 'bearing'] as const;
const precision = { t: 2, x: 1, y: 1, zoom: 2, pitch: 1, bearing: 1 };
function renderKeys() {
  keysBody.replaceChildren(
    ...shot.keys.map((key, index) => {
      const row = document.createElement('tr');
      const next = shot.keys[index + 1];
      if (t >= key.t && (!next || t < next.t)) row.className = 'current';
      for (const field of fields) {
        const cell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.step = field === 't' ? '0.1' : field === 'zoom' ? '0.1' : '1';
        input.value = key[field].toFixed(precision[field]);
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || (field === 'zoom' && value <= 0)) return renderKeys();
          key[field] = value;
          shot.keys.sort((a, b) => a.t - b.t);
          markDirty();
          setTime(t, false);
        });
        cell.append(input);
        row.append(cell);
      }
      const actions = document.createElement('td');
      const go = button('Go', () => setTime(key.t));
      const take = button('⟳', () => {
        Object.assign(key, fromView(key.t));
        markDirty();
        setTime(t, false);
      });
      take.title = 'Replace this key with the current view';
      const remove = button('✕', () => {
        shot.keys.splice(index, 1);
        markDirty();
        setTime(t, false);
      });
      remove.disabled = shot.keys.length <= 2;
      actions.append(go, take, remove);
      row.append(actions);
      return row;
    }),
  );
}
function button(text: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
/** The app's current camera as a key at `at`, its bearing unwrapped next to the path's. */
function fromView(at: number): Key {
  const v = debug().view3D!()!;
  const near = view(shot.keys, at).bearing;
  const bearing = v.bearing + 360 * Math.round((near - v.bearing) / 360);
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    t: round(at, 3),
    x: round(v.centre.x, 2),
    y: round(v.centre.y, 2),
    zoom: round(v.zoom, 3),
    pitch: round(v.pitch, 2),
    bearing: round(bearing, 2),
  };
}

// ---- playback
let playing = false;
async function playShot() {
  if (playing) {
    playing = false;
    return;
  }
  playing = true;
  play.textContent = 'Stop';
  if (t >= DURATION_S - 1e-6) setTime(0, false);
  let last = performance.now();
  while (playing && t < DURATION_S) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    setTime(t + (now - last) / 1000, false);
    last = now;
    await followSim();
  }
  playing = false;
  play.textContent = 'Play';
}

function setBusy(busy: boolean) {
  for (const b of [play, rewind, snap, addKey]) b.disabled = busy;
  time.disabled = busy;
}
// The app holds exposure to 1.5; past it, the cut's final pass brightens the rest of the way.
function setExposure(value: number) {
  shot.exposure = Math.round(value * 100) / 100;
  exposure.value = exposureValue.value = String(shot.exposure);
  debug().setVisual?.({ exposure: Math.min(1.5, shot.exposure) });
  app().introDetail?.setGain(shot.exposure / Math.min(1.5, shot.exposure));
  markDirty();
}

function showSun() {
  sunStart.value = String(shot.sun.startS);
  sunStartValue.textContent = clockText(shot.sun.startS).slice(0, 5);
  sunEnd.value = String(shot.sun.endS);
  sunEndValue.textContent = clockText(shot.sun.endS).slice(0, 5);
  sunChange.value = String(shot.sun.changeT);
}
/** The sun at the current time, as the render sets it for this frame. */
function applySun() {
  const s = sunAt(shot.sun, t);
  sunNow.textContent = `now ${clockText(s).slice(0, 5)}`;
  debug().setSunTime3D?.(s);
}
function setSun(next: Partial<Shot['sun']>) {
  shot.sun = { ...shot.sun, ...next };
  showSun();
  applySun();
  markDirty();
}
function setSeason(value: Season) {
  shot.season = value;
  season.value = value;
  debug().setVisual?.({ date: seasonDates[value] });
  markDirty();
}

async function loadShot() {
  shot = parseShot(await (await fetch('/__intro/shot')).json());
  fmt = frames[shot.format];
  lockup.x = fmt.titleX;
  saved = JSON.stringify(shot);
  exposure.value = exposureValue.value = String(shot.exposure);
  showSun();
  season.value = shot.season;
  markDirty();
}

async function start() {
  await loadShot();
  // Lighting is a viewer preference in storage; the frame shares this page's origin.
  localStorage.setItem(
    'cityflows.lighting',
    JSON.stringify({ mode: 'clock', exposure: Math.min(1.5, shot.exposure), season: shot.season }),
  );
  localStorage.setItem('cityflows.hints', 'done');
  // The map's colours follow the appearance: light, as the render draws them.
  localStorage.setItem(
    'cityflows.appearance',
    JSON.stringify({ appearance: 'light', matchLighting: false }),
  );
  iframe.style.width = '2400px';
  iframe.style.height = '1900px';
  iframe.src = '/?city=grid5x5';
  say('Starting the app…');
  await until(() => app()?.cityflows?.appStore && !store().busy && store().session, 'the app');
  say('Opening the intro project (about a minute)…');
  const project = await (await fetch('/__intro/project')).blob();
  await store().open(new File([project], 'intro.cityflows.json', { type: 'application/json' }));
  await until(
    () => !store().busy && store().session?.project.city.name === 'London City Airport',
    'the project',
  );
  const s = store();
  if (s.viewMode === '2d') s.toggleView();
  if (!s.buildings) s.toggleBuildings();
  for (const [layer, on] of Object.entries({
    basemap: false,
    labels: false,
    places: false,
    shadows: true,
    buildingDetails: true,
  }))
    if (store().layers[layer] !== on) store().toggleLayer(layer);
  if (store().sidebarOpen) store().toggleSidebar();
  await until(() => debug().view3D?.(), 'the 3D view');
  debug().setVisual?.({ dropLines: false });
  applySun();
  // The cut's own detail (bench/intro/detail.ts), loaded into the app's frame.
  say('Adding the cut detail…');
  const script = iframe.contentDocument!.createElement('script');
  script.type = 'module';
  script.textContent =
    "import { install } from '/bench/intro/detail.ts';\n" +
    'window.introDetail = install(window.cityflows.scene3D(), window.cityflows.city());';
  iframe.contentDocument!.head.append(script);
  await until(() => app().introDetail, 'the cut detail');
  app().introDetail!.setGain(shot.exposure / Math.min(1.5, shot.exposure));
  // The subtitle's font and the version, for the title as the render draws it.
  const source = await (await fetch('/__intro/font')).blob();
  const face = new FontFace('Cormorant Garamond', await source.arrayBuffer(), {
    weight: '300 700',
    style: 'italic',
  });
  document.fonts.add(await face.load());
  await document.fonts.load('700 110px Arimo');
  lockup.version = `v${(await (await fetch('/__intro/version')).json()) as string}`;
  const base64 = await new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result).split(',')[1]!);
    reader.readAsDataURL(source);
  });
  subtitleImage = await renderSubtitle(lockup, base64);
  // Size the frame so the app's canvas is exactly the render's W x CANVAS_H.
  const { W, CANVAS_H } = fmt;
  const doc = iframe.contentDocument!;
  const canvas = await until(
    () => doc.querySelector<HTMLCanvasElement>('canvas[aria-label="3D city view"]'),
    'the canvas',
  );
  for (let i = 0; i < 5; i++) {
    const box = canvas.getBoundingClientRect();
    if (Math.round(box.width) === W && Math.round(box.height) === CANVAS_H) break;
    iframe.style.width = `${parseFloat(iframe.style.width) + W - Math.round(box.width)}px`;
    iframe.style.height = `${parseFloat(iframe.style.height) + CANVAS_H - Math.round(box.height)}px`;
    await wait(400);
  }
  const box = canvas.getBoundingClientRect();
  canvasOffset = { left: box.left, top: box.top };
  if (Math.round(box.width) !== W || Math.round(box.height) !== CANVAS_H)
    say(`Canvas is ${box.width}×${box.height}, not ${W}×${CANVAS_H}: framing may differ.`);
  time.max = String(DURATION_S);
  setTime(0, false);
  await stepTo(startS, true);
  setBusy(false);
  say('Ready.');
  setTime(0);
  setInterval(() => {
    const v = debug().view3D?.();
    if (v)
      viewReadout.textContent =
        `view: x ${v.centre.x.toFixed(1)} y ${v.centre.y.toFixed(1)} zoom ${v.zoom.toFixed(2)} ` +
        `pitch ${v.pitch.toFixed(1)} bearing ${v.bearing.toFixed(1)}`;
  }, 250);
}

time.addEventListener('input', () => setTime(Number(time.value)));
play.addEventListener('click', () => void playShot());
rewind.addEventListener('click', () => void rewindTraffic());
snap.addEventListener('click', () => applyCamera());
full.addEventListener('change', layout);
$<HTMLInputElement>('detail').addEventListener('change', (event) =>
  app().introDetail?.setEnabled((event.target as HTMLInputElement).checked),
);
addEventListener('resize', layout);
exposure.addEventListener('input', () => setExposure(Number(exposure.value)));
exposureValue.addEventListener('change', () => setExposure(Number(exposureValue.value)));
sunStart.addEventListener('input', () => setSun({ startS: Number(sunStart.value) }));
sunEnd.addEventListener('input', () => setSun({ endS: Number(sunEnd.value) }));
sunChange.addEventListener('change', () => {
  const value = Number(sunChange.value);
  if (Number.isFinite(value)) setSun({ changeT: Math.min(DURATION_S, Math.max(0, value)) });
});
season.addEventListener('change', () => setSeason(season.value as Season));
addKey.addEventListener('click', () => {
  const key = fromView(t);
  const same = shot.keys.findIndex((k) => Math.abs(k.t - key.t) < 0.02);
  if (same >= 0) shot.keys[same] = key;
  else shot.keys.push(key);
  shot.keys.sort((a, b) => a.t - b.t);
  markDirty();
  setTime(t, false);
});
save.addEventListener('click', async () => {
  const response = await fetch('/__intro/shot', { method: 'POST', body: JSON.stringify(shot) });
  if (!response.ok) return say(`Not saved: ${await response.text()}`);
  saved = JSON.stringify(shot);
  markDirty();
  say('Saved to the shot file. Render with bench/intro/render.ts.');
});
revert.addEventListener('click', async () => {
  await loadShot();
  setExposure(shot.exposure);
  setSun({});
  setSeason(shot.season);
  setTime(t, false);
});
addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
  if (time.disabled) return;
  if (event.key === ' ') {
    event.preventDefault();
    void playShot();
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    setTime(t + (event.key === 'ArrowRight' ? 1 : -1) / FPS);
  }
});

start().catch((error) => say(`Failed: ${error instanceof Error ? error.message : error}`));
