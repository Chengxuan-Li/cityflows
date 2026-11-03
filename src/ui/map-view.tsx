import { useEffect, useRef } from 'react';
import type { Bounds } from '../render/camera';
import { createScene } from '../render/scene';
import type { Pick, Scene } from '../render/types';
import type { Route } from '../routing';
import { useAppStore, type Session } from './store';

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
  if (points.length) scene.camera.fitToBounds(bounds, canvas.clientWidth, canvas.clientHeight, 55);
}

function bindPointer(
  canvas: HTMLCanvasElement,
  scene: Scene,
  signal: AbortSignal,
  canPick: () => boolean,
) {
  const { getState } = useAppStore;
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
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
      scene.camera.pan(dx, dy);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: true };
      canvas.classList.add('panning');
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (drag?.id !== event.pointerId || drag.moved || !canPick()) return;
      const rect = canvas.getBoundingClientRect();
      getState().select(scene.pick(event.clientX - rect.left, event.clientY - rect.top));
    },
    { signal },
  );
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
      scene.camera.zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        Math.exp(-event.deltaY * units * 0.0015),
      );
    },
    { passive: false, signal },
  );
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

      async function pull(session: Session) {
        const snapshot = await session.engine.snapshot();
        const current = getState();
        if (signal.aborted || current.session !== session || current.busy) return;
        if (snapshot.timeS !== snapshotTime) {
          view.setSnapshot(snapshot);
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

      function frame() {
        animation = requestAnimationFrame(frame);
        const { session, selection, vehicle, busy } = getState();
        if (!session) return;
        if (drawn?.compiled !== session.compiled) {
          view.setCity(session.compiled, session.project.city);
          if (drawn?.editor !== session.editor) fitCity(view, canvas, session);
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
          view.setRouteOverlay(
            route && { lanes: route.targetLanes.flat(), movements: route.movements },
          );
          drawnRoute = route;
        }
        if (busy || pulling || failed === session) return;
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

      bindPointer(canvas, view, signal, () => {
        const { session, busy } = getState();
        return !busy && session !== null && session.compiled === drawn?.compiled;
      });
      frame();
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
