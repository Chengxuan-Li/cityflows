import { distance, segmentsIntersect } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import { useAppStore } from '../store';
import type { MapTool, ToolPointer } from './pointer-tool';
import { snapAirside } from './airside';

export function createSelectTool(scene: Scene): MapTool {
  const { getState } = useAppStore;
  let drag: { id: string; start: Vec2; pos: Vec2; kind: 'node' | 'stand' | 'hold' } | null = null;
  let box: { start: Vec2; pos: Vec2 } | null = null;
  function boxRing(start: Vec2, end: Vec2) {
    return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }, start];
  }
  function refresh() {
    if (box) {
      scene.setEditOverlay({ lines: [boxRing(box.start, box.pos)] });
      return;
    }
    const { session, selection } = getState();
    // TASK-305: a selected stand or holding position shows a handle to drag; a taxiway its line.
    const airside = session?.compiled.airside;
    if (airside && selection?.kind === 'stand') {
      const stand = airside.stands[selection.stand]!;
      const pos = drag?.pos ?? stand.pos;
      scene.setEditOverlay({
        handles: [pos],
        lines: drag ? [] : stand.leadIn.map((e) => airside.edges[e]!.line),
      });
      return;
    }
    if (airside && selection?.kind === 'hold') {
      const node = airside.nodes[airside.holds[selection.hold]!.node]!;
      const pos = drag
        ? snapAirside(session.project.city.airport!, drag.pos, scene.camera.zoom, {
            runways: false,
            nodes: false,
          }).pos
        : node.pos;
      scene.setEditOverlay({ handles: [pos] });
      return;
    }
    if (airside && selection?.kind === 'taxiway') {
      scene.setEditOverlay({ lines: [airside.edges[selection.edge]!.line] });
      return;
    }
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
    box = null;
    refresh();
  }
  return {
    pointerDown({ world, shiftKey }: ToolPointer & { shiftKey?: boolean }) {
      if (shiftKey && getState().session) {
        box = { start: world, pos: world };
        return true;
      }
      const { selection, session } = getState();
      const airside = session?.compiled.airside;
      if (airside && (selection?.kind === 'stand' || selection?.kind === 'hold')) {
        const item =
          selection.kind === 'stand'
            ? airside.stands[selection.stand]!
            : {
                ...airside.holds[selection.hold]!,
                pos: airside.nodes[airside.holds[selection.hold]!.node]!.pos,
              };
        if (distance(item.pos, world) * scene.camera.zoom > 10) return false;
        drag = { id: item.id, start: world, pos: item.pos, kind: selection.kind };
        return true;
      }
      if (!session || selection?.kind !== 'node') return false;
      const node = session.compiled.nodes[selection.node]!;
      if (distance(node.pos, world) * scene.camera.zoom > 10) return false;
      drag = { id: node.id, start: world, pos: node.pos, kind: 'node' };
      return true;
    },
    pointerMove({ world }) {
      if (box) {
        box.pos = world;
        refresh();
        return;
      }
      if (drag) {
        drag.pos = world;
        refresh();
      }
    },
    pointerUp({ world, screen }) {
      if (box) {
        const { start } = box;
        box = null;
        const { session, selection, selectedRoads, selectRoads } = getState();
        if (!session) return;
        const existing = selectedRoads.length
          ? selectedRoads
          : selection?.kind === 'lane'
            ? [session.compiled.roads[selection.road]!.id]
            : [];
        useAppStore.setState({ selectionPoint: world });
        if (distance(start, world) * scene.camera.zoom <= 3) {
          const pick = scene.pick(screen.x, screen.y);
          if (pick?.kind === 'lane') {
            const id = session.compiled.roads[pick.road]!.id;
            selectRoads(
              existing.includes(id) ? existing.filter((road) => road !== id) : [...existing, id],
            );
          }
        } else {
          const ring = boxRing(start, world);
          const minX = Math.min(start.x, world.x),
            maxX = Math.max(start.x, world.x);
          const minY = Math.min(start.y, world.y),
            maxY = Math.max(start.y, world.y);
          const roads = Object.values(session.project.city.roads).filter(
            ({ centerline }) =>
              centerline.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) ||
              centerline
                .slice(1)
                .some((p, i) =>
                  ring
                    .slice(1)
                    .some((end, j) => segmentsIntersect(centerline[i]!, p, ring[j]!, end)),
                ),
          );
          selectRoads([...existing, ...roads.map(({ id }) => id)]);
        }
        refresh();
        return;
      }
      const current = drag;
      drag = null;
      if (current && distance(current.start, world) * scene.camera.zoom > 3) {
        const airport = getState().session?.project.city.airport;
        const snap =
          current.kind === 'hold' && airport
            ? snapAirside(airport, world, scene.camera.zoom, { runways: false, nodes: false })
                .vertex
            : null;
        const command =
          current.kind === 'stand'
            ? ({ kind: 'moveStand', standId: current.id, pos: world } as const)
            : current.kind === 'hold'
              ? snap && 'edge' in snap
                ? ({
                    kind: 'moveHold',
                    holdId: current.id,
                    edgeId: snap.edge,
                    atM: snap.atM,
                  } as const)
                : null
              : ({ kind: 'moveNode', nodeId: current.id, pos: world } as const);
        if (command) void getState().commit(command).then(refresh);
      }
      refresh();
    },
    keyDown(event) {
      if (event.key === 'Escape') cancel();
    },
    refresh,
    cancel,
  };
}
