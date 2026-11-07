import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Vec2 } from '../geo/vec2';
import { signalStateAt, type CompiledCity } from '../network';
import { style } from '../render/style';
import type { CityGeometry, Pick } from '../render/types';
import type { PresentationSnapshot } from '../render/vehicle-pose';
import { buildGeometry } from './geometry';
import { Vehicles3D } from './vehicles';

export class Scene3D {
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(45, 1, 0.2, 50000);
  private readonly controls: MapControls;
  private readonly observer: ResizeObserver;
  private readonly sun = new DirectionalLight(0xfff8ec, 1.4);
  private readonly vehicles = new Vehicles3D();
  private readonly raycaster = new Raycaster();
  private readonly selection = new Mesh(
    new BoxGeometry(5.3, 1.9, 2.6).translate(0, 0.8, 0),
    new MeshBasicMaterial({ color: style.selection, wireframe: true }),
  );
  private content = new Group();
  private city: CompiledCity | undefined;
  private source: CityGeometry | undefined;
  private geometry: ReturnType<typeof buildGeometry> | undefined;
  private ground: Mesh<PlaneGeometry, MeshLambertMaterial> | undefined;
  private lamps: InstancedMesh | undefined;
  private selectedId: number | null = null;
  private signalCity: CompiledCity | null = null;
  private lastSignalKey = '';
  private capture: { images: string[]; resolve: (images: string[]) => void } | null = null;
  private belowGround = false;
  private placesVisible = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const renderer = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(style.background);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.add(
      new HemisphereLight(0xffffff, 0x9eaa99, 1.4),
      this.sun,
      this.sun.target,
      this.content,
      this.vehicles.mesh,
      this.selection,
    );
    this.selection.visible = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.05;
    this.controls = new MapControls(this.camera, canvas);
    this.controls.minPolarAngle = (5 * Math.PI) / 180;
    this.controls.maxPolarAngle = (80 * Math.PI) / 180;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 40000;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.dataset.view = '3d';
  }

  private resize() {
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setCity(city: CompiledCity, source: CityGeometry) {
    if (this.city === city && this.source === source) return;
    const start = performance.now();
    this.disposeContent();
    this.city = city;
    this.source = source;
    this.vehicles.poses.snapshot = null;
    this.vehicles.mesh.count = 0;
    const geometry = (this.geometry = buildGeometry(city, source));
    const add = (shape: BufferGeometry, color: number, shadow = true) => {
      const mesh = new Mesh(shape, new MeshLambertMaterial({ color, side: DoubleSide }));
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      this.content.add(mesh);
      return mesh;
    };
    add(geometry.surfaces, style.asphalt);
    add(geometry.slabs, 0x899b99);
    add(geometry.markings, style.marking, false);
    const places = add(geometry.places, 0xffffff, false);
    places.material.vertexColors = true;
    places.name = 'places';
    places.visible = this.placesVisible;
    const transform = new Object3D();
    const piers = new InstancedMesh(
      new BoxGeometry(1.2, 1, 1.2),
      new MeshLambertMaterial({ color: 0x95a29c }),
      geometry.piers.length,
    );
    geometry.piers.forEach((pier, i) => {
      transform.position.set(pier.x, pier.height / 2, pier.y);
      transform.scale.set(1, pier.height, 1);
      transform.updateMatrix();
      piers.setMatrixAt(i, transform.matrix);
    });
    piers.castShadow = piers.receiveShadow = true;
    this.content.add(piers);
    const poles = new InstancedMesh(
      new BoxGeometry(0.12, 3, 0.12),
      new MeshLambertMaterial({ color: 0x637773 }),
      geometry.heads.length,
    );
    const boxes = new InstancedMesh(
      new BoxGeometry(0.55, 0.95, 0.4),
      new MeshLambertMaterial({ color: 0x344843 }),
      geometry.heads.length,
    );
    this.lamps = new InstancedMesh(
      new BoxGeometry(0.32, 0.32, 0.43),
      new MeshBasicMaterial(),
      geometry.heads.length,
    );
    transform.scale.setScalar(1);
    geometry.heads.forEach((head, i) => {
      transform.position.set(head.x, head.height + 1.5, head.y);
      transform.updateMatrix();
      poles.setMatrixAt(i, transform.matrix);
      transform.position.y = head.height + 3;
      transform.updateMatrix();
      boxes.setMatrixAt(i, transform.matrix);
      this.lamps!.setMatrixAt(i, transform.matrix);
    });
    poles.castShadow = boxes.castShadow = true;
    this.content.add(poles, boxes, this.lamps);
    geometry.surfaces.computeBoundingBox();
    const box = geometry.surfaces.boundingBox!;
    if (box.isEmpty()) {
      box.min.set(-50, 0, -50);
      box.max.set(50, 0, 50);
    }
    const width = Math.max(100, box.max.x - box.min.x + 500),
      depth = Math.max(100, box.max.z - box.min.z + 500);
    this.ground = new Mesh(
      new PlaneGeometry(width, depth),
      new MeshLambertMaterial({ color: style.background }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set((box.min.x + box.max.x) / 2, -0.04, (box.min.z + box.max.z) / 2);
    this.ground.receiveShadow = true;
    this.content.add(this.ground);
    this.setBelowGround(this.belowGround);
    this.signalCity = city;
    this.lastSignalKey = '';
    this.setSignals(0);
    this.canvas.dataset.buildMs = (performance.now() - start).toFixed(1);
    this.canvas.dataset.meshes = String(this.content.children.length + 1);
  }

  setVehicleGeometry(city: CompiledCity, durationS: number) {
    this.vehicles.setGeometry(city, durationS);
  }
  setSnapshot(snapshot: PresentationSnapshot) {
    this.vehicles.setSnapshot(snapshot);
  }
  setSelection(pick: Pick | null) {
    this.selectedId = pick?.kind === 'vehicle' ? pick.id : null;
  }

  setSignals(timeS: number, loaded: CompiledCity | null = this.signalCity) {
    this.signalCity = loaded;
    if (!this.geometry || !this.lamps || !this.city) return;
    const states = new Map<number, ReturnType<typeof signalStateAt>>();
    for (const head of this.geometry.heads) {
      const index = loaded?.index.node.get(this.city.nodes[head.node]!.id);
      const signal = index === undefined ? null : loaded!.nodes[index]!.signal;
      if (signal && !states.has(head.node)) states.set(head.node, signalStateAt(signal, timeS));
    }
    const key = [...states].map(([n, s]) => `${n}:${s.phase}:${s.state}`).join('|');
    if (key === this.lastSignalKey) return;
    this.lastSignalKey = key;
    const color = new Color();
    this.geometry.heads.forEach((head, i) => {
      const state = states.get(head.node);
      const index = loaded?.index.node.get(this.city!.nodes[head.node]!.id);
      const signal = index === undefined ? null : loaded!.nodes[index]!.signal;
      const movement = this.city!.movements[head.movement]!.id;
      const mapped = loaded?.index.movement.get(movement);
      const green =
        state &&
        signal &&
        mapped !== undefined &&
        signal.phases[state.phase]!.movements.includes(mapped);
      color.setHex(
        !green || state.state === 'all-red'
          ? style.signalRed
          : state.state === 'green'
            ? style.signalGreen
            : style.signalAmber,
      );
      this.lamps!.setColorAt(i, color);
    });
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  setBelowGround(enabled: boolean) {
    this.belowGround = enabled;
    if (!this.ground || this.ground.material.transparent === enabled) return;
    this.ground.material.transparent = enabled;
    this.ground.material.opacity = enabled ? 0.4 : 1;
    this.ground.material.depthWrite = !enabled;
    this.ground.material.needsUpdate = true;
  }
  setPlaces(visible: boolean) {
    this.placesVisible = visible;
    const places = this.content.getObjectByName('places');
    if (places) places.visible = visible;
  }

  setView(centre: Vec2, zoom: number, pitch = 55, bearing = 0) {
    // Consume and clear the previous gesture before installing the next view.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.controls.target.set(centre.x, 0, centre.y);
    const distance =
      this.canvas.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * zoom);
    const angle = (pitch * Math.PI) / 180,
      azimuth = (bearing * Math.PI) / 180;
    this.camera.position.set(
      centre.x + distance * Math.cos(angle) * Math.sin(azimuth),
      distance * Math.sin(angle),
      centre.y + distance * Math.cos(angle) * Math.cos(azimuth),
    );
    this.controls.update();
  }
  captureFrames(): Promise<string[]> {
    return new Promise((resolve) => {
      this.capture = { images: [], resolve };
    });
  }
  getView() {
    return {
      centre: { x: this.controls.target.x, y: this.controls.target.z },
      zoom:
        this.canvas.clientHeight /
        (2 *
          Math.tan((this.camera.fov * Math.PI) / 360) *
          this.camera.position.distanceTo(this.controls.target)),
    };
  }
  worldToScreen(point: Vec2) {
    const p = new Vector3(point.x, 1, point.y).project(this.camera);
    return {
      x: ((p.x + 1) * this.canvas.clientWidth) / 2,
      y: ((1 - p.y) * this.canvas.clientHeight) / 2,
    };
  }
  pick(x: number, y: number): Pick | null {
    this.vehicles.mesh.computeBoundingSphere();
    this.raycaster.setFromCamera(
      new Vector2((2 * x) / this.canvas.clientWidth - 1, 1 - (2 * y) / this.canvas.clientHeight),
      this.camera,
    );
    const hit = this.raycaster.intersectObject(this.vehicles.mesh)[0];
    const index = hit?.instanceId;
    return index === undefined
      ? null
      : { kind: 'vehicle', id: this.vehicles.poses.snapshot!.id[index]! };
  }

  render(elapsedS: number, timeS: number) {
    this.controls.update();
    if (this.city && this.geometry)
      this.vehicles.animate(elapsedS, this.city, this.geometry.heights);
    this.setSignals(timeS);
    const index =
      this.selectedId === null
        ? -1
        : (this.vehicles.poses.snapshot?.id
            .subarray(0, this.vehicles.mesh.count)
            .indexOf(this.selectedId) ?? -1);
    this.selection.visible = index >= 0;
    if (index >= 0) {
      this.vehicles.mesh.getMatrixAt(index, this.selection.matrix);
      this.selection.matrixAutoUpdate = false;
    }
    // Keep centimetre-separated ground/paint resolvable at city-scale camera distances.
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.2, distance / 50);
    this.camera.far = Math.max(5000, distance * 10);
    this.camera.updateProjectionMatrix();
    // Fit the 2048 shadow map to the camera's ground target, rather than the whole city.
    const extent = Math.max(40, this.camera.position.distanceTo(this.controls.target) * 0.9);
    const target = this.controls.target;
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - extent, extent * 1.5, target.z - extent);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -extent;
    shadow.right = shadow.top = extent;
    shadow.far = extent * 5;
    shadow.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    if (import.meta.env.MODE === 'test' && this.capture) {
      this.capture.images.push(this.canvas.toDataURL('image/png'));
      if (this.capture.images.length === 2) {
        this.capture.resolve(this.capture.images);
        this.capture = null;
      }
    }
    this.canvas.dataset.vehicles = String(this.vehicles.mesh.count);
  }

  private disposeContent() {
    this.content.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
        if (object instanceof InstancedMesh) object.dispose();
      }
    });
    this.content.clear();
  }
  destroy() {
    this.observer.disconnect();
    this.controls.dispose();
    this.disposeContent();
    this.vehicles.destroy();
    this.selection.geometry.dispose();
    this.selection.material.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
