// The key bindings: one table from an action to its keys, and the matching and labelling that go
// with it. No React or store here, so the bindings are testable on their own; `commands.ts` gives
// each action its label and what it does.

/** An action's keys, each written `[mod+][shift+]key`: `mod` is ⌘ on a Mac and Ctrl elsewhere, the
 *  key is `event.key` in lower case, `space` and `escape` are named, and `delete` is the key
 *  that deletes (Backspace on a Mac keyboard). The first key is the one shown. */
export const bindings = {
  new: ['mod+n'],
  import: [],
  open: ['mod+o'],
  save: ['mod+s'],
  export: ['mod+shift+s'],
  undo: ['mod+z'],
  redo: ['mod+shift+z'],
  playPause: ['space'],
  step: ['.'],
  restart: ['mod+r'],
  slower: ['['],
  faster: [']'],
  select: ['1'],
  road: ['2'],
  place: ['3'],
  ramp: ['4'],
  roundabout: ['5'],
  sidebar: ['mod+1'],
  inspector: ['mod+2'],
  view3d: ['mod+3', 'v'],
  layers: [],
  chart: [],
  demand: [],
  compare: [],
  validation: [],
  clearSelection: ['escape'],
  deleteSelection: ['delete'],
  commandMenu: ['mod+k'],
  shortcuts: ['mod+/', '?'],
} as const satisfies Record<string, readonly string[]>;

export type CommandId = keyof typeof bindings;

const platform =
  typeof navigator === 'undefined'
    ? ''
    : ((navigator as { userAgentData?: { platform: string } }).userAgentData?.platform ??
      navigator.platform);
export const isMac = /mac|iphone|ipad/i.test(platform);

export type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

function parse(spec: string) {
  const parts = spec.split('+');
  return { key: parts.at(-1)!, mod: parts.includes('mod'), shift: parts.includes('shift') };
}

const normalize = (key: string) => {
  const lower = key.toLowerCase();
  if (lower === ' ') return 'space';
  if (lower === 'esc') return 'escape';
  return lower === 'backspace' ? 'delete' : lower;
};

/** Whether the event is this key. Shift counts for letters, digits and named keys; for a symbol
 *  (`?`, `/`, `[`) it is part of the character and so ignored unless the spec names it. */
export function matches(event: KeyEvent, spec: string, mac = isMac) {
  const { key, mod, shift } = parse(spec);
  if (normalize(event.key) !== key || event.altKey) return false;
  const [modifier, other] = mac ? [event.metaKey, event.ctrlKey] : [event.ctrlKey, event.metaKey];
  if (modifier !== mod || other) return false;
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  return (symbol && !shift) || event.shiftKey === shift;
}

/** The action an event is bound to, if any. */
export function bound(event: KeyEvent, mac = isMac) {
  return (Object.keys(bindings) as CommandId[]).find((id) =>
    bindings[id].some((spec) => matches(event, spec, mac)),
  );
}

/** A key as a Mac menu or a Windows tooltip writes it: ⇧⌘S or Ctrl+Shift+S. */
export function format(spec: string, mac = isMac) {
  const { key, mod, shift } = parse(spec);
  const name =
    (
      {
        space: 'Space',
        escape: 'Esc',
        delete: mac ? '⌫' : 'Delete',
      } as Record<string, string>
    )[key] ?? key.toUpperCase();
  if (mac) return `${shift ? '⇧' : ''}${mod ? '⌘' : ''}${name}`;
  return [mod && 'Ctrl', shift && 'Shift', name].filter(Boolean).join('+');
}

/** Every key of an action, written out; empty when it has none. */
export const labels = (id: CommandId, mac = isMac) => bindings[id].map((spec) => format(spec, mac));

/** A tooltip with its action's first key after it: "Undo the last edit · Ctrl+Z". */
export const withShortcut = (text: string, id: CommandId) =>
  labels(id).length ? `${text} · ${labels(id)[0]}` : text;

type Target = { closest?: (selector: string) => Target | null; tagName?: string; type?: string };

const nonText = [
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'file',
  'image',
  'color',
];

/** Where typing belongs to the field: a text-like input, a select, a text area, editable text. */
export function isTyping(target: EventTarget | null) {
  const field = (target as Target | null)?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
  return !!field && !(field.tagName === 'INPUT' && nonText.includes(field.type ?? ''));
}

/** Where Space already means something: it presses a button, ticks a box, opens a summary. */
export const pressesOnSpace = (target: EventTarget | null) =>
  !!(target as Target | null)?.closest?.(
    'button, summary, a[href], input, [role="button"], [role="switch"], [role="option"], [role="tab"], [role="menuitem"]',
  );
