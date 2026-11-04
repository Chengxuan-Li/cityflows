import {
  drawRoadCommand,
  nearestPointOnLine,
  type DrawRoadOptions,
  type RoadVertex,
} from '../../editor/commands/topology';
import { distance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import type { City } from '../../schema';
import { useAppStore } from '../store';
import type { MapTool, ToolPointer } from './pointer-tool';

export const initialRoadOptions: DrawRoadOptions = {
  twoWay: true,
  lanes: 1,
  roadClass: 'residential',
  speedKph: 30,
};

function snap(city: City, pos: Vec2, zoom: number): RoadVertex {
  let node = null;
  let best = 12 / zoom;
  for (const candidate of Object.values(city.nodes)) {
    const away = distance(candidate.pos, pos);
    if (away < best) {
      node = candidate;
      best = away;
    }
  }
  if (node) return { kind: 'node', nodeId: node.id, pos: node.pos };
  let target: RoadVertex = { kind: 'free', pos };
  best = 10 / zoom;
  for (const road of Object.values(city.roads)) {
    const point = nearestPointOnLine(pos, road.centerline);
    if (point.distance < best) {
      target = { kind: 'road', roadId: road.id, pos: point.pos };
      best = point.distance;
    }
  }
  return target;
}

export function createDrawRoadTool(scene: Scene, options: () => DrawRoadOptions): MapTool {
  const { getState } = useAppStore;
  let vertices: RoadVertex[] = [];
  let hover: RoadVertex | null = null;
  let down: Vec2 | null = null;
  let source: City | null = null;

  function paint() {
    scene.setEditOverlay({
      lines: [[...vertices.map((v) => v.pos), ...(vertices.length && hover ? [hover.pos] : [])]],
      vertices: vertices.map((v) => v.pos),
      ...(hover && hover.kind !== 'free' ? { snap: { pos: hover.pos, kind: hover.kind } } : {}),
    });
  }
  function cancel() {
    vertices = [];
    hover = null;
    down = null;
    source = null;
    scene.setEditOverlay(null);
  }
  function move({ world }: ToolPointer) {
    const city = getState().session?.project.city;
    if (!city) return;
    hover = snap(city, world, scene.camera.zoom);
    paint();
  }
  async function finish() {
    const { session, busy, commit } = getState();
    if (!session || busy || vertices.length < 2) return;
    try {
      const city = session.project.city;
      await commit(drawRoadCommand(city, vertices, options()));
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
      if (!down || distance(pointer.screen, down) > 4) {
        down = null;
        return;
      }
      down = null;
      move(pointer);
      if (
        !hover ||
        (vertices.length && distance(vertices.at(-1)!.pos, hover.pos) * scene.camera.zoom < 2)
      )
        return;
      source ??= getState().session!.project.city;
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
      if (source && getState().session?.project.city !== source) cancel();
      else paint();
    },
    cancel,
  };
}
