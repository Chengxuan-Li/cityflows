import { create } from 'zustand';
import type { Vec2 } from '../geo/vec2';
import { generatePopulation, scheduleTrips } from '../demand';
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
import type { Metrics, VehicleDetail } from '../sim/types';
import { bundledProject } from './bundled-projects';
import { selectionAfterEdit } from './edit-selection';

export interface Session {
  project: Project & { population: Person[] };
  editor: Editor;
  compiled: CompiledCity;
  loadedCompiled: CompiledCity;
  diagnostics: Diagnostic[];
  engine: EngineClient;
  vehicleHues: Uint32Array;
  populationPlaces: Project['city']['places'];
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

interface AppState {
  layers: LayerVisibility;
  layersOpen: boolean;
  metricsOpen: boolean;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  toggleLayers: () => void;
  toggleMetrics: () => void;
  tool: 'select' | 'road';
  setTool: (tool: AppState['tool']) => void;
  selectionPoint: Vec2 | null;
  session: Session | null;
  run: Run | null;
  selection: MapPick | null;
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
  control: (command: RunCommand, steps?: number) => Promise<void>;
  commit: (command: Command) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
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
      set({
        session: {
          project: { ...project, population },
          populationPlaces: project.city.places,
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
    layers: { ...defaultLayers },
    layersOpen: false,
    metricsOpen: false,
    toggleLayer: (layer) =>
      set(({ layers }) => ({ layers: { ...layers, [layer]: !layers[layer] } })),
    toggleLayers: () => set(({ layersOpen }) => ({ layersOpen: !layersOpen, metricsOpen: false })),
    toggleMetrics: () =>
      set(({ metricsOpen }) => ({ metricsOpen: !metricsOpen, layersOpen: false })),
    tool: 'select',
    setTool: (tool) => set({ tool, selection: null, vehicle: null, selectionPoint: null }),
    selectionPoint: null,
    session: null,
    run: null,
    selection: null,
    vehicle: null,
    diagnosticsOpen: false,
    rejectedEdit: [],
    busy: false,
    error: null,
    select: (selection) =>
      set({ selection, vehicle: null, diagnosticsOpen: false, rejectedEdit: [] }),
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
            session.populationPlaces === editor.city.places
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
              populationPlaces: editor.city.places,
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
