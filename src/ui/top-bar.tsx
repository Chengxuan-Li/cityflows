import { useRef } from 'react';
import { scenarios } from '../fixtures/scenarios';
import { useAppStore } from './store';

export function TopBar() {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const session = useAppStore((state) => state.session);
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
      </div>
      <div className="controls" role="group" aria-label="Edit history">
        <button onClick={() => void undo()} disabled={busy || !session?.editor.canUndo}>
          Undo
        </button>
        <button onClick={() => void redo()} disabled={busy || !session?.editor.canRedo}>
          Redo
        </button>
      </div>
      {city?.geo && <small className="attribution">{city.geo.source.attribution}</small>}
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
