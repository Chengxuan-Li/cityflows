import { DisclosureGroup } from './controls';
import { groupDiagnostics } from './diagnostics';
import { useAppStore } from './store';

/** The left sidebar: the map and analysis panels, opened one at a time over the map. */
export function Sidebar() {
  const mode = useAppStore((state) => state.viewMode);
  const belowGround = useAppStore((state) => state.belowGround);
  const buildings = useAppStore((state) => state.buildings);
  const surroundings = useAppStore((state) => state.layers.context);
  const hasBuildings = useAppStore((state) =>
    state.session?.project.city.context?.features.some((f) => f.class === 'building'),
  );
  const run = useAppStore((state) => state.run);
  const busy = useAppStore((state) => state.busy);
  const diagnostics = useAppStore((state) =>
    state.session ? groupDiagnostics(state.session.diagnostics).issues.length : undefined,
  );
  const diagnosticsOpen = useAppStore((state) => state.diagnosticsOpen);
  const layersOpen = useAppStore((state) => state.layersOpen);
  const metricsOpen = useAppStore((state) => state.metricsOpen);
  const demandOpen = useAppStore((state) => state.demandOpen);
  const compareOpen = useAppStore((state) => state.compareOpen);
  const showCompare = compareOpen && !layersOpen && !metricsOpen && !demandOpen;
  const { toggleCompare, toggleLayers, toggleMetrics, toggleDemand, toggleDiagnostics } =
    useAppStore.getState();
  const disabled = !run || busy;

  return (
    <nav id="sidebar" className="sidebar" aria-label="Sidebar">
      <DisclosureGroup title="Map">
        <button
          className="source-row"
          disabled={!run}
          aria-expanded={layersOpen}
          aria-controls="layers"
          onClick={toggleLayers}
        >
          Layers
        </button>
        {mode === '3d' && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={belowGround}
              onChange={() => useAppStore.getState().toggleBelowGround()}
            />
            See below ground
          </label>
        )}
        {mode === '3d' && hasBuildings && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={buildings}
              disabled={!surroundings}
              onChange={() => useAppStore.getState().toggleBuildings()}
            />
            Buildings
          </label>
        )}
      </DisclosureGroup>
      <DisclosureGroup title="Analysis">
        <button
          className="source-row"
          disabled={disabled}
          aria-expanded={metricsOpen}
          aria-controls="metrics-chart"
          onClick={toggleMetrics}
        >
          Chart
        </button>
        <button
          className="source-row"
          disabled={disabled}
          aria-expanded={demandOpen}
          aria-controls="demand"
          onClick={toggleDemand}
        >
          Demand
        </button>
        <button
          className="source-row"
          disabled={!run}
          aria-expanded={showCompare}
          aria-controls="compare"
          onClick={toggleCompare}
        >
          Compare
        </button>
        <button
          className="source-row"
          disabled={diagnostics === undefined}
          aria-expanded={diagnosticsOpen}
          aria-controls={diagnosticsOpen ? 'diagnostics' : undefined}
          aria-label={`Validation (${diagnostics ?? 0})`}
          onClick={toggleDiagnostics}
        >
          Validation
          <span className="row-count" aria-hidden="true">
            {diagnostics ?? 0}
          </span>
        </button>
      </DisclosureGroup>
    </nav>
  );
}
