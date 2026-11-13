import {
  roadSchema,
  type City,
  type Road,
  type RoadClass,
  type ParkingAccess,
  type ParkingLayout,
} from '../../schema';
import { vehicleClasses, type AccessValue } from '../../schema';
import { PopoverButton } from '../controls';
import { useAppStore } from '../store';
import { NumberField } from './number-field';
import { StreetTopologyActions } from '../tools/topology-actions';

const accessLabels: Record<AccessValue, string> = {
  yes: 'Open',
  no: 'Closed',
  destination: 'Local traffic only',
  delivery: 'Deliveries only',
  private: 'Private',
};

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

  function accessControl(key: 'all' | (typeof vehicleClasses)[number]) {
    return (
      <label className="edit-field" key={key}>
        {key === 'all' ? 'Access' : `${key} access`}
        <select
          value={road.access?.[key] ?? ''}
          onChange={(event) => {
            const access = { ...road.access };
            const value = event.currentTarget.value as AccessValue | '';
            if (value) access[key] = value;
            else delete access[key];
            void commit({
              kind: 'setRoadAccess',
              roadId: road.id,
              access: Object.keys(access).length ? access : null,
            });
          }}
        >
          <option value="">{key === 'all' ? 'Open (default)' : 'Use all vehicles rule'}</option>
          {Object.entries(accessLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
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
        <summary>Roadside parking</summary>
        <div className="edit-fields">
          {(['left', 'right'] as const).map((side) => {
            const curb = city.drivingSide;
            const direction = reverse && side !== curb ? reverse : road;
            return (
              <StripFields
                key={side}
                city={city}
                road={direction}
                side={reverse ? curb : side}
                label={side}
              />
            );
          })}
        </div>
      </details>
      <details className="disclosure">
        <summary>Lanes and street settings</summary>
        <div className="edit-fields">
          {accessControl('all')}
          <div className="edit-field">
            <span>By vehicle class</span>
            <PopoverButton label="Vehicle classes" title="Access by vehicle class">
              <div className="edit-fields">{vehicleClasses.map(accessControl)}</div>
            </PopoverButton>
          </div>
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

function StripFields({
  city,
  road,
  side,
  label,
}: {
  city: City;
  road: Road;
  side: 'left' | 'right';
  label: 'left' | 'right';
}) {
  const disabled = useAppStore((state) => state.busy || state.viewMode === '3d');
  const facilities = Object.values(city.parking ?? {}).filter(
    ({ strip }) => strip?.roadId === road.id && strip.side === side,
  );
  const capacity = facilities.reduce((sum, facility) => sum + facility.capacity, 0);
  const layouts = new Set(facilities.map((facility) => facility.strip!.layout));
  const accesses = new Set(facilities.map((facility) => facility.access));
  const layout = facilities[0]?.strip!.layout ?? null;
  const access = facilities[0]?.access ?? 'public';
  const sources = new Set(
    facilities.map((facility) =>
      facility.provenance.source === 'authored'
        ? 'Edited'
        : facility.provenance.inferred?.length && !facility.strip?.ring
          ? 'Inferred'
          : 'Mapped',
    ),
  );
  const prefix = label === 'left' ? 'Left' : 'Right';
  const { commit } = useAppStore.getState();
  return (
    <fieldset
      className="parking-fields edit-fields"
      aria-label={`${prefix} roadside parking`}
      disabled={disabled}
    >
      <label className="edit-field">
        {prefix} parking
        <select
          aria-label={`${prefix} parking layout`}
          value={layouts.size > 1 ? 'mixed' : (layout ?? 'none')}
          onChange={(event) =>
            void commit({
              kind: 'setRoadParking',
              roadId: road.id,
              side,
              layout:
                event.currentTarget.value === 'none'
                  ? null
                  : (event.currentTarget.value as ParkingLayout),
              access,
            })
          }
        >
          <option value="none">None</option>
          {layouts.size > 1 && (
            <option value="mixed" disabled>
              Mixed
            </option>
          )}
          <option value="parallel">Parallel</option>
          <option value="angled">Diagonal</option>
          <option value="perpendicular">Perpendicular</option>
        </select>
      </label>
      {facilities.length > 0 && (
        <>
          <p className="muted">
            {capacity} spaces · {[...sources].join(', ')}
          </p>
          <label className="edit-field">
            {prefix} parking access
            <select
              value={accesses.size > 1 ? 'mixed' : access}
              onChange={(event) =>
                void commit({
                  kind: 'setRoadParking',
                  roadId: road.id,
                  side,
                  layout,
                  access: event.currentTarget.value as ParkingAccess,
                })
              }
            >
              {accesses.size > 1 && (
                <option value="mixed" disabled>
                  Mixed
                </option>
              )}
              <option value="public">Public</option>
              <option value="customers">Customers</option>
              <option value="private">Private</option>
            </select>
          </label>
        </>
      )}
    </fieldset>
  );
}
