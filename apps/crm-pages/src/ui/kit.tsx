import { CircleNotch, Warning } from '@phosphor-icons/react';
import { clsx, type ClassValue } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

/**
 * The public pages' kit: deliberately small. One column, generous spacing,
 * 44px touch targets, and the organization's accent used once per page.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; size?: 'md' | 'lg' }>(function Button(
  { className, variant = 'secondary', loading, size = 'md', children, disabled, type, ...rest },
  ref,
) {
  const variants = {
    primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
    secondary: 'border border-line-strong bg-card text-ink hover:bg-hover',
    ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  };
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium transition disabled:pointer-events-none disabled:opacity-50',
        size === 'lg' ? 'h-12 px-5 text-body' : 'h-11 px-4 text-body',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <CircleNotch size={16} className="animate-spin" weight="bold" />}
      {children}
    </button>
  );
});

export function Page({ children, className, width = 'md' }: { children: ReactNode; className?: string; width?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className="min-h-dvh bg-paper px-4 py-8 sm:py-14">
      <div className={cn('mx-auto w-full', { sm: 'max-w-[480px]', md: 'max-w-[640px]', lg: 'max-w-[880px]' }[width], className)}>{children}</div>
    </div>
  );
}

export function Masthead({ name, logoUrl, children }: { name: string; logoUrl?: string | null; children?: ReactNode }) {
  return (
    <header className="mb-7 flex items-center gap-3">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-10 w-10 rounded-md border border-line object-contain" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-[13px] font-semibold uppercase text-on-primary">{name.slice(0, 2)}</span>
      )}
      <div className="min-w-0">
        <div className="truncate text-title font-semibold text-ink">{name}</div>
        {children && <div className="truncate text-meta text-ink-2">{children}</div>}
      </div>
    </header>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn('rounded-xl border border-line bg-card shadow-hairline', padded && 'p-6 sm:p-8', className)}>{children}</section>;
}

export function Field({ label, hint, error, required, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ui font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error ? <span className="text-meta text-danger">{error}</span> : hint ? <span className="text-meta text-ink-3">{hint}</span> : null}
    </label>
  );
}

const fieldClass =
  'w-full rounded-md border border-control/70 bg-card px-3 text-body text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} className={cn(fieldClass, 'h-11', invalid && 'border-danger focus:border-danger focus:ring-danger/25', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} rows={4} className={cn(fieldClass, 'min-h-[110px] py-2.5 leading-6', invalid && 'border-danger', className)} {...props} />;
});

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const tones = {
    neutral: 'bg-sunken text-ink-2',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    accent: 'bg-accent/10 text-accent',
  };
  return <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-meta font-medium', tones[tone])}>{children}</span>;
}

/**
 * The shape of the page that is coming — masthead, then a card — rather than a
 * spinner in the middle of an empty screen. A buyer on a slow phone sees the
 * document arrive instead of the layout jumping into place around it.
 */
export function Loading({ label = 'Loading…', width = 'md' }: { label?: string; width?: 'sm' | 'md' | 'lg' }) {
  return (
    <Page width={width}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="mb-7 flex items-center gap-3">
        <div className="skeleton h-10 w-10 rounded-md" />
        <div className="skeleton h-4 w-40" />
      </div>
      <Card>
        <div className="skeleton h-7 w-2/5 rounded-md" />
        <div className="skeleton mt-3 h-4 w-4/5" />
        <div className="mt-7 flex flex-col gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex flex-col gap-2">
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton h-11 w-full rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    </Page>
  );
}

/** Expired links, missing records, anything a buyer might land on by accident. */
export function Notice({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Page width="sm">
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-2">
          <Warning size={22} weight="duotone" />
        </div>
        <h1 className="font-display text-display-sm text-ink">{title}</h1>
        {children && <p className="mt-2 text-body text-ink-2">{children}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </Card>
    </Page>
  );
}
