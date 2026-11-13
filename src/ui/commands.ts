import { useShallow } from 'zustand/react/shallow';
import type { City, Command as Edit, RoadId } from '../schema';
import { bound, isTyping, pressesOnSpace, type CommandId } from './shortcuts';
import { speeds, useAppStore, type SheetName } from './store';

type State = ReturnType<typeof useAppStore.getState>;

/** One thing the app can do: the toolbar, the key bindings, the command menu and the shortcut
 *  sheet all list these. `label` is the command menu's wording while it depends on the state. */
export interface AppCommand {
  id: CommandId;
  group: string;
  name: string;
  label?: (state: State) => string;
  enabled: (state: State) => boolean;
  run: () => void | Promise<void>;
  /** Still works while the command menu or the shortcut sheet is open: their own toggles. */
  insideSheet?: boolean;
}

const store = useAppStore.getState;

/** A sheet's own close: a dialog also reports closing when another sheet replaced it. */
export function closeSheet(name: SheetName) {
  if (store().sheet === name) store().showSheet(null);
}

const idle = (s: State) => !s.busy;
const withSession = (s: State) => !s.busy && s.session !== null;
// Run controls: as in the toolbar, they wait for a loaded run and for the worker to be free.
const running = (s: State) => !s.busy && s.run !== null;
const editing = (s: State) => withSession(s) && s.viewMode === '2d';
const canPlay = (s: State) => running(s) && !s.run!.stale && s.run!.status === 'paused';

export const canUndo = (s: State) =>
  idle(s) &&
  !!s.session?.undoStack.length &&
  !(
    s.viewMode === '3d' &&
    s.session.undoStack.at(-1)!.kind === 'city' &&
    !s.session.editor.canUndoDisplayOnly
  );
export const canRedo = (s: State) =>
  idle(s) &&
  !!s.session?.redoStack.length &&
  !(
    s.viewMode === '3d' &&
    s.session.redoStack.at(-1)!.kind === 'city' &&
    !s.session.editor.canRedoDisplayOnly
  );

/** The edit that deletes a street: both carriageways of its group, as the inspector's button does. */
export function streetDeletion(city: City, ids: RoadId[]): Edit {
  const groups = new Set(ids.map((id) => city.roads[id]!.streetGroupId).filter((g) => g !== null));
  return {
    kind: 'batch',
    label: 'Delete street',
    commands: Object.values(city.roads)
      .filter(
        (r) => ids.includes(r.id) || (r.streetGroupId !== null && groups.has(r.streetGroupId)),
      )
      .map((r) => ({ kind: 'deleteRoad', roadId: r.id })),
  };
}

/** What Delete removes: the selected streets or the selected place, as the inspector's buttons do. */
function deletion(s: State): Edit | null {
  const { session, selection, selectedRoads } = s;
  if (!session || !selection) return null;
  const { compiled, project } = session;
  if (selection.kind === 'lane')
    return streetDeletion(
      project.city,
      selectedRoads.length ? selectedRoads : [compiled.roads[selection.road]!.id],
    );
  let place: number | undefined;
  if (selection.kind === 'place') place = selection.place;
  if (selection.kind === 'connector') {
    const connector = compiled.connectors[selection.connector]!;
    const garage =
      connector.parking !== undefined &&
      !compiled.parking[connector.parking]!.source.provenance.inferred?.includes('implicitGarage');
    if (!garage) place = connector.place;
  }
  return place === undefined ? null : { kind: 'deletePlace', placeId: compiled.places[place]!.id };
}

const tool = (
  id: 'select' | 'road' | 'place' | 'ramp' | 'roundabout',
  name: string,
): AppCommand => ({
  id,
  group: 'Tools',
  name: `${name} tool`,
  enabled: editing,
  run: () => store().setTool(id),
});

type Section = 'layers' | 'chart' | 'demand' | 'compare' | 'validation';
const sections = {
  layers: ['Layers', 'layersOpen', 'toggleLayers', (s: State) => s.run !== null],
  chart: ['Chart', 'metricsOpen', 'toggleMetrics', running],
  demand: ['Demand', 'demandOpen', 'toggleDemand', running],
  compare: ['Compare', 'compareOpen', 'toggleCompare', (s: State) => s.run !== null],
  validation: [
    'Validation',
    'diagnosticsOpen',
    'toggleDiagnostics',
    (s: State) => s.session !== null,
  ],
} as const;

const section = (id: Section): AppCommand => {
  const [title, open, toggle, enabled] = sections[id];
  return {
    id,
    group: 'View',
    name: `Show or hide ${title}`,
    label: (s) => `${s.sidebarOpen && s[open] ? 'Hide' : 'Show'} ${title}`,
    enabled,
    // A hidden sidebar opens first, so the section is seen.
    run: () => {
      const s = store();
      if (!s.sidebarOpen) {
        s.toggleSidebar();
        if (!s[open]) s[toggle]();
      } else s[toggle]();
    },
  };
};

const toggle = (id: 'sidebar' | 'inspector', title: string): AppCommand => ({
  id,
  group: 'View',
  name: `Show or hide ${title}`,
  label: (s) =>
    `${(id === 'sidebar' ? s.sidebarOpen : s.inspectorOpen) ? 'Hide' : 'Show'} ${title}`,
  enabled: () => true,
  run: () => (id === 'sidebar' ? store().toggleSidebar() : store().toggleInspector()),
});

const sheet = (
  id: 'new' | 'import' | 'export',
  name: string,
  enabled: AppCommand['enabled'],
): AppCommand => ({
  id,
  group: 'File',
  name,
  enabled,
  run: () => store().showSheet(id),
});

/** Every command, in the order the command menu and the shortcut sheet list them. */
export const commands: AppCommand[] = [
  sheet('new', 'New city', idle),
  sheet('import', 'Import city', idle),
  {
    id: 'open',
    group: 'File',
    name: 'Open project',
    enabled: idle,
    run: () => document.querySelector<HTMLInputElement>('#open-project')!.click(),
  },
  {
    id: 'save',
    group: 'File',
    name: 'Save project',
    enabled: withSession,
    run: () => store().save(),
  },
  sheet('export', 'Export data', withSession),
  { id: 'undo', group: 'Edit', name: 'Undo', enabled: canUndo, run: () => store().undo() },
  { id: 'redo', group: 'Edit', name: 'Redo', enabled: canRedo, run: () => store().redo() },
  {
    id: 'deleteSelection',
    group: 'Edit',
    name: 'Delete selection',
    enabled: (s) => idle(s) && deletion(s) !== null,
    run: () => {
      const edit = deletion(store());
      if (edit) return store().commit(edit);
    },
  },
  {
    id: 'clearSelection',
    group: 'Edit',
    name: 'Clear selection',
    enabled: (s) => s.selection !== null,
    run: () => store().select(null),
  },
  {
    id: 'playPause',
    group: 'Run',
    name: 'Play or pause',
    label: (s) => (s.run?.status === 'playing' ? 'Pause' : 'Play'),
    enabled: (s) => canPlay(s) || (running(s) && s.run!.status === 'playing'),
    run: () => store().control(store().run?.status === 'playing' ? 'pause' : 'play'),
  },
  {
    id: 'step',
    group: 'Run',
    name: 'Step',
    enabled: canPlay,
    run: () => store().control('step'),
  },
  {
    id: 'restart',
    group: 'Run',
    name: 'Restart',
    enabled: running,
    run: () => store().control('restart'),
  },
  ...(
    [
      ['slower', 'Slower', -1],
      ['faster', 'Faster', 1],
    ] as const
  ).map(([id, name, direction]): AppCommand => ({
    id,
    group: 'Run',
    name,
    enabled: (s) => running(s) && speeds[speeds.indexOf(s.run!.speed) + direction] !== undefined,
    run: () => store().setSpeed(speeds[speeds.indexOf(store().run!.speed) + direction]!),
  })),
  tool('select', 'Select'),
  tool('road', 'Road'),
  tool('place', 'Place'),
  tool('ramp', 'Ramp'),
  tool('roundabout', 'Roundabout'),
  toggle('sidebar', 'sidebar'),
  toggle('inspector', 'inspector'),
  {
    id: 'view3d',
    group: 'View',
    name: 'Switch 2D and 3D',
    label: (s) => (s.viewMode === '2d' ? 'Switch to 3D' : 'Switch to 2D'),
    enabled: running,
    run: () => store().toggleView(),
  },
  ...(Object.keys(sections) as Section[]).map(section),
  {
    id: 'commandMenu',
    group: 'Help',
    name: 'Command menu',
    enabled: () => true,
    run: () => store().showSheet(store().sheet === 'commands' ? null : 'commands'),
    insideSheet: true,
  },
  {
    id: 'shortcuts',
    group: 'Help',
    name: 'Keyboard shortcuts',
    enabled: () => true,
    run: () => store().showSheet(store().sheet === 'shortcuts' ? null : 'shortcuts'),
    insideSheet: true,
  },
];

export const byId = Object.fromEntries(commands.map((c) => [c.id, c])) as Record<
  CommandId,
  AppCommand
>;

/** Which commands can run now, by id. */
export const useEnabled = () =>
  useAppStore(
    useShallow(
      (s) =>
        Object.fromEntries(commands.map((c) => [c.id, c.enabled(s)])) as Record<CommandId, boolean>,
    ),
  );

/** The command menu's wording for each command, by id. */
export const useLabels = () =>
  useAppStore(
    useShallow(
      (s) =>
        Object.fromEntries(commands.map((c) => [c.id, c.label?.(s) ?? c.name])) as Record<
          CommandId,
          string
        >,
    ),
  );

/** Runs the bound command on its key. Space is also the map's hold-to-pan key, so it acts when
 *  let go, and only if no pointer gesture came in between. Returns the cleanup. */
export function installShortcuts() {
  let tap: AppCommand | null = null;
  const abandon = () => {
    tap = null;
  };
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || isTyping(event.target)) return;
    const id = bound(event);
    if (!id) return;
    const command = byId[id];
    // A sheet takes the keys, except that the command menu and the shortcut sheet toggle each other.
    const { sheet } = store();
    const ownSheet = sheet === 'commands' || sheet === 'shortcuts';
    if (document.querySelector('dialog[open]') && !(command.insideSheet && ownSheet)) return;
    if (id === 'playPause') {
      if (pressesOnSpace(event.target)) return;
      event.preventDefault();
      if (!event.repeat) tap = command;
      return;
    }
    // Escape first closes a popover that is open; it is not otherwise taken from the page.
    if (id === 'clearSelection' && document.querySelector(':popover-open')) return;
    if (id !== 'clearSelection') event.preventDefault();
    if (!event.repeat && command.enabled(store())) void command.run();
  }
  function keyup(event: KeyboardEvent) {
    if (event.key !== ' ') return;
    const command = tap;
    tap = null;
    if (command?.enabled(store())) void command.run();
  }
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('pointerdown', abandon, true);
  window.addEventListener('wheel', abandon, true);
  window.addEventListener('blur', abandon);
  return () => {
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('pointerdown', abandon, true);
    window.removeEventListener('wheel', abandon, true);
    window.removeEventListener('blur', abandon);
  };
}
