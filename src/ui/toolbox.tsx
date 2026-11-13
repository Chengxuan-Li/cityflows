import { SegmentedControl } from './controls';
import { useAppStore } from './store';

type Tool = ReturnType<typeof useAppStore.getState>['tool'];

const tools: { value: Tool; label: string; tooltip: string }[] = [
  { value: 'select', label: 'Select', tooltip: 'Select map items · Escape clears selection' },
  { value: 'road', label: 'Road', tooltip: 'Draw a street · Enter finishes · Escape cancels' },
  { value: 'place', label: 'Place', tooltip: 'Paint a place · Escape cancels' },
  {
    value: 'ramp',
    label: 'Ramp',
    tooltip: 'Connect roads with a ramp · Enter or second click builds · Escape cancels',
  },
  {
    value: 'roundabout',
    label: 'Roundabout',
    tooltip:
      'Drag from a junction to size a roundabout · Click its center to remove · Escape cancels',
  },
];

export function Toolbox() {
  const tool = useAppStore((state) => state.tool);
  const in3D = useAppStore((state) => state.viewMode === '3d');
  const disabled = useAppStore((state) => state.busy || !state.session || state.viewMode === '3d');
  // Below 660 px the segmented control gives way to this pop-up menu (app.css).
  const popup = (
    <select
      className="tool-popup"
      aria-label="Tool"
      value={tool}
      disabled={disabled}
      onChange={(event) => useAppStore.getState().setTool(event.currentTarget.value as Tool)}
    >
      {tools.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
  return (
    <>
      {popup}
      <SegmentedControl
        as="nav"
        label="Toolbox"
        options={
          in3D
            ? tools.map((option) => ({ ...option, tooltip: 'Editing is available in 2D' }))
            : tools
        }
        value={tool}
        disabled={disabled}
        onChange={(next) => useAppStore.getState().setTool(next)}
      />
    </>
  );
}
