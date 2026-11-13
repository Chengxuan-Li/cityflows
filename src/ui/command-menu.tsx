import { useEffect, useState } from 'react';
import { closeSheet, commands, useEnabled, useLabels, type AppCommand } from './commands';
import { Sheet } from './controls';
import { labels, matches } from './shortcuts';
import { useAppStore } from './store';

const groups = [...new Set(commands.map((c) => c.group))];

function Commands() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const enabled = useEnabled();
  const wording = useLabels();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = commands.filter(
    (c) =>
      c.id !== 'commandMenu' &&
      words.every((word) => `${c.group} ${wording[c.id]}`.toLowerCase().includes(word)),
  );
  const current = found[Math.min(active, found.length - 1)];

  useEffect(() => {
    if (current)
      document.getElementById(`command-${current.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function choose(command: AppCommand | undefined) {
    if (!command || !enabled[command.id]) return;
    closeSheet('commands');
    void command.run();
  }

  return (
    <>
      <input
        type="text"
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls="command-list"
        aria-activedescendant={current && `command-${current.id}`}
        placeholder="Search commands"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
          if (step !== undefined && found.length) {
            event.preventDefault();
            setActive((Math.min(active, found.length - 1) + step + found.length) % found.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(current);
          } else if (matches(event, 'mod+k')) {
            event.preventDefault();
            closeSheet('commands');
          }
        }}
      />
      <div id="command-list" role="listbox" aria-label="Commands" className="command-list">
        {groups.map((group) => {
          const rows = found.filter((c) => c.group === group);
          return (
            rows.length > 0 && (
              <div key={group} role="group" aria-label={group}>
                <p className="command-group" aria-hidden="true">
                  {group}
                </p>
                {rows.map((command) => (
                  <div
                    key={command.id}
                    id={`command-${command.id}`}
                    role="option"
                    aria-selected={command === current}
                    aria-disabled={!enabled[command.id]}
                    className="command-row"
                    onPointerMove={() => setActive(found.indexOf(command))}
                    onClick={() => choose(command)}
                  >
                    {wording[command.id]}
                    {labels(command.id).length > 0 && <kbd>{labels(command.id)[0]}</kbd>}
                  </div>
                ))}
              </div>
            )
          );
        })}
        {found.length === 0 && <p className="muted">No matching command</p>}
      </div>
    </>
  );
}

/** The command menu (⌘K): every command, searchable, run with the arrow keys and Enter. */
export function CommandMenu() {
  const open = useAppStore((state) => state.sheet === 'commands');
  // The sheet shows after its content renders, and the search field takes the focus then.
  useEffect(() => {
    if (open) document.querySelector<HTMLInputElement>('.command-menu input')?.focus();
  }, [open]);
  return (
    <Sheet
      title="Commands"
      open={open}
      onClose={() => closeSheet('commands')}
      className="command-menu"
    >
      {open && <Commands />}
    </Sheet>
  );
}

/** Every key binding, by group. */
export function ShortcutSheet() {
  const open = useAppStore((state) => state.sheet === 'shortcuts');
  return (
    <Sheet
      title="Keyboard shortcuts"
      open={open}
      onClose={() => closeSheet('shortcuts')}
      className="shortcut-sheet"
    >
      {open && (
        <div className="shortcut-groups">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {commands
                  .filter((c) => c.group === group && labels(c.id).length > 0)
                  .map((command) => (
                    <div key={command.id}>
                      <dt>{command.name}</dt>
                      <dd>
                        {labels(command.id).map((label) => (
                          <kbd key={label}>{label}</kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
