import * as D from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './Button';

/**
 * Dialogs: serif title, body at 15px, ⌘↵ submits, Esc closes, and focus
 * returns to whatever opened it — including when that trigger was inside a
 * menu that has since closed.
 */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const SIZES = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[720px]', xl: 'max-w-[920px]' };

export function DialogContent({ children, className, size = 'md', label, onOpenAutoFocus }: { children: ReactNode; className?: string; size?: keyof typeof SIZES; label?: string; onOpenAutoFocus?: (e: Event) => void }) {
  const restoreTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Radix restores focus to its trigger, but a trigger inside a closed menu is gone by then.
    const active = document.activeElement as HTMLElement | null;
    if (active && !active.closest('[role="menu"],[role="dialog"]')) restoreTo.current = active;
    return () => restoreTo.current?.focus?.();
  }, []);
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-primary/25 backdrop-blur-[1px] animate-fade-in dark:bg-black/50" />
      <D.Content
        aria-label={label}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn(
          'fixed left-1/2 top-[calc(50%-2vh)] z-50 flex max-h-[min(88vh,860px)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-dialog-in',
          SIZES[size],
          className,
        )}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-start gap-3 border-b border-line px-6 py-4">
      <div className="min-w-0 flex-1">
        <D.Title className="font-display text-display-sm text-ink">{title}</D.Title>
        {description && <D.Description className="mt-1 text-ui text-ink-2 text-pretty">{description}</D.Description>}
      </div>
      {actions}
      <D.Close asChild>
        <Button variant="ghost" size="sm" icon aria-label="Close">
          <X size={16} />
        </Button>
      </D.Close>
    </header>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-dialog-body className={cn('flex-1 overflow-y-auto px-6 py-5', className)}>
      {children}
    </div>
  );
}

export function DialogFooter({ children, start, className }: { children: ReactNode; start?: ReactNode; className?: string }) {
  return (
    <footer className={cn('flex items-center gap-2 border-t border-line bg-sunken/60 px-6 py-3', className)}>
      {start}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </footer>
  );
}

/**
 * A form dialog: submits on ⌘↵ and Enter, disables while pending, and never
 * double-submits.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = 'Save',
  pending,
  size = 'md',
  footerStart,
  destructive,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  pending?: boolean;
  size?: keyof typeof SIZES;
  footerStart?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const isPending = pending || busy;
  const submit = async () => {
    if (isPending || disabled) return;
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={o => !isPending && onOpenChange(o)}>
      <DialogContent
        size={size}
        // Radix lands on the close button; a form should open on its first field.
        // Today every dialog happens to carry its own autoFocus — this is so the
        // one that forgets doesn't put the reader on X.
        onOpenAutoFocus={e => {
          const first = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
            '[data-dialog-body] input:not([type=hidden]), [data-dialog-body] textarea, [data-dialog-body] select, [data-dialog-body] button',
          );
          if (first) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <DialogHeader title={title} description={description} />
          <DialogBody>{children}</DialogBody>
          <DialogFooter start={footerStart}>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'danger' : 'primary'} loading={isPending} disabled={disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
