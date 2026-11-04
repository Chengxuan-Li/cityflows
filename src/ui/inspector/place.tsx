import type { Place } from '../../schema';

const directions = { in: 'Arrivals', out: 'Departures', both: 'Arrivals and departures' };

export function PlaceInspector({ place, connectorId }: { place: Place; connectorId?: string }) {
  const { profile } = place;
  return (
    <>
      <h2>Place</h2>
      <p className="entity-name">{place.name}</p>
      <dl className="details">
        <dt>Type</dt>
        <dd className="capitalize">{place.kind}</dd>
        <dt>Residents</dt>
        <dd>{place.population}</dd>
        <dt>Jobs</dt>
        <dd>{place.jobs}</dd>
        <dt>Attraction</dt>
        <dd>{place.attraction}</dd>
        <dt>Capacity</dt>
        <dd>{place.capacity ?? 'Unlimited'}</dd>
        <dt>Profile</dt>
        <dd>{profile ? 'Hourly weights' : 'Default'}</dd>
      </dl>
      {profile && (
        <table>
          <caption>Hourly profile</caption>
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
      )}
      <h3>Connectors</h3>
      {place.connectors.length ? (
        <ul className="item-list">
          {place.connectors.map((connector) => (
            <li
              key={connector.id}
              className={connectorId === connector.id ? 'selected' : undefined}
            >
              <strong>{directions[connector.direction]}</strong>
              <span>
                {connector.roadId} · lane {connector.lane + 1} · {connector.throughputPerMin}{' '}
                veh/min
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No connectors.</p>
      )}
    </>
  );
}
