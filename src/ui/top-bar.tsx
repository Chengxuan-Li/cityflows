import { lazy, Suspense, useRef, useState } from 'react';
import { scenarios } from '../fixtures/scenarios';
import { useAppStore } from './store';
import { ExportMenu } from './export-menu';

const ImportWizard = lazy(() => import('./import/wizard'));

export function TopBar() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const session = useAppStore((state) => state.session);
  const in3D = useAppStore((state) => state.viewMode === '3d');
  const busy = useAppStore((state) => state.busy);
  const { open, save, undo, redo } = useAppStore.getState();
  const city = session?.project.city;

  return (
    <header className="top-bar">
      <h1>{city?.name ?? 'CityFlows'}</h1>
      <div className="controls" role="group" aria-label="Project">
        <button onClick={() => picker.current?.showModal()} aria-haspopup="dialog" disabled={busy}>
          New
        </button>
        <button onClick={() => setImporting(true)} aria-haspopup="dialog" disabled={busy}>
          Import
        </button>
        <button onClick={() => input.current?.click()} disabled={busy}>
          Open
        </button>
        <input
          ref={input}
          type="file"
          accept=".cityflows,.zip,.json,application/zip,application/json"
          aria-label="Open project"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void open(file);
          }}
        />
        <button onClick={() => void save()} disabled={busy || !session}>
          Save
        </button>
        <div className="export-control">
          <button
            onClick={() => setExporting(!exporting)}
            disabled={busy || !session}
            aria-expanded={exporting}
            aria-controls="export-menu"
          >
            Export
          </button>
          {exporting && <ExportMenu onClose={() => setExporting(false)} />}
        </div>
      </div>
      <div className="controls" role="group" aria-label="Edit history">
        <button
          onClick={() => void undo()}
          disabled={
            (in3D && !session?.editor.canUndoDisplayOnly) || busy || !session?.editor.canUndo
          }
        >
          Undo
        </button>
        <button
          onClick={() => void redo()}
          disabled={
            (in3D && !session?.editor.canRedoDisplayOnly) || busy || !session?.editor.canRedo
          }
        >
          Redo
        </button>
      </div>
      {city?.geo && <small className="attribution">{city.geo.source.attribution}</small>}
      {importing && (
        <Suspense fallback={<p role="status">Loading import…</p>}>
          <ImportWizard onClose={() => setImporting(false)} />
        </Suspense>
      )}
      <dialog ref={picker} className="new-picker" aria-labelledby="new-title">
        <div className="sheet-heading">
          <h2 id="new-title">New city</h2>
          <button aria-label="Close New city" onClick={() => picker.current?.close()}>
            ×
          </button>
        </div>
        <ul className="scenario-list">
          {scenarios.map(({ id, name }) => (
            <li key={id}>
              <button
                onClick={() => {
                  picker.current?.close();
                  void open(id);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </header>
  );
}
