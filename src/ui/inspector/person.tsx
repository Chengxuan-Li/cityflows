import type { CompiledCity } from '../../network';
import type { City } from '../../schema';
import type { PersonDetail, PersonLegDetail } from '../../sim/types';
import { useAppStore } from '../store';

const legNames: Record<PersonLegDetail['kind'], string> = {
  access: 'Access walk',
  drive: 'Drive',
  egress: 'Egress walk',
  walk: 'Walk',
};

function clock(timeS: number | null) {
  if (timeS === null) return '—';
  const seconds = Math.floor(timeS);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function PersonInspector({
  id,
  detail,
  city,
  compiled,
}: {
  id: string;
  detail: PersonDetail | null;
  city: City;
  compiled: CompiledCity;
}) {
  const place = (id: string) => `${city.places[id]?.name ?? id} (${id})`;
  const facility = detail?.car.facility
    ? compiled.parking.find(({ id }) => id === detail.car.facility)
    : undefined;
  const trips = detail?.trips.filter((trip) => trip.state !== 'pending') ?? [];
  return (
    <>
      <h2>Person {id}</h2>
      {detail ? (
        <>
          <dl className="details" aria-label="Person details">
            <dt>Home</dt>
            <dd>{place(detail.homePlaceId)}</dd>
            <dt>Work</dt>
            <dd>{detail.workPlaceId ? place(detail.workPlaceId) : 'None'}</dd>
            <dt>State</dt>
            <dd className="capitalize">{detail.state}</dd>
            <dt>Current leg</dt>
            <dd>
              {detail.currentLeg
                ? `${legNames[detail.currentLeg.kind]} · ${detail.currentLeg.state}`
                : 'None'}
            </dd>
            {detail.household && (
              <>
                <dt>Household</dt>
                <dd>
                  {detail.household.id}
                  {detail.household.members
                    .filter((member) => member !== id)
                    .map((member) => (
                      <div key={member}>
                        <button onClick={() => useAppStore.getState().selectPerson(member)}>
                          {member}
                        </button>
                      </div>
                    ))}
                </dd>
                <dt>Car today</dt>
                <dd>
                  {detail.carId ?? 'No free household car today'}
                  {detail.carOwner && detail.carOwner !== id && (
                    <div className="muted">Borrowed from {detail.carOwner}</div>
                  )}
                </dd>
              </>
            )}
            {(detail.carId || !detail.household) && (
              <>
                <dt>Car</dt>
                <dd>
                  {detail.car.facility
                    ? `${facility?.name ?? detail.car.facility}${detail.car.space === null ? '' : ` · space ${detail.car.space}`}`
                    : 'Not parked'}
                </dd>
              </>
            )}
          </dl>
          <table aria-label="Agenda">
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Start</th>
                <th scope="col">Until</th>
              </tr>
            </thead>
            <tbody>
              {detail.agenda.map((activity, index) => (
                <tr key={index}>
                  <th scope="row" className="capitalize">
                    {activity.kind}
                    <div className="muted">
                      {city.places[activity.placeId]?.name ?? activity.placeId}
                    </div>
                  </th>
                  <td style={{ whiteSpace: 'nowrap' }}>{clock(activity.startS)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {clock(activity.startS + activity.durationS)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trips.map((trip) => (
            <p key={trip.tripId}>
              {city.places[trip.originPlaceId]?.name ?? trip.originPlaceId} →{' '}
              {city.places[trip.destinationPlaceId]?.name ?? trip.destinationPlaceId} ·{' '}
              {clock(trip.departS)} · {trip.state}
              {trip.failReason && ` · ${trip.failReason.replaceAll('_', ' ')}`}
            </p>
          ))}
          {trips.length ? (
            <table aria-label="Journey legs">
              <thead>
                <tr>
                  <th scope="col">Leg</th>
                  <th scope="col">Left</th>
                  <th scope="col">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {trips.flatMap((trip, index) =>
                  trip.legs.map((leg) => (
                    <tr key={`${trip.tripId}:${leg.kind}`}>
                      <th scope="row">
                        {index + 1}. {legNames[leg.kind]}
                        <div className="muted">
                          {leg.state}
                          {leg.kind !== 'drive' && ` · ${Math.round(leg.distanceM)} m`}
                        </div>
                      </th>
                      <td style={{ whiteSpace: 'nowrap' }}>{clock(leg.startedS)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{clock(leg.arrivedS)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          ) : (
            <p className="muted">No trips started.</p>
          )}
        </>
      ) : (
        <p className="muted">Reading person details…</p>
      )}
    </>
  );
}
