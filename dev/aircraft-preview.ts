import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { buildAircraftOutline, type AircraftOutlinePart } from '../src/render/aircraft-outline';
import { defaultLighting, sceneLight, type SceneLight } from '../src/render/lighting';
import { buildAircraftMesh } from '../src/render3d/aircraft-mesh';
import { aircraftTypes } from '../src/schema/aircraft';

interface Cell {
  left: number;
  top: number;
  width: number;
  height: number;
}

const palette = {
  day: {
    fuselage: '#f7f9fb',
    wing: '#b7c2cc',
    tailplane: '#b7c2cc',
    fin: '#31657f',
    engine: '#f7f9fb',
    edge: '#566474',
    disc: '#365267',
  },
  night: {
    fuselage: '#aabbd4',
    wing: '#758ba9',
    tailplane: '#758ba9',
    fin: '#5485a1',
    engine: '#aabbd4',
    edge: '#34445b',
    disc: '#9cb5dc',
  },
};

function paintOutline(
  context: CanvasRenderingContext2D,
  parts: AircraftOutlinePart[],
  scale: number,
  colors: (typeof palette)['day'],
) {
  context.lineWidth = 0.9 / scale;
  for (const part of parts) {
    context.beginPath();
    if ('points' in part) {
      const [first, ...rest] = part.points;
      context.moveTo(first!.y, -first!.x);
      for (const { x, y } of rest) context.lineTo(y, -x);
      context.closePath();
      context.fillStyle = colors[part.kind];
      context.strokeStyle = colors.edge;
      context.fill();
      context.stroke();
    } else {
      const { center, radiusM } = part;
      // A propeller disc is nearly edge-on from above. Leave a little depth so it reads at map scale.
      context.ellipse(
        center.y,
        -center.x,
        radiusM,
        radiusM * (part.kind === 'propeller' ? 0.2 : 1),
        0,
        0,
        2 * Math.PI,
      );
      context.strokeStyle = colors.disc;
      context.globalAlpha = 0.65;
      context.stroke();
      context.globalAlpha = 0.09;
      context.fillStyle = colors.disc;
      context.fill();
      context.globalAlpha = 1;
    }
  }
}

function meshPreview(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  const scene = new Scene();
  const sky = new HemisphereLight();
  const sun = new DirectionalLight();
  const fill = new AmbientLight(0xadc9ff, 0);
  scene.add(sky, sun, fill);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 500);
  camera.position.set(112, 138, 120);
  camera.up.set(1, 0, 0);
  camera.lookAt(0, 3, 0);
  const models = aircraftTypes.map((type) => buildAircraftMesh(type));

  return (
    width: number,
    height: number,
    cells: Cell[],
    scale: number,
    light: SceneLight,
    gearDown: boolean,
    spinS: number,
  ) => {
    const ratio = window.devicePixelRatio;
    if (
      renderer.getPixelRatio() !== ratio ||
      canvas.width !== Math.floor(width * ratio) ||
      canvas.height !== Math.floor(height * ratio)
    ) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
    }
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    sky.color.setHex(light.sky);
    sky.groundColor.setHex(light.ground);
    sky.intensity = light.skyIntensity;
    sun.color.setHex(light.sunColor);
    sun.position.set(...light.sun);
    sun.intensity = light.sunIntensity;
    fill.intensity = light.artificial * 0.46;
    for (const [i, { left, top, width: w, height: h }] of cells.entries()) {
      const model = models[i]!;
      model.gear.visible = gearDown;
      model.propellers.forEach((propeller) => {
        propeller.rotation.y = spinS * 9;
      });
      model.rotors.forEach((rotor) => {
        rotor.rotation.y = spinS * 6;
      });
      const bottom = height - top - h;
      renderer.setViewport(left, bottom, w, h);
      renderer.setScissor(left, bottom, w, h);
      camera.right = w / (2 * scale);
      camera.left = -camera.right;
      camera.top = h / (2 * scale);
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      scene.add(model.root);
      renderer.render(scene, camera);
      scene.remove(model.root);
    }
  };
}

export function showAircraftPreview(query: URLSearchParams) {
  document.title = 'Aircraft catalogue · CityFlows renderer';
  document.querySelector('#fixture')!.textContent = 'Aircraft catalogue';
  document.querySelectorAll('header > span:not(#status)').forEach((span) => span.remove());
  const controls = document.createElement('div');
  controls.className = 'aircraft-controls';
  controls.innerHTML = `
    <label>View <select id="aircraft-view"><option value="2d">2D</option><option value="3d">3D</option></select></label>
    <label>Lighting <select id="aircraft-lighting"><option value="day">Day</option><option value="night">Night</option></select></label>
    <label><input type="checkbox" id="aircraft-gear" checked /> Landing gear</label>
    <label><input type="checkbox" id="aircraft-spin" /> Spin propellers and rotors</label>`;
  document.querySelector('#status')!.before(controls);
  const view = controls.querySelector<HTMLSelectElement>('#aircraft-view')!;
  const lighting = controls.querySelector<HTMLSelectElement>('#aircraft-lighting')!;
  const gear = controls.querySelector<HTMLInputElement>('#aircraft-gear')!;
  const spin = controls.querySelector<HTMLInputElement>('#aircraft-spin')!;
  view.value = query.get('view') === '3d' ? '3d' : '2d';
  lighting.value = query.get('lighting') === 'night' ? 'night' : 'day';

  const scroll = document.createElement('section');
  scroll.className = 'aircraft-scroll';
  scroll.setAttribute('aria-label', 'Aircraft at a common scale');
  const gallery = document.createElement('div');
  gallery.className = 'aircraft-preview';
  const captions = aircraftTypes.map(({ name, lengthM, spanM, class: category }) => {
    const cell = document.createElement('div');
    cell.className = 'aircraft-entry';
    const title = document.createElement('strong');
    title.textContent = name;
    const size = document.createElement('span');
    size.textContent = `${lengthM} × ${spanM} m`;
    size.title = `Length × ${category === 'helicopter' ? 'rotor diameter' : 'wingspan'}`;
    cell.append(title, size);
    gallery.append(cell);
    return cell;
  });
  const scaleBar = document.createElement('div');
  scaleBar.className = 'aircraft-scale';
  scaleBar.textContent = '20 m';
  const canvas2d = document.createElement('canvas');
  const canvas3d = document.createElement('canvas');
  canvas2d.setAttribute('aria-hidden', 'true');
  canvas3d.setAttribute('aria-hidden', 'true');
  gallery.append(canvas2d, canvas3d);
  scroll.append(gallery, scaleBar);
  document.querySelector('canvas')!.replaceWith(scroll);

  const outline = aircraftTypes.map(buildAircraftOutline);
  const maxSpan = Math.max(...aircraftTypes.map(({ spanM }) => spanM));
  const maxLength = Math.max(...aircraftTypes.map(({ lengthM }) => lengthM));
  let renderMeshes: ReturnType<typeof meshPreview> | undefined;
  let animation = 0;
  function paint(now = 0) {
    cancelAnimationFrame(animation);
    const is3d = view.value === '3d';
    const mode = lighting.value === 'night' ? 'night' : 'day';
    canvas2d.hidden = is3d;
    canvas3d.hidden = !is3d;
    spin.disabled = gear.disabled = !is3d;
    const light = sceneLight({ ...defaultLighting, mode }, 0);
    scroll.dataset.lighting = mode;
    scroll.style.setProperty(
      '--aircraft-ground',
      `#${light.background.toString(16).padStart(6, '0')}`,
    );

    const width = gallery.clientWidth;
    const height = gallery.clientHeight;
    const cells = captions.map((cell) => ({
      left: cell.offsetLeft,
      top: cell.offsetTop,
      width: cell.offsetWidth,
      height: cell.offsetHeight - 48,
    }));
    const scale = Math.min((cells[0]!.width - 18) / maxSpan, (cells[0]!.height - 18) / maxLength);
    scaleBar.style.width = `${20 * scale}px`;
    if (is3d) {
      renderMeshes ??= meshPreview(canvas3d);
      renderMeshes(width, height, cells, scale, light, gear.checked, spin.checked ? now / 1000 : 0);
      if (spin.checked) animation = requestAnimationFrame(paint);
    } else {
      const ratio = window.devicePixelRatio;
      canvas2d.width = Math.round(width * ratio);
      canvas2d.height = Math.round(height * ratio);
      const context = canvas2d.getContext('2d')!;
      for (const [i, cell] of cells.entries()) {
        context.setTransform(
          scale * ratio,
          0,
          0,
          scale * ratio,
          (cell.left + cell.width / 2) * ratio,
          (cell.top + cell.height / 2) * ratio,
        );
        paintOutline(context, outline[i]!, scale, palette[mode]);
      }
    }
  }
  controls.addEventListener('change', () => paint());
  new ResizeObserver(() => paint()).observe(gallery);
  paint();
}
