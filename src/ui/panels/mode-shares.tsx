import type { PersonMetrics } from '../../sim/types';

// macOS system green and blue, as in the map's palette (TASK-162); app.css holds both appearances.
const walkColor = 'var(--chart-walk)';
const carColor = 'var(--chart-car)';

const percent = (part: number, total: number) =>
  total ? `${Math.round((100 * part) / total)}%` : '—';

/** TASK-113: person trips by mode as they leave, in total and by hour, and arrivals by mode. */
export function ModeShares({ modes }: { modes: PersonMetrics['modes'] }) {
  const { started, byHour, completed } = modes;
  const total = started.walk + started.car;
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
          <path d="M44 24V100H294" fill="none" style={{ stroke: 'var(--separator)' }} />
          <text x="38" y="28" textAnchor="end">
            100%
          </text>
          <text x="38" y="100" textAnchor="end">
            0
          </text>
          {byHour.walk.map((walk, hour) => {
            const car = byHour.car[hour]!;
            const n = walk + car;
            if (!n) return null;
            const walkHeight = (76 * walk) / n;
            return (
              <g key={hour} data-hour={hour} data-walk={walk} data-car={car}>
                <rect
                  x={45 + hour * 10.4}
                  y={24}
                  width={8.4}
                  height={76 - walkHeight}
                  style={{ fill: carColor }}
                />
                <rect
                  x={45 + hour * 10.4}
                  y={100 - walkHeight}
                  width={8.4}
                  height={walkHeight}
                  style={{ fill: walkColor }}
                />
                <title>{`${String(hour).padStart(2, '0')}:00 · ${walk.toLocaleString()} walking, ${car.toLocaleString()} by car`}</title>
              </g>
            );
          })}
          {[0, 6, 12, 18, 24].map((hour) => (
            <text key={hour} x={45 + hour * 10.4} y="118" textAnchor="middle">
              {String(hour % 24).padStart(2, '0')}
            </text>
          ))}
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
