import { create } from 'zustand';
import { version } from '../../package.json';
import { exportGeoJson } from '../project/geojson';
import { exportTripsCsv, exportRoadMetricsCsv, exportTrajectoriesCsv } from '../project/export-csv';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { patchSignals } from '../sim/signals';
import type { Vec2 } from '../geo/vec2';
import { demandSummary, generatePopulation, scheduleTrips, type DemandSummary } from '../demand';
import { createEditor, type CommitResult, type Editor } from '../editor';
import { createEngineClient, type EngineClient } from '../host/client';
import type { HostEvent } from '../host/protocol';
import { compile, type CompiledCity, type Diagnostic } from '../network';
import { openProject } from '../project/open';
import { saveProject } from '../project/save';
import type { Project } from '../project/types';
import type { Pick as MapPick, VehicleSnapshot } from '../render/types';
import { defaultLayers, type LayerVisibility } from '../render/types';
import { placeHue } from '../render/style';
import type { Command, ModeChoiceConfig, Person, Scenario } from '../schema';
import type { DrawRoadOptions } from '../editor/commands/topology';
import type { PaintKind } from './tools/place-paint';
import type { RoadId } from '../schema';
import type {
  Metrics,
  ParkedCarsSnapshot,
  PatchResult,
  PersonDetail,
  VehicleDetail,
  WalkerDetail,
} from '../sim/types';
import { bundledProject } from './bundled-projects';
import { selectionAfterEdit } from './edit-selection';
import { restoreBaseline, saveBaseline, type Variant } from '../project/scenarios';
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

/** Trip scheduling inputs: a change here needs a restart, which reschedules the same population. */
function scheduleKey(city: Project['city']) {
  return JSON.stringify(
    Object.values(city.places)
      .map(({ id, profile, events, attraction }) => [id, profile, events, attraction])
      .sort(),
  );
}

export type TestWalkers = NonNullable<Scenario['walkers']>;
/** One undoable edit: a city command (the editor's history) or a change of the test pedestrians. */
type EditEntry = { kind: 'city' } | { kind: 'walkers'; before: TestWalkers; after: TestWalkers };

export interface Session {
  project: Project & { population: Person[] };
  /** The order of undoable edits across the editor's history and the scenario's test pedestrians. */
  undoStack: EditEntry[];
  redoStack: EditEntry[];
  editor: Editor;
  compiled: CompiledCity;
  loadedCompiled: CompiledCity;
  diagnostics: Diagnostic[];
  engine: EngineClient;
  vehicleHues: Uint32Array;
  /** TASK-129: the household car of each loaded trip, by one-based vehicle id less one. */
  vehicleCars: (string | null)[];
  /** Place demographics the population was generated from; restart regenerates when they change. */
  populationKey: string;
  demandSummary: DemandSummary;
}

interface Run {
  patch?: PatchResult;
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
  viewMode: '2d' | '3d';
  belowGround: boolean;
  buildings: boolean;
  toggleView: () => void;
  toggleBelowGround: () => void;
  toggleBuildings: () => void;
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
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  /** Options of the drawing tools, shown in the sidebar while the tool is active. */
  roadOptions: DrawRoadOptions;
  placeKind: PaintKind;
  placeHint: string;
  /** The onboarding hint on screen, or null (onboarding.tsx). */
  hintStep: number | null;
  tool: 'select' | 'road' | 'place' | 'ramp' | 'roundabout';
  setTool: (tool: AppState['tool']) => void;
  selectionPoint: Vec2 | null;
  session: Session | null;
  run: Run | null;
  selection: MapPick | null;
  selectedRoads: RoadId[];
  selectRoads: (roads: RoadId[]) => void;
  vehicle: VehicleDetail | null;
  walker: WalkerDetail | null;
  personId: string | null;
  person: PersonDetail | null;
  selectPerson: (id: string) => void;
  parkingOccupancy: Record<string, number>;
  parkedCars: ParkedCarsSnapshot | null;
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
  /** TASK-113: change the mode choice's parameters (restart to apply). */
  setModeChoice: (change: Partial<ModeChoiceConfig>) => Promise<void>;
  /** TASK-111: replace the scenario's test pedestrians (undoable; restart to apply). */
  setTestWalkers: (walkers: TestWalkers) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  const signalEpochs = new Map<string, number>();
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

  /** The edit stacks after a commit, undo or redo succeeded. */
  function stacks(session: Session, mode: 'commit' | 'undo' | 'redo', entry: EditEntry) {
    const { undoStack, redoStack } = session;
    if (mode === 'commit') return { undoStack: [...undoStack, entry], redoStack: [] };
    if (mode === 'undo')
      return { undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, entry] };
    return { undoStack: [...undoStack, entry], redoStack: redoStack.slice(0, -1) };
  }
  const cityEdit: EditEntry = { kind: 'city' };

  function edit(
    apply: (editor: Editor) => CommitResult | null,
    displayOnly = false,
    mode: 'commit' | 'undo' | 'redo' = 'commit',
  ) {
    return perform(async () => {
      const { session, run, selection } = get();
      if (!session || !run || (get().viewMode === '3d' && !displayOnly)) return;
      const { editor, engine, project } = session;
      const result = apply(editor);
      if (!result) return;
      if (!result.ok) {
        set({ rejectedEdit: result.diagnostics });
        return;
      }
      const { city, compiled, diagnostics } = result;
      if (compiled === session.compiled) {
        set({
          session: {
            ...session,
            ...stacks(session, mode, cityEdit),
            project: { ...project, city, history: editor.history },
          },
        });
        return;
      }
      cancelComparison();
      set({ comparison: null });
      const stale =
        run.stale ||
        session.populationKey !== demandKey(city) ||
        scheduleKey(project.city) !== scheduleKey(city);
      set({
        session: {
          ...session,
          ...stacks(session, mode, cityEdit),
          project: { ...project, city, history: editor.history },
          compiled,
          diagnostics,
        },
        run: stale ? { ...run, status: 'paused', achieved: 0, stale: true, patch: undefined } : run,
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
      if (!stale) {
        try {
          const patch = await engine.patch(compiled);
          const loadedCompiled = patchSignals(
            session.compiled,
            compiled,
            patch.timeS,
            signalEpochs,
          );
          const { timeS, trips: counts } = await engine.metrics();
          set(({ session, run, selection }) => ({
            session: { ...session!, loadedCompiled },
            run: { ...run!, cityVersion: patch.version, timeS, counts, patch },
            vehicle: null,
            walker: null,
            person: null,
            selection:
              selection?.kind === 'vehicle' || selection?.kind === 'walker'
                ? { ...selection }
                : selection,
          }));
          return;
        } catch (error) {
          set(({ run }) => ({
            run: { ...run!, stale: true, status: 'paused', achieved: 0, patch: undefined },
          }));
          await engine.pause();
          throw error;
        }
      }
      if (run.status === 'playing') {
        await engine.pause();
        const { timeS, trips: counts } = await engine.metrics();
        set(({ run }) => ({ run: { ...run!, status: 'paused', timeS, counts, achieved: 0 } }));
      }
    });
  }

  /** TASK-111: test pedestrians are a scenario input like the demand seed: the run waits for a
   * restart. Undo restores `before`; commit and redo apply `after`. */
  function changeWalkers(
    entry: Extract<EditEntry, { kind: 'walkers' }>,
    mode: 'commit' | 'undo' | 'redo',
  ) {
    return perform(async () => {
      const { session, run } = get();
      if (!session || !run) return;
      const { project, engine } = session;
      const walkers = mode === 'undo' ? entry.before : entry.after;
      const scenario: Scenario = { ...project.scenarios[0]!, walkers };
      if (!walkers.length) delete scenario.walkers;
      await engine.pause();
      const { timeS, trips: counts } = await engine.metrics();
      set({
        session: {
          ...session,
          ...stacks(session, mode, entry),
          project: { ...project, scenarios: [scenario, ...project.scenarios.slice(1)] },
        },
        run: { ...run, status: 'paused', stale: true, achieved: 0, timeS, counts },
      });
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
    const trips = scheduleTrips(editor.city, population, scenario, editor.compiled);
    const engine = createEngineClient(
      new Worker(new URL('../host/worker.ts', import.meta.url), { type: 'module' }),
    );
    try {
      await engine.load({ compiled: editor.compiled, trips, scenario, population });
      const { timeS, trips: counts } = await engine.metrics();
      engine.onEvent((event) => onEvent(engine, event));
      get().session?.engine.terminate();
      signalEpochs.clear();
      cancelComparison();
      set({ comparison: null, compareOpen: false });
      set({
        session: {
          project: { ...project, city: editor.city, population },
          undoStack: [],
          redoStack: [],
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
          vehicleCars: trips.map(({ carId }) => carId ?? null),
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
        parkingOccupancy: {},
        parkedCars: null,
        selectedRoads: [],
        vehicle: null,
        walker: null,
        personId: null,
        person: null,
        rejectedEdit: [],
      });
    } catch (error) {
      engine.terminate();
      throw error;
    }
  }

  return {
    viewMode: '2d',
    belowGround: false,
    buildings: true,
    toggleView: () => {
      const { viewMode, selection, session, busy } = get();
      if (!session || busy) return;
      set({
        viewMode: viewMode === '2d' ? '3d' : '2d',
        tool: 'select',
        selectedRoads: [],
        selection:
          selection?.kind === 'vehicle' ||
          selection?.kind === 'walker' ||
          selection?.kind === 'track' ||
          selection?.kind === 'train' ||
          selection?.kind === 'platform' ||
          (selection?.kind === 'place' &&
            Boolean(
              get().session?.project.city.places[
                get().session!.compiled.places[selection.place]!.id
              ]?.station,
            )) ||
          selection?.kind === 'parking'
            ? selection
            : null,
        selectionPoint: null,
        vehicle: selection?.kind === 'vehicle' ? get().vehicle : null,
        walker: selection?.kind === 'walker' ? get().walker : null,
      });
    },
    toggleBelowGround: () => set(({ belowGround }) => ({ belowGround: !belowGround })),
    toggleBuildings: () => set(({ buildings }) => ({ buildings: !buildings })),
    compareOpen: false,
    comparison: null,
    comparisonProgress: null,
    toggleCompare: () => set(({ compareOpen }) => ({ compareOpen: !compareOpen })),
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
        const population = structuredClone(
          baseline.population ?? generatePopulation(baseline.city, baseline.scenario.demand),
        );
        const trips = scheduleTrips(
          baseline.city,
          population,
          baseline.scenario,
          original.compiled,
        );
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
        await worker.load({
          compiled: original.compiled,
          trips,
          scenario: baseline.scenario,
          population,
        });
        const baselineResult = await worker.runHeadless();
        run = 'Variant';
        set({ comparisonProgress: { run, fraction: 0 } });
        await worker.load({
          compiled: session.compiled,
          trips,
          scenario: baseline.scenario,
          population,
        });
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
    toggleLayers: () => set(({ layersOpen }) => ({ layersOpen: !layersOpen })),
    toggleMetrics: () => set(({ metricsOpen }) => ({ metricsOpen: !metricsOpen })),
    toggleDemand: () => set(({ demandOpen }) => ({ demandOpen: !demandOpen })),
    // Under 900 px the sidebar floats over the map, so it starts closed there.
    sidebarOpen: !window.matchMedia('(max-width: 900px)').matches,
    inspectorOpen: true,
    toggleSidebar: () => set(({ sidebarOpen }) => ({ sidebarOpen: !sidebarOpen })),
    toggleInspector: () => set(({ inspectorOpen }) => ({ inspectorOpen: !inspectorOpen })),
    roadOptions: { twoWay: true, lanes: 1, roadClass: 'residential', speedKph: 30 },
    placeKind: 'residential',
    placeHint: '',
    hintStep: null,
    tool: 'select',
    setTool: (tool) => {
      if (get().viewMode === '3d') return;
      set({
        tool,
        selection: null,
        selectedRoads: [],
        vehicle: null,
        walker: null,
        personId: null,
        person: null,
        selectionPoint: null,
      });
    },
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
        walker: null,
        personId: null,
        person: null,
        rejectedEdit: [],
      });
    },
    vehicle: null,
    walker: null,
    personId: null,
    person: null,
    selectPerson: (personId) => set({ personId, person: null }),
    parkingOccupancy: {},
    parkedCars: null,
    diagnosticsOpen: false,
    rejectedEdit: [],
    busy: false,
    error: null,
    select: (selection) =>
      set({
        selection,
        selectedRoads: [],
        vehicle: null,
        walker: null,
        personId: null,
        person: null,
        rejectedEdit: [],
      }),
    toggleDiagnostics: () => set(({ diagnosticsOpen }) => ({ diagnosticsOpen: !diagnosticsOpen })),
    commit: (command) =>
      edit((editor) => editor.apply(command), command.kind === 'setMarkingTheme'),
    undo: () => {
      const last = get().session?.undoStack.at(-1);
      if (last?.kind === 'walkers') return changeWalkers(last, 'undo');
      return edit((editor) => editor.undo(), get().session?.editor.canUndoDisplayOnly, 'undo');
    },
    redo: () => {
      const next = get().session?.redoStack.at(-1);
      if (next?.kind === 'walkers') return changeWalkers(next, 'redo');
      return edit((editor) => editor.redo(), get().session?.editor.canRedoDisplayOnly, 'redo');
    },
    setTestWalkers: (walkers) => {
      const before = get().session?.project.scenarios[0]!.walkers ?? [];
      return changeWalkers({ kind: 'walkers', before, after: walkers }, 'commit');
    },
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
        const trips = scheduleTrips(project.city, population, scenario, session.compiled);
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
    setModeChoice: (change) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        const { project, engine } = session;
        const current = project.scenarios[0]!;
        const scenario: Scenario = {
          ...current,
          demand: { ...current.demand, modeChoice: { ...current.demand.modeChoice, ...change } },
        };
        await engine.pause();
        const { timeS, trips: counts } = await engine.metrics();
        set({
          session: {
            ...session,
            project: { ...project, scenarios: [scenario, ...project.scenarios.slice(1)] },
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
          if (!run.stale) {
            await engine.restart();
            signalEpochs.clear();
            const { timeS, trips: counts } = await engine.metrics();
            set({
              session: { ...session, loadedCompiled: session.compiled },
              run: { ...run, status: 'paused', achieved: 0, timeS, counts, patch: undefined },
              ...(['vehicle', 'walker'].includes(get().selection?.kind ?? '') && {
                selection: null,
                vehicle: null,
                walker: null,
                personId: null,
                person: null,
              }),
            });
            return;
          }
          const scenario = project.scenarios[0]!;
          const compiled = editor.compiled;
          const population =
            session.populationKey === demandKey(editor.city)
              ? project.population
              : generatePopulation(editor.city, scenario.demand);
          const trips = scheduleTrips(editor.city, population, scenario, compiled);
          await engine.load({ compiled, trips, scenario, population });
          signalEpochs.clear();
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
              vehicleCars: trips.map(({ carId }) => carId ?? null),
            },
            run: {
              ...run,
              status: 'paused',
              stale: false,
              cityVersion: compiled.version,
              timeS,
              counts,
              achieved: 0,
              patch: undefined,
            },
            ...(['vehicle', 'walker'].includes(get().selection?.kind ?? '') && {
              selection: null,
              vehicle: null,
              walker: null,
              personId: null,
              person: null,
            }),
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
      snapshot?: EngineClient['snapshot'];
      drawnSnapshot?: () => VehicleSnapshot | null;
      parkedCars?: () => ParkedCarsSnapshot | null;
      vehicleToScreen?: (id: number) => Vec2 | null;
      capture3D?: () => Promise<string[]>;
      view3D?: () => { centre: Vec2; zoom: number } | null;
      setView3D?: (centre: Vec2, zoom: number, pitch?: number, bearing?: number) => void;
      worldToScreen?: (point: Vec2) => Vec2;
      city?: () => Project['city'];
      commit?: (command: Command) => Promise<void>;
      /** TASK-111: set the test pedestrians and restart the run with them. */
      setWalkers?: (walkers: TestWalkers) => Promise<void>;
      inspectWalker?: EngineClient['inspectWalker'];
      inspectPerson?: EngineClient['inspectPerson'];
      movementId(index: number): string;
      resetHints?: () => void;
    };
  }
}
