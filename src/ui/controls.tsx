import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';

/** A borderless toolbar button: an icon or a short label, its tooltip below it on hover or focus. */
export function ToolbarButton({
  icon,
  label,
  tooltip,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; label: string; tooltip?: string }) {
  const id = useId();
  return (
    <span className="tooltip-anchor">
      <button
        {...props}
        className={`toolbar-button${className ? ` ${className}` : ''}`}
        aria-label={icon ? label : undefined}
        aria-describedby={tooltip ? id : undefined}
      >
        {icon ? <Icon name={icon} /> : (children ?? label)}
      </button>
      {tooltip && (
        <span role="tooltip" id={id} className="tooltip">
          {tooltip}
        </span>
      )}
    </span>
  );
}

/** A toolbar action, drawn as a toolbar button or, when the toolbar overflows, a menu item. */
export type ToolbarAction = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  tooltip?: string;
};

/** A toolbar action inside the overflow menu: its glyph and its name as text. */
export function MenuItem({ icon, label, tooltip, className, onClick, ...props }: ToolbarAction) {
  return (
    <button
      {...props}
      className={`menu-item${className ? ` ${className}` : ''}`}
      title={tooltip}
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
        onClick?.(event);
      }}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}

/** One choice among a few, as a row of pressed buttons (a Mac segmented control). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  as: Element = 'div',
}: {
  label: string;
  options: { value: T; label: string; tooltip?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  as?: 'div' | 'nav';
}) {
  const id = useId();
  return (
    <Element
      className="segmented"
      role={Element === 'div' ? 'group' : undefined}
      aria-label={label}
    >
      {options.map((option, index) => (
        <span key={option.value} className="tooltip-anchor">
          <button
            aria-pressed={option.value === value}
            disabled={disabled}
            aria-describedby={option.tooltip ? `${id}-${index}` : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
          {option.tooltip && (
            <span role="tooltip" id={`${id}-${index}`} className="tooltip">
              {option.tooltip}
            </span>
          )}
        </span>
      ))}
    </Element>
  );
}

/** A checkbox drawn as a switch; the role tells assistive technology it acts at once. */
export function Switch({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="switch">
      <input {...props} type="checkbox" role="switch" />
      {label}
    </label>
  );
}

/** A range slider whose track fills with the accent up to the knob. */
export function Slider({
  value,
  min = 0,
  max = 100,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'min' | 'max'> & {
  value: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
    />
  );
}

/** The Mac stepper beside a number field. Mouse only, as on the Mac: the field keeps the keyboard
 *  (arrow keys), and the arrows stay out of the accessibility tree so the field's name is its own. */
export function StepperArrows({
  onStep,
  canIncrease,
  canDecrease,
}: {
  onStep: (direction: 1 | -1) => void;
  canIncrease: boolean;
  canDecrease: boolean;
}) {
  return (
    <span className="stepper" aria-hidden="true">
      {([1, -1] as const).map((direction) => {
        const enabled = direction === 1 ? canIncrease : canDecrease;
        return (
          <span
            key={direction}
            data-disabled={enabled ? undefined : ''}
            onPointerDown={(event) => {
              event.preventDefault();
              if (enabled) onStep(direction);
            }}
          />
        );
      })}
    </span>
  );
}

/** A labelled number field with a stepper that changes the value at once. */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="edit-field">
      {label}
      <span className="stepper-field">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            if (event.currentTarget.validity.valid) onChange(event.currentTarget.valueAsNumber);
          }}
        />
        <StepperArrows
          canIncrease={value < max}
          canDecrease={value > min}
          onStep={(direction) => onChange(Math.min(max, Math.max(min, value + direction * step)))}
        />
      </span>
    </label>
  );
}

/** The small round close button of sheets and the inspector. */
export function CloseButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      className={`close-button${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      <Icon name="close" />
    </button>
  );
}

/** A collapsible section: a header button that shows or hides its body. Controlled through
 *  `open` and `onToggle`, or open by default and self-managed. */
export function DisclosureGroup({
  title,
  label,
  count,
  open: controlled,
  onToggle,
  defaultOpen = true,
  controls,
  disabled,
  children,
}: {
  title: string;
  label?: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  controls?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const body = useId();
  const open = controlled ?? own;
  return (
    <section className="disclosure-group">
      <button
        className="disclosure-header"
        aria-expanded={open}
        aria-controls={open ? (controls ?? body) : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (onToggle ? onToggle() : setOwn(!own))}
      >
        {title}
        {count !== undefined && (
          <span className="row-count" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="disclosure-body" id={controls ? undefined : body}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A pull-down button whose popover (top layer, light dismiss, Escape) sits under it with an
 *  arrow, kept inside the window. For an edit that belongs to one item of the inspector. */
export function PopoverButton({
  label,
  title,
  icon,
  className,
  onOpen,
  children,
}: {
  label: string;
  title?: string;
  icon?: IconName;
  className?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const width = 300;
  return (
    <>
      <button
        ref={button}
        className={`${icon ? 'toolbar-button' : 'pull-down'}${className ? ` ${className}` : ''}`}
        popoverTarget={id}
        aria-expanded={open}
        aria-controls={id}
        aria-label={icon ? label : undefined}
      >
        {icon ? <Icon name={icon} /> : label}
      </button>
      <section
        id={id}
        popover="auto"
        className="popover anchored"
        aria-label={title ?? label}
        style={{ width }}
        onBeforeToggle={(event) => {
          if (event.newState !== 'open') return;
          // Placed before it shows, so it never flashes at the default centre.
          const anchor = button.current!.getBoundingClientRect();
          const centre = anchor.left + anchor.width / 2;
          const left = Math.max(8, Math.min(innerWidth - 8 - width, centre - width / 2));
          const panel = event.currentTarget;
          panel.style.left = `${left}px`;
          panel.style.setProperty('--arrow', `${centre - left}px`);
          // Below the button, or above it when the room below is short; the body scrolls in
          // whatever room there is.
          const below = innerHeight - anchor.bottom - 24;
          const above = anchor.top - 24;
          const down = below >= 240 || below >= above;
          panel.dataset.placement = down ? 'below' : 'above';
          panel.style.top = down ? `${anchor.bottom + 10}px` : '';
          panel.style.bottom = down ? '' : `${innerHeight - anchor.top + 10}px`;
          panel.style.setProperty('--room', `${(down ? below : above) - 20}px`);
        }}
        onToggle={(event) => {
          setOpen(event.newState === 'open');
          if (event.newState === 'open') onOpen?.();
        }}
      >
        <div className="popover-body">{children}</div>
      </section>
    </>
  );
}

/** A floating panel with an arrow toward the control that opened it. */
export function Popover({
  placement = 'below',
  align = 'center',
  className,
  children,
  ...props
}: {
  placement?: 'below' | 'above';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={`popover${className ? ` ${className}` : ''}`}
      data-placement={placement}
      data-align={align}
    >
      {children}
    </section>
  );
}

/** A modal sheet that drops from under the toolbar; Escape or the close button dismisses it. */
export function Sheet({
  title,
  open,
  onClose,
  className,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`sheet${className ? ` ${className}` : ''}`}
      aria-labelledby={id}
      onClose={onClose}
    >
      <div className="sheet-heading">
        <h2 id={id}>{title}</h2>
        <CloseButton label={`Close ${title}`} onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}

/** The draggable inner edge of a sidebar, as in a Mac split view: drag or arrow keys resize it,
 *  a double click restores its default width. `edge` is the side of the column it sits on. */
export function ResizeHandle({
  label,
  edge,
  value,
  min,
  max,
  onChange,
  onReset,
  className,
}: {
  label: string;
  edge: 'start' | 'end';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  className: string;
}) {
  const sign = edge === 'end' ? 1 : -1;
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`resize-handle ${className}`}
      onPointerDown={(event) => {
        const handle = event.currentTarget;
        const start = event.clientX;
        handle.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent) => onChange(clamp(value + sign * (next.clientX - start)));
        handle.addEventListener('pointermove', move);
        handle.addEventListener('lostpointercapture', () =>
          handle.removeEventListener('pointermove', move),
        );
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = { ArrowRight: 16, ArrowLeft: -16 }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        onChange(clamp(value + sign * step));
      }}
    />
  );
}
