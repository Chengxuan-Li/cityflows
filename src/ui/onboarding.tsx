import { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store';

type State = ReturnType<typeof useAppStore.getState>;
type Side = 'right' | 'left' | 'below' | 'map';

interface Spot {
  /** The card sits beside this element. */
  anchor: Element;
  side: Side;
  /** The control the hint is about; a soft ring marks it. */
  ring?: Element;
}

interface Hint {
  text: string;
  locate: () => Spot | null;
  /** Whether the user has done what the hint asks since it appeared. */
  done: (state: State, start: State, clicked: Element | null) => boolean;
}

const key = 'cityflows.hints';
// Icon buttons carry their name in aria-label; text buttons in their content.
const find = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent) === text,
  ) ?? null;
const map = () => document.querySelector('[aria-label="City map"]');
const streetSettings = () => find('.inspector summary', 'Lanes and street settings');
const onMap = (): Spot | null => {
  const anchor = map();
  return anchor && { anchor, side: 'map' };
};
const beside = (selector: string, text: string, side: Side): Spot | null => {
  const ring = find(selector, text);
  return ring && { anchor: ring, side, ring };
};

const hints: Hint[] = [
  {
    text: 'Choose a city to start from.',
    locate: () => beside('.toolbar button', 'New', 'below'),
    done: (state, start) => state.session?.engine !== start.session?.engine,
  },
  {
    text: 'Press Play to start the day.',
    locate: () => beside('.run-controls button', 'Play', 'below'),
    done: (state) => state.run?.status === 'playing',
  },
  {
    text: 'Click a car to see its trip and why it waits.',
    locate: onMap,
    done: (state) => state.selection?.kind === 'vehicle',
  },
  {
    text: 'Click a street, then open its settings to change lanes or class.',
    locate: () => {
      const ring = streetSettings();
      return ring ? { anchor: ring, side: 'left', ring } : onMap();
    },
    done: () => (streetSettings()?.parentElement as HTMLDetailsElement | undefined)?.open === true,
  },
  {
    text: 'Restart to replay the day with your edits.',
    locate: () => beside('.run-controls button', 'Restart', 'below'),
    done: (_state, _start, clicked) =>
      clicked !== null && clicked.closest('button') === find('.run-controls button', 'Restart'),
  },
  {
    text: 'Compare runs before and after an edit.',
    locate: () => beside('.sidebar button', 'Compare', 'right'),
    done: (state) => state.compareOpen,
  },
];

// Storage can throw in private windows or when blocked; hints then simply show again next time.
function read() {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

/** The hint to show on load: `?hints` reopens the sequence, otherwise resume until done. */
function initialStep() {
  if (new URLSearchParams(location.search).has('hints')) return 0;
  const value = read();
  if (value === 'done') return null;
  const step = Number(value);
  if (value !== null && Number.isInteger(step) && step >= 0 && step < hints.length) return step;
  // Test builds start without hints so scenarios see the map unobstructed; `?hints` or
  // `window.cityflows.resetHints()` opens them.
  return import.meta.env.MODE === 'test' ? null : 0;
}

function place(card: HTMLElement, ring: HTMLElement, { anchor, side, ring: target }: Spot) {
  const rect = anchor.getBoundingClientRect();
  const { width, height } = card.getBoundingClientRect();
  const gap = 10;
  const inset = 16;
  let left = rect.left;
  let top = rect.top;
  if (side === 'right' && rect.right + gap + width <= innerWidth - inset) left = rect.right + gap;
  else if (side === 'right') top = rect.bottom + gap;
  else if (side === 'left') left = rect.left - gap - width;
  else if (side === 'below') {
    left = rect.left + (rect.width - width) / 2;
    top = rect.bottom + gap;
  } else {
    left = rect.left + (rect.width - width) / 2;
    top = rect.top + 72;
  }
  card.style.left = `${Math.max(inset, Math.min(left, innerWidth - inset - width))}px`;
  card.style.top = `${Math.max(inset, Math.min(top, innerHeight - inset - height))}px`;
  const marked = target?.getBoundingClientRect();
  ring.hidden = !marked;
  if (marked) {
    ring.style.left = `${marked.left - 3}px`;
    ring.style.top = `${marked.top - 3}px`;
    ring.style.width = `${marked.width + 6}px`;
    ring.style.height = `${marked.height + 6}px`;
  }
}

export function Onboarding() {
  const [step, setStep] = useState(initialStep);
  const card = useRef<HTMLElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const sheetOpen = useAppStore(
    (state) => !!state.selection || state.selectedRoads.length > 0 || state.diagnosticsOpen,
  );

  function go(next: number | null) {
    const finished = next === null || next >= hints.length;
    write(finished ? 'done' : String(next));
    setStep(finished ? null : next);
  }

  useEffect(() => {
    if (window.cityflows) window.cityflows.resetHints = () => go(0);
  }, []);

  useEffect(() => {
    if (step === null) return;
    const hint = hints[step]!;
    let start: State | null = null;
    let clicked: Element | null = null;
    let frame = 0;
    const click = (event: MouseEvent) => {
      clicked = event.target as Element;
    };
    // Targets move as sheets open and the window resizes, so the card follows them each frame.
    // The loop stops when the hint is done; the next hint's effect starts its own.
    const follow = () => {
      const state = useAppStore.getState();
      const spot = state.session ? hint.locate() : null;
      card.current!.hidden = !spot;
      if (!spot) ring.current!.hidden = true;
      else {
        start ??= state;
        if (hint.done(state, start, clicked)) return go(step + 1);
        place(card.current!, ring.current!, spot);
      }
      frame = requestAnimationFrame(follow);
    };
    document.addEventListener('click', click, true);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', click, true);
    };
  }, [step]);

  if (step === null) {
    return sheetOpen ? null : (
      <button className="show-hints" onClick={() => go(0)}>
        Show hints
      </button>
    );
  }
  const last = step === hints.length - 1;
  return (
    <>
      <div ref={ring} className="hint-ring" aria-hidden="true" hidden />
      <section ref={card} className="hint" aria-label="Hint" aria-live="polite" hidden>
        <p>{hints[step]!.text}</p>
        <div className="controls">
          <small className="muted">
            {step + 1} of {hints.length}
          </small>
          <button onClick={() => go(null)}>Skip</button>
          <button onClick={() => go(step + 1)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </section>
    </>
  );
}
