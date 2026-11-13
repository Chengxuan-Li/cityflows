import { speeds, useAppStore } from './store';
import { useEnabled } from './commands';
import { MenuItem, ToolbarButton, type ToolbarAction } from './controls';
import { labels } from './shortcuts';

function clock(timeS: number) {
  const pad = (value: number) => String(Math.floor(value)).padStart(2, '0');
  const tenths = Math.round(timeS * 10);
  return `${pad(tenths / 36000)}:${pad((tenths / 600) % 60)}:${pad((tenths / 10) % 60)}.${tenths % 10}`;
}

/** Play, pause, step, restart, speed and the 2D / 3D switch. In the toolbar, Play and Pause
 *  always show; with `inMenu`, the items the toolbar overflows (Step and Restart, speed, 3D)
 *  render as overflow-menu entries, each hidden by CSS while the toolbar still has room for it. */
export function RunControls({ inMenu = false }: { inMenu?: boolean }) {
  const mode = useAppStore((state) => state.viewMode);
  const run = useAppStore((state) => state.run);
  const can = useEnabled();
  const { control, setSpeed } = useAppStore.getState();
  const disabled = !can.restart;
  const steps: ToolbarAction[] = [
    {
      icon: 'step',
      label: 'Step',
      tooltip: 'Advance one step',
      command: 'step',
      disabled: !can.step,
      onClick: () => void control('step'),
    },
    {
      icon: 'restart',
      label: 'Restart',
      tooltip: 'Restart the day',
      command: 'restart',
      disabled,
      onClick: () => void control('restart'),
    },
  ];
  const speed = (
    <label
      className={`speed ov-speed${inMenu ? ' menu-row' : ''}`}
      title={`Playback speed · ${labels('slower')[0]} slower · ${labels('faster')[0]} faster`}
    >
      <span className={inMenu ? undefined : 'visually-hidden'}>Speed</span>
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
  );
  const view = {
    label: '3D',
    disabled,
    'aria-pressed': mode === '3d',
    onClick: () => useAppStore.getState().toggleView(),
  };
  if (inMenu)
    return (
      <>
        <div className="menu-group ov-steps">
          {steps.map((action) => (
            <MenuItem key={action.label} {...action} />
          ))}
        </div>
        <div className="menu-group ov-speed">
          {speed}
          <button {...view} className="menu-item view-toggle">
            3D
            <kbd aria-hidden="true">{labels('view3d')[0]}</kbd>
          </button>
        </div>
      </>
    );
  return (
    <div className="run-controls">
      <div className="toolbar-group" role="group" aria-label="Run controls">
        <ToolbarButton
          icon="play"
          label="Play"
          tooltip="Run the simulation"
          command="playPause"
          className="play"
          disabled={!can.playPause || run?.status === 'playing'}
          onClick={() => void control('play')}
        />
        <ToolbarButton
          icon="pause"
          label="Pause"
          tooltip="Pause the simulation"
          command="playPause"
          disabled={!can.playPause || run?.status !== 'playing'}
          onClick={() => void control('pause')}
        />
        {steps.map((action) => (
          <ToolbarButton key={action.label} {...action} className="ov-steps" />
        ))}
      </div>
      {speed}
      <ToolbarButton
        {...view}
        tooltip="Switch between 2D and 3D"
        command="view3d"
        className="view-toggle ov-speed"
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
