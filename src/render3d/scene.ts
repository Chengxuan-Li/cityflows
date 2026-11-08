import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Matrix4,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Vec2 } from '../geo/vec2';
import { signalStateAt, type CompiledCity } from '../network';
import { markingTheme, style } from '../render/style';
import { FrameDemand, renderContinuously } from '../render/frame-demand';
import type { CityGeometry, Pick } from '../render/types';
import type { PresentationSnapshot } from '../render/vehicle-pose';
import { Basemap3D } from './basemap';
import { buildGeometry } from './geometry';
import { pickVehicle3D, vehicleScreenPoint } from './picking';
import { signalMountM, signalRotationY } from './signals';
import { buildingMaterial, groundMaterial } from './context';
import { buildVegetation, surfaceTexture } from './vegetation';
import { placeTrees } from '../render/vegetation';
import { Vehicles3D } from './vehicles';
import { groundMesh } from './terrain';
import { lotGeometry } from './stalls';
import { terrainVehicleOffset } from './heights';
import { buildTerrainGround } from './context';

export class Scene3D {
  private readonly scene = new Scene();
  private readonly demand = new FrameDemand();
  private readonly invalidate = this.demand.invalidate;
  private vehicleAgeS = 0;
  private colourByClass = false;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(45, 1, 0.2, 50000);
  private readonly controls: MapControls;
  private readonly observer: ResizeObserver;
  private readonly sun = new DirectionalLight(0xfff8ec, 1.4);
  private readonly vehicles = new Vehicles3D();
  private readonly selection = new Mesh(
    new BoxGeometry(1.18, 1.27, 1.44).translate(-0.5, 0.53, 0),
    new MeshBasicMaterial({ color: style.selection, wireframe: true }),
  );
  private content = new Group();
  private city: CompiledCity | undefined;
  private source: CityGeometry | undefined;
  private geometry: ReturnType<typeof buildGeometry> | undefined;
  private vegetation: ReturnType<typeof buildVegetation> | undefined;
  private treeCounts: ReturnType<typeof placeTrees>['counts'] | undefined;
  private ground: Mesh<BufferGeometry, MeshLambertMaterial> | undefined;
  private terrainEnabled = true;
  private parkingStallsVisible = true;
  private parkingStalls?: Mesh;
  private renderedTerrain = true;
  private terrainGround: ReturnType<typeof buildTerrainGround> | undefined;
  private buildings: Mesh<BufferGeometry, MeshLambertMaterial> | undefined;
  private surroundings: Mesh<BufferGeometry, MeshLambertMaterial> | undefined;
  private surroundingsVisible = true;
  private buildingsVisible = true;
  private buildingDetails = true;
  private lamps: InstancedMesh | undefined;
  private selectedId: number | null = null;
  private signalCity: CompiledCity | null = null;
  private lastSignalKey = '';
  private capture: { images: string[]; resolve: (images: string[]) => void } | null = null;
  private belowGround = false;
  private placesVisible = true;
  private basemap: Basemap3D | undefined;
  private tilesEnabled = true;
  private lastRenderMs = performance.now();
  private readonly vehicleMatrix = new Matrix4();
  private shadowView = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const renderer = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(style.background);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
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
    this.controls.addEventListener('change', this.invalidate);
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
    if (import.meta.env.MODE === 'test') canvas.dataset.frames = '0';
  }

  private resize() {
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  setCity(city: CompiledCity, source: CityGeometry, terrainEnabled = this.terrainEnabled) {
    this.terrainEnabled = terrainEnabled;
    if (
      this.city === city &&
      this.source === source &&
      this.renderedTerrain === this.terrainEnabled
    )
      return;
    this.invalidate();
    const start = performance.now();
    this.shadowView = '';
    this.disposeContent();
    if (this.city !== city) {
      this.vehicles.poses.snapshot = null;
      this.vehicles.mesh.count = 0;
    }
    this.city = city;
    const renderedSource = this.terrainEnabled ? source : { ...source, terrain: undefined };
    const geometry = (this.geometry = buildGeometry(
      city,
      renderedSource,
      Boolean(renderedSource.terrain),
    ));
    const terrain = geometry.heights.terrain;
    if (this.source?.geo !== source.geo || this.renderedTerrain !== this.terrainEnabled) {
      this.basemap?.destroy();
      this.basemap = source.geo ? new Basemap3D(source.geo, terrain) : undefined;
      if (this.basemap) {
        this.basemap.group.visible = this.tilesEnabled;
        this.scene.add(this.basemap.group);
      }
    }
    this.source = source;
    this.renderedTerrain = this.terrainEnabled;
    const add = (shape: BufferGeometry, color: number, shadow = true) => {
      const mesh = new Mesh(shape, new MeshLambertMaterial({ color, side: DoubleSide }));
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      this.content.add(mesh);
      return mesh;
    };
    add(geometry.surfaces, style.asphalt, !terrain.grid);
    if (terrain.grid) {
      // Ground asphalt cannot cast a useful shadow onto itself. Only decks and
      // raised approaches enter the shadow pass; their visible mesh is unchanged.
      const positions: number[] = [],
        p = geometry.surfaces.getAttribute('position');
      const count = geometry.surfaces.index?.count ?? p.count;
      for (let i = 0; i < count; i += 3) {
        const indices = [0, 1, 2].map((j) => geometry.surfaces.index?.getX(i + j) ?? i + j);
        if (!indices.some((j) => p.getY(j) - terrain.groundAt(p.getX(j), p.getZ(j)) > 0.3))
          continue;
        for (const j of indices) positions.push(p.getX(j), p.getY(j), p.getZ(j));
      }
      const caster = new Mesh(
        new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
        new MeshBasicMaterial({
          side: DoubleSide,
          colorWrite: false,
          depthWrite: false,
        }),
      );
      caster.castShadow = true;
      caster.layers.set(1);
      this.sun.shadow.camera.layers.enable(1);
      this.content.add(caster);
    }
    const asphalt = add(geometry.surfaces, style.asphalt, !terrain.grid);
    asphalt.material.map = surfaceTexture('asphalt');
    const placementStart = performance.now();
    const placed = placeTrees(city, source);
    this.canvas.dataset.treePlacementMs = String(performance.now() - placementStart);
    this.treeCounts = placed.counts;
    this.canvas.dataset.treeCounts = JSON.stringify(placed.counts);
    this.canvas.dataset.treeCap = String(placed.capped);
    this.vegetation = buildVegetation(placed.trees, (p) => terrain.groundAt(p.x, p.y));
    this.content.add(this.vegetation.group);
    add(geometry.slabs, 0x899b99);
    add(geometry.markings, 0xffffff, false).material.vertexColors = true;
    add(geometry.crossings, markingTheme.colors.stop, false);
    const lots = lotGeometry(city, renderedSource, terrain);
    add(lots.surface, style.context.parking, false);
    this.parkingStalls = add(lots.paint, style.stall, false);
    this.parkingStalls.visible = this.parkingStallsVisible;
    this.canvas.dataset.parkingStalls = String(
      this.parkingStallsVisible
        ? (city.lots?.reduce((sum, lot) => sum + lot.stallCount, 0) ?? 0)
        : 0,
    );
    const places = add(geometry.places, 0xffffff, false);
    places.material.vertexColors = true;
    places.name = 'places';
    places.visible = this.placesVisible;
    this.buildings = add(
      this.buildingDetails ? geometry.context.detailedBuildings : geometry.context.buildings,
      0xffffff,
    );
    this.buildings.material.dispose();
    this.buildings.material = buildingMaterial();
    this.buildings.material.side = DoubleSide;
    this.canvas.dataset.contextBuildMs = geometry.context.buildMs.toFixed(1);
    this.canvas.dataset.buildingTriangles = JSON.stringify(geometry.context.buildingTriangles);
    this.canvas.dataset.roofStats = JSON.stringify(geometry.context.roofStats);
    this.canvas.dataset.buildingDetails = String(this.buildingDetails);
    this.surroundings = add(geometry.context.ground, 0xffffff, false);
    this.surroundings.material.vertexColors = true;
    this.surroundings.material.dispose();
    this.surroundings.material = groundMaterial();
    // Broad terrain first, then water/green and lines, in one ordered mesh.
    // It cannot write depth against itself where context areas overlap.
    this.surroundings.material.depthWrite = false;
    // Tiles are transparent too: keep terrain after them even at full opacity.
    this.surroundings.material.transparent = true;
    this.surroundings.renderOrder = 3;
    this.setSurroundings(this.surroundingsVisible, this.buildingsVisible);
    const transform = new Object3D();
    const piers = new InstancedMesh(
      new BoxGeometry(1.2, 1, 1.2),
      new MeshLambertMaterial({ color: 0x95a29c }),
      geometry.piers.length,
    );
    geometry.piers.forEach((pier, i) => {
      transform.position.set(pier.x, pier.base + pier.height / 2, pier.y);
      transform.scale.set(1, pier.height, 1);
      transform.updateMatrix();
      piers.setMatrixAt(i, transform.matrix);
    });
    piers.castShadow = piers.receiveShadow = true;
    this.content.add(piers);
    const poles = new InstancedMesh(
      new BoxGeometry(0.15, 6, 0.15),
      new MeshLambertMaterial({ color: 0x637773 }),
      geometry.supports.length,
    );
    const arms = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0x637773 }),
      geometry.supports.length,
    );
    const boxes = new InstancedMesh(
      new BoxGeometry(0.55, 0.95, 0.4),
      new MeshLambertMaterial({ color: 0x344843 }),
      geometry.heads.length,
    );
    this.lamps = new InstancedMesh(
      new PlaneGeometry(0.32, 0.32).translate(0, 0, 0.205),
      new MeshBasicMaterial(),
      geometry.heads.length,
    );
    transform.scale.setScalar(1);
    geometry.supports.forEach((support, i) => {
      transform.position.set(support.x, support.height + support.clearanceM / 2, support.y);
      transform.updateMatrix();
      poles.setMatrixAt(i, transform.matrix);
      const from = new Vector3(support.x, support.height + support.clearanceM, support.y);
      const to = new Vector3(support.end.x, support.end.height + support.clearanceM, support.end.y);
      const direction = to.clone().sub(from);
      transform.position.copy(from).add(to).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
      transform.scale.set(0.12, direction.length(), 0.12);
      transform.updateMatrix();
      arms.setMatrixAt(i, transform.matrix);
      transform.rotation.set(0, 0, 0);
      transform.scale.setScalar(1);
    });
    geometry.heads.forEach((head, i) => {
      transform.position.set(head.x, head.height + signalMountM, head.y);
      transform.rotation.set(0, signalRotationY(head.heading), 0);
      transform.updateMatrix();
      boxes.setMatrixAt(i, transform.matrix);
      this.lamps!.setMatrixAt(i, transform.matrix);
    });
    poles.castShadow = arms.castShadow = boxes.castShadow = true;
    this.content.add(poles, arms, boxes, this.lamps);
    geometry.surfaces.computeBoundingBox();
    const box = geometry.surfaces.boundingBox!;
    if (box.isEmpty()) {
      box.min.set(-50, 0, -50);
      box.max.set(50, 0, 50);
    }
    const width = Math.max(100, box.max.x - box.min.x + 500),
      depth = Math.max(100, box.max.z - box.min.z + 500);
    const grid = renderedSource.terrain;
    const bounds = {
      minX: Math.min(box.min.x - 250, grid?.originM.x ?? Infinity),
      minY: Math.min(box.min.z - 250, grid?.originM.y ?? Infinity),
      maxX: Math.max(
        box.max.x + 250,
        grid ? grid.originM.x + (grid.cols - 1) * grid.cellM : -Infinity,
      ),
      maxY: Math.max(
        box.max.z + 250,
        grid ? grid.originM.y + (grid.rows - 1) * grid.cellM : -Infinity,
      ),
    };
    this.ground = new Mesh(
      renderedSource.terrain ? groundMesh(terrain, bounds, -0.04) : new PlaneGeometry(width, depth),
      new MeshLambertMaterial({ color: style.background }),
    );
    this.ground.renderOrder = 2;
    if (!renderedSource.terrain) {
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.set((box.min.x + box.max.x) / 2, -0.04, (box.min.z + box.max.z) / 2);
    }
    this.ground.receiveShadow = true;
    this.content.add(this.ground);
    if (grid) {
      const surface = this.ground.geometry.clone().translate(0, 0.015, 0);
      this.terrainGround = buildTerrainGround(surface, source.context?.features ?? []);
      surface.dispose();
      this.surroundings.geometry.dispose();
      this.surroundings.material.forceSinglePass = true;
      this.updateTerrainBackdrop();
    }
    this.setBelowGround(this.belowGround);
    this.signalCity = city;
    this.lastSignalKey = '';
    this.setSignals(0);
    this.canvas.dataset.buildMs = (performance.now() - start).toFixed(1);
    this.canvas.dataset.terrain = String(Boolean(renderedSource.terrain));
    const groundHeight = terrain.groundAt(this.controls.target.x, this.controls.target.z);
    this.camera.position.y += groundHeight - this.controls.target.y;
    this.controls.target.y = groundHeight;
    this.canvas.dataset.meshes = String(this.content.children.length + 1);
  }

  setVehicleGeometry(city: CompiledCity, durationS: number) {
    this.vehicles.setGeometry(city, durationS);
  }
  setSnapshot(snapshot: PresentationSnapshot) {
    this.vehicles.setSnapshot(snapshot);
    this.invalidate();
  }
  setColourVehiclesByClass(enabled: boolean) {
    if (enabled === this.colourByClass) return;
    this.colourByClass = enabled;
    this.vehicles.setColourByClass(enabled);
    this.invalidate();
  }
  setSelection(pick: Pick | null) {
    const id = pick?.kind === 'vehicle' ? pick.id : null;
    if (id !== this.selectedId) this.invalidate();
    this.selectedId = id;
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
    this.invalidate();
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
    if (this.belowGround !== enabled) this.invalidate();
    this.belowGround = enabled;
    if (this.surroundings) this.surroundings.material.opacity = enabled ? 0.4 : 1;
    this.updateTerrainBackdrop();
    if (!this.ground || this.ground.material.transparent === enabled) return;
    this.ground.material.transparent = enabled;
    this.ground.material.opacity = enabled ? 0.4 : 1;
    this.ground.material.depthWrite = !enabled;
    this.ground.material.needsUpdate = true;
  }
  setTiles(enabled: boolean) {
    if (this.tilesEnabled !== enabled) this.invalidate();
    this.tilesEnabled = enabled;
    if (this.basemap) this.basemap.group.visible = enabled;
    this.updateTerrainBackdrop();
  }
  private updateTerrainBackdrop() {
    if (!this.terrainGround || !this.ground || !this.surroundings) return;
    const surface = this.tilesEnabled ? this.terrainGround.transparent : this.terrainGround.opaque;
    this.surroundings.geometry = surface;
    if (this.geometry) this.geometry.context.ground = surface;
    const transparent = this.tilesEnabled || this.belowGround;
    if (this.surroundings.material.transparent !== transparent) {
      this.surroundings.material.transparent = transparent;
      this.surroundings.material.needsUpdate = true;
    }
    this.surroundings.material.depthWrite = !transparent;
    this.ground.visible = this.tilesEnabled || !this.surroundingsVisible;
  }
  setTerrain(enabled: boolean) {
    if (enabled === this.terrainEnabled) return;
    this.terrainEnabled = enabled;
    if (this.city && this.source) this.setCity(this.city, this.source);
  }

  setParkingStalls(enabled: boolean) {
    if (this.parkingStallsVisible !== enabled) this.invalidate();
    this.parkingStallsVisible = enabled;
    if (this.parkingStalls) this.parkingStalls.visible = enabled;
    this.canvas.dataset.parkingStalls = String(
      enabled ? (this.city?.lots?.reduce((sum, lot) => sum + lot.stallCount, 0) ?? 0) : 0,
    );
  }
  setPlaces(visible: boolean) {
    if (this.placesVisible !== visible) this.invalidate();
    this.placesVisible = visible;
    const places = this.content.getObjectByName('places');
    if (places) places.visible = visible;
  }

  setTrees(trees: boolean, streetTrees: boolean) {
    if (!this.vegetation) return;
    if (this.vegetation.natural.visible !== trees || this.vegetation.street.visible !== streetTrees)
      this.invalidate();
    this.vegetation.natural.visible = trees;
    this.vegetation.street.visible = streetTrees;
    const counts = this.treeCounts!;
    this.canvas.dataset.trees = String(
      trees ? counts.osm + counts.row + counts.wood + counts.scrub + counts.park : 0,
    );
    this.canvas.dataset.streetTrees = String(streetTrees ? counts.street : 0);
  }
  setSurroundings(visible: boolean, buildings: boolean) {
    if (this.surroundingsVisible !== visible || this.buildingsVisible !== buildings)
      this.invalidate();
    this.surroundingsVisible = visible;
    this.buildingsVisible = buildings;
    if (this.surroundings) this.surroundings.visible = visible;
    if (this.buildings) this.buildings.visible = visible && buildings;
    this.updateTerrainBackdrop();
    const count = this.geometry?.context;
    const buildingCount = visible && buildings ? (count?.buildingCount ?? 0) : 0;
    this.canvas.dataset.buildings = String(buildingCount);
    this.canvas.dataset.contextFeatures = String(
      buildingCount + (visible ? (count?.groundCount ?? 0) : 0),
    );
  }

  setBuildingDetails(enabled: boolean) {
    if (this.buildingDetails === enabled) return;
    this.buildingDetails = enabled;
    this.invalidate();
    if (this.buildings && this.geometry)
      this.buildings.geometry = enabled
        ? this.geometry.context.detailedBuildings
        : this.geometry.context.buildings;
    this.canvas.dataset.buildingDetails = String(enabled);
  }

  setView(centre: Vec2, zoom: number, pitch = 55, bearing = 0) {
    // Consume and clear the previous gesture before installing the next view.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    const ground = this.geometry?.heights.terrain.groundAt(centre.x, centre.y) ?? 0;
    this.controls.target.set(centre.x, ground, centre.y);
    const distance =
      this.canvas.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * zoom);
    const angle = (pitch * Math.PI) / 180,
      azimuth = (bearing * Math.PI) / 180;
    this.camera.position.set(
      centre.x + distance * Math.cos(angle) * Math.sin(azimuth),
      ground + distance * Math.sin(angle),
      centre.y + distance * Math.cos(angle) * Math.cos(azimuth),
    );
    this.controls.update();
  }
  captureFrames(): Promise<string[]> {
    return new Promise((resolve) => {
      this.capture = { images: [], resolve };
      this.invalidate();
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
    const p = new Vector3(
      point.x,
      (this.geometry?.heights.terrain.groundAt(point.x, point.y) ?? 0) + 1,
      point.y,
    ).project(this.camera);
    return {
      x: ((p.x + 1) * this.canvas.clientWidth) / 2,
      y: ((1 - p.y) * this.canvas.clientHeight) / 2,
    };
  }
  vehicleToScreen(id: number) {
    const index =
      this.vehicles.poses.snapshot?.id.subarray(0, this.vehicles.mesh.count).indexOf(id) ?? -1;
    return index < 0
      ? null
      : vehicleScreenPoint(
          this.vehicles.mesh,
          index,
          this.camera,
          this.canvas.clientWidth,
          this.canvas.clientHeight,
        );
  }
  pick(x: number, y: number): Pick | null {
    const index = pickVehicle3D(
      this.vehicles.mesh,
      this.camera,
      x,
      y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    return index === null
      ? null
      : { kind: 'vehicle', id: this.vehicles.poses.snapshot!.id[index]! };
  }

  render(elapsedS: number, timeS: number) {
    const renderStart = performance.now();
    this.controls.update();
    this.setSignals(timeS);
    if (this.vehicleAgeS !== elapsedS && this.vehicles.mesh.count) this.invalidate();
    this.vehicleAgeS = elapsedS;
    // Keep centimetre-separated ground/paint resolvable at city-scale camera distances.
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.2, distance / 10);
    this.camera.far = Math.max(5000, distance * 10);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const now = performance.now();
    if (
      this.basemap &&
      (this.demand.pending || this.basemap.needsUpdate) &&
      this.basemap.update(
        this.camera,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        now - this.lastRenderMs,
        this.belowGround,
      )
    )
      this.invalidate();
    this.lastRenderMs = now;
    this.canvas.dataset.tiles = String(this.tilesEnabled ? (this.basemap?.visibleCount ?? 0) : 0);
    this.canvas.dataset.crossings = String(
      this.geometry?.crossings.getAttribute('position').count ?? 0,
    );
    if (!this.demand.consume(renderContinuously())) return;
    if (this.city && this.geometry)
      this.vehicles.animate(elapsedS, this.city, this.geometry.heights);
    if (this.city && this.geometry?.heights.terrain.grid && this.vehicles.poses.snapshot) {
      const heights = this.geometry.heights,
        snapshot = this.vehicles.poses.snapshot;
      for (let i = 0; i < snapshot.count; i++) {
        this.vehicles.mesh.getMatrixAt(i, this.vehicleMatrix);
        const e = this.vehicleMatrix.elements,
          p = { x: e[12]!, y: e[14]! },
          lane = snapshot.lane[i]!;
        e[13]! += terrainVehicleOffset(this.city, heights, lane, p);
        this.vehicles.mesh.setMatrixAt(i, this.vehicleMatrix);
      }
    }
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
    // Fit the 2048 shadow map to the camera's ground target, rather than the whole city.
    const extent = Math.max(40, this.camera.position.distanceTo(this.controls.target) * 0.9);
    // A world-space texel offset keeps broad roofs free of self-shadow stripes.
    this.sun.shadow.normalBias = Math.max(0.05, (2 * extent) / this.sun.shadow.mapSize.x);
    const target = this.controls.target;
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - extent, target.y + extent * 1.5, target.z - extent);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -extent;
    shadow.right = shadow.top = extent;
    shadow.far = extent * 5;
    shadow.updateProjectionMatrix();
    this.vegetation?.update(distance);
    // Reuse an unchanged light map. Moving vehicles always refresh their shadows.
    const cacheShadows =
      Boolean(this.geometry?.heights.terrain.grid) && this.vehicles.mesh.count === 0;
    const shadowView = [
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      target.x,
      target.y,
      target.z,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      this.surroundingsVisible ? 1 : 0,
      this.buildingsVisible ? 1 : 0,
      this.buildingDetails ? 1 : 0,
      this.vehicles.mesh.count,
      this.vegetation?.natural.visible ? 1 : 0,
      this.vegetation?.street.visible ? 1 : 0,
    ]
      .map((n) => n.toFixed(4))
      .join(',');
    this.renderer.shadowMap.autoUpdate = !cacheShadows;
    if (shadowView !== this.shadowView) this.renderer.shadowMap.needsUpdate = true;
    this.shadowView = shadowView;
    this.renderer.render(this.scene, this.camera);
    if (import.meta.env.MODE === 'test') {
      this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames) + 1);
      this.canvas.dataset.triangles = String(this.renderer.info.render.triangles);
    }
    if (import.meta.env.MODE === 'test') {
      performance.measure('cityflows:render3d', { start: renderStart, end: performance.now() });
      performance.clearMeasures('cityflows:render3d');
    }
    if (import.meta.env.MODE === 'test' && this.capture) {
      this.capture.images.push(this.canvas.toDataURL('image/png'));
      if (this.capture.images.length === 2) {
        this.capture.resolve(this.capture.images);
        this.capture = null;
      } else this.invalidate();
    }
    this.canvas.dataset.vehicles = String(this.vehicles.mesh.count);
  }

  private disposeContent() {
    if (this.geometry && this.buildings) {
      const context = this.geometry.context;
      (this.buildings.geometry === context.buildings
        ? context.detailedBuildings
        : context.buildings
      ).dispose();
    }
    if (this.terrainGround) {
      const { opaque, transparent } = this.terrainGround;
      (this.surroundings?.geometry === opaque ? transparent : opaque).dispose();
    }
    this.terrainGround = undefined;
    this.content.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof MeshLambertMaterial) material.map?.dispose();
          material.dispose();
        }
        if (object instanceof InstancedMesh) object.dispose();
      }
    });
    this.content.clear();
  }
  destroy() {
    this.observer.disconnect();
    this.controls.dispose();
    this.basemap?.destroy();
    this.disposeContent();
    this.vehicles.destroy();
    this.selection.geometry.dispose();
    this.selection.material.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
