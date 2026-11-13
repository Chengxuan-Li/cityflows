import { useEffect } from 'react';
import { NodeInspector } from './inspector/node';
import { PlaceInspector } from './inspector/place';
import { RailInspector, TrainInspector } from './inspector/rail';
import { ParkingInspector, ParkedSpaceInspector } from './inspector/parking';
import { StreetInspector } from './inspector/street';
import { BatchInspector } from './inspector/batch';
import { VehicleInspector } from './inspector/vehicle';
import { WalkerInspector } from './inspector/walker';
import { PersonInspector } from './inspector/person';
import { CloseButton } from './controls';
import { MapView } from './map-view';
import { Onboarding, ShowHints } from './onboarding';
import { StatusBar } from './run-bar';
import { Sidebar } from './sidebar';
import { useAppStore } from './store';
import { TopBar } from './top-bar';
import { NodeTopologyActions } from './tools/topology-actions';

function Inspector() {
  const selectedRoads = useAppStore((state) => state.selectedRoads);
  const session = useAppStore((state) => state.session);
  const selection = useAppStore((state) => state.selection);
  const vehicle = useAppStore((state) => state.vehicle);
  const walker = useAppStore((state) => state.walker);
  const personId = useAppStore((state) => state.personId);
  const person = useAppStore((state) => state.person);

  if (!session) return null;
  const {
    project: { city },
    compiled,
  } = session;
  if (selectedRoads.length >= 2)
    return (
      <BatchInspector
        key={`${city.version}:${selectedRoads.join(',')}`}
        city={city}
        roads={selectedRoads.map((id) => city.roads[id]!)}
      />
    );
  if (!selection) return null;
  if (personId)
    return <PersonInspector id={personId} detail={person} city={city} compiled={compiled} />;
  switch (selection.kind) {
    case 'train':
      return <TrainInspector id={selection.id} route={selection.route} />;
    case 'track':
      return <RailInspector kind="track" index={selection.track} />;
    case 'platform':
      return <RailInspector kind="platform" index={selection.platform} />;
    case 'parked':
      return <ParkedSpaceInspector space={selection.space} />;
    case 'parking':
      return <ParkingInspector facility={compiled.parking[selection.parking]!} />;
    case 'vehicle':
      return <VehicleInspector id={selection.id} detail={vehicle} city={city} />;
    case 'walker':
      return <WalkerInspector id={selection.id} detail={walker} city={city} />;
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
      if (
        connector.parking !== undefined &&
        !compiled.parking[connector.parking]!.source.provenance.inferred?.includes('implicitGarage')
      )
        return <ParkingInspector facility={compiled.parking[connector.parking]!} />;
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
      window.cityflows.snapshot = () => useAppStore.getState().session!.engine.snapshot();
      window.cityflows.inspectWalker = (id) =>
        useAppStore.getState().session!.engine.inspectWalker(id);
      window.cityflows.inspectPerson = (id) =>
        useAppStore.getState().session!.engine.inspectPerson(id);
      window.cityflows.setWalkers = async (walkers) => {
        const { setTestWalkers, control } = useAppStore.getState();
        await setTestWalkers(walkers);
        await control('restart');
      };
    }
  }, []);
  const error = useAppStore((state) => state.error);
  const rejectedEdit = useAppStore((state) => state.rejectedEdit);
  const selection = useAppStore((state) => state.selection);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const inspectorOpen = useAppStore((state) => state.inspectorOpen);

  useEffect(() => {
    function clear(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open], :popover-open'))
        useAppStore.getState().select(null);
    }
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, []);

  return (
    <div className="app">
      <TopBar />
      {sidebarOpen && <Sidebar />}
      <main className="map-view" aria-label="Map">
        <MapView />
        {error && (
          <div className="map-error" role="alert">
            {error}
          </div>
        )}
      </main>
      {inspectorOpen && (
        <div id="inspector-column" className="inspector-column">
          {selection ? (
            <aside className="inspector" id="inspector" aria-label="Inspector">
              <CloseButton
                label="Close inspector"
                className="close-sheet"
                onClick={() => useAppStore.getState().select(null)}
              />
              <Inspector />
              <NodeTopologyActions />
              {rejectedEdit.length > 0 && (
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
          ) : (
            <div className="no-selection">
              <p>No selection</p>
              <ShowHints />
            </div>
          )}
        </div>
      )}
      <StatusBar />
      <Onboarding />
    </div>
  );
}
