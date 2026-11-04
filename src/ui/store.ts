import { create } from 'zustand';
import { version } from '../../package.json';
import { exportGeoJson } from '../project/geojson';
import { exportTripsCsv, exportRoadMetricsCsv, exportTrajectoriesCsv } from '../project/export-csv';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import type { Vec2 } from '../geo/vec2';
import { demandSummary, generatePopulation, scheduleTrips, type DemandSummary } from '../demand';
import { createEditor, type CommitResult, type Editor } from '../editor';
import { createEngineClient, type EngineClient } from '../host/client';
import type { HostEvent } from '../host/protocol';
import { compile, type CompiledCity, type Diagnostic } from '../network';
import { openProject } from '../project/open';
import { saveProject } from '../project/save';
import type { Project } from '../project/types';
import type { Pick as MapPick } from '../render/types';
import { defaultLayers, type LayerVisibility } from '../render/types';
import { placeHue } from '../render/style';
import type { Command, Person } from '../schema';
import type { RoadId } from '../schema';
import type { Metrics, VehicleDetail } from '../sim/types';
import { bundledProject } from './bundled-projects';
import { selectionAfterEdit } from './edit-selection';
import { comparisonTrips, restoreBaseline, saveBaseline, type Variant } from '../project/scenarios';
import type { HeadlessResult } from '../host/protocol';
import type { RoadDifference } from '../render/types';

export interface Comparison {
  baseline: HeadlessResult;
  variant: HeadlessResult;
  reference: Variant;
  roads: RoadDifference[];
}

function demandKey(city: Project['city']) {
  return JSON.stringify(
    Object.values(city.places)
      .map(({ id, kind, population, jobs }) => [id, kind, population, jobs])
      .sort(),
  );
}

export interface Session {
  project: Project & { population: Person[] };
  editor: Editor;
  compiled: CompiledCity;
  loadedCompiled: CompiledCity;
  diagnostics: Diagnostic[];
  engine: EngineClient;
  vehicleHues: Uint32Array;
  /** Place demographics the population was generated from; restart regenerates when they change. */
  populationKey: string;
  demandSummary: DemandSummary;
}

interface Run {
  stale: boolean;
  cityVersion: number;
  status: 'paused' | 'playing' | 'finished';
  timeS: number;
  counts: Metrics['trips'];
  speed: number;
  achieved: number;
}

type RunCommand = 'play' | 'pause' | 'step' | 'restart';
export type ExportFormat = 'geojson' | 'trips' | 'road-metrics' | 'trajectories';

interface AppState {
  compareOpen: boolean;
  comparison: Comparison | null;
  comparisonProgress: { run: 'Baseline' | 'Variant'; fraction: number } | null;
  toggleCompare: () => void;
  saveBaseline: () => void;
  restoreBaseline: () => Promise<void>;
  runComparison: () => Promise<void>;
  cancelComparison: () => void;
  layers: LayerVisibility;
  layersOpen: boolean;
  metricsOpen: boolean;
  demandOpen: boolean;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  toggleLayers: () => void;
  toggleMetrics: () => void;
  toggleDemand: () => void;
  tool: 'select' | 'road' | 'place' | 'ramp';
  setTool: (tool: AppState['tool']) => void;
  selectionPoint: Vec2 | null;
  session: Session | null;
  run: Run | null;
  selection: MapPick | null;
  selectedRoads: RoadId[];
  selectRoads: (roads: RoadId[]) => void;
  vehicle: VehicleDetail | null;
  diagnosticsOpen: boolean;
  rejectedEdit: Diagnostic[];
  busy: boolean;
  error: string | null;
  select: (selection: MapPick | null) => void;
  toggleDiagnostics: () => void;
  reportError: (error: unknown) => void;
  open: (source?: File | string) => Promise<void>;
  loadProject: (project: Project) => Promise<void>;
  save: () => Promise<void>;
  exportData: (format: ExportFormat) => Promise<void>;
  control: (command: RunCommand, steps?: number) => Promise<void>;
  commit: (command: Command) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  regenerateDemand: (seed: number) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  let comparisonWorker: EngineClient | null = null;
  function cancelComparison() {
    comparisonWorker?.terminate();
    comparisonWorker = null;
    set({ comparisonProgress: null });
  }
  async function perform(action: () => Promise<void>) {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await action();
    } catch (error) {
      get().reportError(error);
    } finally {
      set({ busy: false });
    }
  }

  function onEvent(engine: EngineClient, event: HostEvent) {
    if (event.type === 'headlessProgress') return;
    const { session, run } = get();
    if (session?.engine !== engine || !run) return;
    if (event.type === 'tick') {
      const { timeS, counts, achievedMultiplier } = event;
      set({ run: { ...run, timeS, counts, achieved: achievedMultiplier } });
    } else if (event.type === 'finished') {
      set({ run: { ...run, status: 'finished', timeS: event.timeS, achieved: 0 } });
    } else {
      set({ run: { ...run, status: 'paused', achieved: 0 }, error: event.message });
    }
  }

  function edit(apply: (editor: Editor) => CommitResult | null) {
    return perform(async () => {
      const { session, run, selection } = get();
      if (!session || !run) return;
      const { editor, engine, project } = session;
      const result = apply(editor);
      if (!result) return;
      if (!result.ok) {
        set({ rejectedEdit: result.diagnostics });
        return;
      }
      const { city, compiled, diagnostics } = result;
      cancelComparison();
      set({ comparison: null });
      const playing = run.status === 'playing';
      set({
        session: {
          ...session,
          project: { ...project, city, history: editor.history },
          compiled,
          diagnostics,
        },
        run: { ...run, status: 'paused', achieved: 0, stale: true },
        selection: selectionAfterEdit(selection, session.compiled, compiled),
        selectedRoads: [
          ...new Set(
            get().selectedRoads.flatMap((id) => {
              if (city.roads[id]) return [id];
              const group = project.city.roads[id]?.streetGroupId;
              const survivor = group && compiled.roads.find((road) => road.streetGroupId === group);
              return survivor ? [survivor.id] : [];
            }),
          ),
        ],
        rejectedEdit: [],
      });
      if (playing) {
        await engine.pause();
        const { timeS, trips: counts } = await engine.metrics();
        set(({ run }) => ({ run: { ...run!, status: 'paused', timeS, counts, achieved: 0 } }));
      }
    });
  }

  async function loadSession(project: Project) {
    // The editor exposes the compiled city but does not retain the initial diagnostics.
    const validation = compile(project.city);
    if (!validation.ok) {
      throw new Error(validation.diagnostics.map(({ message }) => message).join('\n'));
    }
    const editor = createEditor(project.city);
    const scenario = project.scenarios[0]!;
    const population = project.population ?? generatePopulation(editor.city, scenario.demand);
    const trips = scheduleTrips(editor.city, population, scenario);
    const engine = createEngineClient(
      new Worker(new URL('../host/worker.ts', import.meta.url), { type: 'module' }),
    );
    try {
      await engine.load({ compiled: editor.compiled, trips, scenario });
      const { timeS, trips: counts } = await engine.metrics();
      engine.onEvent((event) => onEvent(engine, event));
      get().session?.engine.terminate();
      cancelComparison();
      set({ comparison: null, compareOpen: false });
      set({
        session: {
          project: { ...project, population },
          populationKey: demandKey(project.city),
          demandSummary: demandSummary(trips, project.city),
          editor,
          compiled: editor.compiled,
          loadedCompiled: editor.compiled,
          diagnostics: validation.diagnostics,
          engine,
          // Snapshot vehicle IDs are one-based indices into the loaded trip list.
          vehicleHues: Uint32Array.from(trips, ({ destinationPlaceId }) =>
            placeHue(destinationPlaceId),
          ),
        },
        run: {
          status: 'paused',
          stale: false,
          cityVersion: editor.city.version,
          timeS,
          counts,
          speed: 1,
          achieved: 0,
        },
        selection: null,
        selectedRoads: [],
        vehicle: null,
        diagnosticsOpen: false,
        rejectedEdit: [],
      });
    } catch (error) {
      engine.terminate();
      throw error;
    }
  }

  return {
    compareOpen: false,
    comparison: null,
    comparisonProgress: null,
    toggleCompare: () =>
      set(({ compareOpen, layersOpen, metricsOpen, demandOpen }) => ({
        compareOpen: layersOpen || metricsOpen || demandOpen || !compareOpen,
        metricsOpen: false,
        layersOpen: false,
        demandOpen: false,
      })),
    cancelComparison,
    saveBaseline: () => {
      const { session, busy } = get();
      if (!session || busy) return;
      cancelComparison();
      const { editor, project } = session;
      const scenario = project.scenarios[0]!;
      const population =
        session.populationKey === demandKey(editor.city)
          ? project.population
          : generatePopulation(editor.city, scenario.demand);
      set({
        session: {
          ...session,
          project: { ...project, baseline: saveBaseline(editor.city, scenario, population) },
        },
        comparison: null,
      });
    },
    restoreBaseline: () =>
      edit((editor) => {
        const baseline = get().session?.project.baseline;
        return baseline ? restoreBaseline(editor, baseline) : null;
      }),
    runComparison: async () => {
      const session = get().session;
      const baseline = session?.project.baseline;
      if (!session || !baseline || get().busy || comparisonWorker) return;
      const worker = createEngineClient(
        new Worker(new URL('../host/worker.ts', import.meta.url), { type: 'module' }),
      );
      comparisonWorker = worker;
      set({ comparison: null, comparisonProgress: { run: 'Baseline', fraction: 0 }, error: null });
      try {
        const original = compile(baseline.city);
        if (!original.ok)
          throw new Error(original.diagnostics.map(({ message }) => message).join('\n'));
        const trips = comparisonTrips(baseline);
        for (const trip of trips) {
          if (
            !session.editor.city.places[trip.originPlaceId] ||
            !session.editor.city.places[trip.destinationPlaceId]
          ) {
            throw new Error(
              'Comparison needs the baseline trip places. Restore removed places or save a new baseline.',
            );
          }
        }
        let run: 'Baseline' | 'Variant' = 'Baseline';
        worker.onEvent((event) => {
          if (event.type === 'headlessProgress' && comparisonWorker === worker) {
            const duration = baseline.scenario.endS - baseline.scenario.startS;
            set({
              comparisonProgress: {
                run,
                fraction:
                  duration > 0
                    ? Math.min(1, (event.timeS - baseline.scenario.startS) / duration)
                    : 1,
              },
            });
          }
        });
        await worker.load({ compiled: original.compiled, trips, scenario: baseline.scenario });
        const baselineResult = await worker.runHeadless();
        run = 'Variant';
        set({ comparisonProgress: { run, fraction: 0 } });
        await worker.load({ compiled: session.compiled, trips, scenario: baseline.scenario });
        const variantResult = await worker.runHeadless();
        const roads = new Map(original.compiled.roads.map((road) => [road.id, road]));
        for (const road of session.compiled.roads) roads.set(road.id, road);
        if (comparisonWorker === worker)
          set({
            comparison: {
              baseline: baselineResult,
              variant: variantResult,
              reference: {
                cityVersion: session.editor.city.version,
                scenario: structuredClone(baseline.scenario),
              },
              roads: [...roads.values()].map(({ id, surface }) => ({
                id,
                surface,
                vehicles:
                  (variantResult.roadVehicleCounts[id] ?? 0) -
                  (baselineResult.roadVehicleCounts[id] ?? 0),
              })),
            },
            layers: { ...get().layers, difference: true },
          });
      } catch (error) {
        if (comparisonWorker === worker) get().reportError(error);
      } finally {
        worker.terminate();
        if (comparisonWorker === worker) {
          comparisonWorker = null;
          set({ comparisonProgress: null });
        }
      }
    },
    layers: { ...defaultLayers },
    layersOpen: false,
    metricsOpen: false,
    demandOpen: false,
    toggleLayer: (layer) =>
      set(({ layers }) => ({ layers: { ...layers, [layer]: !layers[layer] } })),
    toggleLayers: () =>
      set(({ layersOpen }) => ({ layersOpen: !layersOpen, metricsOpen: false, demandOpen: false })),
    toggleMetrics: () =>
      set(({ metricsOpen }) => ({
        metricsOpen: !metricsOpen,
        layersOpen: false,
        demandOpen: false,
      })),
    toggleDemand: () =>
      set(({ demandOpen }) => ({ demandOpen: !demandOpen, layersOpen: false, metricsOpen: false })),
    tool: 'select',
    setTool: (tool) =>
      set({ tool, selection: null, selectedRoads: [], vehicle: null, selectionPoint: null }),
    selectionPoint: null,
    session: null,
    run: null,
    selection: null,
    selectedRoads: [],
    selectRoads: (roads) => {
      const compiled = get().session?.compiled;
      const selectedRoads = [...new Set(roads)].filter((id) => compiled?.index.road.has(id));
      const road = selectedRoads.length ? compiled!.index.road.get(selectedRoads[0]!)! : undefined;
      set({
        selectedRoads,
        selection:
          road === undefined
            ? null
            : {
                kind: 'lane',
                road,
                lane: compiled!.roads[road]!.lanes[0]!,
              },
        vehicle: null,
        diagnosticsOpen: false,
        rejectedEdit: [],
      });
    },
    vehicle: null,
    diagnosticsOpen: false,
    rejectedEdit: [],
    busy: false,
    error: null,
    select: (selection) =>
      set({
        selection,
        selectedRoads: [],
        vehicle: null,
        diagnosticsOpen: false,
        rejectedEdit: [],
      }),
    toggleDiagnostics: () => set(({ diagnosticsOpen }) => ({ diagnosticsOpen: !diagnosticsOpen })),
    commit: (command) => edit((editor) => editor.apply(command)),
    undo: () => edit((editor) => editor.undo()),
    redo: () => edit((editor) => editor.redo()),
    reportError: (error) => set({ error: error instanceof Error ? error.message : String(error) }),
    open: (source = 'grid5x5') =>
      perform(async () => {
        const result =
          typeof source === 'string'
            ? await bundledProject(source)
            : await openProject(new Uint8Array(await source.arrayBuffer()));
        if (!result.ok) throw new Error(`${result.file} — ${result.error}`);
        const { project } = result;
        await loadSession(project);
      }),
    loadProject: (project) => perform(() => loadSession(project)),
    save: () =>
      perform(async () => {
        const { session } = get();
        if (!session) return;
        const { project } = session;
        const bytes = await saveProject(project);
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `${project.city.name.replace(/[<>:"/\\|?*]/g, '-')}.cityflows`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }),
    regenerateDemand: (seed) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        if (!Number.isSafeInteger(seed)) throw new Error('Seed must be a safe integer.');
        const { project, engine } = session;
        const current = project.scenarios[0]!;
        const scenario = { ...current, seed, demand: { ...current.demand, seed } };
        const population = generatePopulation(project.city, scenario.demand);
        const trips = scheduleTrips(project.city, population, scenario);
        await engine.pause();
        const { timeS, trips: counts } = await engine.metrics();
        set({
          session: {
            ...session,
            project: {
              ...project,
              population,
              scenarios: [scenario, ...project.scenarios.slice(1)],
            },
            populationKey: demandKey(project.city),
            demandSummary: demandSummary(trips, project.city),
          },
          run: { ...run, status: 'paused', stale: true, achieved: 0, timeS, counts },
        });
      }),
    exportData: (format) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        if (format !== 'geojson' && run.stale)
          throw new Error('Restart to export the edited scenario');
        const { project, engine, loadedCompiled } = session;
        const scenario = project.scenarios[0]!;
        const provenance = {
          seed: scenario.seed,
          engineVersion: version,
          schemaVersion: project.city.schemaVersion,
          dtS: scenario.simParams.dtS ?? DEFAULT_SIM_PARAMS.dtS,
        };
        let content: string;
        if (format === 'geojson') {
          content = JSON.stringify({
            ...exportGeoJson(project.city),
            'cityflows:provenance': provenance,
          });
        } else if (format === 'trips') {
          content = exportTripsCsv(await engine.tripRecords(), provenance);
        } else if (format === 'road-metrics') {
          const stats = await engine.roadStats();
          content = exportRoadMetricsCsv(
            stats.map((stat) => {
              const road = project.city.roads[stat.id]!;
              return {
                ...stat,
                name: road.name,
                roadClass: road.roadClass,
                length: loadedCompiled.roads[loadedCompiled.index.road.get(stat.id)!]!.lengthM,
              };
            }),
            provenance,
          );
        } else {
          const records = await engine.trajectories();
          if (!records.length) throw new Error('Record trajectories before exporting');
          content = exportTrajectoriesCsv(records, provenance);
        }
        const extension = format === 'geojson' ? 'geojson' : 'csv';
        const type = format === 'geojson' ? 'application/geo+json' : 'text/csv;charset=utf-8';
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${project.city.name}-${scenario.id}-${format}.${extension}`.replace(
          /[<>:"/\\|?*]/g,
          '-',
        );
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }),
    control: (command, steps = 1) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        if (run.stale && command !== 'restart') return;
        const { engine, editor, project } = session;
        if (command === 'restart') {
          const scenario = project.scenarios[0]!;
          const compiled = editor.compiled;
          const population =
            session.populationKey === demandKey(editor.city)
              ? project.population
              : generatePopulation(editor.city, scenario.demand);
          const trips = scheduleTrips(editor.city, population, scenario);
          await engine.load({ compiled, trips, scenario });
          const { timeS, trips: counts } = await engine.metrics();
          set({
            session: {
              ...session,
              loadedCompiled: compiled,
              project: { ...project, population },
              populationKey: demandKey(editor.city),
              demandSummary: demandSummary(trips, editor.city),
              vehicleHues: Uint32Array.from(trips, ({ destinationPlaceId }) =>
                placeHue(destinationPlaceId),
              ),
            },
            run: {
              ...run,
              status: 'paused',
              stale: false,
              cityVersion: compiled.version,
              timeS,
              counts,
              achieved: 0,
            },
            ...(get().selection?.kind === 'vehicle' && { selection: null, vehicle: null }),
          });
          return;
        }
        if (command === 'play') {
          await engine.play();
          set(({ run }) =>
            run?.status === 'finished' ? {} : { run: { ...run!, status: 'playing' } },
          );
          return;
        }
        if (command === 'step') await engine.step(steps);
        else await engine.pause();
        const { timeS, trips: counts } = await engine.metrics();
        const status = get().run?.status === 'finished' ? 'finished' : 'paused';
        set({ run: { ...run, status, timeS, counts, achieved: 0 } });
      }),
    setSpeed: (speed) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        await session.engine.setSpeed(speed);
        set(({ run }) => ({ run: { ...run!, speed } }));
      }),
  };
});

declare global {
  interface Window {
    cityflows?: Pick<EngineClient, 'metrics' | 'hash' | 'inspect' | 'step'> & {
      city?: () => Project['city'];
      commit?: (command: Command) => Promise<void>;
      movementId(index: number): string;
    };
  }
}
