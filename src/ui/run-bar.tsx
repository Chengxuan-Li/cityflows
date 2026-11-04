import { useLayoutEffect, useRef } from 'react';
import { useAppStore } from './store';
import { Layers } from './layers';
import { MetricsPanel } from './panels/metrics';
import { ComparePanel } from './panels/compare';
import { DemandPanel } from './panels/demand';

const speeds = [1, 2, 5, 10, 20];

function clock(timeS: number) {
  const pad = (value: number) => String(Math.floor(value)).padStart(2, '0');
  const tenths = Math.round(timeS * 10);
  return `${pad(tenths / 36000)}:${pad((tenths / 600) % 60)}:${pad((tenths / 10) % 60)}.${tenths % 10}`;
}

export function RunBar() {
  const run = useAppStore((state) => state.run);
  const busy = useAppStore((state) => state.busy);
  const diagnostics = useAppStore((state) => state.session?.diagnostics.length);
  const diagnosticsOpen = useAppStore((state) => state.diagnosticsOpen);
  const layersOpen = useAppStore((state) => state.layersOpen);
  const metricsOpen = useAppStore((state) => state.metricsOpen);
  const demandOpen = useAppStore((state) => state.demandOpen);
  const compareOpen = useAppStore((state) => state.compareOpen);
  const showCompare = compareOpen && !layersOpen && !metricsOpen && !demandOpen;
  const sheetOpen = showCompare || layersOpen || metricsOpen || demandOpen;
  const barRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const { toggleCompare } = useAppStore.getState();
  const { toggleLayers, toggleMetrics, toggleDemand } = useAppStore.getState();
  const { control, setSpeed, toggleDiagnostics } = useAppStore.getState();
  const disabled = !run || busy;
  const counts = run?.counts;

  useLayoutEffect(() => {
    if (!sheetOpen) return;
    const bar = barRef.current!;
    const app = bar.parentElement!;
    const sheet = sheetRef.current!;

    function reserveSheetSpace() {
      const bottom = app.getBoundingClientRect().bottom;
      app.style.setProperty(
        '--run-sheet-bottom',
        `${bottom - sheet.getBoundingClientRect().bottom}px`,
      );
      // The wrapper stays still while the sheet animates inside it.
      app.style.setProperty('--run-sheet-space', `${bottom - sheet.getBoundingClientRect().top}px`);
    }

    reserveSheetSpace();
    const observer = new ResizeObserver(reserveSheetSpace);
    observer.observe(app);
    observer.observe(bar);
    observer.observe(sheet.parentElement!);
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      app.style.removeProperty('--run-sheet-bottom');
      app.style.removeProperty('--run-sheet-space');
    };
  }, [sheetOpen]);

  return (
    <footer ref={barRef} className="run-bar" aria-label="Simulation">
      <div className="run-controls">
        <output className="clock" aria-label="Simulation clock">
          {run ? clock(run.timeS) : '—'}
        </output>
        <div className="controls" role="group" aria-label="Run controls">
          <button
            className="play"
            disabled={disabled || run.stale || run.status !== 'paused'}
            onClick={() => void control('play')}
          >
            Play
          </button>
          <button
            disabled={disabled || run.status !== 'playing'}
            onClick={() => void control('pause')}
          >
            Pause
          </button>
          <button
            disabled={disabled || run.stale || run.status !== 'paused'}
            onClick={() => void control('step')}
          >
            Step
          </button>
          <button disabled={disabled} onClick={() => void control('restart')}>
            Restart
          </button>
        </div>
        {run?.stale && (
          <span className="restart-notice" role="status">
            Restart to apply changes
          </span>
        )}
        <label className="speed">
          Speed
          <select
            disabled={disabled}
            value={run?.speed ?? 1}
            onChange={(event) => void setSpeed(Number(event.currentTarget.value))}
          >
            {speeds.map((speed) => (
              <option key={speed} value={speed}>
                ×{speed}
              </option>
            ))}
          </select>
        </label>
        {run?.status === 'finished' && <span>Finished</span>}
      </div>
      <div className="run-summary">
        <button
          disabled={!run}
          aria-expanded={showCompare}
          aria-controls="compare"
          onClick={toggleCompare}
        >
          Compare
        </button>
        <button
          disabled={!run}
          aria-expanded={layersOpen}
          aria-controls="layers"
          onClick={toggleLayers}
        >
          Layers
        </button>
        <button
          disabled={disabled}
          aria-expanded={metricsOpen}
          aria-controls="metrics-chart"
          onClick={toggleMetrics}
        >
          Chart
        </button>
        <button
          disabled={disabled}
          aria-expanded={demandOpen}
          aria-controls="demand"
          onClick={toggleDemand}
        >
          Demand
        </button>
        {sheetOpen && (
          <div className="run-sheet" ref={sheetRef}>
            {showCompare && <ComparePanel />}
            {layersOpen && <Layers />}
            {metricsOpen && <MetricsPanel />}
            {demandOpen && <DemandPanel />}
          </div>
        )}
        {counts && (
          <details className="metrics">
            <summary>Trip counts</summary>
            <div className="metrics-sheet">
              <dl className="trip-counts" aria-label="Trip counts">
                <div>
                  <dt>Pending</dt>
                  <dd>{counts.pending}</dd>
                </div>
                <div>
                  <dt>Driving</dt>
                  <dd>{counts.driving}</dd>
                </div>
                <div>
                  <dt>Queued at origin</dt>
                  <dd>{counts.queuedOrigin}</dd>
                </div>
                <div>
                  <dt>Queued at destination</dt>
                  <dd>{counts.queuedDestination}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{counts.completed}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd>{counts.failed}</dd>
                </div>
              </dl>
              <p className="muted">achieved ×{(run?.achieved ?? 0).toFixed(1)}</p>
              <p className="muted">Synthetic traffic, not observed traffic</p>
            </div>
          </details>
        )}
        <button
          disabled={diagnostics === undefined}
          aria-expanded={diagnosticsOpen}
          aria-controls={diagnosticsOpen ? 'diagnostics' : undefined}
          onClick={toggleDiagnostics}
        >
          Validation ({diagnostics ?? 0})
        </button>
        <small className="traffic-notice">Synthetic traffic, not observed traffic</small>
      </div>
    </footer>
  );
}
