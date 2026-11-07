import { useAppStore } from './store';

export function Toolbox() {
  const tool = useAppStore((state) => state.tool);
  const in3D = useAppStore((state) => state.viewMode === '3d');
  const disabled = useAppStore((state) => state.busy || !state.session || state.viewMode === '3d');
  return (
    <nav className="toolbox" aria-label="Toolbox">
      <button
        disabled={disabled}
        aria-pressed={tool === 'select'}
        title={in3D ? 'Editing is available in 2D' : 'Select map items · Escape clears selection'}
        onClick={() => useAppStore.getState().setTool('select')}
      >
        Select
      </button>
      <button
        aria-pressed={tool === 'road'}
        disabled={disabled}
        title={
          in3D ? 'Editing is available in 2D' : 'Draw a street · Enter finishes · Escape cancels'
        }
        onClick={() => useAppStore.getState().setTool('road')}
      >
        Road
      </button>
      <button
        aria-pressed={tool === 'place'}
        disabled={disabled}
        title={in3D ? 'Editing is available in 2D' : 'Paint a place · Escape cancels'}
        onClick={() => useAppStore.getState().setTool('place')}
      >
        Place
      </button>
      <button
        aria-pressed={tool === 'ramp'}
        disabled={disabled}
        title={
          in3D
            ? 'Editing is available in 2D'
            : 'Connect roads with a ramp · Enter or second click builds · Escape cancels'
        }
        onClick={() => useAppStore.getState().setTool('ramp')}
      >
        Ramp
      </button>
      <button
        aria-pressed={tool === 'roundabout'}
        disabled={disabled}
        title={
          in3D
            ? 'Editing is available in 2D'
            : 'Drag from a junction to size a roundabout / Click its center to remove / Escape cancels'
        }
        onClick={() => useAppStore.getState().setTool('roundabout')}
      >
        Roundabout
      </button>
    </nav>
  );
}
