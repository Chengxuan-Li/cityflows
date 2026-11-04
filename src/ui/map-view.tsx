import { useEffect, useRef, useState } from 'react';
import type { Vec2 } from '../geo/vec2';
import type { Bounds } from '../render/camera';
import { createScene } from '../render/scene';
import { style } from '../render/style';
import type { Pick, Scene, VehicleSnapshot } from '../render/types';
import type { Route } from '../routing';
import { useAppStore, type Session } from './store';
import { createDrawRoadTool, initialRoadOptions } from './tools/draw-road';
import { RoadOptions } from './tools/road-options';
import { createSelectTool } from './tools/select';
import type { MapTool } from './tools/pointer-tool';

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
  const tool = useAppStore((state) => state.tool);
  const [options, setOptions] = useState(initialRoadOptions);
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

      async function pull(session: Session) {
        const snapshot = await session.engine.snapshot();
        const current = getState();
        if (signal.aborted || current.session !== session || current.busy) return;
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
        if (drawn?.compiled !== session.compiled) {
          view.setCity(session.compiled, session.project.city);
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

      const tools = {
        select: createSelectTool(view),
        road: createDrawRoadTool(view, () => optionsRef.current),
      };
      const pointer = bindPointer(
        canvas,
        view,
        signal,
        () => {
          const { session, busy } = getState();
          return (
            !busy &&
            session !== null &&
            session.compiled === drawn?.compiled &&
            !document.querySelector('dialog[open]')
          );
        },
        () => tools[getState().tool],
      );
      const unsubscribe = useAppStore.subscribe((state, previous) => {
        if (state.tool !== previous.tool || state.session?.editor !== previous.session?.editor) {
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

  return (
    <>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className={`map${tool === 'road' ? ' drawing' : ''}`}
        aria-label="City map"
      />
      {tool === 'road' && <RoadOptions value={options} onChange={setOptions} />}
    </>
  );
}
