import * as D from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './Button';

/**
 * The peek sheet: a record opened over the right of the list, so J/K keep
 * working behind it. Not modal — clicking the list moves on.
 */
export function Sheet({ open, onOpenChange, children, width = 'md', label }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode; width?: 'md' | 'lg'; label?: string }) {
  return (
    // Non-modal on purpose: the promise of a peek is that the list behind it keeps
    // working — J/K walk the rows while the sheet follows along.
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          data-peek
          aria-label={label ?? 'Record'}
          onInteractOutside={e => {
            // Let the list behind stay usable: only a click on the page background closes.
            const target = e.target as HTMLElement;
            if (target.closest('[data-sheet-keep-open]')) e.preventDefault();
          }}
          onOpenAutoFocus={e => e.preventDefault()}
          className={cn(
            'fixed right-0 top-0 z-40 flex h-dvh flex-col border-l border-line bg-card shadow-sheet animate-sheet-in',
            width === 'lg' ? 'w-full max-w-[720px]' : 'w-full max-w-[560px]',
          )}
        >
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function SheetHeader({ children, onClose, actions }: { children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
      <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
        <X size={16} />
      </Button>
    </header>
  );
}

export function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>;
}
