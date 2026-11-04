import { useEffect } from 'react';
import { Diagnostics } from './inspector/diagnostics';
import { NodeInspector } from './inspector/node';
import { PlaceInspector } from './inspector/place';
import { StreetInspector } from './inspector/street';
import { VehicleInspector } from './inspector/vehicle';
import { MapView } from './map-view';
import { RunBar } from './run-bar';
import { useAppStore } from './store';
import { Toolbox } from './toolbox';
import { TopBar } from './top-bar';

function Inspector() {
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
  if (!selection) {
    return (
      <>
        <h2>Inspector</h2>
        <p className="muted">Select an item on the map.</p>
      </>
    );
  }
  switch (selection.kind) {
    case 'vehicle':
      return <VehicleInspector id={selection.id} detail={vehicle} city={city} />;
    case 'lane':
      return (
        <StreetInspector
          road={city.roads[compiled.roads[selection.road]!.id]!}
          city={city}
          lane={compiled.lanes[selection.lane]!.lane}
        />
      );
    case 'node': {
      const node = compiled.nodes[selection.node]!;
      return <NodeInspector node={node} source={city.nodes[node.id]!} />;
    }
    case 'place':
      return <PlaceInspector place={city.places[compiled.places[selection.place]!.id]!} />;
    case 'connector': {
      const connector = compiled.connectors[selection.connector]!;
      return (
        <PlaceInspector
          place={city.places[compiled.places[connector.place]!.id]!}
          connectorId={connector.id}
        />
      );
    }
  }
}

export function App() {
  const error = useAppStore((state) => state.error);

  useEffect(() => {
    function clear(event: KeyboardEvent) {
      if (event.key === 'Escape') useAppStore.getState().select(null);
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
      <aside className="inspector" id="inspector" aria-label="Inspector">
        <Inspector />
      </aside>
      <RunBar />
    </div>
  );
}
