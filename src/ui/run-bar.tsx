import { useAppStore } from './store';
import { Layers } from './layers';
import { MetricsPanel } from './panels/metrics';
import { ComparePanel } from './panels/compare';
import { DemandPanel } from './panels/demand';
import { ToolbarButton } from './controls';

const speeds = [1, 2, 5, 10, 20];

function clock(timeS: number) {
  const pad = (value: number) => String(Math.floor(value)).padStart(2, '0');
  const tenths = Math.round(timeS * 10);
  return `${pad(tenths / 36000)}:${pad((tenths / 600) % 60)}:${pad((tenths / 10) % 60)}.${tenths % 10}`;
}

/** Play, pause, step, restart, speed and the 2D / 3D switch, in the toolbar. */
export function RunControls() {
  const mode = useAppStore((state) => state.viewMode);
  const run = useAppStore((state) => state.run);
  const busy = useAppStore((state) => state.busy);
  const { control, setSpeed } = useAppStore.getState();
  const disabled = !run || busy;
  return (
    <div className="run-controls">
      <div className="toolbar-group" role="group" aria-label="Run controls">
        <ToolbarButton
          icon="play"
          label="Play"
          tooltip="Run the simulation"
          className="play"
          disabled={disabled || run.stale || run.status !== 'paused'}
          onClick={() => void control('play')}
        />
        <ToolbarButton
          icon="pause"
          label="Pause"
          tooltip="Pause the simulation"
          disabled={disabled || run.status !== 'playing'}
          onClick={() => void control('pause')}
        />
        <ToolbarButton
          icon="step"
          label="Step"
          tooltip="Advance one step"
          disabled={disabled || run.stale || run.status !== 'paused'}
          onClick={() => void control('step')}
        />
        <ToolbarButton
          icon="restart"
          label="Restart"
          tooltip="Restart the day"
          disabled={disabled}
          onClick={() => void control('restart')}
        />
      </div>
      <label className="speed">
        <span className="visually-hidden">Speed</span>
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
      <ToolbarButton
        label="3D"
        tooltip="Switch between 2D and 3D · V"
        className="view-toggle"
        disabled={disabled}
        aria-pressed={mode === '3d'}
        onClick={() => useAppStore.getState().toggleView()}
      />
    </div>
  );
}

/** Clock, trip counts, run notices, the synthetic-traffic notice and map attribution. */
export function StatusBar() {
  const run = useAppStore((state) => state.run);
  const attribution = useAppStore((state) => state.session?.project.city.geo?.source.attribution);
  const counts = run?.counts;
  return (
    <footer className="status-bar" aria-label="Simulation">
      <output className="clock" aria-label="Simulation clock">
        {run ? clock(run.timeS) : '—'}
      </output>
      {counts && (
        <>
          <span className="status-counts">
            {counts.driving} driving · {counts.completed} completed
          </span>
          <details className="metrics">
            <summary>Trip counts</summary>
            <div className="metrics-sheet popover" data-placement="above" data-align="start">
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
        </>
      )}
      {run?.stale && (
        <span className="restart-notice" role="status">
          Restart to apply changes
        </span>
      )}
      {!run?.stale && run?.patch && (
        <span key={run.patch.version} className="live-edit-notice" role="status">
          Edit applied · {run.patch.rerouted} cars rerouted · {run.patch.stranded} removed
        </span>
      )}
      {run?.status === 'finished' && <span>Finished</span>}
      <small className="traffic-notice">Synthetic traffic, not observed traffic</small>
      {attribution && <small className="attribution">{attribution}</small>}
    </footer>
  );
}

/** The analysis panels opened from the sidebar; they float over the map until phase 2. */
export function Panels() {
  const layersOpen = useAppStore((state) => state.layersOpen);
  const metricsOpen = useAppStore((state) => state.metricsOpen);
  const demandOpen = useAppStore((state) => state.demandOpen);
  const compareOpen = useAppStore((state) => state.compareOpen);
  const showCompare = compareOpen && !layersOpen && !metricsOpen && !demandOpen;
  if (!showCompare && !layersOpen && !metricsOpen && !demandOpen) return null;
  return (
    <div className="run-sheet">
      {showCompare && <ComparePanel />}
      {layersOpen && <Layers />}
      {metricsOpen && <MetricsPanel />}
      {demandOpen && <DemandPanel />}
    </div>
  );
}
