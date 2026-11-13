import { describe, expect, it, vi } from 'vitest';
import {
  bindings,
  bound,
  format,
  isTyping,
  labels,
  matches,
  pressesOnSpace,
  withShortcut,
  type CommandId,
  type KeyEvent,
} from './shortcuts';

const press = (key: string, modifiers: Partial<KeyEvent> = {}): KeyEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});
/** An element that answers `closest` for the selectors it is given, as a DOM element would. */
const element = (tagName: string, type?: string) => {
  const self = {
    tagName,
    type,
    closest: (selector: string) => (selector.includes(tagName.toLowerCase()) ? self : null),
  };
  return self as unknown as EventTarget;
};

describe('bindings', () => {
  it('give every key to one action only', () => {
    const keys: string[] = Object.values(bindings).flat();
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of keys)
      expect(spec).toMatch(/^(mod\+)?(shift\+)?([a-z0-9.[\]/?]|space|escape|delete)$/);
  });

  it('name a command each, and every command a binding entry', async () => {
    // The store reads the window's media queries as it is created.
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const { commands } = await import('./commands');
    expect(commands.map((c) => c.id).sort()).toEqual(Object.keys(bindings).sort());
  });

  it('cover the keys of the brief', () => {
    const keyOf = (id: CommandId) => bindings[id][0];
    expect(
      ['new', 'open', 'save', 'export', 'undo', 'redo'].map((id) => keyOf(id as CommandId)),
    ).toEqual(['mod+n', 'mod+o', 'mod+s', 'mod+shift+s', 'mod+z', 'mod+shift+z']);
    expect(
      ['playPause', 'step', 'restart', 'slower', 'faster'].map((id) => keyOf(id as CommandId)),
    ).toEqual(['space', '.', 'mod+r', '[', ']']);
    expect(
      ['select', 'road', 'place', 'ramp', 'roundabout'].map((id) => keyOf(id as CommandId)),
    ).toEqual(['1', '2', '3', '4', '5']);
    expect(bindings.shortcuts).toEqual(['mod+/', '?']);
  });
});

describe('matches', () => {
  it('takes ⌘ on a Mac and Ctrl elsewhere, and never the other one', () => {
    expect(matches(press('z', { metaKey: true }), 'mod+z', true)).toBe(true);
    expect(matches(press('z', { ctrlKey: true }), 'mod+z', true)).toBe(false);
    expect(matches(press('z', { ctrlKey: true }), 'mod+z', false)).toBe(true);
    expect(matches(press('z', { metaKey: true }), 'mod+z', false)).toBe(false);
    expect(matches(press('z'), 'mod+z', false)).toBe(false);
  });

  it('tells undo from redo by Shift, and a tool key from the view key by the modifier', () => {
    const shifted = press('Z', { ctrlKey: true, shiftKey: true });
    expect(bound(shifted, false)).toBe('redo');
    expect(bound(press('z', { ctrlKey: true }), false)).toBe('undo');
    expect(bound(press('2'), false)).toBe('road');
    expect(bound(press('2', { ctrlKey: true }), false)).toBe('inspector');
    expect(bound(press('S', { metaKey: true, shiftKey: true }), true)).toBe('export');
    expect(bound(press('s', { metaKey: true }), true)).toBe('save');
  });

  it('ignores Alt, so typed characters and system chords stay out', () => {
    expect(matches(press('s', { ctrlKey: true, altKey: true }), 'mod+s', false)).toBe(false);
    expect(bound(press('1', { altKey: true }), false)).toBeUndefined();
  });

  it('reads named keys and symbols as typed', () => {
    expect(bound(press(' '), false)).toBe('playPause');
    expect(bound(press('Escape'), false)).toBe('clearSelection');
    expect(bound(press('Backspace'), false)).toBe('deleteSelection');
    expect(bound(press('Delete'), false)).toBe('deleteSelection');
    expect(bound(press('?', { shiftKey: true }), false)).toBe('shortcuts');
    expect(bound(press('/', { ctrlKey: true }), false)).toBe('shortcuts');
    expect(bound(press('/'), false)).toBeUndefined();
    expect(bound(press('['), false)).toBe('slower');
    expect(bound(press('v'), false)).toBe('view3d');
    expect(bound(press('x'), false)).toBeUndefined();
  });
});

describe('labels', () => {
  it('write ⇧⌘S for a Mac and Ctrl+Shift+S elsewhere', () => {
    expect(format('mod+shift+s', true)).toBe('⇧⌘S');
    expect(format('mod+shift+s', false)).toBe('Ctrl+Shift+S');
    expect(format('mod+/', true)).toBe('⌘/');
    expect(format('space', true)).toBe('Space');
    expect(format('escape', false)).toBe('Esc');
    expect(format('delete', true)).toBe('⌫');
    expect(format('delete', false)).toBe('Delete');
    expect(format('?', false)).toBe('?');
  });

  it('list every key of an action, and none for an action without one', () => {
    expect(labels('view3d', false)).toEqual(['Ctrl+3', 'V']);
    expect(labels('import', false)).toEqual([]);
  });

  it('follow a tooltip with the first key', () => {
    expect(withShortcut('Undo the last edit', 'undo').startsWith('Undo the last edit · ')).toBe(
      true,
    );
    expect(withShortcut('Import a city', 'import')).toBe('Import a city');
  });
});

describe('typing', () => {
  it('holds the keys while the focus is in a text, number or select field', () => {
    for (const tag of ['input', 'textarea', 'select'])
      expect(isTyping(element(tag.toUpperCase(), 'text'))).toBe(true);
    expect(isTyping(element('INPUT', 'number'))).toBe(true);
  });

  it('lets them through from the map, buttons, checkboxes and sliders', () => {
    expect(isTyping(null)).toBe(false);
    expect(isTyping({} as EventTarget)).toBe(false);
    expect(isTyping(element('BUTTON'))).toBe(false);
    for (const type of ['checkbox', 'radio', 'range'])
      expect(isTyping(element('INPUT', type))).toBe(false);
  });

  it('keeps Space for what presses on it', () => {
    expect(pressesOnSpace(element('BUTTON'))).toBe(true);
    expect(pressesOnSpace(element('INPUT', 'checkbox'))).toBe(true);
    expect(pressesOnSpace(element('CANVAS'))).toBe(false);
    expect(pressesOnSpace(null)).toBe(false);
  });
});
