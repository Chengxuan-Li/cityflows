import { distance } from '../../geo/polyline';
import type { Scene } from '../../render/types';
import type { City, Node } from '../../schema';
import { useAppStore } from '../store';
import type { MapTool, ToolPointer } from './pointer-tool';

export function createRoundaboutTool(scene: Scene): MapTool {
  const { getState } = useAppStore;
  let selected: Node | null = null;
  let source: City | null = null;
  let radius = 20;
  function cancel() {
    selected = null;
    source = null;
    scene.setEditOverlay(null);
  }
  function paint() {
    if (!selected) return;
    const center = selected.pos;
    scene.setEditOverlay({
      lines: [
        Array.from({ length: 65 }, (_, i) => ({
          x: center.x + radius * Math.cos((i * Math.PI) / 32),
          y: center.y + radius * Math.sin((i * Math.PI) / 32),
        })),
      ],
      vertices: [center],
    });
  }
  function move({ world }: ToolPointer) {
    if (!selected || selected.roundabout) return;
    radius = Math.max(20, Math.round(distance(world, selected.pos)));
    paint();
  }
  return {
    pointerDown({ world }) {
      const { session, busy } = getState();
      if (!session || busy) return false;
      source = session.project.city;
      selected =
        Object.values(source.nodes)
          .filter((node) => distance(world, node.pos) <= 12 / scene.camera.zoom)
          .sort((a, b) => distance(world, a.pos) - distance(world, b.pos))[0] ?? null;
      if (!selected) return false;
      radius = selected.roundabout?.radiusM ?? 20;
      paint();
      return true;
    },
    pointerMove: move,
    pointerUp(pointer) {
      if (!selected) return;
      move(pointer);
      const command = selected.roundabout
        ? { kind: 'removeRoundabout' as const, nodeId: selected.id }
        : { kind: 'addRoundabout' as const, nodeId: selected.id, radiusM: radius };
      cancel();
      void getState()
        .commit(command)
        .catch((error: unknown) => getState().reportError(error));
    },
    keyDown(event) {
      if (event.key === 'Escape') cancel();
    },
    refresh() {
      if (source && getState().session?.project.city !== source) cancel();
      else paint();
    },
    cancel,
  };
}
