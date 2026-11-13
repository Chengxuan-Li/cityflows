import type { Place } from '../../schema';
import { useAppStore } from '../store';
import { useEffect, useState } from 'react';
import { trainsAt, type TrainPose } from '../../network/trains';
import { railTimetable, tramTimetable } from '../../network/trams';

export function TrainInspector({ id, route }: { id: string; route: number }) {
  const session = useAppStore((s) => s.session);
  const timeS = useAppStore((s) => s.run?.timeS ?? 0);
  const [controlled, setControlled] = useState<
    | {
        timeS: number;
        poses: TrainPose[];
        loads: { id: string; capacity: number; riders: string[] }[];
      }
    | null
    | undefined
  >(undefined);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void session.engine.snapshot().then((snapshot) => {
      const rail = snapshot.rail;
      if (active)
        setControlled(
          rail
            ? {
                timeS: snapshot.timeS,
                poses: rail.trains,
                loads: snapshot.transit?.vehicles ?? [],
              }
            : null,
        );
    });
    return () => {
      active = false;
    };
  }, [session, timeS]);
  if (!session?.compiled.rail) return null;
  const rail = session.compiled.rail,
    table = railTimetable(rail),
    service = table.routes[route];
  if (!service) return null;
  const train = (
    controlled?.poses ?? (controlled === null ? trainsAt(rail, table, timeS) : [])
  ).find((t) => t.id === id);
  // TASK-174: who rides in it; the places scale with the scenario's sampled population.
  const load = controlled?.loads.find((v) => v.id === id);
  return (
    <section aria-label="Train inspector">
      <h2>
        {service.kind === 'tram' ? 'Tram' : service.kind === 'sbahn' ? 'S-Bahn' : 'Main-line train'}
      </h2>
      {service.kind === 'tram' && <p>Synthetic service</p>}
      <dl className="details">
        {service.destination && (
          <>
            <dt>Direction</dt>
            <dd>{service.destination}</dd>
          </>
        )}
        <dt>Route</dt>
        <dd>
          {rail.nodes[service.from]!.id} →{' '}
          {service.terminal !== undefined && <>{rail.nodes[service.terminal]!.id} → </>}
          {rail.nodes[service.to]!.id}
        </dd>
        <dt>{service.kind === 'tram' ? 'Stops' : 'Station stops'}</dt>
        <dd>{[...new Set(service.stops.map((s) => s.name))].join(', ') || 'Passes through'}</dd>
        <dt>Next</dt>
        <dd>{train?.next ?? 'Exited'}</dd>
        <dt>Status</dt>
        <dd>{!train ? 'Outside city' : train.speedMps < 0.01 ? 'Stopped' : 'Running'}</dd>
        {load && (
          <>
            <dt>Riders</dt>
            <dd>
              {load.riders.length} of {load.capacity}
            </dd>
          </>
        )}
      </dl>
      {load?.riders.map((person) => (
        <button
          key={person}
          className="nav-row"
          onClick={() => useAppStore.getState().selectPerson(person)}
        >
          {person}
        </button>
      ))}
    </section>
  );
}

const names = {
  rail: 'Rail',
  light_rail: 'Light rail',
  subway: 'Subway',
  tram: 'Tram',
  narrow_gauge: 'Narrow gauge',
};
const forms = {
  embedded: 'Embedded in the road',
  grass: 'Grass bed',
  paved: 'Paved bed',
  ballast: 'Ballast bed',
};
export function RailInspector({ kind, index }: { kind: 'track' | 'platform'; index: number }) {
  const session = useAppStore((s) => s.session);
  if (!session?.compiled.rail) return null;
  const rail = session.compiled.rail;
  if (kind === 'track') {
    const t = rail.tracks[index]!;
    return (
      <section aria-label="Track inspector">
        <h2>{t.name ?? names[t.kind]}</h2>
        <dl className="details">
          <dt>Kind</dt>
          <dd>{names[t.kind]}</dd>
          {t.kind === 'tram' && (
            <>
              <dt>Track</dt>
              <dd>
                {forms[t.form ?? 'embedded']}
                {t.provenance?.inferred?.includes('form') ? ' (inferred)' : ''}
              </dd>
            </>
          )}
          <dt>Service</dt>
          <dd>
            {t.kind === 'tram'
              ? tramTimetable(rail).unused.includes(t.id)
                ? 'No scheduled service'
                : 'Synthetic tram service'
              : (t.service ?? (t.kind === 'rail' ? 'Main line' : 'Running line'))}
          </dd>
          <dt>Length</dt>
          <dd>{Math.round(t.lengthM)} m</dd>
          <dt>Layer</dt>
          <dd>
            {t.layer}
            {t.bridge ? ' · Bridge' : t.tunnel ? ' · Tunnel' : ''}
          </dd>
          {t.maxSpeedMps !== undefined && (
            <>
              <dt>Speed</dt>
              <dd>{Math.round(t.maxSpeedMps * 3.6)} km/h</dd>
            </>
          )}
        </dl>
      </section>
    );
  }
  const p = rail.platforms[index]!;
  const station = p.station ? session.project.city.places[p.station] : undefined;
  const stop = Object.values(session.project.city.rail?.tramStops ?? {}).find(
    (s) => s.platform?.kind === 'mapped' && s.platform.platform === p.id,
  );
  const amenities = stop
    ? (
        [
          [stop.shelter, 'shelter'],
          [stop.covered, 'covered'],
          [stop.bench, 'bench'],
          [stop.tactilePaving, 'tactile paving'],
        ] as const
      )
        .filter(([has]) => has)
        .map(([, label]) => label)
    : [];
  return (
    <section aria-label="Platform inspector">
      <h2>
        {p.name}
        {p.ref ? ` · ${p.ref}` : ''}
      </h2>
      <p>
        {p.mode === 'rail' ? 'Rail' : p.mode === 'tram' ? 'Tram' : 'Bus'} platform ·{' '}
        {p.tracks.length} track sections
      </p>
      {stop && (
        <p>
          Tram stop{stop.lines.length ? ' · lines ' + stop.lines.join(', ') : ''}
          {amenities.length ? ' · ' + amenities.join(', ') : ''}
        </p>
      )}
      {station && (
        <button
          className="nav-row"
          onClick={() =>
            useAppStore
              .getState()
              .select({ kind: 'place', place: session.compiled.index.place.get(station.id)! })
          }
        >
          {station.name} station
        </button>
      )}
      {p.tracks.map((id) => {
        const track = rail.tracks.find((t) => t.id === id)!;
        return (
          <button
            key={id}
            className="nav-row"
            onClick={() => useAppStore.getState().select({ kind: 'track', track: track.idx })}
          >
            {track.name ?? names[track.kind]} · {Math.round(track.lengthM)} m
          </button>
        );
      })}
    </section>
  );
}

export function StationRailDetails({ place }: { place: Place }) {
  const rail = useAppStore((s) => s.session?.compiled.rail);
  if (!place.station || !rail) return null;
  return (
    <div aria-label="Station rail access">
      <p>
        {place.station.platforms.length} platforms · {place.station.entrances.length} entrances
      </p>
      {place.station.platforms.map((id) => {
        const index = rail.platforms.findIndex((p) => p.id === id);
        if (index < 0) return null;
        const p = rail.platforms[index]!;
        return (
          <button
            key={id}
            className="nav-row"
            onClick={() => useAppStore.getState().select({ kind: 'platform', platform: index })}
          >
            {p.ref ? `Platform ${p.ref}` : p.name} · {p.tracks.length} track sections
          </button>
        );
      })}
    </div>
  );
}
