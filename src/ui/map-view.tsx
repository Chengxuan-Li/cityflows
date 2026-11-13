import { useEffect, useRef, useState } from 'react';
import type { Scene3D } from '../render3d/scene';
import type { Vec2 } from '../geo/vec2';
import type { Bounds } from '../render/camera';
import { createScene } from '../render/scene';
import { style, placeHue } from '../render/style';
import type { Pick, Scene, VehicleSnapshot } from '../render/types';
import type { Route } from '../routing';
import type { LaneId } from '../schema';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { useAppStore, type Session } from './store';
import { createDrawRoadTool, initialRoadOptions } from './tools/draw-road';
import { createRampTool } from './tools/ramp';
import { createRoundaboutTool } from './tools/roundabout';
import { RoadOptions } from './tools/road-options';
import { createSelectTool } from './tools/select';
import type { MapTool } from './tools/pointer-tool';
import { createPlacePaintTool, type PaintKind } from './tools/place-paint';
import { PlaceOptions } from './tools/place-options';
import { pausedSnapshot, remapParkedCars } from './drawn-snapshot';

function snapshotForMap(
  snapshot: VehicleSnapshot,
  { compiled, loadedCompiled, vehicleHues }: Session,
) {
  const presentation = { ...snapshot, vehicleHues, motionLane: snapshot.lane };
  if (compiled === loadedCompiled) return presentation;

  // Positions stay in world coordinates. The renderer only needs the remapped index for layering.
  const poseLane = snapshot.poseLane?.map((index) =>
    index < 0 ? -1 : (compiled.index.lane.get(loadedCompiled.lanes[index]!.id) ?? 0),
  );
  const lane = snapshot.lane.map((index, i) => {
    if ((snapshot.poseLane?.[i] ?? -1) >= 0) return index;
    if (index >= 0) return compiled.index.lane.get(loadedCompiled.lanes[index]!.id) ?? 0;
    const movement = loadedCompiled.movements[-index - 1]!;
    const current = compiled.index.movement.get(movement.id);
    return current === undefined
      ? (compiled.index.lane.get(loadedCompiled.lanes[movement.toLane]!.id) ?? 0)
      : -current - 1;
  });
  return { ...presentation, lane, poseLane };
}

function routeForMap(route: Route, { compiled, loadedCompiled }: Session) {
  const lanes = route.targetLanes.flat();
  if (compiled === loadedCompiled) return { lanes, movements: route.movements };
  return {
    lanes: lanes
      .map((index) => compiled.index.lane.get(loadedCompiled.lanes[index]!.id))
      .filter((index) => index !== undefined),
    movements: route.movements
      .map((index) => compiled.index.movement.get(loadedCompiled.movements[index]!.id))
      .filter((index) => index !== undefined),
  };
}

/** A walker's route links, from the loaded run's walk graph to the displayed one. */
function walkLinksForMap(links: readonly number[], { compiled, loadedCompiled }: Session) {
  if (compiled === loadedCompiled) return links;
  const index = new Map(compiled.walk.links.map((link) => [link.id, link.idx]));
  return links
    .map((i) => index.get(loadedCompiled.walk.links[i]!.id))
    .filter((i) => i !== undefined);
}

function fitCity(scene: Scene, canvas: HTMLCanvasElement, { project, compiled }: Session) {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const points = [
    ...compiled.roads.flatMap(({ surface }) => surface),
    ...compiled.nodes.map(({ pos }) => pos),
    ...Object.values(project.city.places).flatMap(({ shape }) =>
      shape.kind === 'polygon' ? shape.ring : [shape.pos],
    ),
  ];
  for (const { x, y } of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  if (points.length) scene.camera.fitToBounds(bounds, canvas.clientWidth, canvas.clientHeight, 72);
}

function bindPointer(
  canvas: HTMLCanvasElement,
  scene: Scene,
  signal: AbortSignal,
  canPick: () => boolean,
  activeTool: () => MapTool,
) {
  const { getState } = useAppStore;
  const { camera } = scene;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let drag: (Vec2 & { id: number; time: number; moved: boolean; pick: boolean }) | null = null;
  let gesture: { id: number; tool: MapTool } | null = null;
  let space = false;
  let vx = 0;
  let vy = 0;
  let zoom: { pointer: Vec2; target: number } | null = null;
  let lastFrame = performance.now();

  function reset() {
    vx = vy = 0;
    zoom = null;
    gesture?.tool.cancel();
    gesture = null;
    drag = null;
    canvas.classList.remove('panning');
  }

  function point(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      world: camera.screenToWorld(screen),
      pointerId: event instanceof PointerEvent ? event.pointerId : 0,
      shiftKey: event.shiftKey,
    };
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if ((event.button !== 0 && event.button !== 1) || drag || gesture) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      reset();
      const navigation = event.button === 1 || space;
      if (!navigation && canPick() && activeTool().pointerDown(point(event))) {
        gesture = { id: event.pointerId, tool: activeTool() };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        moved: false,
        pick: !navigation,
      };
      canvas.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (gesture?.id === event.pointerId) {
        gesture.tool.pointerMove(point(event));
        return;
      }
      if (!drag && canPick() && !space) activeTool().pointerMove(point(event));
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      camera.pan(dx, dy);
      const elapsed = Math.max(8, event.timeStamp - drag.time);
      vx = 0.4 * vx + (0.6 * dx) / elapsed;
      vy = 0.4 * vy + (0.6 * dy) / elapsed;
      drag = { ...drag, x: event.clientX, y: event.clientY, time: event.timeStamp, moved: true };
      canvas.classList.add('panning');
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (gesture?.id === event.pointerId) {
        const tool = gesture.tool;
        gesture = null;
        if (canPick()) tool.pointerUp(point(event));
        else tool.cancel();
        canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (drag?.id !== event.pointerId) return;
      if (reducedMotion.matches || event.timeStamp - drag.time > 80) vx = vy = 0;
      if (!drag.moved && drag.pick && canPick()) {
        const { world, screen } = point(event);
        useAppStore.setState({ selectionPoint: world });
        getState().select(scene.pick(screen.x, screen.y));
      }
      drag = null;
      canvas.classList.remove('panning');
      canvas.releasePointerCapture(event.pointerId);
    },
    { signal },
  );
  canvas.addEventListener('pointercancel', reset, { signal });
  canvas.addEventListener(
    'lostpointercapture',
    () => {
      gesture?.tool.cancel();
      gesture = null;
      drag = null;
      canvas.classList.remove('panning');
    },
    { signal },
  );
  canvas.addEventListener(
    'dblclick',
    (event) => {
      if (event.button === 0 && !space && canPick()) activeTool().doubleClick?.(point(event));
    },
    { signal },
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, button, [contenteditable="true"], dialog')
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        space = true;
        vx = vy = 0;
        return;
      }
      if (event.key === 'Escape') reset();
      if (canPick()) activeTool().keyDown?.(event);
    },
    { signal },
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.code === 'Space') space = false;
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      space = false;
      reset();
      activeTool().cancel();
    },
    { signal },
  );
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * units * 0.0015);
      vx = vy = 0;
      if (reducedMotion.matches) {
        zoom = null;
        camera.zoomAt(pointer, factor);
      } else {
        const target = (zoom?.target ?? camera.zoom) * factor;
        zoom = { pointer, target: Math.min(style.maxZoom, Math.max(style.minZoom, target)) };
      }
    },
    { passive: false, signal },
  );

  return {
    reset,
    advance(now: number) {
      const elapsed = Math.max(0, Math.min(32, now - lastFrame));
      lastFrame = now;
      if (zoom) {
        const distance = Math.log(zoom.target / camera.zoom);
        const arrived = Math.abs(distance) < 0.001;
        const fraction = arrived ? 1 : 1 - Math.exp(-elapsed / 65);
        camera.zoomAt(zoom.pointer, Math.exp(distance * fraction));
        if (arrived) zoom = null;
      } else if (!drag && Math.hypot(vx, vy) > 0.015) {
        const decay = Math.exp(-elapsed / 105);
        camera.pan(vx * 105 * (1 - decay), vy * 105 * (1 - decay));
        vx *= decay;
        vy *= decay;
      }
    },
  };
}

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3DRef = useRef<HTMLCanvasElement>(null);
  const mode = useAppStore((state) => state.viewMode);
  const tool = useAppStore((state) => state.tool);
  const [options, setOptions] = useState(initialRoadOptions);
  const [placeKind, setPlaceKind] = useState<PaintKind>('residential');
  const [placeHint, setPlaceHint] = useState('');
  const placeKindRef = useRef(placeKind);
  useEffect(() => {
    placeKindRef.current = placeKind;
  }, [placeKind]);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { getState, setState } = useAppStore;
    const controller = new AbortController();
    const { signal } = controller;
    let scene: Scene | undefined;
    let three: Scene3D | undefined;
    let animation = 0;

    async function mount() {
      // Strict Mode can dispose the first effect before the renderer is initialized.
      await Promise.resolve();
      if (signal.aborted) return;
      const view = createScene(canvas);
      scene = view;
      await view.ready;
      if (signal.aborted) return;
      // A sidebar opening or closing resizes the map; what sat at its centre stays there.
      let size = { width: canvas.clientWidth, height: canvas.clientHeight };
      const recentre = new ResizeObserver(() => {
        const next = { width: canvas.clientWidth, height: canvas.clientHeight };
        view.camera.pan((next.width - size.width) / 2, (next.height - size.height) / 2);
        size = next;
      });
      recentre.observe(canvas);
      signal.addEventListener('abort', () => recentre.disconnect());

      let drawn: Session | null = null;
      let drawn3D: Session | null = null;
      let active3D = false;
      let loading3D = false;
      const canvas3D = canvas3DRef.current!;
      async function load3D() {
        loading3D = true;
        try {
          const { Scene3D } = await import('../render3d/scene');
          // The frame loop passes the terrain layer with the first setCity (TASK-115).
          if (!signal.aborted) three = new Scene3D(canvas3D);
        } catch (error) {
          if (!signal.aborted) {
            setState({ viewMode: '2d' });
            getState().reportError(error);
          }
        } finally {
          loading3D = false;
        }
      }
      let motionGeometry: Session['loadedCompiled'] | null = null;
      let drawnSelection: Pick | null = null;
      let drawnRoads: readonly string[] | null = null;
      let drawnRoute: Route | null = null;
      let drawnWalkerRoute: readonly number[] | null = null;
      let snapshotTime = NaN;
      let drawnSnapshot: VehicleSnapshot | null = null;
      let parkingCounts: number[] | null = null;
      if (window.cityflows) {
        window.cityflows.drawnSnapshot = () => drawnSnapshot;
        window.cityflows.parkedCars = () => getState().parkedCars;
        window.cityflows.worldToScreen = (point) =>
          active3D ? three!.worldToScreen(point) : view.camera.worldToScreen(point);
        window.cityflows.vehicleToScreen = (id) => three?.vehicleToScreen(id) ?? null;
        window.cityflows.capture3D = () => three!.captureFrames();
        window.cityflows.view3D = () => three?.getView() ?? null;
        window.cityflows.setView3D = (centre, zoom, pitch, bearing) =>
          three?.setView(centre, zoom, pitch, bearing);
      }
      let snapshotAgeS = 0;
      let lastFrame = performance.now();
      let inspected: Pick | null = null;
      let inspectedTime = NaN;
      let inspectedPersonId: string | null = null;
      let pulling = false;
      let failed: Session | null = null;
      let drawnLayers = getState().layers;
      let drawnComparison = getState().comparison;
      view.setLayerVisibility(drawnLayers);
      view.setTiles(drawnLayers.basemap);

      async function pull(session: Session) {
        const snapshot = await session.engine.snapshot();
        const current = getState();
        if (signal.aborted || current.session !== session || current.busy) return;
        if (snapshot.parkedCars) {
          const stock = snapshot.parkedCars;
          for (const space of session.loadedCompiled.parkingSpaces ?? []) {
            const id = stock.id[space.idx]!;
            const owner = session.loadedCompiled.parking[space.parking]!.place;
            stock.hues[space.idx] = id
              ? (session.vehicleHues[id - 1] ?? style.driving)
              : owner >= 0
                ? placeHue(session.loadedCompiled.places[owner]!.id)
                : style.driving;
          }
          setState({ parkedCars: stock });
          const displayed = remapParkedCars(stock, session.loadedCompiled, session.compiled);
          view.setParkedCars(displayed);
          three?.setParkedCars(displayed);
        }
        if (snapshot.parkingOccupancy) {
          const counts = snapshot.parkingOccupancy;
          parkingCounts = session.compiled.parking.map(({ id }) => {
            const index = session.loadedCompiled.index.parking.get(id);
            return index === undefined ? 0 : counts[index]!;
          });
          view.setParkingOccupancy(parkingCounts);
          three?.setParkingOccupancy(parkingCounts);
          const occupancy = Object.fromEntries(
            session.compiled.parking.map((facility) => [
              facility.id,
              parkingCounts![facility.idx]!,
            ]),
          );
          const previous = getState().parkingOccupancy;
          if (
            Object.keys(previous).length !== Object.keys(occupancy).length ||
            Object.entries(occupancy).some(([id, count]) => previous[id] !== count)
          )
            setState({ parkingOccupancy: occupancy });
        }
        if (snapshot.timeS !== snapshotTime && snapshot.roadSpeedRatio) {
          const ratios = snapshot.roadSpeedRatio;
          view.setHeat(
            session.compiled === session.loadedCompiled
              ? ratios
              : session.compiled.roads.map(({ id }) => {
                  const index = session.loadedCompiled.index.road.get(id);
                  return index === undefined ? NaN : ratios[index]!;
                }),
          );
          view.setQueues(snapshotForMap(snapshot, session));
        }
        view.setSignalPreview(current.run?.stale ? null : session.loadedCompiled, snapshot.timeS);
        if (snapshot.timeS !== snapshotTime) {
          const presentation = snapshotForMap(snapshot, session);
          if (active3D) three!.setSnapshot(presentation);
          else view.setSnapshot(presentation);
          if (window.cityflows) {
            drawnSnapshot = pausedSnapshot(
              snapshot,
              session.loadedCompiled,
              session.project.scenarios[0]!.simParams.laneChangeDurationS ??
                DEFAULT_SIM_PARAMS.laneChangeDurationS,
            );
          }
          snapshotTime = snapshot.timeS;
          snapshotAgeS = 0;
          lastFrame = performance.now();
        }
        const { selection, run } = current;
        if ((selection?.kind !== 'vehicle' && selection?.kind !== 'walker') || !run) return;
        if (
          selection === inspected &&
          run.timeS === inspectedTime &&
          current.personId === inspectedPersonId
        )
          return;
        inspected = selection;
        inspectedTime = run.timeS;
        const detail =
          selection.kind === 'vehicle'
            ? { vehicle: await session.engine.inspect(selection.id) }
            : { walker: await session.engine.inspectWalker(selection.id) };
        const personId =
          current.personId ?? ('walker' in detail ? detail.walker?.personId : null) ?? null;
        const person = personId ? await session.engine.inspectPerson(personId) : null;
        inspectedPersonId = personId;
        if (
          !signal.aborted &&
          getState().session === session &&
          getState().selection === selection &&
          getState().personId === current.personId
        ) {
          setState({ ...detail, personId, person });
        }
      }

      function frame(now: number) {
        animation = requestAnimationFrame(frame);
        if (!active3D) pointer.advance(now);
        const { session, selection, vehicle, walker, busy } = getState();
        const elapsedS = Math.max(0, now - lastFrame) / 1000;
        lastFrame = now;
        if (!session || busy) return;
        const layers = getState().layers;
        if (layers !== drawnLayers) {
          view.setLayerVisibility(layers);
          view.setTiles(layers.basemap);
          drawnLayers = layers;
        }
        if (
          drawn?.compiled !== session.compiled ||
          drawn?.project.city.markingTheme !== session.project.city.markingTheme
        ) {
          view.setCity(session.compiled, session.project.city);
          view.setDisconnected(
            session.diagnostics
              .filter(({ code }) => code === 'disconnected_component')
              .flatMap(({ refs }) => refs)
              .map((id) => session.compiled.index.lane.get(id as LaneId))
              .filter((index) => index !== undefined),
          );
          if (drawn?.editor !== session.editor) {
            pointer.reset();
            fitCity(view, canvas, session);
            if (active3D)
              three!.setView(
                view.camera.screenToWorld({
                  x: canvas.clientWidth / 2,
                  y: canvas.clientHeight / 2,
                }),
                view.camera.zoom,
              );
          }
          drawn = session;
          drawnSelection = drawnRoute = drawnWalkerRoute = null;
          drawnRoads = null;
          snapshotTime = NaN;
          drawnSnapshot = null;
          parkingCounts = session.compiled.parking.map(
            ({ id }) => getState().parkingOccupancy[id] ?? 0,
          );
          view.setParkingOccupancy(parkingCounts);
          snapshotAgeS = 0;
          view.setParkedCars(
            remapParkedCars(getState().parkedCars, session.loadedCompiled, session.compiled),
          );
          drawnComparison = null;
        }
        if (motionGeometry !== session.loadedCompiled) {
          motionGeometry = session.loadedCompiled;
          snapshotTime = NaN;
          drawnSnapshot = null;
          snapshotAgeS = 0;
        }
        const want3D = getState().viewMode === '3d';
        if (want3D && !three && !loading3D) void load3D();
        if (want3D !== active3D && (!want3D || three)) {
          pointer.reset();
          const middle = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
          if (want3D) three!.setView(view.camera.screenToWorld(middle), view.camera.zoom);
          else {
            const { centre, zoom } = three!.getView();
            view.camera.zoomAt(middle, zoom / view.camera.zoom);
            const current = view.camera.screenToWorld(middle);
            view.camera.pan(
              (current.x - centre.x) * view.camera.zoom,
              (current.y - centre.y) * view.camera.zoom,
            );
          }
          active3D = want3D;
          view.setActive(!active3D);
          snapshotTime = NaN;
        }
        if (
          active3D &&
          (drawn3D?.compiled !== session.compiled ||
            drawn3D?.project.city.markingTheme !== session.project.city.markingTheme)
        ) {
          three!.setCity(session.compiled, session.project.city, layers.terrain);
          three!.setParkingOccupancy(parkingCounts);
          three!.setParkedCars(
            remapParkedCars(getState().parkedCars, session.loadedCompiled, session.compiled),
          );
          drawn3D = session;
          snapshotTime = NaN;
        }
        // Edits change the displayed city; paths stay with the loaded run until restart.
        view.setVehicleGeometry(
          session.loadedCompiled,
          session.project.scenarios[0]!.simParams.laneChangeDurationS ??
            DEFAULT_SIM_PARAMS.laneChangeDurationS,
        );
        if (active3D) {
          three!.setTerrain(layers.terrain);
          three!.setParkingStalls(layers.parkingStalls);
          three!.setParkedCarsVisible(layers.parkedCars);
          three!.setVehicleGeometry(
            session.loadedCompiled,
            session.project.scenarios[0]!.simParams.laneChangeDurationS ??
              DEFAULT_SIM_PARAMS.laneChangeDurationS,
          );
          three!.setSelection(selection);
          three!.setBelowGround(getState().belowGround);
          three!.setPlaces(layers.places);
          three!.setParkingVisible(layers.parkingOccupancy);
          three!.setColourVehiclesByClass(layers.vehicleClasses);
          three!.setSurroundings(layers.context, getState().buildings);
          three!.setRail(layers.rail);
          three!.setOverheadLines(layers.overheadLines);
          three!.setBuildingDetails(layers.buildingDetails);
          three!.setTrees(layers.trees, layers.streetTrees);
          three!.setWalkLayers(layers.sidewalks, layers.footways);
          three!.setStreet(layers.streetLights, layers.signs, layers.curbs, layers.markings);
          three!.setTiles(layers.basemap);
          three!.setPedestrians(layers.pedestrians);
          three!.setSignals(
            getState().run?.timeS ?? 0,
            getState().run?.stale ? null : session.loadedCompiled,
          );
        }
        if (selection !== drawnSelection) {
          view.setSelection(selection);
          drawnSelection = selection;
        }
        const { selectedRoads } = getState();
        if (selectedRoads !== drawnRoads) {
          view.setMultiSelection(
            selectedRoads
              .map((id) => session.compiled.index.road.get(id)!)
              .filter((index) => index !== undefined),
          );
          drawnRoads = selectedRoads;
        }
        if (getState().comparison !== drawnComparison) {
          drawnComparison = getState().comparison;
          view.setDifference(drawnComparison?.roads ?? null);
        }
        const route = vehicle?.route ?? null;
        if (route !== drawnRoute) {
          view.setRouteOverlay(route && routeForMap(route, session));
          drawnRoute = route;
        }
        const walkerRoute = walker?.route?.links ?? null;
        if (walkerRoute !== drawnWalkerRoute) {
          view.setWalkerRoute(walkerRoute && walkLinksForMap(walkerRoute, session));
          drawnWalkerRoute = walkerRoute;
        }
        const run = getState().run;
        snapshotAgeS = run?.status === 'playing' ? snapshotAgeS + elapsedS * run.speed : 0;
        if (active3D) three!.render(snapshotAgeS, run?.timeS ?? 0);
        else view.animateVehicles(snapshotAgeS, run?.status === 'playing');
        if (pulling || failed === session) return;
        pulling = true;
        void pull(session)
          .catch((error: unknown) => {
            if (signal.aborted || getState().session !== session) return;
            failed = session;
            getState().reportError(error);
          })
          .finally(() => {
            pulling = false;
          });
      }

      const tools = {
        select: createSelectTool(view),
        road: createDrawRoadTool(view, () => optionsRef.current),
        place: createPlacePaintTool(view, () => placeKindRef.current, setPlaceHint),
        ramp: createRampTool(view),
        roundabout: createRoundaboutTool(view),
      };
      const pointer = bindPointer(
        canvas,
        view,
        signal,
        () => {
          const { session, busy } = getState();
          return (
            getState().viewMode === '2d' &&
            !busy &&
            session !== null &&
            session.compiled === drawn?.compiled &&
            !document.querySelector('dialog[open]')
          );
        },
        () => tools[getState().tool],
      );
      const unsubscribe = useAppStore.subscribe((state, previous) => {
        if (
          state.viewMode !== previous.viewMode ||
          state.tool !== previous.tool ||
          state.session?.editor !== previous.session?.editor
        ) {
          pointer.reset();
          tools[previous.tool].cancel();
          view.setEditOverlay(null);
        }
        if (
          state.tool !== previous.tool ||
          state.selection !== previous.selection ||
          state.session?.compiled !== previous.session?.compiled
        )
          tools[state.tool].refresh();
      });
      signal.addEventListener('abort', unsubscribe, { once: true });
      window.addEventListener(
        'keydown',
        (event) => {
          if (
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            document.querySelector('dialog[open]') ||
            (event.target instanceof HTMLElement &&
              event.target.closest('input, textarea, select, [contenteditable="true"]'))
          )
            return;
          if (event.key.toLowerCase() === 'v') {
            event.preventDefault();
            getState().toggleView();
          }
        },
        { signal },
      );
      let down: Vec2 | null = null;
      canvas3D.addEventListener(
        'pointerdown',
        (event) => {
          if (event.button === 0) down = { x: event.clientX, y: event.clientY };
        },
        { signal },
      );
      canvas3D.addEventListener(
        'pointerup',
        (event) => {
          if (
            !down ||
            !active3D ||
            Math.hypot(event.clientX - down.x, event.clientY - down.y) > 3
          ) {
            down = null;
            return;
          }
          down = null;
          const rect = canvas3D.getBoundingClientRect();
          getState().select(three!.pick(event.clientX - rect.left, event.clientY - rect.top));
        },
        { signal },
      );
      animation = requestAnimationFrame(frame);
    }

    void mount().catch((error: unknown) => {
      if (!signal.aborted) getState().reportError(error);
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(animation);
      scene?.destroy();
      three?.destroy();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ visibility: mode === '3d' ? 'hidden' : 'visible' }}
        aria-hidden={mode === '3d'}
        data-view="2d"
        tabIndex={mode === '2d' ? 0 : -1}
        className={`map${tool !== 'select' ? ' drawing' : ''}`}
        aria-label="City map"
      />
      <canvas
        ref={canvas3DRef}
        className="map"
        aria-label="3D city view"
        aria-hidden={mode !== '3d'}
        tabIndex={mode === '3d' ? 0 : -1}
        style={{ position: 'absolute', inset: 0, visibility: mode === '3d' ? 'visible' : 'hidden' }}
      />
      {tool === 'road' && <RoadOptions value={options} onChange={setOptions} />}
      {tool === 'place' && (
        <PlaceOptions value={placeKind} onChange={setPlaceKind} hint={placeHint} />
      )}
      {tool === 'ramp' && (
        <div className="ramp-hint">
          Pick a start road, then an end road · Enter or click to build · Esc cancels
        </div>
      )}
    </>
  );
}
