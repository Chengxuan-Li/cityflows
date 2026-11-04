import { useEffect, useState } from 'react';
import type { MetricsSample } from '../../host/protocol';
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
  const { toggleMetrics, reportError } = useAppStore.getState();
  const [result, setResult] = useState<{
    engine: NonNullable<typeof session>['engine'];
    samples: MetricsSample[];
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  // A new loaded city also identifies restart. History lives in the worker, not this sheet.
  useEffect(() => {
    if (!session) return;
    let active = true;
    void session.engine
      .metricsSeries()
      .then((samples) => {
        if (active) {
          setResult({ engine: session.engine, samples });
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
      <div className="chart-plots">
        {plots.map(([key, label, color]) => {
          const max = Math.max(1, ...samples.map((sample) => sample[key]));
          const start = first?.timeS ?? 0;
          const duration = Math.max(60, (last?.timeS ?? start) - start);
          const points = samples
            .map(
              (sample) =>
                `${36 + (250 * (sample.timeS - start)) / duration},${100 - (76 * Math.max(0, sample[key])) / max}`,
            )
            .join(' ');
          return (
            <figure key={key}>
              <figcaption>
                {label} <strong>{last ? Math.round(last[key]).toLocaleString() : '—'}</strong>
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
