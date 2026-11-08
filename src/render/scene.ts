import { Application, Container, Graphics, Polygon } from 'pixi.js';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { Place } from '../schema';
import { cityGrades } from './grades';
import { Camera } from './camera';
import { drawVegetation } from './layers/vegetation';
import { placeTrees } from './vegetation';
import { drawContext } from './layers/context';
import { drawEditOverlay, type EditOverlay } from './layers/edit-overlay';
import { drawJunctionMarkings } from './layers/junction-markings';
import { drawNode, drawRoadJoins, nodeColor } from './layers/nodes';
import { drawRoute, drawSelection } from './layers/overlay';
import { drawMultiSelection } from './layers/overlay';
import { HeatLayer } from './layers/heat';
import { drawPlaces } from './layers/places';
import { drawMovementArrow, drawRoad, drawCrossings } from './layers/roads';
import { drawTransitions } from './layers/transitions';
import { drawSignal } from './layers/signals';
import { drawSigns } from './layers/signs';
import { DeckCoverage, DeckGhosts, drawGradeShadows } from './layers/shadows';
import { Tiles } from './layers/tiles';
import { createVehicleLayer, Vehicles } from './layers/vehicles';
import { createPicker, pickVehicle } from './picking';
import { style } from './style';
import { drawSignalPreview } from './layers/signal-preview';
import type { Pick, CityGeometry, Scene } from './types';
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
  const markings = new Graphics();
  const nodes = new Graphics();
  const guides = new Graphics();
  const arrows = new Graphics();
  const crossings = new Graphics();
  const places = new Graphics();
  const connectors = new Graphics();
  const signals = new Container();
  const vehicles = createVehicleLayer();
  terrain.addChild(surfaces, markings, arrows, nodes, guides, crossings);
  group.addChild(terrain, connectors, places, signals, vehicles.container);
  return {
    layer,
    group,
    terrain,
    surfaces,
    markings,
    nodes,
    guides,
    arrows,
    crossings,
    places,
    connectors,
    signals,
    vehicles,
    terrainSize: 0,
    cacheResolution: 0,
  };
}

export function createScene(canvas: HTMLCanvasElement): Scene & {
  setVehicleGeometry(city: CompiledCity, laneChangeDurationS: number): void;
  animateVehicles(elapsedS: number): void;
} {
  const app = new Application();
  const world = new Container();
  world.eventMode = 'none';
  const map = new Container();
  const routeOverlay = new Graphics();
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
  world.addChild(map, routeOverlay, selectionOverlay, vehicleRing, heatOverlay);
  world.addChild(multiSelectionOverlay);
  world.addChild(disconnectedOverlay, signalPreview);
  const editOverlay = new Graphics();
  let editPreview: EditOverlay | null = null;
  world.addChild(editOverlay);
  app.stage.addChild(world);

  const vehicles = new Vehicles();
  let surroundings: ReturnType<typeof drawContext> | undefined;
  let contextCount = 0;
  let vegetation: ReturnType<typeof drawVegetation> | undefined;
  let treeCounts: ReturnType<typeof placeTrees>['counts'] | undefined;
  let city: CompiledCity | undefined;
  let tiles: Tiles | undefined;
  let tilesEnabled = true;
  let sourceGeometry: CityGeometry | undefined;
  let shapes: Place['shape'][] = [];
  let staticPick: ReturnType<typeof createPicker> | undefined;
  let updateSignals: ((timeS: number) => void)[] = [];
  let updatePlaces: ((zoom: number) => void) | undefined;
  let layerVisibility: LayerVisibility = defaultLayers;
  let visibleGrades: ReturnType<typeof createGrade>[] = [];
  let gradeShadows: ReturnType<typeof drawGradeShadows>[] = [];
  let ghosts: DeckGhosts[] = [];
  let rebuildShadows = () => {};

  let redrawTerrain = () => {};

  function updateTerrainCache() {
    // At overview zoom both markings and arrows are invisible. Rasterize the static
    // terrain once at a power-of-two screen resolution, leaving cars/signals live.
    // A 2048 px edge cap bounds texture storage; detailed views use vector geometry.
    const overview = camera.zoom < 0.7;
    const resolution = 2 ** Math.ceil(Math.log2(camera.zoom * window.devicePixelRatio));
    if (surroundings) surroundings.ties.visible = !overview;
    for (const grade of visibleGrades) {
      grade.markings.visible = !overview;
      grade.guides.visible = !overview;
      grade.arrows.visible = !overview;
      grade.crossings.visible = !overview;
      const next = overview && grade.terrainSize * resolution <= 2048 ? resolution : 0;
      if (next === grade.cacheResolution) continue;
      grade.terrain.cacheAsTexture(false);
      if (next) grade.terrain.cacheAsTexture({ resolution: next, antialias: true });
      grade.cacheResolution = next;
    }
  }

  function applyVisibility() {
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
    routeOverlay.visible = layerVisibility.routes;
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
      });
      resizeObserver.observe(canvas);
      if (import.meta.env.MODE === 'test') {
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
      app.ticker.add(({ deltaMS }) => {
        if (tilesEnabled && tiles) {
          const { width, height } = app.screen;
          tiles.update(camera, width, height, deltaMS);
        }
      });
    });

  function updateVehicleRing(): void {
    vehicleRing.visible = selectedVehicle >= 0;
    if (selectedVehicle >= 0)
      vehicleRing.position.set(vehicles.x[selectedVehicle]!, vehicles.y[selectedVehicle]!);
  }

  const camera = new Camera(() => {
    const { x, y } = camera.worldToScreen({ x: 0, y: 0 });
    world.position.set(x, y);
    world.scale.set(camera.zoom);
    vehicleRing.scale.set(1 / camera.zoom);
    vehicles.setZoom(camera.zoom);
    updateTerrainCache();
    drawEditOverlay(editOverlay, editPreview, camera.zoom);
    updatePlaces?.(camera.zoom);
    if (city) drawSelection(selectionOverlay, city, shapes, selection, camera.zoom);
  });
  vehicles.setZoom(camera.zoom);

  return {
    ready,
    camera,
    setActive(active) {
      if (active) app.start();
      else app.stop();
    },
    setCity(compiled, source) {
      // Versions identify edits within a city. Different source cities can share a version.
      if (city?.version === compiled.version && sourceGeometry === source) return;
      const rebuildStart = import.meta.env.MODE === 'test' ? performance.now() : 0;
      city = compiled;
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
      for (const child of map.removeChildren()) child.destroy({ children: true, context: true });
      updateSignals = [];

      if (tiles) map.addChild(tiles.container);
      const started = performance.now();
      const features = source?.context?.features ?? [];
      const placementStart = performance.now();
      const placed = placeTrees(compiled, source ?? { nodes: {}, places: {} });
      treeCounts = placed.counts;
      canvas.dataset.treePlacementMs = String(performance.now() - placementStart);
      canvas.dataset.treeCounts = JSON.stringify(placed.counts);
      canvas.dataset.treeCap = String(placed.capped);
      const vegetationStart = performance.now();
      vegetation = drawVegetation(placed.trees);
      canvas.dataset.vegetationRebuildMs = String(performance.now() - vegetationStart);
      surroundings = drawContext(features);
      contextCount = features.length;
      map.addChild(surroundings.container);
      if (import.meta.env.MODE === 'test')
        canvas.dataset.contextRebuildMs = String(performance.now() - started);
      const { nodeGrades, roadGrades } = cityGrades(city, source);
      visibleGrades = orderedLayers([...nodeGrades, ...roadGrades]).map(createGrade);
      const grades = new Map(visibleGrades.map((grade) => [grade.layer, grade]));
      for (const { group } of visibleGrades) map.addChild(group);
      // The bottom grade shares its overview texture with surroundings: same draw order,
      // without another map-sized textured quad on software GPUs.
      visibleGrades[0]!.terrain.addChildAt(surroundings.container, 0);
      visibleGrades[0]!.terrain.addChildAt(vegetation.container, 1);
      const base = grades.get(0)!;
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
          );
          drawTransitions(
            grade.surfaces,
            grade.markings,
            compiled,
            road,
            layerVisibility.roadClasses,
          );
          drawRoadJoins(grade.surfaces, compiled, road, layerVisibility.roadClasses);
          drawCrossings(grade.crossings, compiled, road, sourceGeometry);
        }
        for (const node of compiled.nodes) {
          drawNode(
            grades.get(nodeGrades[node.idx]!)!.nodes,
            node,
            nodeColor(compiled, node, layerVisibility.roadClasses),
          );
        }
        for (const movement of compiled.movements) {
          if (!movement.neverGreen && compiled.nodes[movement.node]!.outline.length)
            drawMovementArrow(grades.get(nodeGrades[movement.node]!)!.arrows, movement);
        }
        updateTerrainCache();
      };
      // Guide lines do not depend on road-class tones, so they are drawn once per version.
      for (const node of city.nodes)
        drawJunctionMarkings(grades.get(nodeGrades[node.idx]!)!.guides, city, node);
      redrawTerrain();
      for (const node of city.nodes) {
        const grade = grades.get(nodeGrades[node.idx]!)!;
        drawSigns(city, node, grade.signals, () => camera.zoom);
        if (node.signal) updateSignals.push(drawSignal(city, node, grade.signals));
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
      tilesEnabled = enabled;
      if (!enabled) tiles?.clearView();
    },
    setSnapshot(snapshot) {
      if (!city) return;
      vehicles.update(snapshot);
      for (const update of updateSignals) update(snapshot.timeS);
      for (const ghost of ghosts) ghost.sync();
      if (selection?.kind === 'vehicle') {
        selectedVehicle = snapshot.id.subarray(0, snapshot.count).indexOf(selection.id);
        updateVehicleRing();
      }
    },
    setVehicleGeometry(compiled, laneChangeDurationS) {
      vehicles.setGeometry(compiled, laneChangeDurationS);
    },
    animateVehicles(elapsedS) {
      vehicles.animate(elapsedS);
      for (const ghost of ghosts) ghost.sync();
      updateVehicleRing();
    },
    setSelection(next) {
      selection = next;
      if (city) drawSelection(selectionOverlay, city, shapes, selection, camera.zoom);
      const snapshot = vehicles.snapshot;
      selectedVehicle =
        snapshot && selection?.kind === 'vehicle'
          ? snapshot.id.subarray(0, snapshot.count).indexOf(selection.id)
          : -1;
      updateVehicleRing();
    },
    setMultiSelection(roads) {
      if (city) drawMultiSelection(multiSelectionOverlay, city, roads);
    },
    setSignalPreview(loaded, timeS) {
      const nodeId = selection?.kind === 'node' ? city!.nodes[selection.node]!.id : null;
      const preview = drawSignalPreview(signalPreview, loaded, nodeId, timeS);
      canvas.setAttribute(
        'aria-description',
        preview ? `Signal ${nodeId}: phase ${preview.phase + 1}, ${preview.state}` : '',
      );
      if (import.meta.env.MODE === 'test') canvas.dataset.signalPreview = JSON.stringify(preview);
    },
    setRouteOverlay(route) {
      if (city) drawRoute(routeOverlay, city, route);
    },
    setEditOverlay(overlay) {
      editPreview = overlay;
      drawEditOverlay(editOverlay, overlay, camera.zoom);
    },
    setHeat(ratios) {
      if (city) heat.setHeat(ratios);
    },
    setDifference(roads) {
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
      if (city) heat.setQueues(snapshot);
    },
    setLayerVisibility(layers) {
      const recolor = layers.roadClasses !== layerVisibility.roadClasses;
      const reshade = layers.shadows !== layerVisibility.shadows;
      layerVisibility = layers;
      if (recolor) redrawTerrain();
      if (reshade) rebuildShadows();
      applyVisibility();
    },
    setDisconnected(lanes) {
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
      const vehicle =
        snapshot &&
        pickVehicle(point, camera.zoom, snapshot.id, vehicles.x, vehicles.y, snapshot.count);
      return vehicle ?? staticPick?.(point, camera.zoom) ?? null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const ghost of ghosts) ghost.destroy();
      vehicles.destroy();
      tiles?.destroy();
      if (resizeObserver) {
        resizeObserver.disconnect();
        app.destroy(false, { children: true, context: true });
      }
    },
  };
}
