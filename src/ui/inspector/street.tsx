import type { City, Road } from '../../schema';

export function StreetInspector({ road, city, lane }: { road: Road; city: City; lane: number }) {
  const reverse =
    road.streetGroupId !== null &&
    Object.values(city.roads).find(
      (other) =>
        other.streetGroupId === road.streetGroupId &&
        other.from === road.to &&
        other.to === road.from,
    );
  return (
    <>
      <h2>Street</h2>
      <p className="entity-name">{road.name || road.id}</p>
      <dl className="details">
        <dt>Class</dt>
        <dd className="capitalize">{road.roadClass}</dd>
        <dt>Direction</dt>
        <dd>{reverse ? 'Two-way' : 'One-way'}</dd>
        <dt>Selected direction</dt>
        <dd>
          {road.from} → {road.to}
        </dd>
        <dt>Lanes in this direction</dt>
        <dd>{road.lanes.length}</dd>
        {reverse && (
          <>
            <dt>Lanes in reverse</dt>
            <dd>{reverse.lanes.length}</dd>
          </>
        )}
        <dt>Selected lane</dt>
        <dd>{lane + 1}</dd>
        <dt>Speed limit</dt>
        <dd>{Math.round(road.speedLimitMps * 3.6)} km/h</dd>
      </dl>
    </>
  );
}
