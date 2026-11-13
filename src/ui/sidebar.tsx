import { DisclosureGroup } from './controls';
import { groupDiagnostics } from './diagnostics';
import { Diagnostics } from './inspector/diagnostics';
import { Layers } from './layers';
import { ComparePanel } from './panels/compare';
import { DemandPanel } from './panels/demand';
import { MetricsPanel } from './panels/metrics';
import { useAppStore } from './store';
import { PlaceOptions } from './tools/place-options';
import { RoadOptions } from './tools/road-options';

const toolTitles = { road: 'Road', place: 'Place', ramp: 'Ramp', roundabout: 'Roundabout' };

function ToolOptions() {
  const tool = useAppStore((state) => state.tool);
  const roadOptions = useAppStore((state) => state.roadOptions);
  const placeKind = useAppStore((state) => state.placeKind);
  const placeHint = useAppStore((state) => state.placeHint);
  if (tool === 'select') return null;
  return (
    <DisclosureGroup title={`${toolTitles[tool]} tool`}>
      {tool === 'road' && (
        <RoadOptions
          value={roadOptions}
          onChange={(roadOptions) => useAppStore.setState({ roadOptions })}
        />
      )}
      {tool === 'place' && (
        <PlaceOptions
          value={placeKind}
          onChange={(placeKind) => useAppStore.setState({ placeKind })}
          hint={placeHint}
        />
      )}
      {tool === 'ramp' && (
        <p className="muted tool-help">
          Pick a start road, then an end road · Enter or click to build · Esc cancels
        </p>
      )}
      {tool === 'roundabout' && (
        <p className="muted tool-help">
          Drag from a junction to size a roundabout · Click its center to remove · Esc cancels
        </p>
      )}
    </DisclosureGroup>
  );
}

function Validation() {
  const session = useAppStore((state) => state.session);
  const timeS = useAppStore((state) => state.run?.timeS);
  if (!session || timeS === undefined) return null;
  return <Diagnostics diagnostics={session.diagnostics} engine={session.engine} timeS={timeS} />;
}

/** The left sidebar: tool options and the map and analysis panels, each a collapsible section. */
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
  const { toggleCompare, toggleLayers, toggleMetrics, toggleDemand, toggleDiagnostics } =
    useAppStore.getState();
  const disabled = !run || busy;

  return (
    <nav id="sidebar" className="sidebar" aria-label="Sidebar">
      <ToolOptions />
      {mode === '3d' && (
        <DisclosureGroup title="3D view">
          <label className="check-row">
            <input
              type="checkbox"
              checked={belowGround}
              onChange={() => useAppStore.getState().toggleBelowGround()}
            />
            See below ground
          </label>
          {hasBuildings && (
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
      )}
      <DisclosureGroup
        title="Layers"
        open={layersOpen}
        onToggle={toggleLayers}
        controls="layers"
        disabled={!run}
      >
        <Layers />
      </DisclosureGroup>
      <DisclosureGroup
        title="Chart"
        open={metricsOpen}
        onToggle={toggleMetrics}
        controls="metrics-chart"
        disabled={disabled}
      >
        <MetricsPanel />
      </DisclosureGroup>
      <DisclosureGroup
        title="Demand"
        open={demandOpen}
        onToggle={toggleDemand}
        controls="demand"
        disabled={disabled}
      >
        <DemandPanel />
      </DisclosureGroup>
      <DisclosureGroup
        title="Compare"
        open={compareOpen}
        onToggle={toggleCompare}
        controls="compare"
        disabled={!run}
      >
        <ComparePanel />
      </DisclosureGroup>
      <DisclosureGroup
        title="Validation"
        label={`Validation (${diagnostics ?? 0})`}
        count={diagnostics ?? 0}
        open={diagnosticsOpen}
        onToggle={toggleDiagnostics}
        controls="diagnostics"
        disabled={diagnostics === undefined}
      >
        <Validation />
      </DisclosureGroup>
    </nav>
  );
}
