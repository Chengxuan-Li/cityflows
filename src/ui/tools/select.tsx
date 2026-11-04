import { distance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import { useAppStore } from '../store';
import type { MapTool } from './pointer-tool';

export function createSelectTool(scene: Scene): MapTool {
  const { getState } = useAppStore;
  let drag: { id: string; start: Vec2; pos: Vec2 } | null = null;
  function refresh() {
    const { session, selection } = getState();
    const node =
      session && selection?.kind === 'node' ? session.compiled.nodes[selection.node] : undefined;
    if (!node) {
      scene.setEditOverlay(null);
      return;
    }
    const pos = drag?.pos ?? node.pos;
    const lines = drag
      ? Object.values(session!.project.city.roads)
          .filter((r) => r.from === node.id || r.to === node.id)
          .map((r) =>
            r.centerline.map((p, i) =>
              (i === 0 && r.from === node.id) || (i === r.centerline.length - 1 && r.to === node.id)
                ? pos
                : p,
            ),
          )
      : [];
    scene.setEditOverlay({ handles: [pos], lines });
  }
  function cancel() {
    drag = null;
    refresh();
  }
  return {
    pointerDown({ world }) {
      const { selection, session } = getState();
      if (!session || selection?.kind !== 'node') return false;
      const node = session.compiled.nodes[selection.node]!;
      if (distance(node.pos, world) * scene.camera.zoom > 10) return false;
      drag = { id: node.id, start: world, pos: node.pos };
      return true;
    },
    pointerMove({ world }) {
      if (drag) {
        drag.pos = world;
        refresh();
      }
    },
    pointerUp({ world }) {
      const current = drag;
      drag = null;
      if (current && distance(current.start, world) * scene.camera.zoom > 3)
        void getState().commit({ kind: 'moveNode', nodeId: current.id, pos: world }).then(refresh);
      refresh();
    },
    keyDown(event) {
      if (event.key === 'Escape') cancel();
    },
    refresh,
    cancel,
  };
}
