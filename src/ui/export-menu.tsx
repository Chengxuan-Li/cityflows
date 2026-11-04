import { useEffect, useState } from 'react';
import type { TrajectoryStatus } from '../host/protocol';
import { useAppStore, type ExportFormat } from './store';

const formats: [ExportFormat, string][] = [
  ['geojson', 'GeoJSON'],
  ['trips', 'Trips CSV'],
  ['road-metrics', 'Road metrics CSV'],
  ['trajectories', 'Trajectories CSV'],
];

export function ExportMenu({ onClose }: { onClose: () => void }) {
  const session = useAppStore((state) => state.session);
  const run = useAppStore((state) => state.run);
  const busy = useAppStore((state) => state.busy);
  const { exportData, reportError } = useAppStore.getState();
  const [status, setStatus] = useState<TrajectoryStatus>({ enabled: false, count: 0 });
  const [toggling, setToggling] = useState(false);
  const engine = session?.engine;

  useEffect(() => {
    let current = true;
    void session?.engine
      .trajectoryStatus()
      .then((value) => {
        if (current) setStatus(value);
      })
      .catch((error: unknown) => {
        if (current) reportError(error);
      });
    return () => {
      current = false;
    };
  }, [session, run?.timeS, reportError]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  async function toggle(enabled: boolean) {
    if (!engine) return;
    setToggling(true);
    try {
      setStatus(await engine.setTrajectories(enabled));
    } catch (error) {
      reportError(error);
    } finally {
      setToggling(false);
    }
  }

  return (
    <section id="export-menu" className="layers-sheet export-sheet" aria-label="Export files">
      {formats.map(([format, label]) => (
        <button
          key={format}
          disabled={
            busy ||
            !session ||
            (format !== 'geojson' && run?.stale) ||
            (format === 'trajectories' && !status.count)
          }
          onClick={() => void exportData(format)}
        >
          {label}
        </button>
      ))}
      <label>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy || toggling || !session || run?.stale}
          onChange={(event) => void toggle(event.target.checked)}
        />
        Record trajectories
      </label>
      <p className="muted">Every 10 simulated seconds while recording. Restart clears samples.</p>
      {run?.stale && <p className="muted">Restart to export the edited scenario.</p>}
      <p className="muted">synthetic traffic, not observed traffic</p>
    </section>
  );
}
