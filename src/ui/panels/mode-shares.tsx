import type { PersonMetrics, TransitMetrics } from '../../sim/types';

// macOS system green, blue and purple, as in the map's palette (TASK-162); app.css holds both
// appearances.
const walkColor = 'var(--chart-walk)';
const carColor = 'var(--chart-car)';
const transitColor = 'var(--chart-transit)';

const percent = (part: number, total: number) =>
  total ? `${Math.round((100 * part) / total)}%` : '—';

/** TASK-113: person trips by mode as they leave, in total and by hour, and arrivals by mode.
 * TASK-174: transit is the third mode, with the riders per line. */
export function ModeShares({
  modes,
  transit,
}: {
  modes: PersonMetrics['modes'];
  transit?: TransitMetrics;
}) {
  const { started, byHour, completed } = modes;
  const total = started.walk + started.car + started.transit;
  const lines = transit?.lines.filter((l) => l.boardings + l.riderBoardings + l.riderAlightings);
  return (
    <figure className="mode-shares" aria-label="Mode shares">
      <figcaption>
        Person trips by mode · walk <strong>{percent(started.walk, total)}</strong> · car{' '}
        <strong>{percent(started.car, total)}</strong>
        {transit && (
          <>
            {' '}
            · transit <strong>{percent(started.transit, total)}</strong>
          </>
        )}
      </figcaption>
      <dl className="details">
        <dt>Started walking, by car{transit && ', by transit'}</dt>
        <dd>
          {started.walk.toLocaleString()}, {started.car.toLocaleString()}
          {transit && `, ${started.transit.toLocaleString()}`}
        </dd>
        <dt>Arrived on foot</dt>
        <dd>{completed.walk.toLocaleString()}</dd>
        <dt>Arrived by car, parked at the destination</dt>
        <dd>{completed.drive.toLocaleString()}</dd>
        <dt>Arrived by car, parked away and walked on</dt>
        <dd>{completed.driveWalk.toLocaleString()}</dd>
        {transit && (
          <>
            <dt>Arrived by tram or S-Bahn</dt>
            <dd>{completed.transit.toLocaleString()}</dd>
            <dt>Mean wait at a stop</dt>
            <dd>{transit.waits.count ? `${Math.round(transit.waits.meanS)} s` : '—'}</dd>
            <dt>Left behind by a full vehicle</dt>
            <dd>{transit.deniedBoardings.toLocaleString()}</dd>
          </>
        )}
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
            const car = byHour.car[hour]!,
              ridden = byHour.transit[hour]!;
            const n = walk + car + ridden;
            if (!n) return null;
            const walkHeight = (76 * walk) / n,
              transitHeight = (76 * ridden) / n;
            const x = 45 + hour * 10.4;
            return (
              <g key={hour} data-hour={hour} data-walk={walk} data-car={car} data-transit={ridden}>
                <rect
                  x={x}
                  y={24}
                  width={8.4}
                  height={76 - walkHeight - transitHeight}
                  style={{ fill: carColor }}
                />
                <rect
                  x={x}
                  y={100 - walkHeight - transitHeight}
                  width={8.4}
                  height={transitHeight}
                  style={{ fill: transitColor }}
                />
                <rect
                  x={x}
                  y={100 - walkHeight}
                  width={8.4}
                  height={walkHeight}
                  style={{ fill: walkColor }}
                />
                <title>{`${String(hour).padStart(2, '0')}:00 · ${walk.toLocaleString()} walking, ${car.toLocaleString()} by car, ${ridden.toLocaleString()} by transit`}</title>
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
        {transit && (
          <>
            <span className="swatch" style={{ background: transitColor }} /> transit{' '}
          </>
        )}
        <span className="swatch" style={{ background: carColor }} /> car, share of person trips
        leaving in each hour
      </p>
      {lines && lines.length > 0 && (
        <table aria-label="Riders per line">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Boarded</th>
              <th scope="col">Most aboard</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.route}>
                <th scope="row">
                  {line.name}
                  {line.riderBoardings + line.riderAlightings > 0 && (
                    <div className="muted">
                      Station riders: {line.riderAlightings.toLocaleString()} off,{' '}
                      {line.riderBoardings.toLocaleString()} on
                    </div>
                  )}
                </th>
                <td>{line.boardings.toLocaleString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {line.peakLoad} of {line.capacity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
