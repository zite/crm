import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../ui/Dialog';

/**
 * App-wide actions any component can reach without prop-drilling: confirming a
 * destructive step, opening a create dialog, peeking a record, opening the
 * command palette.
 *
 * Create dialogs register themselves in shell/CreateDialogs.tsx — one file per
 * kind, default-exported as ({ open, onOpenChange, defaults }).
 */

export type CreateKind = 'deal' | 'company' | 'contact' | 'lead' | 'task' | 'activity' | 'quote' | 'product' | 'sequence' | 'template' | 'form' | 'meetingLink';

export type PeekTarget = { type: 'deal' | 'company' | 'contact' | 'lead'; id: string } | null;

type ConfirmOptions = { title: ReactNode; description?: ReactNode; confirmLabel?: string; destructive?: boolean };

export type AppActions = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  openCreate: (kind: CreateKind, defaults?: Record<string, unknown>) => void;
  createRequest: { kind: CreateKind; defaults: Record<string, unknown>; nonce: number } | null;
  closeCreate: () => void;
  peek: PeekTarget;
  openPeek: (target: PeekTarget) => void;
  openPalette: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
};

const Ctx = createContext<AppActions | null>(null);

export function AppActionsProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [createRequest, setCreateRequest] = useState<AppActions['createRequest']>(null);
  const [peek, setPeek] = useState<PeekTarget>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const nonce = useRef(0);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setConfirmState({ ...options, resolve })), []);

  const value = useMemo<AppActions>(
    () => ({
      confirm,
      openCreate: (kind, defaults = {}) => setCreateRequest({ kind, defaults, nonce: ++nonce.current }),
      createRequest,
      closeCreate: () => setCreateRequest(null),
      peek,
      openPeek: setPeek,
      openPalette: () => setPaletteOpen(true),
      paletteOpen,
      setPaletteOpen,
      shortcutsOpen,
      setShortcutsOpen,
    }),
    [confirm, createRequest, peek, paletteOpen, shortcutsOpen],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {confirmState && (
        <ConfirmDialog
          open
          onOpenChange={open => {
            if (!open) {
              confirmState.resolve(false);
              setConfirmState(null);
            }
          }}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          destructive={confirmState.destructive}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

export function useAppActions() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAppActions must be used inside AppActionsProvider');
  return value;
}
