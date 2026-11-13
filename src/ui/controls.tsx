import {
  useEffect,
  useId,
  useRef,
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

/** A number field with a Mac stepper beside it. */
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
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
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
        <span className="stepper">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${label}`}
            disabled={value >= max}
            onClick={() => onChange(clamp(value + step))}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${label}`}
            disabled={value <= min}
            onClick={() => onChange(clamp(value - step))}
          />
        </span>
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

/** A collapsible group with a heading, open by default. */
export function DisclosureGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="disclosure-group" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
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
