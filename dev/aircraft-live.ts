import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { defaultLighting, sceneLight } from '../src/render/lighting';
import type { AircraftPose } from '../src/render/types';
import { aircraftTypes } from '../src/schema/aircraft';
import { Aircraft3D } from '../src/render3d/aircraft';
import { pixelScale } from '../src/render3d/airfield-lights';

// TASK-301: every catalogue type through the app's own aircraft renderer (accent colours,
// outlines, spinning parts, gear, lights and shadow) in one sim state at a time.
// /dev/render.html?fixture=aircraft-live&state=taxi&lighting=night

const states = {
  parked: { enginesRunning: false, speedMps: 0, onRunway: false, heightM: 0 },
  taxi: { enginesRunning: true, speedMps: 8, onRunway: false, heightM: 0 },
  'takeoff-roll': { enginesRunning: true, speedMps: 50, onRunway: true, heightM: 0 },
  approach: { enginesRunning: true, speedMps: 70, onRunway: false, heightM: 40 },
  climb: { enginesRunning: true, speedMps: 80, onRunway: false, heightM: 300 },
} as const;

export function showAircraftLive(query: URLSearchParams) {
  const state = (query.get('state') ?? 'taxi') as keyof typeof states;
  const mode = query.get('lighting') === 'night' ? 'night' : 'day';
  const only = query.get('class');
  document.querySelector('#fixture')!.textContent = `Aircraft in state ${state}, ${mode}`;
  const canvas = document.querySelector('canvas')!;
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  const light = sceneLight({ ...defaultLighting, mode }, 0);
  renderer.setClearColor(light.background);
  const sky = new HemisphereLight(light.sky, light.ground, light.skyIntensity);
  const sun = new DirectionalLight(light.sunColor, light.sunIntensity);
  sun.position.set(...light.sun);
  const ground = new Mesh(
    new PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: mode === 'night' ? 0x3a3f4a : 0x9ea3a8 }),
  );
  scene.add(sky, sun, ground);
  const aircraft = new Aircraft3D(0);
  aircraft.setLight(light.artificial);
  scene.add(aircraft.group);
  const types = aircraftTypes.filter((t) => !only || t.class === only);
  const s = states[state] ?? states.taxi;
  // A row along x, heading north (-y).
  const longest = Math.max(...types.map((t) => Math.max(t.lengthM, t.spanM)));
  const spacing = longest + 15;
  const poses: AircraftPose[] = types.map((type, i) => ({
    id: i + 1,
    registration: `G-${type.id}`,
    typeId: type.id,
    x: i * spacing,
    y: 0,
    heightM: s.heightM,
    heading: -Math.PI / 2,
    speedMps: 0,
    state: type.class === 'helicopter' && state === 'taxi' ? 'hover-taxi' : state,
    enginesRunning: s.enginesRunning,
    onRunway: s.onRunway,
    airborne: s.heightM > 0 || (type.class === 'helicopter' && state === 'taxi'),
    gearDown: s.heightM < 150,
    stand: null,
    runwayEnd: null,
    route: [],
  }));
  aircraft.update(poses, 0);
  const camera = new PerspectiveCamera(35, 1, 1, 20000);
  const controls = new MapControls(camera, canvas);
  const middle = ((types.length - 1) * spacing) / 2;
  controls.target.set(middle, s.heightM, 0);
  // Ahead and to the left of the row, far enough to frame it.
  const reach = (types.length - 1) * spacing * 0.7 + longest * 1.6;
  camera.position.set(middle - 0.45 * reach, s.heightM + 0.35 * reach, -0.85 * reach);
  canvas.dataset.aircraft = String(aircraft.count);
  let last = performance.now();
  function frame(now: number) {
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    controls.update();
    aircraft.setPixelScale(pixelScale(camera, height));
    aircraft.animate(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    renderer.render(scene, camera);
    canvas.dataset.report = JSON.stringify(aircraft.report());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
