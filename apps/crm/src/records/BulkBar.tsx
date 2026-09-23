import { X } from '@phosphor-icons/react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

/** The bar that appears when rows are selected. Actions are quiet on ink. */
export function BulkBar({ count, noun = 'record', onClear, children, className }: { count: number; noun?: string; onClear: () => void; children: ReactNode; className?: string }) {
  if (!count) return null;
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4', className)}>
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-primary px-2 py-2 text-on-primary shadow-pop animate-bar-in">
        <span className="tabular whitespace-nowrap px-2 text-ui font-medium">
          {count} {count === 1 ? noun : `${noun}s`}
        </span>
        <span className="mx-1 h-5 w-px bg-on-primary/20" />
        {children}
        <span className="mx-1 h-5 w-px bg-on-primary/20" />
        <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-on-primary/10">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** Forwards its ref and takes Button's full prop surface: these are Radix triggers. */
export const BulkButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(function BulkButton({ className, ...rest }, ref) {
  return <Button ref={ref} variant="ghost" size="sm" className={cn('text-on-primary hover:bg-on-primary/10 hover:text-on-primary', className)} {...rest} />;
});
