// Toolbar glyphs drawn for CityFlows on a 16 px grid in the manner of the macOS toolbar: 1.5 px
// strokes in the current text colour, filled shapes only for the transport controls.
const tray =
  'M5 6.5H4a1.5 1.5 0 0 0-1.5 1.5v4.75a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V8A1.5 1.5 0 0 0 12 6.5h-1';

const strokes = {
  sidebarLeft:
    'M3 2.75h10a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-7.5A1.5 1.5 0 0 1 3 2.75ZM6 2.75v10.5M3.25 5.25h1M3.25 7.25h1',
  sidebarRight:
    'M3 2.75h10a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-7.5A1.5 1.5 0 0 1 3 2.75ZM10 2.75v10.5M11.75 5.25h1M11.75 7.25h1',
  new: 'M9.25 1.75h-4.5a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5V5.25ZM9.25 1.75v3.5h3.5M8 7.25v4.5M5.75 9.5h4.5',
  import:
    'M1.75 3.75 5.5 2.25l5 1.75 3.75-1.5v9.75l-3.75 1.5-5-1.75-3.75 1.5ZM5.5 2.25v9.75M10.5 4v9.75',
  open: 'M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h2.9l1.6 1.6h5a1.5 1.5 0 0 1 1.5 1.5v6.4a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5ZM1.75 6.75h12.5',
  save: `${tray}M8 1.75v8M5.25 7 8 9.75 10.75 7`,
  export: `${tray}M8 10V1.75M5.25 4.5 8 1.75l2.75 2.75`,
  undo: 'M5.25 3.25 2.25 6.25l3 3M2.5 6.25h6.75a3.5 3.5 0 0 1 0 7H6.5',
  redo: 'M10.75 3.25l3 3-3 3M13.5 6.25H6.75a3.5 3.5 0 0 0 0 7H9.5',
  close: 'M5 5l6 6M11 5l-6 6',
  restart: 'M2.5 8.5a5.5 5.5 0 1 0 1.65-3.93M2.25 2.25v3h3',
};

const fills = {
  play: 'M4.5 2.9v10.2a.6.6 0 0 0 .92.5l7.9-5.1a.6.6 0 0 0 0-1L5.42 2.4a.6.6 0 0 0-.92.5Z',
  pause:
    'M3.75 2.5h2a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-9.5a.75.75 0 0 1 .75-.75ZM10.25 2.5h2a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-9.5a.75.75 0 0 1 .75-.75Z',
  step: 'M2.75 3.4v9.2a.6.6 0 0 0 .94.5l6.55-4.6a.6.6 0 0 0 0-1L3.69 2.9a.6.6 0 0 0-.94.5ZM11.5 2.75h1.25a.75.75 0 0 1 .75.75v9a.75.75 0 0 1-.75.75H11.5a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75Z',
};

export type IconName = keyof typeof strokes | keyof typeof fills;

export function Icon({ name }: { name: IconName }) {
  const filled = name in fills;
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d={filled ? fills[name as keyof typeof fills] : strokes[name as keyof typeof strokes]}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
