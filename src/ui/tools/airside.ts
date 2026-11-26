import { distance, nearestOnPolyline } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import type { AirsideVertex } from '../../schema';
import type { Airport, StandKind } from '../../schema/airport';
import { useAppStore } from '../store';
import type { MapTool, ToolPointer } from './pointer-tool';

// TASK-305: the Airside tool adds stands and holding positions with a click, and draws taxiways
// and taxilanes as the road tool draws streets: click the points, Enter or a double click ends.

export interface AirsideOptions {
  mode: 'stand' | 'taxiway' | 'taxilane' | 'hold';
  standKind: StandKind;
}

export const standKindLabels: Record<StandKind, string> = {
  contact: 'Contact',
  remote: 'Remote',
  cargo: 'Cargo',
  general_aviation: 'General aviation',
  maintenance: 'Maintenance',
};

type Snap = { vertex: AirsideVertex; pos: Vec2; kind: 'node' | 'road' | 'free' };

/** The airside node within 12 px, else the point of a taxiway, taxilane (or, with `runways`, a
 * runway) under the pointer: within its half width or 10 px. */
export function snapAirside(
  airport: Airport,
  pos: Vec2,
  zoom: number,
  { runways = true, nodes = true } = {},
): Snap {
  let best = 12 / zoom;
  let snap: Snap = { vertex: { pos }, pos, kind: 'free' };
  if (nodes)
    for (const node of Object.values(airport.nodes)) {
      const away = distance(node.pos, pos);
      if (away < best) {
        best = away;
        snap = { vertex: { node: node.id }, pos: node.pos, kind: 'node' };
      }
    }
  if (snap.kind === 'node') return snap;
  let nearest = Infinity;
  for (const edge of Object.values(airport.edges)) {
    if (edge.kind === 'lead_in' || (!runways && edge.kind === 'runway')) continue;
    const near = nearestOnPolyline(edge.line, pos);
    if (near.away > Math.max(10 / zoom, edge.widthM / 2) || near.away >= nearest) continue;
    nearest = near.away;
    snap = { vertex: { edge: edge.id, atM: near.along }, pos: near.point, kind: 'road' };
  }
  return snap;
}

/** The next free numeric stand ref: one above the largest. */
export function nextStandRef(airport: Airport) {
  const numbers = Object.values(airport.stands)
    .map((s) => Number(s.ref))
    .filter(Number.isInteger);
  return String(Math.max(0, ...numbers) + 1);
}

export function createAirsideTool(scene: Scene, options: () => AirsideOptions): MapTool {
  const { getState } = useAppStore;
  let vertices: Snap[] = [];
  let hover: Snap | null = null;
  let down: Vec2 | null = null;

  const airport = () => getState().session?.project.city.airport;
  function paint() {
    const { mode } = options();
    const drawing = mode === 'taxiway' || mode === 'taxilane';
    scene.setEditOverlay({
      lines: drawing
        ? [[...vertices.map((v) => v.pos), ...(vertices.length && hover ? [hover.pos] : [])]]
        : [],
      vertices: vertices.map((v) => v.pos),
      ...(hover && hover.kind !== 'free'
        ? { snap: { pos: hover.pos, kind: hover.kind } }
        : hover && mode === 'stand'
          ? { handles: [hover.pos] }
          : {}),
    });
  }
  function cancel() {
    vertices = [];
    hover = null;
    down = null;
    scene.setEditOverlay(null);
  }
  function move({ world }: ToolPointer) {
    const current = airport();
    if (!current) return;
    const { mode } = options();
    hover =
      mode === 'stand'
        ? { vertex: { pos: world }, pos: world, kind: 'free' }
        : snapAirside(current, world, scene.camera.zoom, {
            runways: mode !== 'hold',
            nodes: mode !== 'hold',
          });
    paint();
  }
  async function commit(command: Parameters<ReturnType<typeof getState>['commit']>[0]) {
    try {
      await getState().commit(command);
    } catch (error) {
      getState().reportError(error);
    }
  }
  async function finish() {
    const { mode } = options();
    if ((mode !== 'taxiway' && mode !== 'taxilane') || vertices.length < 2) return;
    const drawn = vertices.map((v) => v.vertex);
    cancel();
    await commit({ kind: 'addTaxiway', edgeKind: mode, vertices: drawn });
  }
  return {
    pointerDown(pointer) {
      if (!airport()) return false;
      down = pointer.screen;
      move(pointer);
      return true;
    },
    pointerMove: move,
    pointerUp(pointer) {
      if (!down || distance(pointer.screen, down) > 4) {
        down = null;
        return;
      }
      down = null;
      move(pointer);
      const current = airport();
      if (!hover || !current) return;
      const { mode, standKind } = options();
      if (mode === 'stand') {
        void commit({
          kind: 'addStand',
          pos: hover.pos,
          standKind,
          ref: nextStandRef(current),
        });
        return;
      }
      if (mode === 'hold') {
        if ('edge' in hover.vertex)
          void commit({ kind: 'addHold', edgeId: hover.vertex.edge, atM: hover.vertex.atM });
        return;
      }
      if (vertices.length && distance(vertices.at(-1)!.pos, hover.pos) * scene.camera.zoom < 2)
        return;
      vertices.push(hover);
      paint();
    },
    doubleClick() {
      void finish();
    },
    keyDown(event) {
      if (event.key === 'Escape') cancel();
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish();
      }
    },
    refresh() {
      paint();
    },
    cancel,
  };
}
