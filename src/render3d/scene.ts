import { cityMarkingTheme } from '../schema/marking-theme';
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
import { markingThemes, roadTint, style } from '../render/style';
import { FrameDemand, renderContinuously } from '../render/frame-demand';
import {
  defaultLayers,
  type CityGeometry,
  type Pick,
  type ParkedCarsSnapshot,
} from '../render/types';
import type { PresentationSnapshot } from '../render/vehicle-pose';
import { Basemap3D } from './basemap';
import { buildGeometry } from './geometry';
import { pickVehicle3D, vehicleScreenPoint } from './picking';
import { signalMountM, signalRotationY } from './signals';
import { buildingMaterial, groundMaterial } from './context';
import { buildVegetation, surfaceTexture } from './vegetation';
import { placeTrees } from '../render/vegetation';
import { placeStreet, treeContext } from '../render/street';
import { buildStreet } from './street';
import { Vehicles3D } from './vehicles';
import { buildWalkSignals, Walkers3D } from './walkers';
import { groundMesh } from './terrain';
import { lotGeometry } from './stalls';
import { stripGeometry } from './strips';
import { terrainVehicleOffset } from './heights';
import { buildTerrainGround } from './context';
import { Parking3D } from './parking';
import { ParkedCars3D } from './parked-cars';
import { buildWalk } from './walk';
import { buildRail, pickRail3D } from './rail';
import { buildCatenary } from './catenary';
import { Trains3D } from './trains';
import { Stations3D } from './stations';
import { TramStops3D } from './tram-stops';
import { LevelCrossings3D } from './level-crossings';
import { noLevelCrossings } from '../render/level-crossings';
import { noFurniture, placeStationFurniture } from '../render/station-furniture';
import { noTramStops, placeTramStops } from '../render/tram-stops';
import { trainTimetable, trainsAt } from '../network/trains';
import { railTimetable } from '../network/trams';
import { paintedCity } from '../render/road-paint';

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
  private readonly sun = new DirectionalLight(0xffffff, 0.95);
  private readonly vehicles = new Vehicles3D();
  private readonly walkers = new Walkers3D();
  private walkSignals: ReturnType<typeof buildWalkSignals> | undefined;
  private pedestrians = true;
  private readonly selection = new Mesh(
    new BoxGeometry(1.18, 1.27, 1.44).translate(-0.5, 0.53, 0),
    new MeshBasicMaterial({ color: style.selection, wireframe: true }),
  );
  private content = new Group();
  private city: CompiledCity | undefined;
  private rail: ReturnType<typeof buildRail> | undefined;
  private railVisible = true;
  private catenary: ReturnType<typeof buildCatenary> | undefined;
  private overheadVisible = true;
  private trains: Trains3D | undefined;
  private stations: Stations3D | undefined;
  private tramStops: TramStops3D | undefined;
  private levelCrossings: LevelCrossings3D | undefined;
  private crossingStates: Uint8Array | undefined;
  private trainTimeS = NaN;
  private selectedTrain: string | null = null;
  private railSelection: string | undefined;
  private source: CityGeometry | undefined;
  private geometry: ReturnType<typeof buildGeometry> | undefined;
  private vegetation: ReturnType<typeof buildVegetation> | undefined;
  private streetCounts: ReturnType<typeof placeStreet>['counts'] | undefined;
  private street: ReturnType<typeof buildStreet> | undefined;
  private paint: Mesh[] = [];
  private asphalt: Mesh<BufferGeometry, MeshLambertMaterial>[] = [];
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
  private selectedParking: number | null = null;
  private parking: Parking3D | undefined;
  private parkedCars: ParkedCars3D | undefined;
  private parkedSnapshot: ParkedCarsSnapshot | null = null;
  private parkedVisible = true;
  private selectedSpace: number | null = null;
  private parkingVisible = false;
  private parkingCounts: ArrayLike<number> | null = null;
  private signalCity: CompiledCity | null = null;
  private lastSignalKey = '';
  private capture: { images: string[]; resolve: (images: string[]) => void } | null = null;
  private belowGround = false;
  private placesVisible = true;
  private walk: { sidewalks: Mesh; footways: Mesh; steps: Mesh } | undefined;
  private walkVisibility = { sidewalks: true, footways: true };
  private basemap: Basemap3D | undefined;
  private tilesEnabled = defaultLayers.basemap;
  private lastRenderMs = performance.now();
  private readonly vehicleMatrix = new Matrix4();
  private shadowView = '';
  private readonly restoreContext = () => {
    this.renderer.setClearColor(style.background);
    this.rail?.paintCache.reset();
    this.shadowView = '';
    this.invalidate();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const renderer = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(style.background);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.scene.add(
      // TASK-162: more sky, less sun: lighter, softer shadows for the flat Sonoma look.
      new HemisphereLight(0xffffff, 0xd9dad6, 2),
      this.sun,
      this.sun.target,
      this.content,
      this.vehicles.mesh,
      this.walkers.mesh,
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
    canvas.addEventListener('webglcontextrestored', this.restoreContext);
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
    city = paintedCity(city);
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
      this.walkers.mesh.count = 0;
      this.parkedSnapshot = null;
    }
    this.city = city;
    const renderedSource = this.terrainEnabled ? source : { ...source, terrain: undefined };
    const geometry = (this.geometry = buildGeometry(
      city,
      renderedSource,
      Boolean(renderedSource.terrain),
    ));
    const terrain = geometry.heights.terrain;
    this.rail = buildRail(city, renderedSource, geometry.heights);
    this.crossingStates = undefined;
    if (city.rail) {
      const table = trainTimetable(city.rail);
      this.trains = new Trains3D(
        city.rail,
        geometry.heights,
        this.rail.heights!,
        railTimetable(city.rail),
      );
      this.content.add(this.trains.group);
      this.stations = new Stations3D(
        placeStationFurniture(city, renderedSource),
        city.rail,
        table,
        geometry.heights,
      );
      this.content.add(this.stations.group);
      this.tramStops = new TramStops3D(placeTramStops(city, renderedSource), geometry.heights);
      this.content.add(this.tramStops.group);
      this.levelCrossings = new LevelCrossings3D(
        city.rail.facilities ?? [],
        geometry.heights,
        city.rail,
      );
      this.content.add(this.levelCrossings.group);
    } else this.trains = this.stations = this.tramStops = this.levelCrossings = undefined;
    this.trainTimeS = NaN;
    this.railSelection = undefined;
    this.content.add(this.rail.group);
    this.catenary = buildCatenary(city, renderedSource, geometry.heights);
    this.catenary.setBelowGround(this.belowGround);
    this.content.add(this.catenary.group);
    this.setRail(this.railVisible);
    this.parking = new Parking3D(city, (p) => terrain.groundAt(p.x, p.y));
    this.parking.group.visible = this.parkingVisible;
    this.parking.setCounts(this.parkingCounts);
    this.content.add(this.parking.group);
    this.parkedCars = new ParkedCars3D(city, geometry.heights);
    this.parkedCars.mesh.visible = this.parkedVisible;
    this.parkedCars.setStyle(this.getView().zoom, this.colourByClass);
    this.parkedCars.setSnapshot(this.parkedSnapshot);
    this.content.add(this.parkedCars.mesh);
    this.updateParkedDataset();
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
    const ground = add(geometry.surfaces, style.asphalt, !terrain.grid);
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
    this.asphalt = [ground, asphalt];
    for (const mesh of this.asphalt) mesh.material.vertexColors = true;
    const walk = buildWalk(city, renderedSource, geometry.heights);
    this.walk = {
      sidewalks: add(walk.sidewalks, style.walk.sidewalk, false),
      footways: add(walk.footways, style.walk.footway, false),
      steps: add(walk.steps, style.walk.steps, false),
    };
    this.setWalkLayers(this.walkVisibility.sidewalks, this.walkVisibility.footways);
    asphalt.material.map = surfaceTexture('asphalt');
    const placementStart = performance.now();
    const placed = placeTrees(city, treeContext(source));
    this.canvas.dataset.treePlacementMs = String(performance.now() - placementStart);
    this.treeCounts = placed.counts;
    this.canvas.dataset.treeCounts = JSON.stringify(placed.counts);
    this.canvas.dataset.treeCap = String(placed.capped);
    this.vegetation = buildVegetation(placed.trees, (p) => terrain.groundAt(p.x, p.y));
    this.content.add(this.vegetation.group);
    const streetStart = performance.now();
    const furniture = placeStreet(city, source, placed.trees);
    this.streetCounts = furniture.counts;
    this.canvas.dataset.streetCounts = JSON.stringify(furniture.counts);
    this.canvas.dataset.streetPlacementMs = String(performance.now() - streetStart);
    this.street = buildStreet(furniture, city, geometry.heights);
    this.content.add(this.street.group);
    add(geometry.slabs, 0xb4b4b8);
    const paint = add(geometry.markings, 0xffffff, false);
    paint.material.vertexColors = true;
    this.paint = [
      paint,
      add(geometry.crossings, markingThemes[cityMarkingTheme(source)].colors.stop, false),
    ];
    const lots = lotGeometry(city, renderedSource, terrain);
    add(lots.surface, style.context.parking, false);
    const strips = stripGeometry(city, renderedSource, geometry.heights);
    add(strips.surface, style.context.parking, false);
    add(strips.paint, style.stall, false);
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
      new MeshLambertMaterial({ color: 0xb4b4b8 }),
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
      new MeshLambertMaterial({ color: 0x6e6e73 }),
      geometry.supports.length,
    );
    const arms = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0x6e6e73 }),
      geometry.supports.length,
    );
    const boxes = new InstancedMesh(
      new BoxGeometry(0.55, 0.95, 0.4),
      new MeshLambertMaterial({ color: 0x3a3a3c }),
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
    this.walkSignals = buildWalkSignals(city, geometry.heights);
    this.content.add(this.walkSignals.group);
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
    this.canvas.dataset.markingTheme = cityMarkingTheme(source);
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
  private updateParkedDataset() {
    this.canvas.dataset.parkedCars = String(this.parkedVisible ? (this.parkedCars?.count ?? 0) : 0);
    this.canvas.dataset.parkingSpaces = String(this.city?.parkingSpaces?.length ?? 0);
    this.canvas.dataset.parkingStrips = String(this.city?.strips?.length ?? 0);
  }
  setParkedCars(snapshot: ParkedCarsSnapshot | null) {
    if (snapshot === this.parkedSnapshot) return;
    this.parkedSnapshot = snapshot;
    this.parkedCars?.setSnapshot(snapshot);
    this.updateParkedDataset();
    this.invalidate();
  }
  setParkedCarsVisible(visible: boolean) {
    if (visible === this.parkedVisible) return;
    this.parkedVisible = visible;
    if (this.parkedCars) this.parkedCars.mesh.visible = visible;
    this.updateParkedDataset();
    this.invalidate();
  }
  setSnapshot(snapshot: PresentationSnapshot) {
    this.crossingStates = snapshot.rail?.crossings;
    this.levelCrossings?.setSnapshot(this.crossingStates, snapshot.timeS, snapshot.rail?.railReady);
    this.canvas.dataset.levelCrossingStates = JSON.stringify(
      this.railVisible ? Array.from(this.crossingStates ?? []) : [],
    );
    this.vehicles.setSnapshot(snapshot);
    this.trainTimeS = NaN;
    if (this.geometry) this.walkers.setSnapshot(snapshot.walkers, this.geometry.heights);
    this.canvas.dataset.walkers = String(this.walkers.mesh.count);
    this.invalidate();
  }
  /** TASK-111: the Pedestrians layer. */
  setPedestrians(visible: boolean) {
    if (visible !== this.pedestrians) this.invalidate();
    this.pedestrians = visible;
    this.walkers.mesh.visible = visible;
  }
  setColourVehiclesByClass(enabled: boolean) {
    if (enabled === this.colourByClass) return;
    this.colourByClass = enabled;
    this.vehicles.setColourByClass(enabled);
    this.parkedCars?.setStyle(this.getView().zoom, enabled);
    this.invalidate();
  }
  setSelection(pick: Pick | null) {
    const train = pick?.kind === 'train' ? pick.id : null;
    if (train !== this.selectedTrain) {
      this.selectedTrain = train;
      this.trainTimeS = NaN;
      this.invalidate();
    }
    const key = JSON.stringify(pick);
    if (this.railSelection !== key) {
      this.railSelection = key;
      this.rail?.select(pick);
      this.invalidate();
    }
    const id = pick?.kind === 'vehicle' ? pick.id : null;
    const parking = pick?.kind === 'parking' ? pick.parking : null;
    const space = pick?.kind === 'parked' ? pick.space : null;
    if (space !== this.selectedSpace) this.invalidate();
    this.selectedSpace = space;
    if (id !== this.selectedId || parking !== this.selectedParking) this.invalidate();
    this.selectedId = id;
    this.selectedParking = parking;
  }
  setParkingOccupancy(counts: ArrayLike<number> | null) {
    const same =
      counts === this.parkingCounts ||
      (counts !== null &&
        this.parkingCounts !== null &&
        counts.length === this.parkingCounts.length &&
        Array.prototype.every.call(counts, (n: number, i: number) => n === this.parkingCounts![i]));
    this.parkingCounts = counts;
    if (same) return;
    this.parking?.setCounts(counts);
    this.invalidate();
  }
  setParkingVisible(visible: boolean) {
    if (visible !== this.parkingVisible) this.invalidate();
    this.parkingVisible = visible;
    if (this.parking) this.parking.group.visible = visible;
    this.canvas.dataset.parkingFacilities = String(visible ? (this.city?.parking.length ?? 0) : 0);
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
    if (this.walkSignals?.update(timeS, loaded)) this.invalidate();
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
    if (this.belowGround !== enabled) this.trainTimeS = NaN;
    if (this.belowGround !== enabled) this.invalidate();
    this.belowGround = enabled;
    this.rail?.setBelowGround(enabled);
    this.catenary?.setBelowGround(enabled);
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

  setStreet(lights: boolean, signs: boolean, curbs: boolean, markings: boolean) {
    if (!this.street) return;
    this.street.lamps.visible = lights;
    this.street.signs.visible = signs;
    this.street.curbs.visible = curbs;
    for (const paint of this.paint) paint.visible = markings;
    const counts = this.streetCounts!;
    this.canvas.dataset.streetLights = String(
      lights ? counts.lamps.osm + counts.lamps.generated : 0,
    );
    this.canvas.dataset.accessSigns = String(signs ? counts.signEntries : 0);
    this.canvas.dataset.curbs = String(curbs ? counts.curbs : 0);
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
  worldToScreen(point: Vec2, heightM = 1) {
    const p = new Vector3(
      point.x,
      (this.geometry?.heights.terrain.groundAt(point.x, point.y) ?? 0) + heightM,
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
    if (this.trains && this.railVisible) {
      const car = pickVehicle3D(
        this.trains.body,
        this.camera,
        x,
        y,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
      if (car !== null) return this.trains.pick(car);
    }
    const index = pickVehicle3D(
      this.vehicles.mesh,
      this.camera,
      x,
      y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    if (index !== null) return { kind: 'vehicle', id: this.vehicles.poses.snapshot!.id[index]! };
    const walker =
      this.pedestrians && this.walkers.mesh.count
        ? pickVehicle3D(
            this.walkers.mesh,
            this.camera,
            x,
            y,
            this.canvas.clientWidth,
            this.canvas.clientHeight,
          )
        : null;
    if (walker !== null) return { kind: 'walker', id: this.walkers.snapshot!.id[walker]! };
    if (this.parkedVisible && this.parkedCars) {
      const parked = pickVehicle3D(
        this.parkedCars.mesh,
        this.camera,
        x,
        y,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
      if (parked !== null) return { kind: 'parked', space: this.parkedCars.spaceAt(parked) };
    }
    if (this.parkingVisible && this.city) {
      const tolerance = Math.max(7, 5 * this.getView().zoom);
      for (let i = this.city.parking.length - 1; i >= 0; i--) {
        const facility = this.city.parking[i]!,
          p = this.worldToScreen(facility.centroid);
        if (Math.abs(p.x - x) <= tolerance && Math.abs(p.y - y) <= tolerance)
          return { kind: 'parking', parking: facility.idx };
      }
    }
    return this.city && this.railVisible
      ? pickRail3D(
          this.city,
          this.rail?.heights,
          { x, y },
          (p, heightM) => this.worldToScreen(p, heightM + 0.06),
          this.belowGround,
        )
      : null;
  }

  render(elapsedS: number, timeS: number) {
    const renderStart = performance.now();
    this.controls.update();
    this.setSignals(timeS);
    if (this.city?.rail && this.trains && this.railVisible && this.trainTimeS !== timeS) {
      const snapshot = this.vehicles.poses.snapshot;
      const poses =
        snapshot?.rail?.trains ?? trainsAt(this.city.rail, railTimetable(this.city.rail), timeS);
      this.trains.update(poses, this.belowGround, this.selectedTrain);
      this.stations?.update(timeS);
      this.canvas.dataset.trains = String(poses.length);
      this.canvas.dataset.trams = String(poses.filter((p) => p.kind === 'tram').length);
      this.trainTimeS = timeS;
      this.invalidate();
    }
    if (import.meta.env.MODE === 'test') this.stations?.report(this.canvas, this.railVisible);
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
    // TASK-162: white streets at overview, a light asphalt gray close up (`roadTint`).
    const tint = roadTint(this.getView().zoom / style.roadDetailScale3d);
    for (const mesh of this.asphalt) mesh.material.color.setHex(tint);
    this.parking?.update(this.getView().zoom, this.selectedParking);
    this.parkedCars?.setStyle(this.getView().zoom, this.colourByClass);
    if (this.city && this.geometry)
      this.vehicles.animate(elapsedS, this.city, this.geometry.heights);
    if (this.city && this.geometry?.heights.terrain.grid && this.vehicles.poses.snapshot) {
      const heights = this.geometry.heights,
        snapshot = this.vehicles.poses.snapshot;
      for (let i = 0; i < snapshot.count; i++) {
        this.vehicles.mesh.getMatrixAt(i, this.vehicleMatrix);
        const e = this.vehicleMatrix.elements,
          p = { x: e[12]!, y: e[14]! },
          lane = (snapshot.poseLane?.[i] ?? -1) >= 0 ? snapshot.poseLane![i]! : snapshot.lane[i]!;
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
    if (this.selectedSpace !== null && this.parkedCars && this.parkedVisible) {
      const parkedIndex = this.parkedCars.instanceOf(this.selectedSpace);
      this.selection.visible = parkedIndex >= 0;
      if (parkedIndex >= 0) {
        this.parkedCars.mesh.getMatrixAt(parkedIndex, this.selection.matrix);
        this.selection.matrix.elements[12]! += 0.5 * this.selection.matrix.elements[0]!;
        this.selection.matrix.elements[14]! += 0.5 * this.selection.matrix.elements[2]!;
        this.selection.matrixAutoUpdate = false;
      }
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
    this.catenary?.setZoom(
      this.canvas.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance),
    );
    // Reuse an unchanged light map. Moving vehicles always refresh their shadows.
    const cacheShadows =
      Boolean(this.geometry?.heights.terrain.grid) &&
      this.vehicles.mesh.count === 0 &&
      this.walkers.mesh.count === 0;
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
      this.walkers.mesh.count,
      this.vegetation?.natural.visible ? 1 : 0,
      this.vegetation?.street.visible ? 1 : 0,
    ]
      .map((n) => n.toFixed(4))
      .join(',');
    this.renderer.shadowMap.autoUpdate = !cacheShadows;
    if (shadowView !== this.shadowView) this.renderer.shadowMap.needsUpdate = true;
    this.shadowView = shadowView;
    const cachedRail = this.rail?.paintCache.update(
      this.renderer,
      this.camera,
      this.railVisible && !this.belowGround && !this.geometry?.heights.terrain.grid,
    );
    this.renderer.render(this.scene, this.camera);
    if (import.meta.env.MODE === 'test') {
      this.canvas.dataset.railPaint = cachedRail ? 'cached' : 'mesh';
      this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames) + 1);
      this.canvas.dataset.triangles = String(this.renderer.info.render.triangles);
      this.canvas.dataset.drawCalls = String(this.renderer.info.render.calls);
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

  setWalkLayers(sidewalks: boolean, footways: boolean) {
    if (this.walkVisibility.sidewalks !== sidewalks || this.walkVisibility.footways !== footways)
      this.invalidate();
    this.walkVisibility = { sidewalks, footways };
    if (this.walk) {
      this.walk.sidewalks.visible = sidewalks;
      this.walk.footways.visible = this.walk.steps.visible = footways;
    }
    this.canvas.dataset.sidewalks = String(sidewalks);
    this.canvas.dataset.footways = String(footways);
  }
  setRail(visible: boolean) {
    if (this.railVisible !== visible) {
      this.invalidate();
      this.trainTimeS = NaN;
    }
    this.railVisible = visible;
    if (this.rail) this.rail.group.visible = visible;
    if (this.trains) this.trains.group.visible = visible;
    if (this.stations) this.stations.group.visible = visible;
    if (this.tramStops) this.tramStops.group.visible = visible;
    if (this.levelCrossings) this.levelCrossings.group.visible = visible;
    this.canvas.dataset.levelCrossings = JSON.stringify(
      visible && this.levelCrossings ? this.levelCrossings.counts : noLevelCrossings,
    );
    this.canvas.dataset.levelCrossingStates = JSON.stringify(
      visible ? Array.from(this.crossingStates ?? []) : [],
    );
    if (!visible) this.canvas.dataset.trains = this.canvas.dataset.trams = '0';
    this.setOverheadLines(this.overheadVisible);

    this.canvas.dataset.railTracks = String(visible ? (this.city?.rail?.tracks.length ?? 0) : 0);
    this.canvas.dataset.stationFurniture = JSON.stringify(
      visible && this.stations ? this.stations.furnitureCounts : noFurniture,
    );
    this.canvas.dataset.tramStops = JSON.stringify(
      visible && this.tramStops ? this.tramStops.counts : noTramStops,
    );
  }

  /** TASK-134: overhead lines, shown with Rail. */
  setOverheadLines(visible: boolean) {
    if (this.overheadVisible !== visible) this.invalidate();
    this.overheadVisible = visible;
    const shown = visible && this.railVisible;
    if (this.catenary) this.catenary.group.visible = shown;
    this.canvas.dataset.catenary =
      shown && this.catenary ? JSON.stringify(this.catenary.counts) : '';
  }

  private disposeContent() {
    this.rail?.paintCache.dispose();
    if (this.geometry && this.buildings) {
      const context = this.geometry.context;
      (this.buildings.geometry === context.buildings
        ? context.detailedBuildings
        : context.buildings
      ).dispose();
    }
    this.walk = undefined;
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
          if (material instanceof MeshLambertMaterial || material instanceof MeshBasicMaterial)
            material.map?.dispose();
          material.dispose();
        }
        if (object instanceof InstancedMesh) object.dispose();
      }
    });
    this.content.clear();
  }
  destroy() {
    this.canvas.removeEventListener('webglcontextrestored', this.restoreContext);
    this.observer.disconnect();
    this.controls.dispose();
    this.basemap?.destroy();
    this.disposeContent();
    this.vehicles.destroy();
    this.walkers.destroy();
    this.selection.geometry.dispose();
    this.selection.material.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
