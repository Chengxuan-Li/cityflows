import type { Place } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';

const directions = { in: 'Arrivals', out: 'Departures', both: 'Arrivals and departures' };

export function PlaceInspector({ place, connectorId }: { place: Place; connectorId?: string }) {
  const { profile } = place;
  const { commit } = useAppStore.getState();
  return (
    <>
      <h2>{place.name}</h2>
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
        <div className="edit-fields">
          {(['population', 'jobs', 'capacity'] as const).map((field) => (
            <NumberField
              key={field}
              label={{ population: 'Population', jobs: 'Jobs', capacity: 'Capacity' }[field]}
              value={place[field]}
              step={1}
              nullable={field === 'capacity'}
              onCommit={(value) =>
                void commit({ kind: 'updatePlace', placeId: place.id, patch: { [field]: value } })
              }
            />
          ))}
        </div>
      </details>
      <details className="disclosure">
        <summary>Connectors</summary>
        {place.connectors.length ? (
          <ul className="item-list">
            {place.connectors.map((connector) => (
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
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No connectors.</p>
        )}
      </details>
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
