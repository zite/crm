import { Slot } from '@radix-ui/react-slot';
import { CircleNotch } from '@phosphor-icons/react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent/90 active:bg-accent/80 shadow-hairline',
  secondary: 'bg-card text-ink border border-line-strong hover:bg-hover active:bg-pressed shadow-hairline',
  ghost: 'text-ink-2 hover:text-ink hover:bg-hover active:bg-pressed',
  quiet: 'text-ink hover:bg-hover active:bg-pressed',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80 dark:text-paper',
  link: 'text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent px-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-meta gap-1 rounded-sm',
  sm: 'h-8 px-2.5 text-ui gap-1.5 rounded-sm',
  md: 'h-9 px-3 text-ui gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-body gap-2 rounded-md',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 w-7 rounded-sm',
  sm: 'h-8 w-8 rounded-sm',
  md: 'h-9 w-9 rounded-md',
  lg: 'h-10 w-10 rounded-md',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square and icon-only. Always pass an aria-label. */
  icon?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
  asChild?: boolean;
};

/**
 * The one button. `primary` is the single accent action in a screen region;
 * `secondary` for the rest; `ghost` in toolbars and rows.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, leading, trailing, loading, asChild, className, children, disabled, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,box-shadow] duration-100',
        'disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
        VARIANTS[variant],
        icon ? ICON_SIZES[size] : SIZES[size],
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <CircleNotch className="animate-spin" size={16} weight="bold" /> : leading}
          {children}
          {trailing}
        </>
      )}
    </Comp>
  );
});

/** A quiet control that sits inside a row or a facts rail and opens a picker. */
export const Chipput = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { placeholder?: boolean }>(function Chipput({ className, placeholder, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        // No `truncate` here: text-overflow does nothing on an inline-flex box, so the
        // class only invited the bug it looked like it solved. Children truncate themselves.
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm px-2 text-ui transition-colors hover:bg-hover active:bg-pressed',
        placeholder ? 'text-ink-3' : 'text-ink',
        className,
      )}
      {...rest}
    />
  );
});
