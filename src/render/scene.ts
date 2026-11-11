import { cityMarkingTheme } from '../schema/marking-theme';
import { markingThemes } from './style';
import { Application, Container, Graphics, Polygon } from 'pixi.js';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { Place } from '../schema';
import { cityGrades } from './grades';
import { Camera } from './camera';
import { FrameDemand, renderContinuously } from './frame-demand';
import { drawVegetation } from './layers/vegetation';
import { placeTrees } from './vegetation';
import { placeStreet, treeContext } from './street';
import { drawStreet } from './layers/street';
import { drawContext } from './layers/context';
import { drawRail } from './layers/rail';
import { drawTrains, pickTrain, trainLayers } from './layers/trains';
import { trainTimetable, trainsAt, type TrainPose } from '../network/trains';
import { railGeometry, pickRail } from './rail-geometry';
import { drawLots } from './layers/stalls';
import { walkGeometry } from './walk-geometry';
import { SIDE_BY_SIDE_EDGE_M, sideBySideEdges } from './side-by-side';
import { drawWalk } from './layers/walk';
import { drawHillshade } from './layers/hillshade';
import { drawEditOverlay, type EditOverlay } from './layers/edit-overlay';
import { drawJunctionMarkings } from './layers/junction-markings';
import { drawNode, drawRoadJoins, nodeColor } from './layers/nodes';
import { drawRoute, drawSelection } from './layers/overlay';
import { drawMultiSelection } from './layers/overlay';
import { HeatLayer } from './layers/heat';
import { drawPlaces } from './layers/places';
import { drawParking } from './layers/parking';
import { drawMovementArrow, drawRoad, drawCrossings, updateZoomFade } from './layers/roads';
import { drawTransitions } from './layers/transitions';
import { drawSignal } from './layers/signals';
import { drawWalkerRoute, drawWalkers, drawWalkSignals } from './layers/walkers';
import { drawSigns } from './layers/signs';
import { DeckCoverage, DeckGhosts, drawGradeShadows } from './layers/shadows';
import { Tiles } from './layers/tiles';
import { createVehicleLayer, Vehicles } from './layers/vehicles';
import { ParkedCars } from './layers/parked-cars';
import { stripTicks } from './strip-geometry';
import { createPicker, pickParking, pickVehicle } from './picking';
import { style } from './style';
import { drawSignalPreview } from './layers/signal-preview';
import type { Pick, CityGeometry, Scene, WalkerSnapshot } from './types';
import { defaultLayers, type LayerVisibility } from './types';

export function orderedLayers(layers: readonly number[]): number[] {
  return [...new Set([0, ...layers])].sort((a, b) => a - b);
}

export function pickThroughNode(
  city: CompiledCity,
  point: Vec2,
  zoom: number,
  grades: number[],
  minimumGrade: number,
) {
  let selected: CompiledCity['nodes'][number] | undefined;
  let closest = Infinity;
  for (const node of city.nodes) {
    if (node.outline.length || !node.movements.length || grades[node.idx]! < minimumGrade) continue;
    const distance = Math.hypot(point.x - node.pos.x, point.y - node.pos.y);
    if (distance > 6 / zoom || (grades[node.idx] === minimumGrade && distance >= closest)) continue;
    selected = node;
    minimumGrade = grades[node.idx]!;
    closest = distance;
  }
  return selected;
}

export function createGrade(layer: number) {
  const group = new Container();
  const terrain = new Container();
  const surfaces = new Graphics();
  const rail = new Graphics();
  const railDetail = new Graphics();
  const trains = new Graphics();
  const tram = new Graphics();
  const sidewalks = new Graphics();
  const footways = new Graphics();
  const markings = new Graphics();
  const nodes = new Graphics();
  const guides = new Graphics();
  const arrows = new Graphics();
  const crossings = new Graphics();
  const places = new Graphics();
  const connectors = new Graphics();
  const signals = new Container();
  const vehicles = createVehicleLayer();
  const walkers = new Graphics();
  const parkedCars = createVehicleLayer();
  const bands = new Graphics();
  const slotTicks = new Graphics();
  terrain.addChild(
    rail,
    railDetail,
    footways,
    sidewalks,
    bands,
    surfaces,
    slotTicks,
    markings,
    arrows,
    nodes,
    tram,
    guides,
    crossings,
  );
  group.addChild(
    terrain,
    connectors,
    places,
    signals,
    parkedCars.container,
    vehicles.container,
    trains,
    walkers,
  );
  return {
    layer,
    group,
    terrain,
    surfaces,
    sidewalks,
    rail,
    railDetail,
    trains,
    footways,
    tram,
    markings,
    nodes,
    guides,
    arrows,
    crossings,
    places,
    connectors,
    signals,
    vehicles,
    walkers,
    parkedCars,
    bands,
    slotTicks,
    terrainSize: 0,
    cacheResolution: 0,
  };
}

export function createScene(canvas: HTMLCanvasElement): Scene & {
  setVehicleGeometry(city: CompiledCity, laneChangeDurationS: number): void;
  animateVehicles(elapsedS: number, playing?: boolean): void;
  setWalkerRoute(links: readonly number[] | null): void;
} {
  const app = new Application();
  const demand = new FrameDemand();
  const invalidate = demand.invalidate;
  let active = true;
  let animation = 0;
  let vehicleAgeS = 0;
  let previewLoaded: CompiledCity | null | undefined;
  let previewTimeS = NaN;
  let previewNode: string | null = null;
  const world = new Container();
  world.eventMode = 'none';
  const map = new Container();
  const routeOverlay = new Graphics();
  const walkerRoute = new Graphics();
  const selectionOverlay = new Graphics();
  const multiSelectionOverlay = new Graphics();
  const vehicleRing = new Graphics()
    .circle(0, 0, 6)
    .stroke({ width: 1.25, color: style.selection });
  vehicleRing.visible = false;
  const heatOverlay = new Graphics();
  const heat = new HeatLayer();
  const difference = new Graphics();
  let differenceCount = 0;
  heatOverlay.addChild(heat.roads, heat.queues);
  const disconnectedOverlay = new Graphics();
  const signalPreview = new Graphics();
  const parking = new Graphics();
  world.addChild(map, routeOverlay, walkerRoute, selectionOverlay, vehicleRing, heatOverlay);
  world.addChild(multiSelectionOverlay);
  world.addChild(disconnectedOverlay, signalPreview, parking);
  const editOverlay = new Graphics();
  let editPreview: EditOverlay | null = null;
  world.addChild(editOverlay);
  app.stage.addChild(world);

  const vehicles = new Vehicles();
  const parkedCars = new ParkedCars();
  let surroundings: ReturnType<typeof drawContext> | undefined;
  let lots: ReturnType<typeof drawLots> | undefined;
  let hillshade: ReturnType<typeof drawHillshade> | undefined;
  let contextCount = 0;
  let vegetation: ReturnType<typeof drawVegetation> | undefined;
  let furniture: ReturnType<typeof drawStreet> = [];
  let furnitureCounts: ReturnType<typeof placeStreet>['counts'] | undefined;
  let treeCounts: ReturnType<typeof placeTrees>['counts'] | undefined;
  let city: CompiledCity | undefined;
  let trainPoses: TrainPose[] = [];
  let trainTimeS = 0;
  let trainsVisible = true;
  const updateTrainPoses = () => {
    if (!layerVisibility.rail) return;
    trainPoses = city?.rail ? trainsAt(city.rail, trainTimetable(city.rail), trainTimeS) : [];
    redrawTrains();
  };
  const redrawTrains = () => {
    if (!city?.rail) return;
    drawTrains(
      trainLayers(visibleGrades),
      city.rail,
      trainPoses,
      selection?.kind === 'train' ? selection.id : null,
    );
    canvas.dataset.trains = String(layerVisibility.rail ? trainPoses.length : 0);
  };
  let parkingCounts: ArrayLike<number> | null = null;
  let tiles: Tiles | undefined;
  let tilesEnabled = true;
  let sourceGeometry: CityGeometry | undefined;
  let shapes: Place['shape'][] = [];
  let staticPick: ReturnType<typeof createPicker> | undefined;
  let updateSignals: ((timeS: number) => void)[] = [];
  let updatePlaces: ((zoom: number) => void) | undefined;
  let layerVisibility: LayerVisibility = defaultLayers;
  let visibleGrades: ReturnType<typeof createGrade>[] = [];
  let walkerLayers = new Map<number, Graphics>();
  let walkerSnapshot: WalkerSnapshot | undefined;
  let selectedWalker = -1;
  let drawnWalkers = false;
  const redrawWalkers = () => {
    // Without test pedestrians the layers stay empty: nothing to clear or draw.
    if (!walkerSnapshot && !drawnWalkers) return;
    drawWalkers(walkerLayers, walkerSnapshot, camera.zoom, selectedWalker);
    drawnWalkers = !!walkerSnapshot;
  };
  let gradeShadows: ReturnType<typeof drawGradeShadows>[] = [];
  let ghosts: DeckGhosts[] = [];
  let rebuildShadows = () => {};

  let redrawTerrain = () => {};

  function updateTerrainCache() {
    for (const grade of visibleGrades) grade.slotTicks.alpha = Math.min(1, camera.zoom / 1.5);
    if (lots) lots.stalls.alpha = Math.min(1, camera.zoom / 1.5);
    // At overview zoom both markings and arrows are invisible. Rasterize the static
    // terrain once at a power-of-two screen resolution, leaving cars/signals live.
    // A 2048 px edge cap bounds texture storage; detailed views use vector geometry.
    const overview = camera.zoom < 0.7;
    const resolution = 2 ** Math.ceil(Math.log2(camera.zoom * window.devicePixelRatio));
    if (surroundings) surroundings.ties.visible = !overview;
    for (const grade of visibleGrades) {
      // Twin rails are 0.18 m wide: below 3 px/m they are sub-pixel slivers that cost frame time.
      const detail = layerVisibility.rail && camera.zoom >= 3;
      if (grade.rail.visible !== layerVisibility.rail || grade.railDetail.visible !== detail) {
        grade.rail.visible = layerVisibility.rail;
        grade.railDetail.visible = detail;
        grade.tram.visible = layerVisibility.rail;
        grade.terrain.updateCacheTexture();
      }
      for (const graphics of [grade.markings, grade.guides, grade.arrows, grade.crossings])
        updateZoomFade(graphics, camera.zoom);
      for (const child of grade.signals.children)
        if (child instanceof Graphics) updateZoomFade(child, camera.zoom);
      grade.markings.visible = !overview && layerVisibility.markings;
      grade.guides.visible = !overview && layerVisibility.markings;
      grade.arrows.visible = !overview && layerVisibility.markings;
      grade.crossings.visible = !overview && layerVisibility.markings;
      const next = overview && grade.terrainSize * resolution <= 2048 ? resolution : 0;
      if (next === grade.cacheResolution) continue;
      grade.terrain.cacheAsTexture(false);
      if (next) grade.terrain.cacheAsTexture({ resolution: next, antialias: true });
      grade.cacheResolution = next;
    }
    for (const ghost of ghosts) ghost.sync();
  }

  function applyVisibility() {
    if (trainsVisible !== layerVisibility.rail) {
      trainsVisible = layerVisibility.rail;
      if (trainsVisible) updateTrainPoses();
    }
    for (const grade of visibleGrades) grade.trains.visible = layerVisibility.rail;
    canvas.dataset.trains = String(layerVisibility.rail ? trainPoses.length : 0);
    for (const grade of visibleGrades)
      grade.parkedCars.container.visible = layerVisibility.parkedCars;
    canvas.dataset.parkedCars = String(layerVisibility.parkedCars ? parkedCars.count : 0);
    canvas.dataset.parkingSpaces = String(city?.parkingSpaces?.length ?? 0);
    canvas.dataset.parkingStrips = String(city?.strips?.length ?? 0);
    if (lots && lots.stalls.visible !== layerVisibility.parkingStalls) {
      lots.stalls.visible = layerVisibility.parkingStalls;
      visibleGrades[0]!.terrain.updateCacheTexture();
    }
    canvas.dataset.parkingStalls = String(
      layerVisibility.parkingStalls
        ? (city?.lots?.reduce((s, lot) => s + lot.stallCount, 0) ?? 0)
        : 0,
    );
    for (const grade of visibleGrades) {
      if (
        grade.sidewalks.visible !== layerVisibility.sidewalks ||
        grade.footways.visible !== layerVisibility.footways
      ) {
        grade.sidewalks.visible = layerVisibility.sidewalks;
        grade.footways.visible = layerVisibility.footways;
        grade.terrain.updateCacheTexture();
      }
    }
    canvas.dataset.sidewalks = String(layerVisibility.sidewalks);
    canvas.dataset.railTracks = String(layerVisibility.rail ? (city?.rail?.tracks.length ?? 0) : 0);
    selectionOverlay.visible =
      layerVisibility.rail ||
      (selection?.kind !== 'track' &&
        selection?.kind !== 'platform' &&
        !(
          selection?.kind === 'place' &&
          sourceGeometry?.places[city!.places[selection.place]!.id]?.station
        ));
    canvas.dataset.footways = String(layerVisibility.footways);
    if (hillshade && hillshade.visible !== layerVisibility.terrain) {
      hillshade.visible = layerVisibility.terrain;
      const grade = visibleGrades[0]!;
      const bounds = grade.terrain.getLocalBounds();
      grade.terrainSize = Math.max(bounds.width, bounds.height);
      updateTerrainCache();
      grade.terrain.updateCacheTexture();
    }
    for (const layer of furniture) {
      layer.container.visible = camera.zoom >= 1.5;
      layer.lamps.visible = layerVisibility.streetLights;
      layer.signs.visible = layerVisibility.signs;
    }
    canvas.dataset.streetLights = String(
      layerVisibility.streetLights
        ? furnitureCounts
          ? furnitureCounts.lamps.osm + furnitureCounts.lamps.generated
          : 0
        : 0,
    );
    canvas.dataset.accessSigns = String(
      layerVisibility.signs ? (furnitureCounts ? furnitureCounts.signEntries : 0) : 0,
    );
    updateTerrainCache();
    canvas.dataset.terrain = String(Boolean(hillshade && layerVisibility.terrain));
    if (surroundings && surroundings.container.visible !== layerVisibility.context) {
      surroundings.container.visible = layerVisibility.context;
      const grade = visibleGrades[0]!;
      const bounds = grade.terrain.getLocalBounds();
      grade.terrainSize = Math.max(bounds.width, bounds.height);
      updateTerrainCache();
      grade.terrain.updateCacheTexture();
    }
    if (
      vegetation &&
      (vegetation.natural.visible !== layerVisibility.trees ||
        vegetation.street.visible !== layerVisibility.streetTrees)
    ) {
      vegetation.natural.visible = layerVisibility.trees;
      vegetation.street.visible = layerVisibility.streetTrees;
      visibleGrades[0]!.terrain.updateCacheTexture();
    }
    canvas.dataset.trees = String(
      layerVisibility.trees && treeCounts
        ? Object.entries(treeCounts).reduce((sum, [key, n]) => sum + (key === 'street' ? 0 : n), 0)
        : 0,
    );
    canvas.dataset.streetTrees = String(
      layerVisibility.streetTrees ? (treeCounts?.street ?? 0) : 0,
    );
    canvas.dataset.contextFeatures = String(layerVisibility.context ? contextCount : 0);
    difference.visible = layerVisibility.difference;
    if (import.meta.env.MODE === 'test')
      canvas.dataset.differenceRoads = String(layerVisibility.difference ? differenceCount : 0);
    heat.roads.visible = layerVisibility.heat;
    heat.queues.visible = layerVisibility.queues;
    parking.visible = layerVisibility.parkingOccupancy;
    canvas.dataset.parkingFacilities = String(
      layerVisibility.parkingOccupancy ? (city?.parking.length ?? 0) : 0,
    );
    routeOverlay.visible = layerVisibility.routes;
    walkerRoute.visible = layerVisibility.routes && layerVisibility.pedestrians;
    for (const graphics of walkerLayers.values()) graphics.visible = layerVisibility.pedestrians;
    disconnectedOverlay.visible = layerVisibility.disconnected;
    for (const grade of visibleGrades) {
      grade.places.visible = layerVisibility.places;
      grade.connectors.visible = layerVisibility.connectors;
      grade.signals.visible = layerVisibility.signals;
    }
    for (const ghost of ghosts) ghost.signals.visible = layerVisibility.signals;
    if (import.meta.env.MODE === 'test')
      canvas.dataset.gradeEffects = JSON.stringify({
        graphics: gradeShadows.length * 2,
        ghosts: ghosts.length,
        tunnels: visibleGrades.filter((grade) => grade.surfaces.alpha !== 1).length,
      });
  }
  let selection: Pick | null = null;
  let selectedVehicle = -1;
  let destroyed = false;
  let resizeObserver: ResizeObserver | undefined;
  const ready = app
    .init({
      canvas,
      autoStart: false,
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
      resolution: window.devicePixelRatio,
      antialias: true,
      backgroundColor: style.background,
      preference: 'webgl',
    })
    .then(() => {
      if (destroyed) {
        app.destroy(false, { children: true });
        return;
      }
      resizeObserver = new ResizeObserver(() => {
        app.renderer.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
        invalidate();
      });
      resizeObserver.observe(canvas);
      if (import.meta.env.MODE === 'test') {
        canvas.dataset.frames = '0';
        canvas.dataset.active = String(active);
        const render = app.renderer.render.bind(app.renderer) as (
          options: unknown,
          legacyOptions?: unknown,
        ) => void;
        app.renderer.render = (options, legacyOptions?: unknown) => {
          const start = performance.now();
          render(options, legacyOptions);
          performance.measure('cityflows:render', { start, end: performance.now() });
          performance.clearMeasures('cityflows:render');
        };
      }
      let lastFrame = performance.now();
      const frame = (now: number) => {
        animation = requestAnimationFrame(frame);
        // Preserve the ticker's fade delta cap on slow frames.
        const deltaMS = Math.min(1000 / app.ticker.minFPS, Math.max(0, now - lastFrame));
        lastFrame = now;
        if (!active) return;
        if (tilesEnabled && tiles && (demand.pending || tiles.needsUpdate)) {
          const { width, height } = app.screen;
          if (tiles.update(camera, width, height, deltaMS)) invalidate();
        }
        if (demand.consume(renderContinuously())) {
          app.render();
          if (import.meta.env.MODE === 'test')
            canvas.dataset.frames = String(Number(canvas.dataset.frames) + 1);
        }
      };
      animation = requestAnimationFrame(frame);
    });

  function updateVehicleRing(): void {
    vehicleRing.visible = selectedVehicle >= 0;
    if (selectedVehicle >= 0)
      vehicleRing.position.set(vehicles.x[selectedVehicle]!, vehicles.y[selectedVehicle]!);
  }

  const camera = new Camera(() => {
    invalidate();
    const { x, y } = camera.worldToScreen({ x: 0, y: 0 });
    world.position.set(x, y);
    world.scale.set(camera.zoom);
    vehicleRing.scale.set(1 / camera.zoom);
    vehicles.setZoom(camera.zoom);
    parkedCars.setStyle(camera.zoom, layerVisibility.vehicleClasses);
    updateTerrainCache();
    for (const layer of furniture) layer.container.visible = camera.zoom >= 1.5;
    drawEditOverlay(editOverlay, editPreview, camera.zoom);
    updatePlaces?.(camera.zoom);
    if (city) drawParking(parking, city, parkingCounts, camera.zoom);
    if (city) drawSelection(selectionOverlay, city, shapes, selection, camera.zoom);
    redrawWalkers();
  });
  vehicles.setZoom(camera.zoom);

  return {
    ready,
    camera,
    setActive(next) {
      active = next;
      if (import.meta.env.MODE === 'test') canvas.dataset.active = String(active);
      if (active) invalidate();
    },
    setCity(compiled, source) {
      const markingTheme = markingThemes[cityMarkingTheme(source)];
      // Versions identify edits within a city. Different source cities can share a version.
      if (city?.version === compiled.version && sourceGeometry === source) return;
      invalidate();
      previewLoaded = undefined;
      const rebuildStart = import.meta.env.MODE === 'test' ? performance.now() : 0;
      city = compiled;
      parkingCounts = null;
      drawParking(parking, city, parkingCounts, camera.zoom);
      vehicles.setGeometry(compiled);
      if (sourceGeometry?.geo !== source?.geo) {
        tiles?.destroy();
        tiles = source?.geo ? new Tiles(source.geo) : undefined;
      }
      sourceGeometry = source;
      selection = null;
      selectedVehicle = -1;
      updateVehicleRing();
      selectionOverlay.clear();
      multiSelectionOverlay.clear();
      routeOverlay.clear();
      walkerRoute.clear();
      walkerSnapshot = undefined;
      selectedWalker = -1;
      heatOverlay.clear();
      heat.setCity(compiled);
      disconnectedOverlay.clear();
      signalPreview.clear();
      tiles?.container.removeFromParent();
      // The heat tint lives in the base grade so it sits under vehicles and signals.
      heat.roads.removeFromParent();
      difference.removeFromParent();
      difference.clear();
      differenceCount = 0;
      for (const ghost of ghosts) ghost.destroy();
      ghosts = [];
      gradeShadows = [];
      hillshade?.destroy({ texture: true, textureSource: true });
      hillshade = undefined;
      for (const child of map.removeChildren()) child.destroy({ children: true, context: true });
      updateSignals = [];

      if (tiles) map.addChild(tiles.container);
      const started = performance.now();
      const features = (source?.context?.features ?? []).filter(
        (f) => !compiled.rail || (f.class !== 'rail' && f.class !== 'tram'),
      );
      const placementStart = performance.now();
      const placed = placeTrees(compiled, treeContext(source ?? { nodes: {}, places: {} }));
      treeCounts = placed.counts;
      canvas.dataset.treePlacementMs = String(performance.now() - placementStart);
      canvas.dataset.treeCounts = JSON.stringify(placed.counts);
      canvas.dataset.treeCap = String(placed.capped);
      const streetStart = performance.now();
      const street = placeStreet(compiled, source ?? { nodes: {}, places: {} }, placed.trees);
      furnitureCounts = street.counts;
      canvas.dataset.streetCounts = JSON.stringify(street.counts);
      canvas.dataset.streetPlacementMs = String(performance.now() - streetStart);

      const vegetationStart = performance.now();
      vegetation = drawVegetation(placed.trees);
      canvas.dataset.vegetationRebuildMs = String(performance.now() - vegetationStart);
      surroundings = drawContext(features);
      contextCount = features.length;
      map.addChild(surroundings.container);
      if (import.meta.env.MODE === 'test')
        canvas.dataset.contextRebuildMs = String(performance.now() - started);
      const { nodeGrades, roadGrades } = cityGrades(city, source);
      visibleGrades = orderedLayers([
        ...nodeGrades,
        ...roadGrades,
        ...compiled.walk.links.map((l) => l.layer),
        ...(compiled.rail?.tracks.map((t) => t.layer) ?? []),
        ...(compiled.rail?.platforms.map((p) => p.layer) ?? []),
      ]).map(createGrade);
      const grades = new Map(visibleGrades.map((grade) => [grade.layer, grade]));
      for (const shape of railGeometry(compiled, source)) {
        const grade = grades.get(shape.layer)!;
        const over = shape.tram === 'rail' || shape.tram === 'street';
        drawRail(over ? grade.tram : shape.detail ? grade.railDetail : grade.rail, shape);
      }
      walkerLayers = new Map(visibleGrades.map((grade) => [grade.layer, grade.walkers]));
      drawnWalkers = false;
      for (const shape of walkGeometry(compiled, source)) {
        const grade = grades.get(shape.layer)!;
        drawWalk(shape.sidewalk ? grade.sidewalks : grade.footways, shape);
      }
      for (const { group } of visibleGrades) map.addChild(group);
      for (const strip of compiled.strips ?? [])
        grades.get(roadGrades[strip.road]!)!.bands.poly(strip.polygon).fill(style.context.parking);
      for (const tick of stripTicks(compiled, source))
        grades
          .get(roadGrades[tick.road]!)!
          .slotTicks.poly(tick.points, false)
          .stroke({ color: style.stall, width: 0.12, alpha: 0.8 });
      // The bottom grade shares its overview texture with surroundings: same draw order,
      // without another map-sized textured quad on software GPUs.
      visibleGrades[0]!.terrain.addChildAt(surroundings.container, 0);
      visibleGrades[0]!.terrain.addChildAt(vegetation.container, 1);
      lots = drawLots(compiled, source);
      visibleGrades[0]!.terrain.addChildAt(lots.container, 1);
      if (source?.terrain) {
        hillshade = drawHillshade(source.terrain);
        hillshade.visible = layerVisibility.terrain;
        visibleGrades[0]!.terrain.addChildAt(hillshade, 0);
      }
      const base = grades.get(0)!;
      furniture = drawStreet(street, roadGrades);
      for (const layer of furniture) grades.get(layer.grade)!.group.addChild(layer.container);
      base.group.addChildAt(heat.roads, base.group.getChildIndex(base.connectors));
      base.group.addChildAt(difference, base.group.getChildIndex(base.connectors));
      applyVisibility();
      shapes = city.places.map(
        ({ id, centroid }) => source?.places[id]?.shape ?? { kind: 'point', pos: centroid },
      );
      staticPick = createPicker(city, shapes, roadGrades);
      const pickBase = staticPick;
      const nodeAreas = city.nodes.map(
        (node) => new Polygon(node.outline.flatMap(({ x, y }) => [x, y])),
      );
      staticPick = (point, zoom) => {
        const hit = pickBase(point, zoom);
        const minimumGrade = hit?.kind === 'lane' ? roadGrades[hit.road]! : -Infinity;
        const through = pickThroughNode(compiled, point, zoom ?? 1, nodeGrades, minimumGrade);
        if (through && (!hit || hit.kind === 'lane' || hit.kind === 'node'))
          return { kind: 'node', node: through.idx };
        if (hit && hit.kind !== 'node') return hit;
        const node = nodeAreas.findIndex((area) => area.contains(point.x, point.y));
        if (node >= 0) return { kind: 'node', node };
        // Keep the center handle of an authored roundabout selectable for removal.
        return hit?.kind === 'node' && source?.nodes[compiled.nodes[hit.node]!.id]?.roundabout
          ? hit
          : null;
      };

      const sideBySide = sideBySideEdges(compiled, source);
      redrawTerrain = () => {
        for (const grade of visibleGrades) {
          grade.terrain.cacheAsTexture(false);
          grade.cacheResolution = 0;
          for (const graphics of [
            grade.surfaces,
            grade.markings,
            grade.arrows,
            grade.nodes,
            grade.crossings,
          ])
            graphics.clear();
        }
        for (const road of compiled.roads) {
          const grade = grades.get(roadGrades[road.idx]!)!;
          drawRoad(
            grade.surfaces,
            grade.markings,
            compiled,
            road,
            layerVisibility.roadClasses,
            grade.crossings,
            sourceGeometry,
            markingTheme,
          );
          drawTransitions(
            grade.surfaces,
            grade.markings,
            compiled,
            road,
            layerVisibility.roadClasses,
            markingTheme,
          );
          drawRoadJoins(grade.surfaces, compiled, road, layerVisibility.roadClasses);
          drawCrossings(grade.crossings, compiled, road, sourceGeometry, markingTheme);
        }
        for (const node of compiled.nodes) {
          drawNode(
            grades.get(nodeGrades[node.idx]!)!.nodes,
            node,
            nodeColor(compiled, node, layerVisibility.roadClasses),
          );
        }
        // TASK-131 (B55): two roads side by side on their OSM lines, an edge line between them,
        // over the junction surface where it runs on into a junction both meet at.
        for (const { roads, line } of sideBySide)
          grades
            .get(roadGrades[roads[0]]!)!
            .nodes.poly(line, false)
            .stroke({ color: style.walk.sidewalk, width: SIDE_BY_SIDE_EDGE_M, cap: 'round' });
        for (const movement of compiled.movements) {
          if (!movement.neverGreen && compiled.nodes[movement.node]!.outline.length)
            drawMovementArrow(
              grades.get(nodeGrades[movement.node]!)!.arrows,
              movement,
              markingTheme,
            );
        }
        updateTerrainCache();
      };
      // Guide lines do not depend on road-class tones.
      for (const node of city.nodes)
        drawJunctionMarkings(grades.get(nodeGrades[node.idx]!)!.guides, city, node, markingTheme);
      redrawTerrain();
      canvas.dataset.markingTheme = markingTheme.id;
      for (const node of city.nodes) {
        const grade = grades.get(nodeGrades[node.idx]!)!;
        drawSigns(city, node, grade.signals);
        if (node.signal) {
          updateSignals.push(drawSignal(city, node, grade.signals));
          updateSignals.push(drawWalkSignals(city, node, grade.signals));
        }
      }
      updatePlaces = drawPlaces(grades.get(0)!.places, city, shapes, grades.get(0)!.connectors);
      updatePlaces(camera.zoom);
      for (const grade of visibleGrades) {
        const bounds = grade.terrain.getLocalBounds();
        grade.terrainSize = Math.max(bounds.width, bounds.height);
      }
      updateTerrainCache();
      for (const update of updateSignals) update(0);
      vehicles.setLayers(
        visibleGrades.map((grade) => grade.vehicles),
        city.lanes.map(({ road }) => grades.get(roadGrades[road]!)!.vehicles),
        city.movements.map(({ node }) => grades.get(nodeGrades[node]!)!.vehicles),
      );
      parkedCars.setGeometry(
        compiled,
        visibleGrades.map((grade) => grade.parkedCars),
        city.lanes.map(({ road }) => grades.get(roadGrades[road]!)!.parkedCars),
      );
      rebuildShadows = () => {
        for (const effect of gradeShadows) {
          effect.shadow.removeFromParent();
          effect.edges.removeFromParent();
          effect.shadow.destroy({ context: true });
          effect.edges.destroy({ context: true });
        }
        gradeShadows = [];
        for (const ghost of ghosts) ghost.destroy();
        ghosts = [];
        for (const grade of visibleGrades) {
          grade.terrain.cacheAsTexture(false);
          grade.cacheResolution = 0;
          // Dim the tunnel grade's road layers, not the surroundings (TASK-096) that share the
          // bottom grade's terrain cache.
          const alpha = layerVisibility.shadows && grade.layer < 0 ? style.tunnelAlpha : 1;
          for (const child of grade.terrain.children)
            if (child !== surroundings?.container && child !== vegetation?.container)
              child.alpha = alpha;
        }
        if (layerVisibility.shadows) {
          const coverage = new DeckCoverage(compiled, roadGrades, nodeGrades);
          for (const [i, grade] of visibleGrades.entries()) {
            if (grade.layer !== 0) {
              const effect = drawGradeShadows(
                compiled,
                grade.layer,
                visibleGrades[i - 1]?.layer,
                roadGrades,
                nodeGrades,
              );
              if (grade.layer > 0) grade.terrain.addChildAt(effect.shadow, 0);
              else grade.terrain.addChild(effect.shadow);
              grade.terrain.addChild(effect.edges);
              gradeShadows.push(effect);
            }
            if (i === visibleGrades.length - 1) continue;
            const ghost = new DeckGhosts(
              grade.layer,
              coverage,
              grade.signals,
              grade.vehicles.container,
            );
            map.addChild(ghost.container);
            ghosts.push(ghost);
          }
        }
        for (const grade of visibleGrades) {
          const bounds = grade.terrain.getLocalBounds();
          grade.terrainSize = Math.max(bounds.width, bounds.height);
        }
        updateTerrainCache();
        applyVisibility();
      };
      rebuildShadows();
      if (import.meta.env.MODE === 'test') {
        performance.measure('cityflows:rebuild', { start: rebuildStart, end: performance.now() });
        performance.clearMeasures('cityflows:rebuild');
      }
    },
    setTiles(enabled) {
      invalidate();
      tilesEnabled = enabled;
      if (!enabled) tiles?.clearView();
    },
    setParkedCars(snapshot) {
      parkedCars.setSnapshot(snapshot);
      canvas.dataset.parkedCars = String(layerVisibility.parkedCars ? parkedCars.count : 0);
      invalidate();
    },
    setSnapshot(snapshot) {
      invalidate();
      if (!city) return;
      trainTimeS = snapshot.timeS;
      updateTrainPoses();
      vehicles.update(snapshot);
      vehicleAgeS = 0;
      walkerSnapshot = snapshot.walkers;
      redrawWalkers();
      if (import.meta.env.MODE === 'test')
        canvas.dataset.walkers = String(walkerSnapshot?.count ?? 0);
      for (const update of updateSignals) update(snapshot.timeS);
      for (const ghost of ghosts) ghost.sync();
      if (selection?.kind === 'vehicle') {
        selectedVehicle = snapshot.id.subarray(0, snapshot.count).indexOf(selection.id);
        updateVehicleRing();
      }
    },
    setWalkerRoute(links) {
      invalidate();
      if (city && links) drawWalkerRoute(walkerRoute, city, links);
      else walkerRoute.clear();
    },
    setVehicleGeometry(compiled, laneChangeDurationS) {
      vehicles.setGeometry(compiled, laneChangeDurationS);
    },
    animateVehicles(elapsedS, playing = false) {
      if (elapsedS === vehicleAgeS && !playing) return;
      vehicleAgeS = elapsedS;
      if (vehicles.snapshot?.count) invalidate();
      vehicles.animate(elapsedS);
      for (const ghost of ghosts) ghost.sync();
      updateVehicleRing();
    },
    setSelection(next) {
      invalidate();
      selection = next;
      redrawTrains();
      if (city) drawSelection(selectionOverlay, city, shapes, selection, camera.zoom);
      const snapshot = vehicles.snapshot;
      selectedVehicle =
        snapshot && selection?.kind === 'vehicle'
          ? snapshot.id.subarray(0, snapshot.count).indexOf(selection.id)
          : -1;
      updateVehicleRing();
      selectedWalker = selection?.kind === 'walker' ? selection.id : -1;
      redrawWalkers();
    },
    setMultiSelection(roads) {
      invalidate();
      if (city) drawMultiSelection(multiSelectionOverlay, city, roads);
    },
    setSignalPreview(loaded, timeS) {
      const nodeId = selection?.kind === 'node' ? city!.nodes[selection.node]!.id : null;
      if (loaded === previewLoaded && timeS === previewTimeS && nodeId === previewNode) return;
      previewLoaded = loaded;
      previewTimeS = timeS;
      previewNode = nodeId;
      invalidate();
      const preview = drawSignalPreview(signalPreview, loaded, nodeId, timeS);
      canvas.setAttribute(
        'aria-description',
        preview ? `Signal ${nodeId}: phase ${preview.phase + 1}, ${preview.state}` : '',
      );
      if (import.meta.env.MODE === 'test') canvas.dataset.signalPreview = JSON.stringify(preview);
    },
    setRouteOverlay(route) {
      invalidate();
      if (city) drawRoute(routeOverlay, city, route);
    },
    setEditOverlay(overlay) {
      invalidate();
      editPreview = overlay;
      drawEditOverlay(editOverlay, overlay, camera.zoom);
    },
    setHeat(ratios) {
      invalidate();
      if (city) heat.setHeat(ratios);
    },
    setParkingOccupancy(counts) {
      // Snapshots arrive while paused too; redraw only for a changed count (TASK-115).
      const same =
        counts === parkingCounts ||
        (counts !== null &&
          parkingCounts !== null &&
          counts.length === parkingCounts.length &&
          Array.prototype.every.call(counts, (n: number, i: number) => n === parkingCounts![i]));
      parkingCounts = counts;
      if (same) return;
      invalidate();
      if (city) drawParking(parking, city, counts, camera.zoom);
    },
    setDifference(roads) {
      invalidate();
      difference.clear();
      differenceCount = 0;
      const max = Math.max(1, ...(roads ?? []).map(({ vehicles }) => Math.abs(vehicles)));
      for (const road of roads ?? []) {
        if (!road.vehicles) continue;
        difference.poly(road.surface).fill({
          color: road.vehicles > 0 ? 0xb97750 : 0x4d8e94,
          alpha: 0.35 + (0.5 * Math.abs(road.vehicles)) / max,
        });
        differenceCount++;
      }
      applyVisibility();
    },
    setQueues(snapshot) {
      invalidate();
      if (city) heat.setQueues(snapshot);
    },
    setLayerVisibility(layers) {
      invalidate();
      const recolor = layers.roadClasses !== layerVisibility.roadClasses;
      const reshade = layers.shadows !== layerVisibility.shadows;
      layerVisibility = layers;
      vehicles.setColourByClass(layers.vehicleClasses);
      parkedCars.setStyle(camera.zoom, layers.vehicleClasses);
      if (recolor) redrawTerrain();
      if (reshade) rebuildShadows();
      applyVisibility();
    },
    setDisconnected(lanes) {
      invalidate();
      disconnectedOverlay.clear();
      if (!city) return;
      for (const index of lanes) {
        const lane = city.lanes[index]!;
        disconnectedOverlay.poly(lane.polyline, false).stroke({
          width: lane.widthM + 1,
          color: style.signalAmber,
          alpha: 0.8,
          cap: 'round',
        });
      }
    },
    pick(screenX, screenY) {
      const point = camera.screenToWorld({ x: screenX, y: screenY });
      const snapshot = vehicles.snapshot;
      const body = vehicles.pickBody(point);
      const vehicle =
        body !== null
          ? { kind: 'vehicle' as const, id: body }
          : snapshot &&
            pickVehicle(point, camera.zoom, snapshot.id, vehicles.x, vehicles.y, snapshot.count);
      const walker =
        layerVisibility.pedestrians && walkerSnapshot
          ? pickVehicle(
              point,
              camera.zoom,
              walkerSnapshot.id,
              walkerSnapshot.x,
              walkerSnapshot.y,
              walkerSnapshot.count,
            )
          : null;
      const parked = layerVisibility.parkedCars ? parkedCars.pick(point) : null;
      const staticHit = staticPick?.(point, camera.zoom);
      const roadGrade =
        city && staticHit?.kind === 'lane'
          ? cityGrades(city, sourceGeometry).roadGrades[staticHit.road]!
          : -Infinity;
      const train =
        city?.rail && layerVisibility.rail
          ? pickTrain(
              trainPoses,
              point,
              camera.zoom,
              city.rail,
              staticHit?.kind === 'node'
                ? cityGrades(city, sourceGeometry).nodeGrades[staticHit.node]!
                : roadGrade,
            )
          : null;
      return (
        train ??
        vehicle ??
        (walker?.kind === 'vehicle' ? { kind: 'walker' as const, id: walker.id } : null) ??
        (parked === null ? null : { kind: 'parked' as const, space: parked }) ??
        (city && layerVisibility.parkingOccupancy ? pickParking(city, point, camera.zoom) : null) ??
        (city && layerVisibility.rail ? pickRail(city, point, camera.zoom, roadGrade) : null) ??
        staticHit ??
        null
      );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(animation);
      for (const ghost of ghosts) ghost.destroy();
      vehicles.destroy();
      parkedCars.destroy();
      hillshade?.destroy({ texture: true, textureSource: true });
      tiles?.destroy();
      if (resizeObserver) {
        resizeObserver.disconnect();
        app.destroy(false, { children: true, context: true });
      }
    },
  };
}
