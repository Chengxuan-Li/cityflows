import type { PersonMetrics } from '../../sim/types';

const walkColor = '#668e72';
const carColor = '#4d8e94';

const percent = (part: number, total: number) =>
  total ? `${Math.round((100 * part) / total)}%` : '—';

/** TASK-113: person trips by mode as they leave, in total and by hour, and arrivals by mode. */
export function ModeShares({ modes }: { modes: PersonMetrics['modes'] }) {
  const { started, byHour, completed } = modes;
  const total = started.walk + started.car;
  const hours = byHour.walk.map((walk, hour) => ({ hour, walk, car: byHour.car[hour]! }));
  const shown = hours.filter(({ walk, car }) => walk + car > 0);
  const first = shown[0]?.hour ?? 0;
  const last = shown.at(-1)?.hour ?? 0;
  const span = hours.slice(first, last + 1);
  const width = 250 / Math.max(1, span.length);
  return (
    <figure className="mode-shares" aria-label="Mode shares">
      <figcaption>
        Person trips by mode · walk <strong>{percent(started.walk, total)}</strong> · car{' '}
        <strong>{percent(started.car, total)}</strong>
      </figcaption>
      <dl className="details">
        <dt>Started walking, by car</dt>
        <dd>
          {started.walk.toLocaleString()}, {started.car.toLocaleString()}
        </dd>
        <dt>Arrived on foot</dt>
        <dd>{completed.walk.toLocaleString()}</dd>
        <dt>Arrived by car, parked at the destination</dt>
        <dd>{completed.drive.toLocaleString()}</dd>
        <dt>Arrived by car, parked away and walked on</dt>
        <dd>{completed.driveWalk.toLocaleString()}</dd>
      </dl>
      {total > 0 && (
        <svg viewBox="0 0 300 124" role="img" aria-label="Walk share by hour">
          <path d="M36 24V100H286" fill="none" stroke="#dcded2" />
          <text x="30" y="28" textAnchor="end">
            100%
          </text>
          <text x="30" y="100" textAnchor="end">
            0
          </text>
          {span.map(({ hour, walk, car }, i) => {
            const n = walk + car;
            const walkHeight = n ? (76 * walk) / n : 0;
            return (
              <g key={hour} data-hour={hour} data-walk={walk} data-car={car}>
                <rect
                  x={37 + i * width}
                  y={24}
                  width={width - 2}
                  height={n ? 76 - walkHeight : 0}
                  fill={carColor}
                />
                <rect
                  x={37 + i * width}
                  y={100 - walkHeight}
                  width={width - 2}
                  height={walkHeight}
                  fill={walkColor}
                />
                <title>{`${String(hour).padStart(2, '0')}:00 · ${walk.toLocaleString()} walking, ${car.toLocaleString()} by car`}</title>
              </g>
            );
          })}
          <text x="36" y="118">
            {String(first).padStart(2, '0')}:00
          </text>
          <text x="286" y="118" textAnchor="end">
            {String(last + 1).padStart(2, '0')}:00
          </text>
        </svg>
      )}
      <p className="muted">
        <span className="swatch" style={{ background: walkColor }} /> walk{' '}
        <span className="swatch" style={{ background: carColor }} /> car, share of person trips
        leaving in each hour
      </p>
    </figure>
  );
}
