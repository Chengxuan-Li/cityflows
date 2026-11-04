import { useEffect } from 'react';
import { Diagnostics } from './inspector/diagnostics';
import { NodeInspector } from './inspector/node';
import { PlaceInspector } from './inspector/place';
import { StreetInspector } from './inspector/street';
import { BatchInspector } from './inspector/batch';
import { VehicleInspector } from './inspector/vehicle';
import { MapView } from './map-view';
import { RunBar } from './run-bar';
import { useAppStore } from './store';
import { Toolbox } from './toolbox';
import { TopBar } from './top-bar';
import { NodeTopologyActions } from './tools/topology-actions';

function Inspector() {
  const selectedRoads = useAppStore((state) => state.selectedRoads);
  const session = useAppStore((state) => state.session);
  const selection = useAppStore((state) => state.selection);
  const vehicle = useAppStore((state) => state.vehicle);
  const diagnosticsOpen = useAppStore((state) => state.diagnosticsOpen);
  const timeS = useAppStore((state) => (state.diagnosticsOpen ? state.run?.timeS : undefined));

  if (!session) return null;
  const {
    project: { city },
    compiled,
    engine,
    diagnostics,
  } = session;
  if (diagnosticsOpen && timeS !== undefined) {
    return <Diagnostics diagnostics={diagnostics} engine={engine} timeS={timeS} />;
  }
  if (selectedRoads.length >= 2)
    return (
      <BatchInspector
        key={`${city.version}:${selectedRoads.join(',')}`}
        city={city}
        roads={selectedRoads.map((id) => city.roads[id]!)}
      />
    );
  if (!selection) return null;
  switch (selection.kind) {
    case 'vehicle':
      return <VehicleInspector id={selection.id} detail={vehicle} city={city} />;
    case 'lane':
      return (
        <StreetInspector
          key={compiled.roads[selection.road]!.id}
          road={city.roads[compiled.roads[selection.road]!.id]!}
          city={city}
          lane={compiled.lanes[selection.lane]!.lane}
        />
      );
    case 'node': {
      const node = compiled.nodes[selection.node]!;
      return (
        <NodeInspector
          key={node.id}
          node={node}
          source={city.nodes[node.id]!}
          compiled={compiled}
        />
      );
    }
    case 'place':
      return (
        <PlaceInspector
          key={compiled.places[selection.place]!.id}
          place={city.places[compiled.places[selection.place]!.id]!}
        />
      );
    case 'connector': {
      const connector = compiled.connectors[selection.connector]!;
      return (
        <PlaceInspector
          key={compiled.places[connector.place]!.id}
          place={city.places[compiled.places[connector.place]!.id]!}
          connectorId={connector.id}
        />
      );
    }
  }
}

export function App() {
  useEffect(() => {
    if (window.cityflows) {
      window.cityflows.city = () => useAppStore.getState().session!.project.city;
      window.cityflows.commit = (command) => useAppStore.getState().commit(command);
    }
  }, []);
  const error = useAppStore((state) => state.error);
  const rejectedEdit = useAppStore((state) => state.rejectedEdit);
  const selection = useAppStore((state) => state.selection);
  const diagnosticsOpen = useAppStore((state) => state.diagnosticsOpen);

  function closeSheet() {
    const { diagnosticsOpen, toggleDiagnostics, select } = useAppStore.getState();
    if (diagnosticsOpen) toggleDiagnostics();
    else select(null);
  }

  useEffect(() => {
    function clear(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeSheet();
    }
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <Toolbox />
      <main className="map-view" aria-label="Map">
        <MapView />
        {error && (
          <div className="map-error" role="alert">
            {error}
          </div>
        )}
      </main>
      {(selection || diagnosticsOpen) && (
        <aside
          className="inspector"
          id={diagnosticsOpen ? 'diagnostics' : 'inspector'}
          aria-label="Inspector"
        >
          <button className="close-sheet" aria-label="Close inspector" onClick={closeSheet}>
            ×
          </button>
          <Inspector />
          {!diagnosticsOpen && <NodeTopologyActions />}
          {!diagnosticsOpen && rejectedEdit.length > 0 && (
            <div className="edit-diagnostics" role="alert">
              <strong>Edit rejected</strong>
              <ul>
                {rejectedEdit
                  .filter(({ severity }) => severity === 'error')
                  .map(({ message }, index) => (
                    <li key={index}>{message}</li>
                  ))}
              </ul>
            </div>
          )}
        </aside>
      )}
      <RunBar />
    </div>
  );
}
