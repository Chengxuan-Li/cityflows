import { useEffect, useState } from 'react';
import { aircraftTypes } from '../../schema/aircraft';
import type { AircraftPoseSnapshot } from '../../sim/types';
import { Switch } from '../controls';
import { useAppStore } from '../store';

const states: Record<AircraftPoseSnapshot['state'], string> = {
  approach: 'On approach',
  flare: 'Landing',
  'landing-roll': 'Landing roll',
  'go-around': 'Going around',
  taxi: 'Taxiing',
  holding: 'Holding',
  'line-up': 'Lining up',
  'takeoff-roll': 'Take-off roll',
  rotation: 'Rotating',
  climb: 'Climbing out',
  parked: 'Parked',
  pushback: 'Pushback',
  tow: 'Under tow',
  'hover-taxi': 'Hover-taxiing',
  'vertical-climb': 'Lifting off',
  'helicopter-climb': 'Climbing out',
  'helicopter-approach': 'On approach',
  'vertical-descent': 'Landing',
};

const classes = {
  double_decker: 'Large double-decker',
  widebody: 'Widebody',
  narrowbody: 'Narrowbody',
  regional_jet: 'Regional jet',
  propeller: 'Propeller',
  private: 'Private',
  helicopter: 'Helicopter',
};

/** TASK-298: the selected aircraft, as the latest snapshot has it. */
export function AircraftInspector({ id }: { id: number }) {
  const session = useAppStore((s) => s.session);
  const timeS = useAppStore((s) => s.run?.timeS ?? 0);
  const following = useAppStore((s) => s.followAircraft === id);
  const setFollow = useAppStore((s) => s.setFollowAircraft);
  const [pose, setPose] = useState<AircraftPoseSnapshot | null | undefined>(undefined);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void session.engine.snapshot().then((snapshot) => {
      if (active) setPose(snapshot.aircraft?.find((a) => a.id === id) ?? null);
    });
    return () => {
      active = false;
    };
  }, [session, timeS, id]);
  const graph = session?.compiled.airside;
  if (!graph || pose === undefined) return null;
  if (pose === null)
    return (
      <section aria-label="Aircraft inspector">
        <h2>Aircraft</h2>
        <p>Left the area</p>
      </section>
    );
  const type = aircraftTypes.find((t) => t.id === pose.typeId)!;
  const stand = pose.stand ? graph.stands[graph.index.stand.get(pose.stand)!] : undefined;
  // The route by taxiway names, each once in turn.
  const refs = pose.route
    .map((e) => {
      const edge = graph.edges[e]!;
      return edge.kind === 'lead_in'
        ? null
        : edge.kind === 'runway'
          ? 'runway'
          : (edge.ref ?? null);
    })
    .filter((ref, i, all): ref is string => !!ref && ref !== all[i - 1]);
  return (
    <section aria-label="Aircraft inspector">
      <h2>{pose.registration}</h2>
      <dl className="details">
        <dt>Type</dt>
        <dd>
          {type.name}, {classes[type.class]}
        </dd>
        <dt>Status</dt>
        <dd>{states[pose.state]}</dd>
        {stand && (
          <>
            <dt>Stand</dt>
            <dd>{stand.ref ?? stand.id}</dd>
          </>
        )}
        {pose.runwayEnd && (
          <>
            <dt>Runway</dt>
            <dd>{pose.runwayEnd}</dd>
          </>
        )}
        <dt>Speed</dt>
        <dd>{Math.round(pose.speedMps * 1.944)} kt</dd>
        {pose.airborne && (
          <>
            <dt>Height</dt>
            <dd>{Math.round(pose.heightM)} m</dd>
          </>
        )}
        {refs.length > 0 && (
          <>
            <dt>Route</dt>
            <dd>{refs.join(', ')}</dd>
          </>
        )}
      </dl>
      <Switch
        label="Follow with camera"
        checked={following}
        onChange={(event) => setFollow(event.currentTarget.checked ? id : null)}
      />
    </section>
  );
}
