// The Mac control set on one page, for review shots (dev server only: /dev/controls.html).
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CloseButton,
  DisclosureGroup,
  Popover,
  SegmentedControl,
  Sheet,
  Slider,
  Stepper,
  Switch,
  ToolbarButton,
} from '../src/ui/controls';
import type { IconName } from '../src/ui/icons';
import '../src/ui/app.css';

const icons: [IconName, string][] = [
  ['sidebarLeft', 'Sidebar'],
  ['new', 'New'],
  ['import', 'Import'],
  ['open', 'Open'],
  ['save', 'Save'],
  ['export', 'Export'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
  ['play', 'Play'],
  ['pause', 'Pause'],
  ['step', 'Step'],
  ['restart', 'Restart'],
  ['sidebarRight', 'Inspector'],
];

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gallery-row">
      <span className="muted">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function Gallery() {
  const [tool, setTool] = useState('road');
  const [view, setView] = useState('2d');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(60);
  const [lanes, setLanes] = useState(2);
  const [sheet, setSheet] = useState(false);
  return (
    <main className="gallery">
      <section className="gallery-panel">
        <h2>Type</h2>
        <Row label="Body 13">
          <span>Lanes in this direction</span> <strong>Street r:706</strong>
        </Row>
        <Row label="Small 11">
          <small className="muted">Synthetic traffic, not observed traffic</small>
        </Row>
      </section>

      <section className="gallery-panel gallery-toolbar">
        <h2>Toolbar buttons</h2>
        <div className="toolbar">
          {icons.map(([icon, label]) => (
            <ToolbarButton key={icon} icon={icon} label={label} tooltip={label} />
          ))}
          <ToolbarButton label="3D" className="view-toggle" aria-pressed />
          <ToolbarButton icon="play" label="Play disabled" disabled />
        </div>
        <div className="toolbar">
          <span className="muted">Tooltip (shown after a pause on hover, at once on focus)</span>
          <span className="tooltip-anchor demo-open">
            <ToolbarButton icon="save" label="Save" />
            <span role="tooltip" className="tooltip">
              Save the project file
            </span>
          </span>
        </div>
      </section>

      <section className="gallery-panel">
        <h2>Buttons</h2>
        <Row label="Push">
          <button>Split</button> <button>Delete street</button> <button disabled>Disabled</button>
        </Row>
        <Row label="Primary">
          <button className="primary">Accept city</button>{' '}
          <button className="primary" disabled>
            Disabled
          </button>
        </Row>
        <Row label="Toggle">
          <button aria-pressed>On</button> <button aria-pressed={false}>Off</button>
        </Row>
        <Row label="Close">
          <CloseButton label="Close" />
        </Row>
      </section>

      <section className="gallery-panel">
        <h2>Segmented control</h2>
        <Row label="Enabled">
          <SegmentedControl
            label="Tool"
            value={tool}
            onChange={setTool}
            options={['select', 'road', 'place', 'ramp', 'roundabout'].map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
          />
        </Row>
        <Row label="Two">
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
          />
        </Row>
        <Row label="Disabled">
          <SegmentedControl
            label="Tool disabled"
            value="select"
            onChange={() => undefined}
            disabled
            options={[
              { value: 'select', label: 'Select' },
              { value: 'road', label: 'Road' },
            ]}
          />
        </Row>
      </section>

      <section className="gallery-panel">
        <h2>Pop-up menu</h2>
        <Row label="Enabled">
          <select defaultValue="de" aria-label="Marking style">
            <option value="de">Germany</option>
            <option value="us">United States</option>
            <option value="uk">United Kingdom</option>
          </select>{' '}
          <select defaultValue="5" aria-label="Speed">
            <option value="5">×5</option>
          </select>
        </Row>
        <Row label="Disabled">
          <select disabled aria-label="Disabled">
            <option>×1</option>
          </select>
        </Row>
      </section>

      <section className="gallery-panel">
        <h2>Checkbox and switch</h2>
        <Row label="Checkbox">
          <label className="check-row">
            <input type="checkbox" checked={checked} onChange={() => setChecked(!checked)} />
            Lane markings
          </label>
          <label className="check-row">
            <input type="checkbox" defaultChecked={false} />
            Shadows
          </label>
          <label className="check-row">
            <input type="checkbox" disabled defaultChecked />
            Overhead lines (disabled)
          </label>
        </Row>
        <Row label="Switch">
          <Switch label="Record trajectories" checked={on} onChange={() => setOn(!on)} />
          <Switch label="Off" defaultChecked={false} />
          <Switch label="Disabled" disabled />
        </Row>
      </section>

      <section className="gallery-panel">
        <h2>Slider and fields</h2>
        <Row label="Slider">
          <Slider
            aria-label="Share"
            value={level}
            onChange={(event) => setLevel(event.currentTarget.valueAsNumber)}
          />{' '}
          <span className="muted">{level}%</span>
        </Row>
        <Row label="Text">
          <input type="text" aria-label="City name" defaultValue="Munich" />{' '}
          <input type="text" aria-label="Empty" placeholder="Name" />{' '}
          <input type="text" aria-label="Disabled" disabled defaultValue="Disabled" />
        </Row>
        <Row label="Number">
          <label className="edit-field">
            Speed limit (km/h)
            <input type="number" defaultValue={50} />
          </label>
        </Row>
        <Row label="Stepper">
          <Stepper label="Lanes" value={lanes} min={1} max={6} onChange={setLanes} />
        </Row>
      </section>

      <section className="gallery-panel">
        <h2>Disclosure group</h2>
        <div className="sidebar gallery-sidebar">
          <DisclosureGroup title="Map">
            <button className="source-row" aria-expanded>
              Layers
            </button>
          </DisclosureGroup>
          <DisclosureGroup title="Analysis">
            <button className="source-row">Chart</button>
            <button className="source-row">
              Validation <span className="row-count">82</span>
            </button>
          </DisclosureGroup>
          <DisclosureGroup title="Closed" defaultOpen={false}>
            <span>Hidden</span>
          </DisclosureGroup>
        </div>
      </section>

      <section className="gallery-panel gallery-popovers">
        <h2>Popover</h2>
        <div className="gallery-popover-stage">
          <span className="export-control">
            <button aria-expanded>Export</button>
            <Popover aria-label="Below">
              <p>Every 10 simulated seconds while recording.</p>
            </Popover>
          </span>
          <span className="export-control">
            <button aria-expanded>Trip counts</button>
            <Popover placement="above" align="start" aria-label="Above">
              <p>Driving 120 · Completed 30</p>
            </Popover>
          </span>
        </div>
      </section>

      <section className="gallery-panel">
        <h2>Sheet</h2>
        <button className="primary" onClick={() => setSheet(true)}>
          Show sheet
        </button>
        <Sheet title="New city" open={sheet} onClose={() => setSheet(false)} className="new-picker">
          <ul className="scenario-list">
            {['5 × 5 grid', 'Town', 'Station'].map((name) => (
              <li key={name}>
                <button onClick={() => setSheet(false)}>{name}</button>
              </li>
            ))}
          </ul>
        </Sheet>
      </section>
    </main>
  );
}

const style = document.createElement('style');
style.textContent = `
  body { overflow: auto; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 14px; padding: 16px; }
  .gallery-panel { display: grid; align-content: start; gap: 8px; padding: 12px 14px; border-radius: 10px; background: var(--inspector); box-shadow: inset 0 0 0 1px var(--separator); }
  .gallery-toolbar { grid-column: 1 / -1; }
  .gallery-toolbar .toolbar { grid-area: auto; height: 52px; border: 1px solid var(--separator); border-radius: 6px; }
  .gallery-row { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 10px; }
  .gallery-row > div { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .gallery-sidebar { width: 216px; border: 1px solid var(--separator); border-radius: 6px; }
  .gallery-popover-stage { display: flex; justify-content: space-around; padding: 70px 0 70px; }
  .gallery-panel > .primary { justify-self: start; }
  .demo-open > .tooltip { visibility: visible; opacity: 1; }
`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
