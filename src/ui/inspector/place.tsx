import { useState } from 'react';
import type { Place } from '../../schema';
import { useAppStore } from '../store';
import { nearestPlaceLane } from '../tools/place-brush';
import { NumberField } from './number-field';

const directions = { in: 'Arrivals', out: 'Departures', both: 'Arrivals and departures' };

function DemographicSlider({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [edit, setEdit] = useState({ source: value, value });
  const draft = edit.source === value ? edit.value : value;
  const save = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="edit-field">
      <span>
        {label} <output>{draft}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={0}
        max={Math.max(2000, value * 2)}
        step={1}
        disabled={disabled}
        value={draft}
        onChange={(event) => setEdit({ source: value, value: event.currentTarget.valueAsNumber })}
        onPointerUp={save}
        onKeyUp={save}
        onBlur={save}
      />
    </label>
  );
}

export function PlaceInspector({ place, connectorId }: { place: Place; connectorId?: string }) {
  const { profile } = place;
  const { commit } = useAppStore.getState();
  const session = useAppStore((state) => state.session)!;
  const busy = useAppStore((state) => state.busy);
  const summary = session.demandSummary.byPlace[place.id];
  const center = session.compiled.places[session.compiled.index.place.get(place.id)!]!.centroid;
  const available = nearestPlaceLane(session.compiled, center, place.connectors);
  function setConnectors(connectors: Place['connectors']) {
    void commit({ kind: 'setConnectors', placeId: place.id, connectors });
  }
  return (
    <>
      <h2>{place.name}</h2>
      <p className="muted" aria-label="Place demand">
        {place.kind === 'residential' ? `${place.population} residents` : `${place.jobs} jobs`}
        {' · '}
        {summary?.departures ?? 0} trips produced · {summary?.arrivals ?? 0} attracted
      </p>
      {!summary && <p className="muted">Regenerate demand to schedule this place.</p>}
      <div className="edit-fields">
        {(place.kind === 'residential'
          ? (['population'] as const)
          : place.kind === 'gateway'
            ? (['population', 'jobs'] as const)
            : (['jobs'] as const)
        ).map((field) => (
          <DemographicSlider
            key={`${place.id}:${field}`}
            label={field === 'population' ? 'Population' : 'Jobs'}
            value={place[field]}
            disabled={busy}
            onCommit={(value) =>
              void commit({ kind: 'updatePlace', placeId: place.id, patch: { [field]: value } })
            }
          />
        ))}
        <NumberField
          label="Capacity"
          value={place.capacity}
          nullable
          step={1}
          onCommit={(capacity) =>
            void commit({ kind: 'updatePlace', placeId: place.id, patch: { capacity } })
          }
        />
      </div>
      <details className="disclosure">
        <summary>Place settings</summary>
        <dl className="details">
          <dt>Type</dt>
          <dd className="capitalize">{place.kind}</dd>
          <dt>Attraction</dt>
          <dd>{place.attraction}</dd>
          <dt>Profile</dt>
          <dd>{profile ? 'Hourly weights' : 'Default'}</dd>
        </dl>
      </details>
      <details className="disclosure">
        <summary>Connectors</summary>
        <button
          disabled={busy || !available}
          onClick={() => {
            if (available)
              setConnectors([
                ...place.connectors,
                {
                  id: `c:${session.project.city.nextId}`,
                  ...available,
                  direction: 'both',
                  throughputPerMin: 60,
                },
              ]);
          }}
        >
          Add connector
        </button>
        {!available && <p className="muted">No unused lane within 60 m.</p>}
        {place.connectors.length ? (
          <ul className="item-list">
            {place.connectors.map((connector) => {
              const lane = nearestPlaceLane(
                session.compiled,
                center,
                place.connectors.filter((c) => c.id !== connector.id),
              );
              const unchanged =
                lane?.roadId === connector.roadId &&
                lane.lane === connector.lane &&
                Math.abs(lane.positionM - connector.positionM) < 0.01;
              return (
                <li
                  key={connector.id}
                  className={connectorId === connector.id ? 'selected' : undefined}
                >
                  <strong>{directions[connector.direction]}</strong>
                  <span>
                    {connector.roadId} · lane {connector.lane + 1}
                  </span>
                  <NumberField
                    label="Throughput (veh/min)"
                    value={connector.throughputPerMin}
                    onCommit={(throughputPerMin) =>
                      void commit({
                        kind: 'setConnectors',
                        placeId: place.id,
                        connectors: place.connectors.map((entry) =>
                          entry === connector
                            ? { ...entry, throughputPerMin: throughputPerMin! }
                            : entry,
                        ),
                      })
                    }
                  />
                  <div className="controls">
                    <button
                      disabled={busy || !lane || unchanged}
                      onClick={() => {
                        if (lane)
                          setConnectors(
                            place.connectors.map((c) =>
                              c.id === connector.id ? { ...c, ...lane } : c,
                            ),
                          );
                      }}
                    >
                      Move to nearest lane
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setConnectors(place.connectors.filter((c) => c.id !== connector.id))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No connectors.</p>
        )}
      </details>
      <button
        disabled={busy}
        onClick={() => void commit({ kind: 'deletePlace', placeId: place.id })}
      >
        Delete place
      </button>
      {profile && (
        <details className="disclosure">
          <summary>Hourly profile</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Hour</th>
                <th scope="col">Arrivals</th>
                <th scope="col">Departures</th>
              </tr>
            </thead>
            <tbody>
              {profile.arrivals.map((weight, hour) => (
                <tr key={hour}>
                  <th scope="row">{String(hour).padStart(2, '0')}:00</th>
                  <td>{weight}</td>
                  <td>{profile.departures[hour]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
