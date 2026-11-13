import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { scenarios } from '../fixtures/scenarios';
import { Sheet, ToolbarButton } from './controls';
import { ExportMenu } from './export-menu';
import { RunControls } from './run-bar';
import { useAppStore } from './store';
import { Toolbox } from './toolbox';

const ImportWizard = lazy(() => import('./import/wizard'));

/** The unified toolbar: file actions, history, tools, run controls and the sidebar toggles. */
export function TopBar() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [picking, setPicking] = useState(false);
  // Stable, so the menu's Escape listener is not re-attached mid-keystroke when the window
  // re-renders on the same Escape (closing the inspector), which would skip it.
  const closeExport = useCallback(() => setExporting(false), []);
  const input = useRef<HTMLInputElement>(null);
  const session = useAppStore((state) => state.session);
  const in3D = useAppStore((state) => state.viewMode === '3d');
  const busy = useAppStore((state) => state.busy);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const inspectorOpen = useAppStore((state) => state.inspectorOpen);
  const { open, save, undo, redo, toggleSidebar, toggleInspector } = useAppStore.getState();
  const city = session?.project.city;

  return (
    <header className="toolbar">
      <ToolbarButton
        icon="sidebarLeft"
        className="sidebar-toggle"
        label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        onClick={toggleSidebar}
      />
      <div className="toolbar-title">
        <h1>{city?.name ?? 'CityFlows'}</h1>
        {city && <small>CityFlows</small>}
      </div>
      <div className="toolbar-group" role="group" aria-label="Project">
        <ToolbarButton
          icon="new"
          label="New"
          tooltip="Start from a bundled city"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => setPicking(true)}
        />
        <ToolbarButton
          icon="import"
          label="Import"
          tooltip="Import a city from OpenStreetMap"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => setImporting(true)}
        />
        <ToolbarButton
          icon="open"
          label="Open"
          tooltip="Open a saved project"
          disabled={busy}
          onClick={() => input.current?.click()}
        />
        <input
          ref={input}
          type="file"
          accept=".cityflows,.zip,.json,application/zip,application/json"
          aria-label="Open project"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void open(file);
          }}
        />
        <ToolbarButton
          icon="save"
          label="Save"
          tooltip="Save the project file"
          disabled={busy || !session}
          onClick={() => void save()}
        />
        <div className="export-control">
          <ToolbarButton
            icon="export"
            label="Export"
            tooltip="Export data files"
            disabled={busy || !session}
            aria-expanded={exporting}
            aria-controls="export-menu"
            onClick={() => setExporting(!exporting)}
          />
          {exporting && <ExportMenu onClose={closeExport} />}
        </div>
      </div>
      <div className="toolbar-group" role="group" aria-label="Edit history">
        <ToolbarButton
          icon="undo"
          label="Undo"
          tooltip="Undo the last edit"
          disabled={
            busy ||
            !session?.undoStack.length ||
            (in3D &&
              session.undoStack.at(-1)!.kind === 'city' &&
              !session.editor.canUndoDisplayOnly)
          }
          onClick={() => void undo()}
        />
        <ToolbarButton
          icon="redo"
          label="Redo"
          tooltip="Redo the edit"
          disabled={
            busy ||
            !session?.redoStack.length ||
            (in3D &&
              session.redoStack.at(-1)!.kind === 'city' &&
              !session.editor.canRedoDisplayOnly)
          }
          onClick={() => void redo()}
        />
      </div>
      <Toolbox />
      <RunControls />
      <ToolbarButton
        icon="sidebarRight"
        className="sidebar-toggle"
        label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        aria-expanded={inspectorOpen}
        aria-controls="inspector-column"
        onClick={toggleInspector}
      />
      {importing && (
        <Suspense fallback={<p role="status">Loading import…</p>}>
          <ImportWizard onClose={() => setImporting(false)} />
        </Suspense>
      )}
      <Sheet
        title="New city"
        open={picking}
        onClose={() => setPicking(false)}
        className="new-picker"
      >
        <ul className="scenario-list">
          {scenarios.map(({ id, name }) => (
            <li key={id}>
              <button
                onClick={() => {
                  setPicking(false);
                  void open(id);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </header>
  );
}
