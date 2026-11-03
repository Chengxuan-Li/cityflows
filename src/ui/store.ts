import { create } from 'zustand';
import demo from '../../fixtures/projects/grid5x5.cityflows.json?raw';
import { generatePopulation, scheduleTrips } from '../demand';
import { createEditor, type Editor } from '../editor';
import { createEngineClient, type EngineClient } from '../host/client';
import type { HostEvent } from '../host/protocol';
import { compile, type CompiledCity, type Diagnostic } from '../network';
import { openProject } from '../project/open';
import { saveProject } from '../project/save';
import type { Project } from '../project/types';
import type { Pick as MapPick } from '../render/types';
import type { Metrics, VehicleDetail } from '../sim/types';

export interface Session {
  project: Project;
  editor: Editor;
  compiled: CompiledCity;
  diagnostics: Diagnostic[];
  engine: EngineClient;
}

interface Run {
  status: 'paused' | 'playing' | 'finished';
  timeS: number;
  counts: Metrics['trips'];
  speed: number;
  achieved: number;
}

type RunCommand = 'play' | 'pause' | 'step' | 'restart';

interface AppState {
  session: Session | null;
  run: Run | null;
  selection: MapPick | null;
  vehicle: VehicleDetail | null;
  diagnosticsOpen: boolean;
  busy: boolean;
  error: string | null;
  select: (selection: MapPick | null) => void;
  toggleDiagnostics: () => void;
  reportError: (error: unknown) => void;
  open: (file?: File) => Promise<void>;
  save: () => Promise<void>;
  control: (command: RunCommand) => Promise<void>;
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

  return {
    session: null,
    run: null,
    selection: null,
    vehicle: null,
    diagnosticsOpen: false,
    busy: false,
    error: null,
    select: (selection) => set({ selection, vehicle: null, diagnosticsOpen: false }),
    toggleDiagnostics: () =>
      set(({ diagnosticsOpen }) => ({
        diagnosticsOpen: !diagnosticsOpen,
        selection: null,
        vehicle: null,
      })),
    reportError: (error) => set({ error: error instanceof Error ? error.message : String(error) }),
    open: (file) =>
      perform(async () => {
        const result = await openProject(file ? new Uint8Array(await file.arrayBuffer()) : demo);
        if (!result.ok) throw new Error(`${result.file} — ${result.error}`);
        const { project } = result;
        // The editor exposes the compiled city but does not retain the initial diagnostics.
        const validation = compile(project.city);
        if (!validation.ok) {
          throw new Error(validation.diagnostics.map(({ message }) => message).join('\n'));
        }
        const editor = createEditor(project.city);
        const scenario = project.scenarios[0]!;
        project.population ??= generatePopulation(editor.city, scenario.demand);
        const trips = scheduleTrips(editor.city, project.population, scenario);
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
              project,
              editor,
              compiled: editor.compiled,
              diagnostics: validation.diagnostics,
              engine,
            },
            run: { status: 'paused', timeS, counts, speed: 1, achieved: 0 },
            selection: null,
            vehicle: null,
            diagnosticsOpen: false,
          });
        } catch (error) {
          engine.terminate();
          throw error;
        }
      }),
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
    control: (command) =>
      perform(async () => {
        const { session, run } = get();
        if (!session || !run) return;
        const { engine } = session;
        if (command === 'play') {
          await engine.play();
          set(({ run }) =>
            run?.status === 'finished' ? {} : { run: { ...run!, status: 'playing' } },
          );
          return;
        }
        if (command === 'step') await engine.step(1);
        else await engine[command]();
        const { timeS, trips: counts } = await engine.metrics();
        const status =
          command !== 'restart' && get().run?.status === 'finished' ? 'finished' : 'paused';
        set({ run: { ...run, status, timeS, counts, achieved: 0 } });
        if (command === 'restart') set({ selection: null, vehicle: null });
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
    cityflows?: Pick<EngineClient, 'metrics' | 'hash' | 'inspect'>;
  }
}
