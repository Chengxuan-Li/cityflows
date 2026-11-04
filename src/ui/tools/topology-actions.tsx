import { editTopology, nearestPointOnLine } from '../../editor/commands/topology';
import { polylineLength } from '../../geo/polyline';
import type { Command, Road } from '../../schema';
import { useAppStore } from '../store';

export function StreetTopologyActions({ road }: { road: Road }) {
  const point = useAppStore((state) => state.selectionPoint);
  const busy = useAppStore((state) => state.busy);
  const atM = point ? nearestPointOnLine(point, road.centerline).atM : 0;
  const inside = atM > 1 && atM < polylineLength(road.centerline) - 1;
  function remove() {
    const { session, commit } = useAppStore.getState();
    if (!session) return;
    const roads = Object.values(session.project.city.roads).filter(
      (r) =>
        r.id === road.id || (road.streetGroupId !== null && r.streetGroupId === road.streetGroupId),
    );
    void commit({
      kind: 'batch',
      label: 'Delete street',
      commands: roads.map((r) => ({ kind: 'deleteRoad', roadId: r.id })),
    });
  }
  return (
    <div className="controls topology-actions">
      <button
        disabled={busy || !inside}
        title="Split at the point clicked on this street"
        onClick={() =>
          void useAppStore.getState().commit({ kind: 'splitRoad', roadId: road.id, atM })
        }
      >
        Split
      </button>
      <button disabled={busy} onClick={remove}>
        Delete street
      </button>
    </div>
  );
}

export function NodeTopologyActions() {
  const session = useAppStore((state) => state.session);
  const selection = useAppStore((state) => state.selection);
  const busy = useAppStore((state) => state.busy);
  const { commit } = useAppStore.getState();
  if (!session || selection?.kind !== 'node') return null;
  const node = session.compiled.nodes[selection.node]!;
  const city = session.project.city;
  const roads = Object.values(city.roads);
  const first = roads.find((r) => r.to === node.id);
  const second = first && roads.find((r) => r.from === node.id && r.to !== first.from);
  let command: Extract<Command, { kind: 'mergeRoads' }> | null = null;
  let reason = 'Merge requires two streets with equal attributes';
  if (first && second) {
    const candidate = { kind: 'mergeRoads', roadId: first.id, otherRoadId: second.id } as const;
    try {
      editTopology(city, candidate);
      command = candidate;
    } catch (error) {
      reason = (error as Error).message;
    }
  }
  return (
    <div className="topology-actions">
      <p className="muted">Drag the map handle to move this junction.</p>
      <button
        disabled={busy || !command}
        title={command ? 'Join the streets and remove this junction' : reason}
        onClick={() => command && void commit(command)}
      >
        Merge streets
      </button>
    </div>
  );
}
