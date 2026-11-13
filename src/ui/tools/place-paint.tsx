import { nearestPointOnLine } from '../../editor/commands/topology';
import type { Vec2 } from '../../geo/vec2';
import type { Scene } from '../../render/types';
import { placeColors } from '../../render/style';
import type { City, Place } from '../../schema';
import { useAppStore } from '../store';
import {
  brushRadiusM,
  insideRing,
  nearestPlaceLane,
  PlaceBrush,
  ringArea,
  ringCenter,
} from './place-brush';
import type { MapTool } from './pointer-tool';

export type PaintKind = 'residential' | 'work' | 'retail' | 'school';

export function createPlacePaintTool(
  scene: Scene,
  kind: () => PaintKind,
  hint: (text: string) => void,
): MapTool {
  const { getState } = useAppStore;
  let brush: PlaceBrush | null = null;
  let source: City | null = null;
  let extending: Place | null = null;
  let paintKind: PaintKind = 'residential';
  let ring: Vec2[] = [];

  function cancel() {
    brush = source = extending = null;
    ring = [];
    scene.setEditOverlay(null);
  }
  function paint(world: Vec2) {
    if (!brush || !source) return;
    const samples = brush.paint(world);
    if (!extending) {
      extending =
        Object.values(source.places).find((p) => {
          if (p.kind !== paintKind || p.shape.kind !== 'polygon') return false;
          const boundary = [...p.shape.ring, p.shape.ring[0]!];
          const existingRing = p.shape.ring;
          return samples.some(
            (point) =>
              insideRing(point, existingRing) ||
              nearestPointOnLine(point, boundary).distance < brushRadiusM - 2,
          );
        }) ?? null;
      if (extending?.shape.kind === 'polygon') brush.include(extending.shape.ring);
    }
    ring = brush.ring();
    scene.setEditOverlay({
      // The place type's tint, as the painted place will look (TASK-162 palette).
      polygon: { ring, color: placeColors(paintKind).edge },
    });
  }
  return {
    pointerDown({ world }) {
      const { session, busy } = getState();
      if (!session || busy) return false;
      source = session.project.city;
      paintKind = kind();
      brush = new PlaceBrush();
      hint('');
      paint(world);
      return true;
    },
    pointerMove({ world }) {
      paint(world);
    },
    pointerUp({ world }) {
      if (!source || !brush) return;
      paint(world);
      const { session, commit } = getState();
      if (!session || session.project.city !== source) {
        cancel();
        return;
      }
      const center = ringCenter(ring);
      const lane = nearestPlaceLane(session.compiled, center);
      if (!lane && !extending) {
        hint('No lane within 60 m. Paint closer to a street.');
        cancel();
        return;
      }
      const shape = { kind: 'polygon', ring } as const;
      const field = paintKind === 'residential' ? 'population' : 'jobs';
      const density = paintKind === 'residential' ? 0.04 : 0.06;
      const placeId = extending?.id ?? `p:${source.nextId}`;
      const originalArea = extending?.shape.kind === 'polygon' ? ringArea(extending.shape.ring) : 0;
      const amount = extending
        ? extending[field] + Math.max(0, Math.round((ringArea(ring) - originalArea) * density))
        : Math.max(1, Math.round(ringArea(ring) * density));
      const command = extending
        ? { kind: 'updatePlace' as const, placeId, patch: { shape, [field]: amount } }
        : {
            kind: 'batch' as const,
            label: 'Paint place',
            commands: [
              {
                kind: 'addPlace' as const,
                place: {
                  kind: paintKind,
                  name: `${paintKind[0]!.toUpperCase()}${paintKind.slice(1)} ${Object.keys(source.places).length + 1}`,
                  shape,
                  population: 0,
                  jobs: 0,
                  [field]: amount,
                  attraction: 1,
                  capacity: null,
                  connectors: [],
                  profile: null,
                  events: [],
                  provenance: { source: 'authored' as const },
                },
              },
              {
                kind: 'setConnectors' as const,
                placeId,
                connectors: [
                  {
                    id: `c:${source.nextId + 1}`,
                    ...lane!,
                    direction: 'both' as const,
                    throughputPerMin: 60,
                  },
                ],
              },
            ],
          };
      cancel();
      void commit(command).then(() => {
        const index = getState().session?.compiled.index.place.get(placeId);
        if (index !== undefined) getState().select({ kind: 'place', place: index });
      });
    },
    refresh() {
      if (source && getState().session?.project.city !== source) cancel();
    },
    cancel,
  };
}
