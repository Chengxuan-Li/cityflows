import { lazy, Suspense } from 'react';
import { scenarios } from '../fixtures/scenarios';
import { MenuItem, PopoverButton, Sheet, ToolbarButton, type ToolbarAction } from './controls';
import { byId, closeSheet, useEnabled } from './commands';
import { ExportMenu } from './export-menu';
import { RunControls } from './run-bar';
import { useAppStore } from './store';
import { Toolbox } from './toolbox';

const ImportWizard = lazy(() => import('./import/wizard'));

/** The unified toolbar: file actions, history, tools, run controls and the sidebar toggles. */
export function TopBar() {
  const sheet = useAppStore((state) => state.sheet);
  const session = useAppStore((state) => state.session);
  const can = useEnabled();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const inspectorOpen = useAppStore((state) => state.inspectorOpen);
  // A selection made while the inspector is hidden marks its toggle instead of reopening it.
  const waiting = useAppStore((state) => !state.inspectorOpen && state.selection !== null);
  const { open, toggleSidebar, toggleInspector } = useAppStore.getState();
  const city = session?.project.city;
  // The actions are plain objects shared by the toolbar and its overflow menu.
  const run = (id: keyof typeof byId) => () => void byId[id].run();
  const fileActions: ToolbarAction[] = [
    {
      icon: 'new',
      label: 'New',
      tooltip: 'Start from a bundled city',
      command: 'new',
      'aria-haspopup': 'dialog',
      disabled: !can.new,
      onClick: run('new'),
    },
    {
      icon: 'import',
      label: 'Import',
      tooltip: 'Import a city from OpenStreetMap',
      'aria-haspopup': 'dialog',
      disabled: !can.import,
      onClick: run('import'),
    },
    {
      icon: 'open',
      label: 'Open',
      tooltip: 'Open a saved project',
      command: 'open',
      disabled: !can.open,
      onClick: run('open'),
    },
    {
      icon: 'save',
      label: 'Save',
      tooltip: 'Save the project file',
      command: 'save',
      disabled: !can.save,
      onClick: run('save'),
    },
    {
      icon: 'export',
      label: 'Export',
      tooltip: 'Export data files',
      command: 'export',
      'aria-haspopup': 'dialog',
      disabled: !can.export,
      onClick: run('export'),
    },
  ];
  const historyActions: ToolbarAction[] = [
    {
      icon: 'undo',
      label: 'Undo',
      tooltip: 'Undo the last edit',
      command: 'undo',
      disabled: !can.undo,
      onClick: run('undo'),
    },
    {
      icon: 'redo',
      label: 'Redo',
      tooltip: 'Redo the edit',
      command: 'redo',
      disabled: !can.redo,
      onClick: run('redo'),
    },
  ];

  return (
    <header className="toolbar">
      <ToolbarButton
        icon="sidebarLeft"
        className="sidebar-toggle"
        label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        command="sidebar"
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
        command="inspector"
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
      {sheet === 'import' && (
        <Suspense fallback={<p role="status">Loading import…</p>}>
          <ImportWizard onClose={() => closeSheet('import')} />
        </Suspense>
      )}
      <Sheet title="Export" open={sheet === 'export'} onClose={() => closeSheet('export')}>
        {sheet === 'export' && <ExportMenu />}
      </Sheet>
      <Sheet
        title="New city"
        open={sheet === 'new'}
        onClose={() => closeSheet('new')}
        className="new-picker"
      >
        <ul className="scenario-list">
          {scenarios.map(({ id, name }) => (
            <li key={id}>
              <button
                onClick={() => {
                  closeSheet('new');
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
