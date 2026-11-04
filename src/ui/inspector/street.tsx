import { roadSchema, type City, type Road, type RoadClass } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';
import { StreetTopologyActions } from '../tools/topology-actions';

export function StreetInspector({ road, city, lane }: { road: Road; city: City; lane: number }) {
  const { commit } = useAppStore.getState();
  const { streetGroupId } = road;
  const reverse =
    streetGroupId === null
      ? undefined
      : Object.values(city.roads).find(
          (other) =>
            other.streetGroupId === streetGroupId &&
            other.from === road.to &&
            other.to === road.from,
        );

  function laneCount(direction: Road, label: string) {
    return (
      <NumberField
        key={direction.id}
        label={label}
        value={direction.lanes.length}
        min={1}
        max={Math.max(64, direction.lanes.length)}
        step={1}
        onCommit={(count) =>
          void commit({
            kind: 'setRoadLanes',
            roadId: direction.id,
            lanes: Array.from(
              { length: count! },
              (_, index) => direction.lanes[index] ?? direction.lanes.at(-1)!,
            ),
          })
        }
      />
    );
  }

  return (
    <>
      <h2>{road.name || `Street ${road.id}`}</h2>
      <p className="muted">
        {road.from} → {road.to} · lane {lane + 1}
      </p>
      <StreetTopologyActions road={road} />
      <details className="disclosure">
        <summary>Lanes and street settings</summary>
        <div className="edit-fields">
          <label className="edit-field">
            Road class
            <select
              value={road.roadClass}
              onChange={(event) =>
                void commit({
                  kind: 'setRoadAttributes',
                  roadId: road.id,
                  roadClass: event.currentTarget.value as RoadClass,
                })
              }
            >
              {roadSchema.shape.roadClass.options.map((kind) => (
                <option key={kind} value={kind} className="capitalize">
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="edit-field">
            Direction
            <select
              value={reverse ? 'both' : road.id}
              onChange={({ currentTarget: { value: direction } }) => {
                if (direction === 'reverse') void commit({ kind: 'reverseRoad', roadId: road.id });
                else if (streetGroupId !== null) {
                  void commit({ kind: 'setStreetDirection', streetGroupId, direction });
                }
              }}
            >
              {streetGroupId !== null && <option value="both">Two-way</option>}
              <option value={road.id}>
                {road.from} → {road.to}
              </option>
              <option value={reverse?.id ?? 'reverse'}>
                {road.to} → {road.from}
              </option>
            </select>
          </label>
          {laneCount(road, 'Lanes in this direction')}
          {reverse && laneCount(reverse, 'Lanes in reverse')}
          <NumberField
            label="Speed limit (km/h)"
            value={Number((road.speedLimitMps * 3.6).toFixed(3))}
            onCommit={(speed) =>
              void commit({
                kind: 'setRoadAttributes',
                roadId: road.id,
                speedLimitMps: speed! / 3.6,
              })
            }
          />
        </div>
      </details>
    </>
  );
}
