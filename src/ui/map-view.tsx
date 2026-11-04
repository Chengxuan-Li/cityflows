import { useEffect, useRef } from 'react';
import type { Vec2 } from '../geo/vec2';
import type { Bounds } from '../render/camera';
import { createScene } from '../render/scene';
import { style } from '../render/style';
import type { Pick, Scene, VehicleSnapshot } from '../render/types';
import type { Route } from '../routing';
import type { LaneId } from '../schema';
import { useAppStore, type Session } from './store';

function snapshotForMap(
  snapshot: VehicleSnapshot,
  { compiled, loadedCompiled, vehicleHues }: Session,
) {
  const presentation = { ...snapshot, vehicleHues };
  if (compiled === loadedCompiled) return presentation;

  // Positions stay in world coordinates. The renderer only needs the remapped index for layering.
  const lane = snapshot.lane.map((index) => {
    if (index >= 0) return compiled.index.lane.get(loadedCompiled.lanes[index]!.id) ?? 0;
    const movement = loadedCompiled.movements[-index - 1]!;
    const current = compiled.index.movement.get(movement.id);
    return current === undefined
      ? (compiled.index.lane.get(loadedCompiled.lanes[movement.toLane]!.id) ?? 0)
      : -current - 1;
  });
  return { ...presentation, lane };
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
) {
  const { getState } = useAppStore;
  const { camera } = scene;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let drag: (Vec2 & { id: number; time: number; moved: boolean }) | null = null;
  let vx = 0;
  let vy = 0;
  let zoom: { pointer: Vec2; target: number } | null = null;
  let lastFrame = performance.now();

  function reset() {
    vx = vy = 0;
    zoom = null;
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || drag) return;
      reset();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
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
      if (drag?.id !== event.pointerId) return;
      if (reducedMotion.matches || event.timeStamp - drag.time > 80) vx = vy = 0;
      if (drag.moved || !canPick()) return;
      const rect = canvas.getBoundingClientRect();
      getState().select(scene.pick(event.clientX - rect.left, event.clientY - rect.top));
    },
    { signal },
  );
  canvas.addEventListener('pointercancel', reset, { signal });
  canvas.addEventListener(
    'lostpointercapture',
    () => {
      drag = null;
      canvas.classList.remove('panning');
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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { getState, setState } = useAppStore;
    const controller = new AbortController();
    const { signal } = controller;
    let scene: Scene | undefined;
    let animation = 0;

    async function mount() {
      // Strict Mode can dispose the first effect before the renderer is initialized.
      await Promise.resolve();
      if (signal.aborted) return;
      const view = createScene(canvas);
      scene = view;
      await view.ready;
      if (signal.aborted) return;

      let drawn: Session | null = null;
      let drawnSelection: Pick | null = null;
      let drawnRoute: Route | null = null;
      let snapshotTime = NaN;
      let inspected: Pick | null = null;
      let inspectedTime = NaN;
      let pulling = false;
      let failed: Session | null = null;
      let drawnLayers = getState().layers;
      view.setLayerVisibility(drawnLayers);

      async function pull(session: Session) {
        const snapshot = await session.engine.snapshot();
        const current = getState();
        if (signal.aborted || current.session !== session || current.busy) return;
        if (snapshot.roadSpeedRatio) {
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
          view.setSnapshot(snapshotForMap(snapshot, session));
          snapshotTime = snapshot.timeS;
        }
        const { selection, run } = current;
        if (selection?.kind !== 'vehicle' || !run) return;
        if (selection === inspected && run.timeS === inspectedTime) return;
        inspected = selection;
        inspectedTime = run.timeS;
        const vehicle = await session.engine.inspect(selection.id);
        if (
          !signal.aborted &&
          getState().session === session &&
          getState().selection === selection
        ) {
          setState({ vehicle });
        }
      }

      function frame(now: number) {
        animation = requestAnimationFrame(frame);
        pointer.advance(now);
        const { session, selection, vehicle, busy } = getState();
        if (!session || busy) return;
        const layers = getState().layers;
        if (layers !== drawnLayers) {
          view.setLayerVisibility(layers);
          drawnLayers = layers;
        }
        if (drawn?.compiled !== session.compiled) {
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
          }
          drawn = session;
          drawnSelection = drawnRoute = null;
          snapshotTime = NaN;
        }
        if (selection !== drawnSelection) {
          view.setSelection(selection);
          drawnSelection = selection;
        }
        const route = vehicle?.route ?? null;
        if (route !== drawnRoute) {
          view.setRouteOverlay(route && routeForMap(route, session));
          drawnRoute = route;
        }
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

      const pointer = bindPointer(canvas, view, signal, () => {
        const { session, busy } = getState();
        return !busy && session !== null && session.compiled === drawn?.compiled;
      });
      animation = requestAnimationFrame(frame);
    }

    void mount().catch((error: unknown) => {
      if (!signal.aborted) getState().reportError(error);
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(animation);
      scene?.destroy();
    };
  }, []);

  return <canvas ref={canvasRef} className="map" aria-label="City map" />;
}
