import { bypass } from '../src/fixtures/bypass';
import { disconnected } from '../src/fixtures/disconnected';
import { dividedHighway } from '../src/fixtures/divided-highway';
import { grid5x5 } from '../src/fixtures/grid5x5';
import { ramp } from '../src/fixtures/ramp';
import { shortTurnLane } from '../src/fixtures/short-turn-lane';
import { signalApproach } from '../src/fixtures/signal-approach';
import { headingAtDistance, pointAtDistance } from '../src/geo/polyline';
import { importOsm } from '../src/importers/osm';
import { compile } from '../src/network';
import type { Bounds } from '../src/render/camera';
import { tileSettings } from '../src/render/layers/tiles';
import { createScene } from '../src/render/scene';
import type { VehicleSnapshot } from '../src/render/types';

const fixtures = {
  bypass,
  disconnected,
  dividedHighway,
  grid5x5,
  ramp,
  shortTurnLane,
  signalApproach,
};
const query = new URLSearchParams(location.search);
const fixture = query.get('fixture') ?? 'grid5x5';
const status = document.querySelector<HTMLSpanElement>('#status')!;

async function loadCity() {
  if (query.get('osm') === 'downtown') {
    const { default: xml } = await import('../fixtures/osm/downtown.osm?raw');
    const imported = importOsm(xml, { importerVersion: '1' });
    if (!imported.ok)
      throw new Error(imported.diagnostics.map(({ message }) => message).join('\n'));
    return { ...imported.city, name: 'Center City, Philadelphia' };
  }
  if (!Object.hasOwn(fixtures, fixture)) {
    throw new Error(
      `Unknown fixture "${fixture}". Available fixtures: ${Object.keys(fixtures).join(', ')}`,
    );
  }
  return fixtures[fixture as keyof typeof fixtures]();
}

async function start() {
  const source = await loadCity();
  const result = compile(source);
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('\n'));
  const { compiled } = result;
  const canvas = document.querySelector('canvas')!;
  document.querySelector('#fixture')!.textContent = source.name;
  const scene = createScene(canvas);
  await scene.ready;
  scene.setCity(compiled, source);
  if (source.geo) {
    const toggle = document.querySelector<HTMLInputElement>('#tiles')!;
    toggle.parentElement!.hidden = false;
    toggle.checked = query.get('tiles') !== 'off';
    scene.setTiles(toggle.checked);
    toggle.addEventListener('change', () => scene.setTiles(toggle.checked));
    const attribution = document.querySelector<HTMLAnchorElement>('#attribution')!;
    attribution.textContent = tileSettings.attribution;
    attribution.href = tileSettings.attributionUrl;
    attribution.hidden = false;
  }

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const points = [
    ...compiled.roads.flatMap(({ surface }) => surface),
    ...compiled.nodes.map(({ pos }) => pos),
    ...Object.values(source.places).flatMap(({ shape }) =>
      shape.kind === 'polygon' ? shape.ring : [shape.pos],
    ),
  ];
  for (const { x, y } of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  scene.camera.fitToBounds(bounds, width, height, 55);
  const requestedZoom = Number(query.get('zoom'));
  if (requestedZoom > 0) {
    const center = {
      x: Number(query.get('x') ?? (bounds.minX + bounds.maxX) / 2),
      y: Number(query.get('y') ?? (bounds.minY + bounds.maxY) / 2),
    };
    const screen = scene.camera.worldToScreen(center);
    scene.camera.pan(width / 2 - screen.x, height / 2 - screen.y);
    scene.camera.zoomAt({ x: width / 2, y: height / 2 }, requestedZoom / scene.camera.zoom);
  }

  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    scene.camera.pan(dx, dy);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: true };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.moved) {
      const rect = canvas.getBoundingClientRect();
      const selection = scene.pick(event.clientX - rect.left, event.clientY - rect.top);
      scene.setSelection(selection);
      status.textContent = selection?.kind ?? '';
    }
    drag = null;
  });
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      scene.camera.zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        Math.exp(-event.deltaY * units * 0.0015),
      );
    },
    { passive: false },
  );

  const benchmark = query.has('benchmark');
  const count = benchmark
    ? 3000
    : Math.round(compiled.lanes.reduce((sum, lane) => sum + lane.lengthM, 0) / 70);
  const snapshot: VehicleSnapshot = {
    count,
    timeS: 0,
    id: Uint32Array.from({ length: count }, (_, i) => i + 1),
    x: new Float32Array(count),
    y: new Float32Array(count),
    speed: new Float32Array(count),
    heading: new Float32Array(count),
    lateralM: new Float32Array(count),
    lane: new Int32Array(count),
    state: new Uint8Array(count),
    vclass: Uint8Array.from({ length: count }, (_, i) => i % 4),
    fade: new Float32Array(count).fill(1),
  };
  const moving = Array.from({ length: count }, (_, i) => {
    const lane = compiled.lanes[i % compiled.lanes.length]!;
    snapshot.lane[i] = lane.idx;
    snapshot.state[i] = i % 9 === 0 ? 2 : 1;
    const speed = snapshot.state[i] === 2 ? 0 : Math.min(lane.speedLimitMps, 7 + (i % 12));
    snapshot.speed[i] = speed;
    return { lane, speed, start: ((i * 0.61803398875) % 1) * lane.lengthM };
  });

  const startTime = performance.now();
  const samples: number[] = [];
  let frame = 0;
  function tick(now: number) {
    const timeS = Math.max(0, (now - startTime) / 1000);
    snapshot.timeS = timeS;
    for (let i = 0; i < count; i++) {
      const { lane, speed, start } = moving[i]!;
      const distance = (start + speed * timeS) % lane.lengthM;
      const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
      snapshot.x[i] = point.x;
      snapshot.y[i] = point.y;
      snapshot.heading[i] = headingAtDistance(lane.polyline, lane.cumulative, distance);
      if (i % 5 === 0) snapshot.lateralM[i] = Math.sin(timeS * 2 + i) * 0.5;
    }
    if (benchmark && frame < 210) {
      const before = performance.now();
      scene.setSnapshot(snapshot);
      if (frame++ >= 30) samples.push(performance.now() - before);
      if (samples.length === 180) {
        samples.sort((a, b) => a - b);
        const median = samples[Math.ceil(samples.length * 0.5) - 1]!.toFixed(2);
        const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!.toFixed(2);
        const max = samples.at(-1)!.toFixed(2);
        status.textContent = `3,000 vehicles · setSnapshot median ${median} ms · p95 ${p95} ms · max ${max} ms`;
      }
    } else {
      scene.setSnapshot(snapshot);
    }
    if (!query.has('still') || benchmark) requestAnimationFrame(tick);
  }
  tick(startTime);
  return { scene, compiled, snapshot };
}

export const demo = start();
void demo.catch((error: unknown) => {
  status.textContent = String(error);
});
