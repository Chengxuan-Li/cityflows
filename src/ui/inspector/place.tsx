import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CompiledCity } from '../../network';
import type { Connector, Place, PlaceEvent, PlaceKind } from '../../schema';
import type { Vec2 } from '../../geo/vec2';
import { useAppStore } from '../store';
import { nearestPlaceLane } from '../tools/place-brush';
import { NumberField } from './number-field';

const directions = { in: 'Arrivals', out: 'Departures', both: 'Arrivals and departures' };
const kinds: PlaceKind[] = [
  'residential',
  'work',
  'retail',
  'school',
  'station',
  'airport',
  'parking',
  'gateway',
  'other',
];
type Profile = NonNullable<Place['profile']>;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** Nearest free lane, or a free slot further along an already connected lane. */
function connectorSlot(compiled: CompiledCity, center: Vec2, connectors: Connector[]) {
  const free = nearestPlaceLane(compiled, center, connectors);
  if (free) return free;
  const nearest = nearestPlaceLane(compiled, center);
  if (!nearest) return null;
  const lane = compiled.lanes[compiled.index.lane.get(`${nearest.roadId}#${nearest.lane}`)!]!;
  const taken = connectors
    .filter((c) => c.roadId === nearest.roadId && c.lane === nearest.lane)
    .map((c) => c.positionM);
  const spacingM = 15;
  const slots = [nearest.positionM, ...taken.flatMap((at) => [at - spacingM, at + spacingM])]
    .filter((at) => at >= 5 && at <= lane.lengthM - 5)
    .filter((at) => taken.every((used) => Math.abs(used - at) >= spacingM))
    .sort((a, b) => Math.abs(a - nearest.positionM) - Math.abs(b - nearest.positionM));
  return slots.length ? { ...nearest, positionM: slots[0]! } : null;
}

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

function TextField({
  label,
  value,
  type = 'text',
  onCommit,
}: {
  label: string;
  value: string;
  type?: 'text' | 'time';
  onCommit: (value: string) => void;
}) {
  return (
    <label className="edit-field">
      {label}
      <input
        key={value}
        type={type}
        required
        defaultValue={value}
        onBlur={({ currentTarget: input }) => {
          const next = input.value;
          const valid = input.validity.valid;
          input.value = value;
          if (valid && next !== value) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.reportValidity()) {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.value = value;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

const barWidth = 10;
const barTop = 6;
const barBottom = 54;

function ProfileRow({
  label,
  weights,
  top,
  disabled,
  onDraft,
  onCommit,
}: {
  label: string;
  weights: number[];
  top: number;
  disabled: boolean;
  onDraft: (hour: number, weight: number) => void;
  onCommit: (hour?: number, weight?: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  function weightAt(event: ReactPointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 24 * barWidth;
    const y = ((event.clientY - box.top) / box.height) * 64;
    const hour = Math.min(23, Math.max(0, Math.floor(x / barWidth)));
    const fraction = (barBottom - y) / (barBottom - barTop);
    return { hour, weight: Math.round(Math.min(1, Math.max(0, fraction)) * top) };
  }
  return (
    <figure className="profile-row">
      <figcaption>{label}</figcaption>
      <svg
        viewBox={`0 0 ${24 * barWidth} 64`}
        aria-label={`${label} by hour`}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          const { hour, weight } = weightAt(event);
          onDraft(hour, weight);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const { hour, weight } = weightAt(event);
          onDraft(hour, weight);
        }}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          onCommit();
        }}
        onPointerCancel={() => setDragging(false)}
      >
        {hours.map((hour) => {
          const height = ((barBottom - barTop) * weights[hour]!) / top;
          return (
            <rect
              key={hour}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${label} ${hourLabel(hour)}`}
              aria-valuemin={0}
              aria-valuemax={top}
              aria-valuenow={weights[hour]}
              x={hour * barWidth + 1}
              y={barBottom - height}
              width={barWidth - 2}
              height={height}
              onKeyDown={(event) => {
                const steps = { ArrowUp: 1, ArrowDown: -1, Home: -top, End: top }[event.key];
                if (steps === undefined || disabled) return;
                event.preventDefault();
                onCommit(hour, Math.min(top, Math.max(0, weights[hour]! + steps)));
              }}
            />
          );
        })}
        <path d={`M0 ${barBottom}H${24 * barWidth}`} className="profile-axis" />
        {[0, 6, 12, 18].map((hour) => (
          <text key={hour} x={hour * barWidth + 1} y="63">
            {String(hour).padStart(2, '0')}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function ProfileEditor({
  profile,
  disabled,
  onCommit,
}: {
  profile: Profile;
  disabled: boolean;
  onCommit: (profile: Profile) => void;
}) {
  const [draft, setDraft] = useState<{ source: Profile; value: Profile } | null>(null);
  const shown = draft?.source === profile ? draft.value : profile;
  const top = Math.max(10, ...shown.arrivals, ...shown.departures);
  const changed = (row: keyof Profile, hour: number, weight: number) =>
    shown[row][hour] === weight
      ? null
      : { ...shown, [row]: shown[row].map((w, h) => (h === hour ? weight : w)) };
  const edit = (row: keyof Profile) => (hour: number, weight: number) => {
    const value = changed(row, hour, weight);
    if (value) setDraft({ source: profile, value });
  };
  // Pointer drags commit the accumulated draft on release; a key press commits at once.
  const commit = (row: keyof Profile) => (hour?: number, weight?: number) => {
    const value = hour === undefined ? shown : changed(row, hour, weight!);
    if (value && value !== profile) onCommit(value);
  };
  return (
    <div className="profile-editor">
      {(['arrivals', 'departures'] as const).map((row) => (
        <ProfileRow
          key={row}
          label={row === 'arrivals' ? 'Arrivals' : 'Departures'}
          weights={shown[row]}
          top={top}
          disabled={disabled}
          onDraft={edit(row)}
          onCommit={commit(row)}
        />
      ))}
      <p className="muted">Drag across the bars. Taller bars send more trips in that hour.</p>
    </div>
  );
}

/** A commute shape to start from: homes send people out in the morning, other places receive them. */
function defaultProfile(kind: PlaceKind): Profile {
  const morning = hours.map((hour) => ({ 7: 4, 8: 8, 9: 4 })[hour] ?? 0);
  const evening = hours.map((hour) => ({ 16: 4, 17: 8, 18: 4 })[hour] ?? 0);
  return kind === 'residential' || kind === 'gateway'
    ? { arrivals: evening, departures: morning }
    : { arrivals: morning, departures: evening };
}

const toClock = (seconds: number) =>
  `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
const fromClock = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return h! * 3600 + m! * 60;
};

function EventList({
  placeId,
  events,
  disabled,
  onCommit,
}: {
  placeId: string;
  events: PlaceEvent[];
  disabled: boolean;
  onCommit: (events: PlaceEvent[]) => void;
}) {
  const update = (event: PlaceEvent, patch: Partial<PlaceEvent>) =>
    onCommit(events.map((entry) => (entry === event ? { ...entry, ...patch } : entry)));
  return (
    <>
      <button
        disabled={disabled}
        onClick={() => {
          let n = 1;
          while (events.some(({ id }) => id === `${placeId}:event-${n}`)) n++;
          onCommit([
            ...events,
            {
              id: `${placeId}:event-${n}`,
              name: `Event ${n}`,
              startS: 8 * 3600,
              durationS: 30 * 60,
              arrivals: 50,
              departures: 50,
            },
          ]);
        }}
      >
        Add event
      </button>
      {events.length ? (
        <ul className="item-list">
          {events.map((event) => (
            <li key={event.id}>
              <div className="edit-fields">
                <TextField
                  label="Name"
                  value={event.name}
                  onCommit={(name) => update(event, { name })}
                />
                <TextField
                  label="Starts at"
                  type="time"
                  value={toClock(event.startS)}
                  onCommit={(clock) => update(event, { startS: fromClock(clock) })}
                />
                <NumberField
                  label="Lasts (min)"
                  value={event.durationS / 60}
                  min={1}
                  step={1}
                  onCommit={(minutes) => update(event, { durationS: minutes! * 60 })}
                />
                <NumberField
                  label="Cars arriving"
                  value={event.arrivals}
                  step={1}
                  onCommit={(arrivals) => update(event, { arrivals: arrivals! })}
                />
                <NumberField
                  label="Cars leaving"
                  value={event.departures}
                  step={1}
                  onCommit={(departures) => update(event, { departures: departures! })}
                />
              </div>
              <div className="controls">
                <button
                  disabled={disabled}
                  onClick={() => onCommit(events.filter((entry) => entry !== event))}
                >
                  Remove event
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No events. Add one for a train, a match or a market.</p>
      )}
    </>
  );
}

export function PlaceInspector({ place, connectorId }: { place: Place; connectorId?: string }) {
  const { profile } = place;
  const { commit } = useAppStore.getState();
  const session = useAppStore((state) => state.session)!;
  const busy = useAppStore((state) => state.busy);
  const summary = session.demandSummary.byPlace[place.id];
  const center = session.compiled.places[session.compiled.index.place.get(place.id)!]!.centroid;
  const available = connectorSlot(session.compiled, center, place.connectors);
  function update(patch: Partial<Omit<Place, 'id' | 'connectors'>>) {
    void commit({ kind: 'updatePlace', placeId: place.id, patch });
  }
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
            onCommit={(value) => update({ [field]: value })}
          />
        ))}
        <NumberField
          label="Capacity"
          value={place.capacity}
          nullable
          step={1}
          onCommit={(capacity) => update({ capacity })}
        />
      </div>
      <details className="disclosure">
        <summary>Place settings</summary>
        <div className="edit-fields">
          <label className="edit-field">
            Type
            <select
              value={place.kind}
              disabled={busy}
              onChange={(event) => update({ kind: event.currentTarget.value as PlaceKind })}
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind} className="capitalize">
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Attraction"
            value={place.attraction}
            onCommit={(attraction) => update({ attraction: attraction! })}
          />
        </div>
      </details>
      <details className="disclosure">
        <summary>Hourly profile</summary>
        {profile ? (
          <>
            <ProfileEditor
              profile={profile}
              disabled={busy}
              onCommit={(profile) => update({ profile })}
            />
            <button disabled={busy} onClick={() => update({ profile: null })}>
              Use default timing
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Trips follow the scenario's work hours. A profile sets its own hourly weights.
            </p>
            <button disabled={busy} onClick={() => update({ profile: defaultProfile(place.kind) })}>
              Add profile
            </button>
          </>
        )}
      </details>
      <details className="disclosure">
        <summary>Events</summary>
        <EventList
          placeId={place.id}
          events={place.events}
          disabled={busy}
          onCommit={(events) => update({ events })}
        />
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
        {!available && <p className="muted">No room on a lane within 60 m.</p>}
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
              const patch = (fields: Partial<Connector>) =>
                setConnectors(
                  place.connectors.map((entry) =>
                    entry === connector ? { ...entry, ...fields } : entry,
                  ),
                );
              return (
                <li
                  key={connector.id}
                  className={connectorId === connector.id ? 'selected' : undefined}
                >
                  <span>
                    {connector.roadId} · lane {connector.lane + 1} ·{' '}
                    {Math.round(connector.positionM)} m
                  </span>
                  <div className="edit-fields">
                    <label className="edit-field">
                      Direction
                      <select
                        value={connector.direction}
                        disabled={busy}
                        onChange={(event) =>
                          patch({ direction: event.currentTarget.value as Connector['direction'] })
                        }
                      >
                        {(['in', 'out', 'both'] as const).map((direction) => (
                          <option key={direction} value={direction}>
                            {directions[direction]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <NumberField
                      label="Throughput (veh/min)"
                      value={connector.throughputPerMin}
                      onCommit={(throughputPerMin) =>
                        patch({ throughputPerMin: throughputPerMin! })
                      }
                    />
                  </div>
                  <div className="controls">
                    <button
                      disabled={busy || !lane || unchanged}
                      onClick={() => {
                        if (lane) patch(lane);
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
    </>
  );
}
