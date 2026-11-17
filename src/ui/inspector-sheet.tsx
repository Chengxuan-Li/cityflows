import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { CloseButton } from './controls';
import { useAppStore } from './store';

type Snap = 'half' | 'full';

/** Release speed (px/ms) above which a drag is a flick that moves one step. */
const flick = 0.5;
/** Finger travel (px) before a press on the grabber becomes a drag rather than a tap. */
const slop = 6;
/** Where a slow release lands, as a share of the full height: nearer 0 closes, past `fullFrom`
 *  goes full. Half height is a little over half of full, so these sit midway between the stops. */
const closeBelow = 0.28;
const fullFrom = 0.77;

interface Gesture {
  y: number;
  height: number;
  max: number;
  moved: boolean;
  samples: { y: number; t: number }[];
}

/** TASK-189: under 600 px the inspector is a bottom sheet over the map (a Mac-style grabber, no
 *  glass). It opens at half height; a drag on the grabber or a tap moves it between half and full
 *  height, a downward flick or Escape (the clear-selection shortcut) closes it. The sheet's height
 *  comes from app.css (`data-sheet`); only a drag in progress sets it here. */
export function InspectorSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snap>('half');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const column = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);

  // The map keeps the selection above the sheet (TASK-196): report each height it settles at.
  useEffect(() => {
    const sheet = column.current!;
    const { setSheetHeight } = useAppStore.getState();
    const observer = new ResizeObserver(() => {
      if (sheet.dataset.dragging === undefined) setSheetHeight(sheet.offsetHeight);
    });
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      setSheetHeight(null);
    };
  }, []);

  function start(event: PointerEvent<HTMLButtonElement>) {
    const sheet = column.current!;
    const area = sheet.parentElement!.querySelector('.map-view')!.clientHeight;
    const gap = parseFloat(getComputedStyle(sheet).getPropertyValue('--sheet-gap'));
    gesture.current = {
      y: event.clientY,
      height: sheet.offsetHeight,
      max: area - gap,
      moved: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
    swallowClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function heightAt(g: Gesture, y: number) {
    return Math.min(g.max, Math.max(0, g.height - (y - g.y)));
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || (!g.moved && Math.abs(event.clientY - g.y) < slop)) return;
    g.moved = true;
    g.samples = [...g.samples, { y: event.clientY, t: event.timeStamp }].filter(
      ({ t }) => event.timeStamp - t <= 100,
    );
    setDragHeight(heightAt(g, event.clientY));
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) return;
    swallowClick.current = true;
    const first = g.samples[0]!;
    const last = g.samples.at(-1)!;
    const speed = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const share = heightAt(g, event.clientY) / g.max;
    const next =
      Math.abs(speed) > flick && event.timeStamp - last.t <= 100
        ? speed < 0
          ? 'full'
          : snap === 'full'
            ? 'half'
            : 'close'
        : share < closeBelow
          ? 'close'
          : share < fullFrom
            ? 'half'
            : 'full';
    setDragHeight(null);
    if (next === 'close') useAppStore.getState().select(null);
    else setSnap(next);
  }

  function key(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowUp') setSnap('full');
    else if (event.key === 'ArrowDown') setSnap('half');
    else return;
    event.preventDefault();
  }

  return (
    <div
      id="inspector-column"
      ref={column}
      className="inspector-column"
      data-sheet={snap}
      data-dragging={dragHeight === null ? undefined : ''}
      style={dragHeight === null ? undefined : { height: dragHeight }}
    >
      <div className="sheet-grab">
        <button
          type="button"
          className="sheet-grabber"
          aria-label={snap === 'full' ? 'Shrink inspector' : 'Expand inspector'}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => {
            gesture.current = null;
            setDragHeight(null);
          }}
          onClick={() => {
            if (swallowClick.current) swallowClick.current = false;
            else setSnap(snap === 'full' ? 'half' : 'full');
          }}
          onKeyDown={key}
        />
        <CloseButton label="Close inspector" onClick={() => useAppStore.getState().select(null)} />
      </div>
      {children}
    </div>
  );
}
