import { useAppStore } from './store';

export function Toolbox() {
  return (
    <nav className="toolbox" aria-label="Toolbox">
      <button
        aria-pressed="true"
        title="Select map items · Escape clears selection"
        onClick={() => useAppStore.getState().select(null)}
      >
        Select
      </button>
    </nav>
  );
}
