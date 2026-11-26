import { nearestOnPolyline, polylineLength } from '../../geo/polyline';
import { aircraftCodes, type AircraftCode } from '../../schema/aircraft';
import { standKinds, type StandKind } from '../../schema/airport';
import { useFlightBoard } from '../flight-board-data';
import { useAppStore } from '../store';
import { standKindLabels } from '../tools/airside';
import { NumberField } from './number-field';
import { TextField } from './place';

// TASK-305: the stand, taxiway and holding position inspectors, which edit them.

type CodeChoice = AircraftCode | 'none' | 'rule';

/** The aircraft code limit: by rule (TASK-295's derivation, kept up to date by edits) or set. */
function CodeField({
  code,
  inferred,
  onChange,
}: {
  code: AircraftCode | null;
  inferred: boolean;
  onChange: (code: AircraftCode | null | 'rule') => void;
}) {
  return (
    <label className="edit-field">
      Code limit
      <select
        value={inferred ? 'rule' : (code ?? 'none')}
        onChange={(event) => {
          const value = event.currentTarget.value as CodeChoice;
          onChange(value === 'none' ? null : value);
        }}
      >
        <option value="rule">By rule{inferred ? ` (${code ?? 'none'})` : ''}</option>
        {aircraftCodes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="none">None</option>
      </select>
    </label>
  );
}

function useEditing() {
  const viewMode = useAppStore((state) => state.viewMode);
  const busy = useAppStore((state) => state.busy);
  return { disabled: viewMode === '3d' || busy, in3D: viewMode === '3d' };
}

export function StandInspector({ index }: { index: number }) {
  const compiled = useAppStore((s) => s.session?.compiled.airside?.stands[index]);
  const stand = useAppStore(
    (s) => compiled && s.session?.project.city.airport?.stands[compiled.id],
  );
  // The flight board counts stands as the loaded run has them.
  const loaded = useAppStore((s) =>
    compiled ? s.session?.loadedCompiled.airside?.index.stand.get(compiled.id) : undefined,
  );
  const board = useFlightBoard();
  const occupancy = loaded === undefined ? undefined : board?.stands[loaded];
  const { disabled, in3D } = useEditing();
  const { commit } = useAppStore.getState();
  if (!compiled || !stand) return null;
  const set = (change: {
    standKind?: StandKind;
    ref?: string | null;
    maxCode?: AircraftCode | null | 'rule';
  }) => void commit({ kind: 'setStand', standId: stand.id, ...change });
  return (
    <section aria-label="Stand inspector">
      <h2>Stand {stand.ref ?? stand.id}</h2>
      <dl className="details">
        <dt>Occupancy</dt>
        <dd>
          {occupancy?.occupiedBy ??
            (occupancy?.reservedFor
              ? `Reserved for ${occupancy.reservedFor}`
              : occupancy
                ? 'Free'
                : '—')}
        </dd>
      </dl>
      <fieldset className="edit-fields" disabled={disabled}>
        <TextField
          label="Stand"
          value={stand.ref ?? ''}
          required={false}
          onCommit={(ref) => set({ ref: ref.trim() || null })}
        />
        <label className="edit-field">
          Kind
          <select
            value={stand.kind}
            onChange={(event) => set({ standKind: event.currentTarget.value as StandKind })}
          >
            {standKinds.map((kind) => (
              <option key={kind} value={kind}>
                {standKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <CodeField
          code={stand.maxCode}
          inferred={stand.provenance.inferred?.includes('maxCode') ?? false}
          onChange={(maxCode) => set({ maxCode })}
        />
      </fieldset>
      <button
        disabled={disabled}
        onClick={() => void commit({ kind: 'deleteStand', standId: stand.id })}
      >
        Delete stand
      </button>
      <p className="muted">{in3D ? 'Edit stands in 2D.' : 'Drag the stand to move it.'}</p>
    </section>
  );
}

export function TaxiwayInspector({ index }: { index: number }) {
  const compiled = useAppStore((s) => s.session?.compiled.airside?.edges[index]);
  const edge = useAppStore((s) => compiled && s.session?.project.city.airport?.edges[compiled.id]);
  const point = useAppStore((s) => s.selectionPoint);
  const { disabled, in3D } = useEditing();
  const { commit } = useAppStore.getState();
  if (!compiled || !edge) return null;
  const set = (change: {
    edgeKind?: 'taxiway' | 'taxilane';
    ref?: string | null;
    widthM?: number | null;
    maxCode?: AircraftCode | null | 'rule';
  }) => void commit({ kind: 'setTaxiway', edgeId: edge.id, ...change });
  const name = edge.kind === 'taxilane' ? 'Taxilane' : 'Taxiway';
  const lengthM = polylineLength(edge.line);
  const splitAt = point ? nearestOnPolyline(edge.line, point).along : lengthM / 2;
  const widthInferred = edge.provenance.inferred?.includes('widthM') ?? false;
  return (
    <section aria-label="Taxiway inspector">
      <h2>
        {name} {edge.ref ?? ''}
      </h2>
      <dl className="details">
        <dt>Length</dt>
        <dd>{Math.round(lengthM)} m</dd>
      </dl>
      <fieldset className="edit-fields" disabled={disabled}>
        <TextField
          label="Name"
          value={edge.ref ?? ''}
          required={false}
          onCommit={(ref) => set({ ref: ref.trim() || null })}
        />
        <label className="edit-field">
          Kind
          <select
            value={edge.kind}
            onChange={(event) =>
              set({ edgeKind: event.currentTarget.value as 'taxiway' | 'taxilane' })
            }
          >
            <option value="taxiway">Taxiway</option>
            <option value="taxilane">Taxilane</option>
          </select>
        </label>
        <NumberField
          label="Width (m)"
          value={widthInferred ? null : edge.widthM}
          nullable
          placeholder={`By code (${edge.widthM})`}
          min={3}
          max={80}
          step={0.5}
          onCommit={(widthM) => set({ widthM })}
        />
        <CodeField
          code={edge.maxCode}
          inferred={edge.provenance.inferred?.includes('maxCode') ?? false}
          onChange={(maxCode) => set({ maxCode })}
        />
      </fieldset>
      <div className="controls">
        <button
          disabled={disabled || splitAt < 1 || splitAt > lengthM - 1}
          onClick={() => void commit({ kind: 'splitTaxiway', edgeId: edge.id, atM: splitAt })}
        >
          Split here
        </button>
        <button
          disabled={disabled}
          onClick={() => void commit({ kind: 'deleteTaxiway', edgeId: edge.id })}
        >
          Delete {name.toLowerCase()}
        </button>
      </div>
      {in3D && <p className="muted">Edit taxiways in 2D.</p>}
    </section>
  );
}

export function HoldInspector({ index }: { index: number }) {
  const compiled = useAppStore((s) => s.session?.compiled.airside?.holds[index]);
  const airport = useAppStore((s) => s.session?.project.city.airport);
  const { disabled, in3D } = useEditing();
  const { commit } = useAppStore.getState();
  const hold = compiled && airport?.holdingPositions[compiled.id];
  if (!hold || !airport) return null;
  const runways = Object.values(airport.runways);
  return (
    <section aria-label="Holding position inspector">
      <h2>Holding position {hold.ref ?? ''}</h2>
      <dl className="details">
        <dt>Kind</dt>
        <dd>{hold.kind === 'runway' ? 'Runway hold' : 'Intermediate'}</dd>
        {hold.side && (
          <>
            <dt>Side</dt>
            <dd className="capitalize">{hold.side}</dd>
          </>
        )}
      </dl>
      <fieldset className="edit-fields" disabled={disabled}>
        <TextField
          label="Name"
          value={hold.ref ?? ''}
          required={false}
          onCommit={(ref) =>
            void commit({ kind: 'setHold', holdId: hold.id, ref: ref.trim() || null })
          }
        />
        <label className="edit-field">
          Protects
          <select
            value={hold.runway ?? ''}
            onChange={(event) =>
              void commit({
                kind: 'setHold',
                holdId: hold.id,
                runway: event.currentTarget.value || null,
              })
            }
          >
            {runways.map((runway) => (
              <option key={runway.id} value={runway.id}>
                Runway {runway.ref}
              </option>
            ))}
            <option value="">No runway</option>
          </select>
        </label>
      </fieldset>
      <button
        disabled={disabled}
        onClick={() => void commit({ kind: 'deleteHold', holdId: hold.id })}
      >
        Delete holding position
      </button>
      <p className="muted">
        {in3D ? 'Edit holding positions in 2D.' : 'Drag it along the taxiway to move it.'}
      </p>
    </section>
  );
}
