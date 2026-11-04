import { rampCenterline } from '../../editor/commands/ramp';
import { nearestPointOnLine } from '../../editor/commands/topology';
import { distance, polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import type { City } from '../../schema';
import { useAppStore } from '../store';
import type { MapTool, ToolPointer } from './pointer-tool';

interface Endpoint {
  roadId: string;
  atM: number;
  pos: Vec2;
}

export function createRampTool(scene: Scene): MapTool {
  const { getState } = useAppStore;
  let start: Endpoint | null = null;
  let hover: Endpoint | null = null;
  let down: Vec2 | null = null;
  let source: City | null = null;

  function cancel() {
    start = hover = null;
    down = null;
    source = null;
    scene.setEditOverlay(null);
  }
  function paint() {
    const city = getState().session?.project.city;
    if (!city) return;
    let line: Vec2[] = [];
    if (start && hover && start.roadId !== hover.roadId && distance(start.pos, hover.pos) >= 10)
      line = rampCenterline(city, start, hover);
    scene.setEditOverlay({
      lines: line.length ? [line] : [],
      vertices: start ? [start.pos] : [],
      ...(hover ? { snap: { pos: hover.pos, kind: 'road' as const } } : {}),
    });
  }
  function move({ world }: ToolPointer) {
    const session = getState().session;
    if (!session) return;
    hover = null;
    let best = 10 / scene.camera.zoom;
    // Pick the visible carriageway, then project onto its canonical centerline for splitting.
    for (const lane of session.compiled.lanes) {
      const away = nearestPointOnLine(world, lane.polyline).distance;
      if (away >= best) continue;
      const road = session.project.city.roads[session.compiled.roads[lane.road]!.id]!;
      if (road.roadClass === 'ramp' || road.id === start?.roadId) continue;
      const point = nearestPointOnLine(world, road.centerline);
      if (point.atM <= 1 || point.atM >= polylineLength(road.centerline) - 1) continue;
      best = away;
      hover = { roadId: road.id, atM: point.atM, pos: point.pos };
    }
    paint();
  }
  async function finish() {
    const { session, busy, commit } = getState();
    if (!session || busy || !start || !hover) return;
    try {
      const city = session.project.city;
      await commit({ kind: 'addRamp', from: start, to: hover });
      if (getState().session?.project.city !== city) cancel();
    } catch (error) {
      getState().reportError(error);
    }
  }
  return {
    pointerDown(pointer) {
      down = pointer.screen;
      move(pointer);
      return true;
    },
    pointerMove: move,
    pointerUp(pointer) {
      if (!down || distance(down, pointer.screen) > 4) {
        down = null;
        return;
      }
      down = null;
      move(pointer);
      if (!hover) return;
      if (start) {
        void finish();
        return;
      }
      source = getState().session!.project.city;
      start = hover;
      hover = null;
      paint();
    },
    keyDown(event) {
      if (event.key === 'Escape') cancel();
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish();
      }
    },
    refresh() {
      if (source && getState().session?.project.city !== source) cancel();
      else paint();
    },
    cancel,
  };
}
