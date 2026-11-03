import { Application, Container, Graphics } from 'pixi.js';
import type { CompiledCity } from '../network';
import type { Place } from '../schema';
import { Camera } from './camera';
import { drawMovementSurface, drawNode, drawRoadJoins } from './layers/nodes';
import { drawHeat, drawRoute, drawSelection } from './layers/overlay';
import { drawPlaces } from './layers/places';
import { drawMovementArrow, drawRoad } from './layers/roads';
import { drawSignal } from './layers/signals';
import { createVehicleLayer, Vehicles } from './layers/vehicles';
import { createPicker, pickVehicle } from './picking';
import { style } from './style';
import type { Pick, CityGeometry, Scene } from './types';

function createGrade() {
  const group = new Container();
  const surfaces = new Graphics();
  const markings = new Graphics();
  const nodes = new Graphics();
  const arrows = new Graphics();
  const places = new Graphics();
  const signals = new Container();
  const vehicles = createVehicleLayer();
  group.addChild(surfaces, markings, nodes, arrows, places, signals, vehicles.container);
  return { group, surfaces, markings, nodes, arrows, places, signals, vehicles };
}

export function createScene(canvas: HTMLCanvasElement): Scene {
  const app = new Application();
  const world = new Container();
  world.eventMode = 'none';
  const map = new Container();
  const routeOverlay = new Graphics();
  const selectionOverlay = new Graphics();
  const vehicleRing = new Graphics()
    .circle(0, 0, 6)
    .stroke({ width: 1.25, color: style.selection });
  vehicleRing.visible = false;
  const heatOverlay = new Graphics();
  world.addChild(map, routeOverlay, selectionOverlay, vehicleRing, heatOverlay);
  app.stage.addChild(world);

  const vehicles = new Vehicles();
  let city: CompiledCity | undefined;
  let sourceGeometry: CityGeometry | undefined;
  let shapes: Place['shape'][] = [];
  let staticPick: ReturnType<typeof createPicker> | undefined;
  let updateSignals: ((timeS: number) => void)[] = [];
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
  });
  vehicles.setZoom(camera.zoom);

  return {
    ready,
    camera,
    setCity(compiled, source) {
      // Versions identify edits within a city. Different source cities can share a version.
      if (city?.version === compiled.version && sourceGeometry === source) return;
      city = compiled;
      sourceGeometry = source;
      selection = null;
      selectedVehicle = -1;
      updateVehicleRing();
      selectionOverlay.clear();
      routeOverlay.clear();
      heatOverlay.clear();
      for (const child of map.removeChildren()) child.destroy({ children: true, context: true });
      updateSignals = [];

      const nodeGrades = city.nodes.map(({ id }) => source?.nodes[id]?.layer ?? 0);
      const roadGrades = city.roads.map(({ from, to }) =>
        Math.min(nodeGrades[from]!, nodeGrades[to]!),
      );
      const grades = new Map(
        [...new Set([0, ...nodeGrades, ...roadGrades])]
          .sort((a, b) => a - b)
          .map((grade) => [grade, createGrade()]),
      );
      for (const { group } of grades.values()) map.addChild(group);
      shapes = city.places.map(
        ({ id, centroid }) => source?.places[id]?.shape ?? { kind: 'point', pos: centroid },
      );
      staticPick = createPicker(city, shapes, roadGrades);

      for (const road of city.roads) {
        const { surfaces, markings, nodes } = grades.get(roadGrades[road.idx]!)!;
        drawRoad(surfaces, markings, city, road);
        drawRoadJoins(nodes, city, road);
      }
      for (const node of city.nodes) {
        const grade = grades.get(nodeGrades[node.idx]!)!;
        drawNode(grade.nodes, node);
        if (node.signal) updateSignals.push(drawSignal(city, node, grade.signals));
      }
      for (const movement of city.movements) {
        const { nodes, arrows } = grades.get(nodeGrades[movement.node]!)!;
        drawMovementSurface(nodes, city, movement);
        drawMovementArrow(arrows, movement);
      }
      drawPlaces(grades.get(0)!.places, city, shapes);
      for (const update of updateSignals) update(0);
      vehicles.setLayers(
        [...grades.values()].map((grade) => grade.vehicles),
        city.lanes.map(({ road }) => grades.get(roadGrades[road]!)!.vehicles),
        city.movements.map(({ node }) => grades.get(nodeGrades[node]!)!.vehicles),
      );
    },
    setSnapshot(snapshot) {
      if (!city) return;
      vehicles.update(snapshot);
      for (const update of updateSignals) update(snapshot.timeS);
      if (selection?.kind === 'vehicle') {
        selectedVehicle = snapshot.id.subarray(0, snapshot.count).indexOf(selection.id);
        updateVehicleRing();
      }
    },
    setSelection(next) {
      selection = next;
      if (city) drawSelection(selectionOverlay, city, shapes, selection);
      const snapshot = vehicles.snapshot;
      selectedVehicle =
        snapshot && selection?.kind === 'vehicle'
          ? snapshot.id.subarray(0, snapshot.count).indexOf(selection.id)
          : -1;
      updateVehicleRing();
    },
    setRouteOverlay(route) {
      if (city) drawRoute(routeOverlay, city, route);
    },
    setHeat(ratios) {
      if (city) drawHeat(heatOverlay, city, ratios);
    },
    pick(screenX, screenY) {
      const point = camera.screenToWorld({ x: screenX, y: screenY });
      const snapshot = vehicles.snapshot;
      const vehicle =
        snapshot &&
        pickVehicle(point, camera.zoom, snapshot.id, vehicles.x, vehicles.y, snapshot.count);
      return vehicle ?? staticPick?.(point) ?? null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      vehicles.destroy();
      if (resizeObserver) {
        resizeObserver.disconnect();
        app.destroy(false, { children: true, context: true });
      }
    },
  };
}
