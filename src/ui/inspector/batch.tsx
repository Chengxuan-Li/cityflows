import { useState } from 'react';
import { roadSchema, type City, type Command, type Road, type RoadClass } from '../../schema';
import { useAppStore } from '../store';

type Field = 'lanes' | 'speed' | 'roadClass' | 'direction';

export function BatchInspector({ city, roads }: { city: City; roads: Road[] }) {
  const busy = useAppStore((state) => state.busy);
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const allRoads = Object.values(city.roads);
  const opposite = (road: Road) =>
    road.streetGroupId === null
      ? undefined
      : allRoads.find(
          (other) => other.streetGroupId === road.streetGroupId && other.id !== road.id,
        );
  const common = (value: (road: Road) => string) => {
    const first = value(roads[0]!);
    return roads.every((road) => value(road) === first) ? first : '';
  };
  const initial = {
    lanes: common((road) => String(road.lanes.length)),
    speed: common((road) => String(Number((road.speedLimitMps * 3.6).toFixed(3)))),
    roadClass: common((road) => road.roadClass),
    direction: common((road) => (opposite(road) ? 'both' : 'one')),
  };
  const value = (field: Field) => draft[field] ?? initial[field];
  const change = (field: Field, next: string) => setDraft({ ...draft, [field]: next });

  function apply() {
    const commands: Command[] = [];
    // Direction changes can keep an unselected opposite carriageway. Apply the
    // staged attributes to that survivor too, before removing either direction.
    const targets = new Map(roads.map((road) => [road.id, road]));
    if (draft.direction === 'reverse') {
      for (const road of roads) {
        const reverse = opposite(road);
        if (reverse) targets.set(reverse.id, reverse);
      }
    }
    for (const road of targets.values()) {
      if (draft.speed || draft.roadClass)
        commands.push({
          kind: 'setRoadAttributes',
          roadId: road.id,
          ...(draft.speed && { speedLimitMps: Number(draft.speed) / 3.6 }),
          ...(draft.roadClass && { roadClass: draft.roadClass as RoadClass }),
        });
      if (draft.lanes)
        commands.push({
          kind: 'setRoadLanes',
          roadId: road.id,
          lanes: Array.from(
            { length: Number(draft.lanes) },
            (_, index) => road.lanes[index] ?? road.lanes.at(-1)!,
          ),
        });
    }
    if (draft.direction) {
      const groups = new Set<string>();
      for (const road of roads) {
        const { streetGroupId } = road;
        if (streetGroupId !== null) {
          if (groups.has(streetGroupId)) continue;
          groups.add(streetGroupId);
          const reverse = opposite(road);
          commands.push({
            kind: 'setStreetDirection',
            streetGroupId,
            direction:
              draft.direction === 'both'
                ? 'both'
                : draft.direction === 'reverse' && reverse
                  ? reverse.id
                  : road.id,
          });
          if (draft.direction === 'reverse' && !reverse)
            commands.push({ kind: 'reverseRoad', roadId: road.id });
        } else if (draft.direction === 'reverse')
          commands.push({ kind: 'reverseRoad', roadId: road.id });
      }
    }
    if (commands.length)
      void useAppStore
        .getState()
        .commit({ kind: 'batch', label: `Edit ${roads.length} streets`, commands });
  }

  return (
    <>
      <h2>{roads.length} streets selected</h2>
      <p className="muted">
        {roadSchema.shape.roadClass.options
          .flatMap((kind) => {
            const count = roads.filter((road) => road.roadClass === kind).length;
            return count ? [`${count} ${kind}`] : [];
          })
          .join(' · ')}
      </p>
      <form
        className="edit-fields"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="edit-field">
          Lanes per direction
          <input
            type="number"
            min={1}
            max={Math.max(64, ...roads.map((road) => road.lanes.length))}
            step={1}
            placeholder="Mixed"
            value={value('lanes')}
            onChange={(event) => change('lanes', event.currentTarget.value)}
          />
        </label>
        <label className="edit-field">
          Speed limit (km/h)
          <input
            type="number"
            min={0.1}
            step="any"
            placeholder="Mixed"
            value={value('speed')}
            onChange={(event) => change('speed', event.currentTarget.value)}
          />
        </label>
        <label className="edit-field">
          Road class
          <select
            value={value('roadClass')}
            onChange={(event) => change('roadClass', event.currentTarget.value)}
          >
            <option value="">{initial.roadClass ? 'Keep unchanged' : 'Mixed'}</option>
            {roadSchema.shape.roadClass.options.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="edit-field">
          Direction
          <select
            value={value('direction')}
            onChange={(event) => change('direction', event.currentTarget.value)}
          >
            <option value="">{initial.direction ? 'Keep unchanged' : 'Mixed'}</option>
            <option value="both" disabled={roads.some((road) => road.streetGroupId === null)}>
              Two-way
            </option>
            <option value="one">One-way (selected direction)</option>
            <option value="reverse">One-way (opposite direction)</option>
          </select>
        </label>
        {roads.some((road) => road.streetGroupId === null) && (
          <p className="muted">Two-way requires a paired street.</p>
        )}
        <p className="muted">
          When both directions are selected, the first selected road sets the direction.
        </p>
        <button type="submit" disabled={busy || !Object.values(draft).some(Boolean)}>
          Apply
        </button>
      </form>
    </>
  );
}
