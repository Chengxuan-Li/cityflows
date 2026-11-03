import { useRef } from 'react';
import { useAppStore } from './store';

export function TopBar() {
  const input = useRef<HTMLInputElement>(null);
  const session = useAppStore((state) => state.session);
  const busy = useAppStore((state) => state.busy);
  const { open, save } = useAppStore.getState();
  const city = session?.project.city;

  return (
    <header className="top-bar">
      <h1>{city?.name ?? 'CityFlows'}</h1>
      <div className="controls" role="group" aria-label="Project">
        <button onClick={() => void open()} disabled={busy}>
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
        <button disabled>Undo</button>
        <button disabled>Redo</button>
      </div>
      {city?.geo && <small className="attribution">{city.geo.source.attribution}</small>}
    </header>
  );
}
