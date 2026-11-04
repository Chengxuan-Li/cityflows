import { useAppStore } from './store';

export function Toolbox() {
  const tool = useAppStore((state) => state.tool);
  const disabled = useAppStore((state) => state.busy || !state.session);
  return (
    <nav className="toolbox" aria-label="Toolbox">
      <button
        aria-pressed={tool === 'select'}
        title="Select map items · Escape clears selection"
        onClick={() => useAppStore.getState().setTool('select')}
      >
        Select
      </button>
      <button
        aria-pressed={tool === 'road'}
        disabled={disabled}
        title="Draw a street · Enter finishes · Escape cancels"
        onClick={() => useAppStore.getState().setTool('road')}
      >
        Road
      </button>
      <button
        aria-pressed={tool === 'ramp'}
        disabled={disabled}
        title="Connect roads with a ramp · Enter or second click builds · Escape cancels"
        onClick={() => useAppStore.getState().setTool('ramp')}
      >
        Ramp
      </button>
    </nav>
  );
}
