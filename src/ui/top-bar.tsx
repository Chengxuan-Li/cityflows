import { lazy, Suspense, useState } from 'react';
import { scenarios } from '../fixtures/scenarios';
import { MenuItem, PopoverButton, Sheet, ToolbarButton, type ToolbarAction } from './controls';
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
  const session = useAppStore((state) => state.session);
  const in3D = useAppStore((state) => state.viewMode === '3d');
  const busy = useAppStore((state) => state.busy);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const inspectorOpen = useAppStore((state) => state.inspectorOpen);
  // A selection made while the inspector is hidden marks its toggle instead of reopening it.
  const waiting = useAppStore((state) => !state.inspectorOpen && state.selection !== null);
  const { open, save, undo, redo, toggleSidebar, toggleInspector } = useAppStore.getState();
  const city = session?.project.city;
  // The file input is looked up when clicked rather than held in a ref: the actions are plain
  // objects shared by the toolbar and its overflow menu.
  const pickFile = () => document.querySelector<HTMLInputElement>('#open-project')!.click();
  const fileActions: ToolbarAction[] = [
    {
      icon: 'new',
      label: 'New',
      tooltip: 'Start from a bundled city',
      'aria-haspopup': 'dialog',
      disabled: busy,
      onClick: () => setPicking(true),
    },
    {
      icon: 'import',
      label: 'Import',
      tooltip: 'Import a city from OpenStreetMap',
      'aria-haspopup': 'dialog',
      disabled: busy,
      onClick: () => setImporting(true),
    },
    {
      icon: 'open',
      label: 'Open',
      tooltip: 'Open a saved project',
      disabled: busy,
      onClick: pickFile,
    },
    {
      icon: 'save',
      label: 'Save',
      tooltip: 'Save the project file',
      disabled: busy || !session,
      onClick: () => void save(),
    },
    {
      icon: 'export',
      label: 'Export',
      tooltip: 'Export data files',
      'aria-haspopup': 'dialog',
      disabled: busy || !session,
      onClick: () => setExporting(true),
    },
  ];
  const historyActions: ToolbarAction[] = [
    {
      icon: 'undo',
      label: 'Undo',
      tooltip: 'Undo the last edit',
      disabled:
        busy ||
        !session?.undoStack.length ||
        (in3D && session.undoStack.at(-1)!.kind === 'city' && !session.editor.canUndoDisplayOnly),
      onClick: () => void undo(),
    },
    {
      icon: 'redo',
      label: 'Redo',
      tooltip: 'Redo the edit',
      disabled:
        busy ||
        !session?.redoStack.length ||
        (in3D && session.redoStack.at(-1)!.kind === 'city' && !session.editor.canRedoDisplayOnly),
      onClick: () => void redo(),
    },
  ];

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
      <div className="toolbar-group ov-file" role="group" aria-label="Project">
        {fileActions.map((action) => (
          <ToolbarButton key={action.label} {...action} />
        ))}
      </div>
      <div className="toolbar-group ov-history" role="group" aria-label="Edit history">
        {historyActions.map((action) => (
          <ToolbarButton key={action.label} {...action} />
        ))}
      </div>
      <Toolbox />
      <RunControls />
      <ToolbarButton
        icon="sidebarRight"
        className={`sidebar-toggle${waiting ? ' waiting' : ''}`}
        label={
          inspectorOpen ? 'Hide inspector' : `Show inspector${waiting ? ', item selected' : ''}`
        }
        tooltip={waiting ? 'An item is selected' : undefined}
        aria-expanded={inspectorOpen}
        aria-controls="inspector-column"
        onClick={toggleInspector}
      />
      <PopoverButton
        label="More toolbar items"
        icon="more"
        className="more-button"
        title="More toolbar items"
      >
        <div className="overflow-menu">
          <div className="menu-group ov-file">
            {fileActions.map((action) => (
              <MenuItem key={action.label} {...action} />
            ))}
          </div>
          <div className="menu-group ov-history">
            {historyActions.map((action) => (
              <MenuItem key={action.label} {...action} />
            ))}
          </div>
          <RunControls inMenu />
        </div>
      </PopoverButton>
      <input
        id="open-project"
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
      {importing && (
        <Suspense fallback={<p role="status">Loading import…</p>}>
          <ImportWizard onClose={() => setImporting(false)} />
        </Suspense>
      )}
      <Sheet title="Export" open={exporting} onClose={() => setExporting(false)}>
        {exporting && <ExportMenu />}
      </Sheet>
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
