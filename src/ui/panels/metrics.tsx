import { useEffect, useState } from 'react';
import type { MetricsSample } from '../../host/protocol';
import type { Metrics } from '../../sim/types';
import { useAppStore } from '../store';

function clock(timeS: number) {
  return `${String(Math.floor(timeS / 3600)).padStart(2, '0')}:${String(Math.floor(timeS / 60) % 60).padStart(2, '0')}`;
}

const plots = [
  ['driving', 'Driving', '#4d8e94'],
  ['queued', 'Waiting at entrances and exits', '#a47950'],
  ['completed', 'Completed trips', '#668e72'],
  ['meanDelayS', 'Average delay · seconds', '#987ca0'],
] as const;

export function MetricsPanel() {
  const session = useAppStore((state) => state.session);
  const selection = useAppStore((state) => state.selection);
  const { toggleMetrics, reportError } = useAppStore.getState();
  const [result, setResult] = useState<{
    engine: NonNullable<typeof session>['engine'];
    samples: MetricsSample[];
    parking: Metrics['parking'];
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  // A new loaded city also identifies restart. History lives in the worker, not this sheet.
  useEffect(() => {
    if (!session) return;
    let active = true;
    void Promise.all([session.engine.metricsSeries(), session.engine.metrics()])
      .then(([samples, metrics]) => {
        if (active) {
          setResult({ engine: session.engine, samples, parking: metrics.parking });
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoading(false);
          reportError(error);
        }
      });
    return () => {
      active = false;
    };
  }, [session, revision, reportError]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleMetrics();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [toggleMetrics]);

  const samples = result?.engine === session?.engine ? (result?.samples ?? []) : [];
  const first = samples[0];
  const last = samples.at(-1);
  const facilities = session?.compiled.parking ?? [];
  const selectedId = selection?.kind === 'parking' ? facilities[selection.parking]?.id : undefined;
  const chosen =
    facilities.find(({ id }) => id === facilityId) ??
    facilities.find(({ id }) => id === selectedId) ??
    facilities[0];
  const parking = result?.engine === session?.engine ? result?.parking : undefined;
  const charts: { key: string; label: string; color: string; values: number[]; maximum: number }[] =
    plots.map(([key, label, color]) => ({
      key,
      label,
      color,
      values: samples.map((sample) => sample[key]),
      maximum: 1,
    }));
  if (chosen)
    charts.push({
      key: 'parking',
      label: 'Parking occupancy',
      color: '#668e72',
      values: samples.map((sample) => sample.parkingOccupancy?.[chosen.id] ?? 0),
      maximum: chosen.capacity,
    });
  return (
    <section id="metrics-chart" className="chart-sheet" aria-label="Traffic over time">
      <div className="chart-heading">
        <span>
          {last ? `Through ${clock(last.timeS)} · every simulated minute` : 'Loading history…'}
        </span>
        <div>
          <button
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Refresh
          </button>
          <button aria-label="Close chart" onClick={toggleMetrics}>
            ×
          </button>
        </div>
      </div>
      {parking && (
        <dl className="details" aria-label="Parking metrics">
          <dt>Cars parked</dt>
          <dd>{parking.parked.toLocaleString()}</dd>
          <dt>Mean parking search</dt>
          <dd>{parking.meanSearchTimeS.toFixed(1)} s</dd>
          <dt>Trips failed for lack of parking</dt>
          <dd>{parking.failed.toLocaleString()}</dd>
        </dl>
      )}
      {chosen && (
        <label className="edit-field">
          Occupancy by facility
          <select value={chosen.id} onChange={(event) => setFacilityId(event.currentTarget.value)}>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name ?? facility.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="chart-plots">
        {charts.map(({ key, label, color, values, maximum }) => {
          const max = Math.max(1, maximum, ...values);
          const start = first?.timeS ?? 0;
          const duration = Math.max(60, (last?.timeS ?? start) - start);
          const points = samples
            .map(
              (sample, index) =>
                `${36 + (250 * (sample.timeS - start)) / duration},${100 - (76 * Math.max(0, values[index]!)) / max}`,
            )
            .join(' ');
          return (
            <figure key={key}>
              <figcaption>
                {label} <strong>{last ? Math.round(values.at(-1)!).toLocaleString() : '—'}</strong>
              </figcaption>
              <svg viewBox="0 0 300 124" role="img" aria-label={`${label} over simulated time`}>
                <path d="M36 24V100H286" fill="none" stroke="#dcded2" />
                <text x="30" y="28" textAnchor="end">
                  {Math.ceil(max)}
                </text>
                <text x="30" y="100" textAnchor="end">
                  0
                </text>
                <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
                {first && (
                  <text x="36" y="118">
                    {clock(first.timeS)}
                  </text>
                )}
                {last && (
                  <text x="286" y="118" textAnchor="end">
                    {clock(last.timeS)}
                  </text>
                )}
              </svg>
            </figure>
          );
        })}
      </div>
      <p className="muted">
        Average delay is for completed trips. Synthetic traffic, not observed traffic.
      </p>
      {samples.length < 2 && (
        <p className="muted">Run for a simulated minute, then refresh to see the curves.</p>
      )}
    </section>
  );
}
