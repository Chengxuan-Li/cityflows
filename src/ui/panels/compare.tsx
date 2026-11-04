import { useEffect } from 'react';
import type { HeadlessResult } from '../../host/protocol';
import { useAppStore } from '../store';

const rows: { label: string; read: (result: HeadlessResult) => number; seconds?: boolean }[] = [
  { label: 'Mean travel time', read: (result) => result.travelTime.meanS, seconds: true },
  { label: '90th percentile delay', read: (result) => result.travelTime.p90DelayS, seconds: true },
  { label: 'Completed', read: (result) => result.metrics.trips.completed },
  { label: 'Failed', read: (result) => result.metrics.trips.failed },
];

export function ComparePanel() {
  const session = useAppStore((state) => state.session);
  const result = useAppStore((state) => state.comparison);
  const progress = useAppStore((state) => state.comparisonProgress);
  const busy = useAppStore((state) => state.busy);
  const { toggleCompare, saveBaseline, restoreBaseline, runComparison, cancelComparison } =
    useAppStore.getState();
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleCompare();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [toggleCompare]);
  const baseline = session?.project.baseline;
  return (
    <section id="compare" className="chart-sheet compare-sheet" aria-label="Scenario comparison">
      <div className="chart-heading">
        <span>
          {baseline
            ? `Baseline saved · city version ${baseline.city.version}`
            : 'Save a baseline before editing the city.'}
        </span>
        <button aria-label="Close comparison" onClick={toggleCompare}>
          ×
        </button>
      </div>
      <div className="controls compare-actions">
        <button disabled={busy || !!progress} onClick={saveBaseline}>
          Save as baseline
        </button>
        <button disabled={busy || !!progress || !baseline} onClick={() => void restoreBaseline()}>
          Restore baseline
        </button>
        <button disabled={busy || !!progress || !baseline} onClick={() => void runComparison()}>
          Run comparison
        </button>
        {progress && <button onClick={cancelComparison}>Cancel comparison</button>}
      </div>
      {progress && (
        <div className="comparison-progress" role="status">
          <span>
            {progress.run} · {progress.run === 'Baseline' ? '1' : '2'} of 2 ·{' '}
            {Math.round(progress.fraction * 100)}%
          </span>
          <progress
            aria-label="Comparison progress"
            max={2}
            value={(progress.run === 'Baseline' ? 0 : 1) + progress.fraction}
          />
        </div>
      )}
      {result && (
        <>
          <table aria-label="Comparison results">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Baseline</th>
                <th scope="col">Variant</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, read, seconds }) => {
                const before = read(result.baseline);
                const after = read(result.variant);
                const available =
                  !seconds ||
                  (result.baseline.metrics.trips.completed > 0 &&
                    result.variant.metrics.trips.completed > 0);
                const format = (value: number) =>
                  seconds ? `${value.toFixed(2)} s` : String(value);
                return (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>
                      {seconds && !result.baseline.metrics.trips.completed ? '—' : format(before)}
                    </td>
                    <td>
                      {seconds && !result.variant.metrics.trips.completed ? '—' : format(after)}
                    </td>
                    <td>
                      {available ? `${after > before ? '+' : ''}${format(after - before)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="difference-key">
            <span className="usage-up">More vehicles</span> ·{' '}
            <span className="usage-down">Fewer vehicles</span> · toggle in Layers
          </p>
          <p className="muted">
            Variant city version {result.reference.cityVersion} · seed{' '}
            {result.reference.scenario.seed}. Same saved demand for both runs.
          </p>
        </>
      )}
      <p className="muted">
        Travel time and delay cover completed trips only. Synthetic traffic, not observed traffic.
      </p>
    </section>
  );
}
