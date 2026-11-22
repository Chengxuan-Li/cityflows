import { useEffect, useState, type ReactNode } from 'react';
import { aircraftCodes } from '../../schema/aircraft';
import type { StandKind } from '../../schema/airport';
import type { FlightBoard } from '../../sim/flight-operations';
import { useAppStore } from '../store';
import { aircraftStateLabels, flightBoardContext, useFlightBoard } from '../flight-board-data';

export function FlightBoardProvider({ children }: { children: ReactNode }) {
  const engine = useAppStore((s) => s.session?.compiled.airside && s.session.engine);
  const timeS = useAppStore((s) => (s.session?.compiled.airside ? s.run?.timeS : undefined));
  const [snapshot, setSnapshot] = useState<{ engine: typeof engine; board: FlightBoard | null }>();
  useEffect(() => {
    if (!engine) return;
    let active = true;
    void engine.flightBoard().then(
      (board) => {
        if (active) setSnapshot({ engine, board });
      },
      (error: unknown) => {
        if (active) useAppStore.getState().reportError(error);
      },
    );
    return () => {
      active = false;
    };
  }, [engine, timeS]);
  return (
    <flightBoardContext.Provider
      value={snapshot?.engine === engine ? (snapshot?.board ?? null) : null}
    >
      {children}
    </flightBoardContext.Provider>
  );
}

type Movement = FlightBoard['arrivals'][number];

const kinds: Record<StandKind, string> = {
  contact: 'Contact',
  remote: 'Remote',
  cargo: 'Cargo',
  general_aviation: 'General aviation',
  maintenance: 'Maintenance',
};

const stateLabels: Record<Movement['state'], string> = {
  ...aircraftStateLabels,
  scheduled: 'Scheduled',
  'before start': 'Before start',
  'holding for stand': 'Holding for stand',
  'awaiting clearance': 'Awaiting clearance',
  'awaiting approach': 'Awaiting approach',
  arrived: 'Arrived',
  departed: 'Departed',
  diverted: 'Diverted',
  cancelled: 'Cancelled',
};

function localTime(timeS: number) {
  const minutes = Math.floor(timeS / 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const pageSize = 6;

function Movements({ title, rows }: { title: string; rows: Movement[] }) {
  const now = useAppStore((s) => s.run?.timeS ?? 0);
  const [page, setPage] = useState<number | null>(null);
  const upcoming = rows.findIndex(({ timeS }) => timeS >= now);
  const maxStart = Math.max(0, rows.length - pageSize);
  const start = Math.min(maxStart, page ?? (upcoming < 0 ? maxStart : Math.max(0, upcoming - 2)));
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No scheduled flights</p>
      ) : (
        <>
          <table aria-label={title}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Aircraft</th>
                <th scope="col">Stand</th>
                <th scope="col">State</th>
                <th scope="col">Delay</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(start, start + pageSize).map((row) => (
                <tr key={row.id}>
                  <td>{localTime(row.timeS)}</td>
                  <td title={row.registration}>{row.typeId}</td>
                  <td>{row.stand ?? '—'}</td>
                  <td>{stateLabels[row.state]}</td>
                  <td>{row.delayS ? `+${Math.ceil(row.delayS / 60)}m` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > pageSize && (
            <div className="controls">
              <button disabled={start === 0} onClick={() => setPage(Math.max(0, start - pageSize))}>
                Earlier
              </button>
              <button disabled={page === null} onClick={() => setPage(null)}>
                Now
              </button>
              <button
                disabled={start === maxStart}
                onClick={() => setPage(Math.min(maxStart, start + pageSize))}
              >
                Later
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function FlightBoardInspector() {
  const board = useFlightBoard();
  if (!board) return null;
  return (
    <section aria-label="Flight board" className="flight-board">
      <h2>Flight board</h2>
      <Movements title="Departures" rows={board.departures} />
      <Movements title="Arrivals" rows={board.arrivals} />
    </section>
  );
}

export function StandInspector({ index }: { index: number }) {
  const stand = useAppStore((s) => s.session?.compiled.airside?.stands[index]);
  const occupancy = useFlightBoard()?.stands[index];
  if (!stand) return null;
  return (
    <section aria-label="Stand inspector">
      <h2>Stand {stand.ref ?? stand.id}</h2>
      <dl className="details">
        <dt>Code</dt>
        <dd>{aircraftCodes[stand.maxCode] ?? '—'}</dd>
        <dt>Kind</dt>
        <dd>{kinds[stand.kind]}</dd>
        <dt>Occupancy</dt>
        <dd>
          {occupancy?.occupiedBy ??
            (occupancy?.reservedFor
              ? `Reserved for ${occupancy.reservedFor}`
              : occupancy
                ? 'Free'
                : '—')}
        </dd>
      </dl>
    </section>
  );
}
