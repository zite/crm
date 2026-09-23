import * as Sw from '@radix-ui/react-switch';
import * as Cb from '@radix-ui/react-checkbox';
import { Check, MagnifyingGlass, Minus, X } from '@phosphor-icons/react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export const inputClass =
  'h-9 w-full rounded-md border border-control/60 bg-card px-2.5 text-body text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} className={cn(inputClass, invalid && 'border-danger focus:border-danger focus:ring-danger/25', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; invalid?: boolean }>(function Textarea(
  { className, minRows = 4, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={cn(inputClass, 'h-auto min-h-[84px] resize-y py-2 leading-6', invalid && 'border-danger focus:border-danger focus:ring-danger/25', className)}
      {...props}
    />
  );
});

/** Label + control + hint/error. Errors replace the hint so the row never grows. */
export function Field({ label, hint, error, required, children, className, htmlFor, action }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-center gap-2">
          <label htmlFor={htmlFor} className="text-ui font-medium text-ink">
            {label}
            {required && <span className="ml-0.5 text-danger">*</span>}
          </label>
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
      {error ? <p className="text-meta text-danger">{error}</p> : hint ? <p className="text-meta text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function FieldRow({ children, cols = 2, className }: { children: ReactNode; cols?: 2 | 3; className?: string }) {
  return <div className={cn('grid gap-4', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2', className)}>{children}</div>;
}

export function SearchField({ value, onChange, placeholder = 'Search', className, autoFocus, onKeyDown, inputRef }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div className={cn('relative', className)}>
      <MagnifyingGlass size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(inputClass, 'h-8 pl-8 pr-7 text-ui')}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink">
          <X size={12} weight="bold" />
        </button>
      )}
    </div>
  );
}

// Radix renders a <button role="switch">, which a <label htmlFor> cannot name, so
// without one of these a screen reader announces every switch in the app as just
// "switch". The visible text has to be passed in.
export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  label,
  'aria-labelledby': labelledBy,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
  label?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <Sw.Root
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="h-5 w-9 shrink-0 rounded-full border border-transparent bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <Sw.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-card shadow-hairline transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}

export function SwitchRow({ label, description, checked, onCheckedChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} id={`${id}-label`} className="text-ui font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-meta text-ink-2 text-pretty">{description}</p>}
      </div>
      <Switch id={id} aria-labelledby={`${id}-label`} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function Checkbox({ checked, onCheckedChange, indeterminate, className, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; indeterminate?: boolean; className?: string; label?: string; disabled?: boolean }) {
  return (
    <Cb.Root
      checked={indeterminate ? 'indeterminate' : checked}
      onCheckedChange={v => onCheckedChange(v === true)}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-xs border border-control bg-card transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:opacity-50',
        className,
      )}
    >
      <Cb.Indicator className="text-on-accent">{indeterminate ? <Minus size={11} weight="bold" /> : <Check size={12} weight="bold" />}</Cb.Indicator>
    </Cb.Root>
  );
}

/** A small segmented control for two to four exclusive options. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; icon?: ReactNode; title?: string }>; className?: string; size?: 'sm' | 'md' }) {
  // w-fit, not just inline-flex: as a child of a column flex (every settings
  // Group) the default `align-items: stretch` blew the control out to the full
  // column, leaving a wide grey bar beside three options.
  return (
    <div className={cn('inline-flex w-fit items-center gap-0.5 rounded-md bg-sunken p-0.5', className)} role="tablist">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          title={o.title}
          // An icon-only option still needs a name a screen reader can read out.
          aria-label={!o.label && o.title ? o.title : undefined}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-2.5 font-medium transition-colors',
            size === 'sm' ? 'h-7 text-meta' : 'h-8 text-ui',
            value === o.value ? 'bg-card text-ink shadow-hairline' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A native select styled to match inputs — for short, boring lists. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(inputClass, 'select-caret appearance-none bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pr-8', className)} {...props}>
      {children}
    </select>
  );
});
