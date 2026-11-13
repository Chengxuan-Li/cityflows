import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { cachedExtract } from '../../importers/cache';
import { areaError, defaultEndpoint, fetchOverpass, type Bbox } from '../../importers/overpass';
import type { ImportResult } from '../../importers/types';
import type { ImportMessage } from '../../importers/worker';
import { defaultScenario } from '../../fixtures/scenarios';
import { CloseButton } from '../controls';
import { useAppStore } from '../store';
import { DiagnosticsStep } from './diagnostics-step';

const AreaPicker = lazy(() => import('./area-picker').then((m) => ({ default: m.AreaPicker })));
type Step = 'source' | 'area' | 'options' | 'progress' | 'diagnostics' | 'accept';

export default function ImportWizard({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef<AbortController | null>(null);
  const worker = useRef<Worker | null>(null);
  const [step, setStep] = useState<Step>('source');
  const [file, setFile] = useState<File | null>(null);
  const [bbox, setBbox] = useState<Bbox>([-74.008, 40.711, -74.004, 40.715]);
  const [endpoint, setEndpoint] = useState(
    () => localStorage.getItem('cityflows-overpass-endpoint') ?? defaultEndpoint,
  );
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [surroundings, setSurroundings] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [name, setName] = useState('OpenStreetMap import');
  // The largest 0.05 step at which the Munich reference extract does not gridlock (plan,
  // "Reference extract and import baseline", wave 10 table).
  const [demandScale, setDemandScale] = useState(0.15);
  const [progress, setProgress] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const homes = result?.ok
    ? Object.values(result.city.places).filter(
        (place) => place.kind === 'residential' || place.kind === 'gateway',
      )
    : [];
  const residents = homes.reduce((sum, place) => sum + place.population, 0);
  const persons = homes.reduce((sum, place) => sum + Math.round(place.population * demandScale), 0);
  const busy = useAppStore((s) => s.busy);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      operation.current?.abort();
      worker.current?.terminate();
    };
  }, []);

  async function runImport() {
    const controller = new AbortController();
    operation.current = controller;
    setError('');
    setStep('progress');
    setProgress(file ? 'Reading file…' : 'Checking saved area…');
    try {
      let xml: string;
      if (file) {
        xml = await file.text();
        setSourceNote(file.name);
      } else {
        const invalid = areaError(bbox);
        if (invalid) throw new Error(invalid);
        localStorage.setItem('cityflows-overpass-endpoint', endpoint);
        const cached = surroundings ? await cachedExtract(bbox) : undefined;
        controller.signal.throwIfAborted();
        if (cached !== undefined) {
          xml = cached;
          setSourceNote('Loaded from cache');
        } else {
          setProgress('Downloading roads…');
          xml = await fetchOverpass(bbox, controller.signal, endpoint, surroundings);
          setSourceNote('Downloaded from Overpass');
        }
      }
      controller.signal.throwIfAborted();
      const parser = new Worker(new URL('../../importers/worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = parser;
      parser.onerror = () => {
        parser.terminate();
        setError('Import worker failed. Try another extract.');
        setStep('options');
      };
      parser.onmessage = async (event: MessageEvent<ImportMessage>) => {
        if (controller.signal.aborted) return;
        if (event.data.type === 'progress') {
          setProgress(event.data.message);
          return;
        }
        parser.terminate();
        worker.current = null;
        const imported = event.data.result;
        if (imported.ok && !file && surroundings) {
          try {
            await cachedExtract(bbox, xml);
          } catch {
            setError('Could not save this area to the browser cache.');
          }
        }
        if (controller.signal.aborted) return;
        setResult(imported);
        setStep('diagnostics');
      };
      parser.postMessage({
        xml,
        options: {
          importerVersion: '1',
          drivingSide: side,
          context: surroundings,
          terrain,
          ...(!file && { bbox }),
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : String(error));
      setStep('options');
    }
  }

  async function accept() {
    if (!result?.ok) return;
    const scenario = defaultScenario('grid5x5');
    scenario.id = 'import';
    scenario.name = name.trim();
    scenario.demand.personsPerResident = demandScale;
    await useAppStore
      .getState()
      .loadProject({ city: { ...result.city, name: name.trim() }, scenarios: [scenario] });
    const failure = useAppStore.getState().error;
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="sheet import-wizard"
      aria-labelledby="import-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="sheet-heading">
        <h2 id="import-title">Import city</h2>
        <CloseButton label="Close Import city" disabled={busy} onClick={onClose} />
      </div>
      <p className="muted">
        {step === 'progress' ? 'Importing' : step[0]!.toUpperCase() + step.slice(1)}
      </p>
      {step === 'source' && (
        <div className="edit-fields">
          <button
            onClick={() => {
              setFile(null);
              setStep('area');
            }}
          >
            Choose map area
          </button>
          <label className="edit-field">
            OSM file
            <input
              type="file"
              accept=".osm,application/xml,text/xml"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) {
                  setFile(selected);
                  setStep('options');
                }
              }}
            />
          </label>
        </div>
      )}
      {step === 'area' && (
        <>
          <Suspense fallback={<p role="status">Loading map…</p>}>
            <AreaPicker bbox={bbox} onChange={setBbox} />
          </Suspense>
          <div className="controls">
            <button onClick={() => setStep('source')}>Back</button>
            <button
              className="primary"
              disabled={!!areaError(bbox)}
              onClick={() => setStep('options')}
            >
              Next
            </button>
          </div>
        </>
      )}
      {step === 'options' && (
        <>
          <div className="edit-fields">
            <label className="edit-field">
              City name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="edit-field">
              Driving side
              <select
                value={side}
                onChange={(event) => setSide(event.target.value as 'left' | 'right')}
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={surroundings}
                onChange={(event) => setSurroundings(event.target.checked)}
              />
              Include surroundings
            </label>
            <label>
              <input
                type="checkbox"
                checked={terrain}
                onChange={(event) => setTerrain(event.target.checked)}
              />
              Include terrain
            </label>
            {!file && (
              <label className="edit-field">
                Overpass endpoint
                <input
                  type="url"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>
            )}
          </div>
          <p>Set population and jobs on places after import to generate synthetic traffic.</p>
          <div className="controls">
            <button onClick={() => setStep(file ? 'source' : 'area')}>Back</button>
            <button
              className="primary"
              disabled={!name.trim() || (!file && !!areaError(bbox))}
              onClick={() => void runImport()}
            >
              Import roads
            </button>
          </div>
        </>
      )}
      {step === 'progress' && (
        <>
          <p role="status">{progress}</p>
          <progress aria-label="Import progress" />
          <button onClick={onClose}>Cancel import</button>
        </>
      )}
      {step === 'diagnostics' && result && (
        <>
          <p>{sourceNote}</p>
          <DiagnosticsStep result={result} />
          <div className="controls">
            <button onClick={() => setStep('options')}>Back</button>
            <button
              className="primary"
              disabled={!result.ok || result.diagnostics.some((d) => d.severity === 'error')}
              onClick={() => setStep('accept')}
            >
              Continue
            </button>
          </div>
        </>
      )}
      {step === 'accept' && result?.ok && (
        <>
          <p>
            {name} · {Object.keys(result.city.roads).length} roads
          </p>
          <p>{result.city.geo?.source.attribution}</p>
          <div className="edit-fields">
            <label className="edit-field">
              Demand
              <input
                id="import-demand"
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={demandScale}
                disabled={busy}
                aria-describedby="import-demand-persons"
                onChange={(event) => setDemandScale(event.target.valueAsNumber)}
              />
            </label>
            <output id="import-demand-persons" htmlFor="import-demand" aria-label="Demand persons">
              {residents.toLocaleString()} residents × {demandScale} = {persons.toLocaleString()}{' '}
              persons
            </output>
          </div>
          <p>The current city will be replaced. Save any changes you want to keep first.</p>
          <div className="controls">
            <button disabled={busy} onClick={() => setStep('diagnostics')}>
              Back
            </button>
            <button className="primary" disabled={busy} onClick={() => void accept()}>
              Accept city
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
