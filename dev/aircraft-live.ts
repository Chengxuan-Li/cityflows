import {
  DirectionalLight,
  DoubleSide,
  Group,
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
import { AircraftModels } from '../src/render3d/aircraft-models';
import { pixelScale } from '../src/render3d/airfield-lights';

// TASK-301: every catalogue type through the app's own aircraft renderer (accent colours,
// outlines, spinning parts, gear, lights and shadow) in one sim state at a time.
// /dev/render.html?fixture=aircraft-live&state=taxi&lighting=night
// TASK-315: `type=A388` shows one type; `angle` (degrees round the row, 0 ahead-left) and
// `distance` (a factor on the framing distance) move the camera in for close-ups; `rise` sets
// the camera's height as a share of that distance (TASK-318).
// TASK-318: the real models by level of detail as the camera moves; `compare=1` adds a second row
// of the procedural meshes beside them, `lod=0` holds every real model at its near level.
// TASK-331: `parts=glass` draws only the near level's parts whose names match (a regex), the
// rest of the airframe as a faint ghost; `aim` sets the camera target's height and `ahead` moves
// target and camera forward along the row's aircraft (metres); `gear` (0 stowed to 1 down) and
// `pitch` (degrees) pose the aircraft as in a retraction.

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
  const typeId = query.get('type');
  const angle = (Number(query.get('angle') ?? 0) * Math.PI) / 180;
  const distance = Number(query.get('distance') ?? 1);
  const rise = Number(query.get('rise') ?? 0.35);
  const parts = query.get('parts');
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
  const aircraft = new Aircraft3D(0, new AircraftModels());
  const procedural = query.has('compare') ? new Aircraft3D(0) : null;
  for (const set of [aircraft, procedural]) {
    if (!set) continue;
    set.setLight(light.artificial);
    scene.add(set.group);
  }
  const near = query.get('lod') === '0';
  const types = aircraftTypes.filter(
    (t) => (!only || t.class === only) && (!typeId || t.id === typeId),
  );
  const s = states[state] ?? states.taxi;
  // A row along x, heading north (-y).
  const longest = Math.max(...types.map((t) => Math.max(t.lengthM, t.spanM)));
  const spacing = longest + 15;
  // With `compare`, each real model has its procedural mesh to its right.
  const slots = procedural ? 2 : 1;
  const poses: AircraftPose[] = types.map((type, i) => ({
    id: i + 1,
    registration: `G-${type.id}`,
    typeId: type.id,
    x: i * slots * spacing,
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
    ...(query.has('gear') && {
      visual: {
        x: i * slots * spacing,
        y: 0,
        heightM: s.heightM,
        heading: -Math.PI / 2,
        pitch: (Number(query.get('pitch') ?? 0) * Math.PI) / 180,
        roll: 0,
        steering: 0,
        gear: Number(query.get('gear')),
      },
    }),
  }));
  if (parts) {
    const match = new RegExp(parts);
    const models = new AircraftModels();
    const ghost = new MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: DoubleSide,
    });
    for (const pose of poses) {
      const type = aircraftTypes.find((t) => t.id === pose.typeId)!;
      void models.load(type.id, type.lengthM, 0)?.then((model) => {
        const group = new Group();
        for (const part of model.lods[0]!.parts)
          group.add(
            new Mesh(
              part.geometry,
              match.test(part.name)
                ? new MeshLambertMaterial({ color: part.color, side: DoubleSide })
                : ghost,
            ),
          );
        group.position.set(pose.x, pose.heightM, pose.y);
        group.rotation.y = -pose.heading;
        scene.add(group);
      });
    }
  } else aircraft.update(poses, 0);
  procedural?.update(
    poses.map((pose) => ({ ...pose, x: pose.x + spacing })),
    0,
  );
  const camera = new PerspectiveCamera(35, 1, 1, 20000);
  const controls = new MapControls(camera, canvas);
  const middle = ((types.length * slots - 1) * spacing) / 2;
  const ahead = Number(query.get('ahead') ?? 0);
  controls.target.set(middle, s.heightM + Number(query.get('aim') ?? 0), -ahead);
  // Ahead and to the left of the row, far enough to frame it.
  const reach = ((types.length * slots - 1) * spacing * 0.7 + longest * 1.6) * distance;
  const c = Math.cos(angle),
    sn = Math.sin(angle);
  camera.position.set(
    middle - reach * (0.45 * c - 0.85 * sn),
    s.heightM + rise * reach,
    -reach * (0.85 * c + 0.45 * sn) - ahead,
  );
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
    const scale = pixelScale(camera, height);
    for (const set of [aircraft, procedural]) {
      if (!set) continue;
      set.setPixelScale(scale);
      set.animate(0, Math.min(0.1, (now - last) / 1000));
      camera.updateMatrixWorld();
      set.setDetail(camera, near ? scale * 1e-3 : scale);
    }
    last = now;
    renderer.render(scene, camera);
    canvas.dataset.report = JSON.stringify(aircraft.report());
    canvas.dataset.levels = JSON.stringify(aircraft.levels());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
