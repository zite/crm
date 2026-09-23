import { Warning } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { seedWorkspace } from 'zitejs/api';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Layout';
import { TooltipProvider } from '../ui/Tooltip';
import { AppActionsProvider, useAppActions } from '../lib/app-actions';
import { useHotkeys, useSequenceHotkeys } from '../lib/hotkeys';
import { WorkspaceProvider, useWorkspaceQuery, useWorkspace } from '../lib/workspace';
import { CommandPalette } from './CommandPalette';
import { CreateDialogs } from './CreateDialogs';
import { RecordSheets } from './RecordSheets';
import { ShortcutsDialog } from './ShortcutsDialog';
import { TopBar } from './TopBar';

/** The frame: top bar, one scrolling main, and the app-wide overlays. */
/** The record a shortcut should act on: whatever is open. */
function recordFromPath(pathname: string): Record<string, string> {
  const [, section, id] = pathname.split('/');
  if (!id) return {};
  if (section === 'deals') return { dealId: id };
  if (section === 'companies') return { companyId: id };
  if (section === 'contacts') return { contactId: id };
  if (section === 'leads') return { leadId: id };
  return {};
}

/**
 * Opens the picker on a labelled fact in the record rail. Returns false when the
 * page has no such fact, so the key falls through to whatever else wants it
 * instead of being silently eaten on a list page.
 */
function openFact(...slugs: string[]) {
  for (const slug of slugs) {
    const button = document.querySelector<HTMLElement>(`[data-fact="${slug}"] button:not([disabled])`);
    if (button) {
      button.click();
      return;
    }
  }
  return false;
}

function Shell({ children }: { children: ReactNode }) {
  const actions = useAppActions();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useHotkeys({
    'mod+k': () => actions.setPaletteOpen(true),
    '?': () => actions.setShortcutsOpen(true),
    c: () => actions.openCreate('deal', recordFromPath(pathname)),
    'shift+c': () => actions.openCreate('contact'),
    t: () => actions.openCreate('task', recordFromPath(pathname)),
    // Advertised in the New menu and the shortcuts sheet, so it has to work.
    l: () => actions.openCreate('activity', recordFromPath(pathname)),
    a: () => openFact('owner'),
    d: () => openFact('close-date', 'due-date', 'expires'),
  });
  useSequenceHotkeys('g', {
    h: () => navigate('/home'),
    l: () => navigate('/leads'),
    d: () => navigate('/deals'),
    o: () => navigate('/companies'),
    p: () => navigate('/contacts'),
    t: () => navigate('/tasks'),
    r: () => navigate('/reports'),
    i: () => navigate('/inbox'),
    s: () => navigate('/settings/general'),
  });

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <TopBar />
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
      <CommandPalette />
      <CreateDialogs />
      <RecordSheets />
      <ShortcutsDialog open={actions.shortcutsOpen} onOpenChange={actions.setShortcutsOpen} />
    </div>
  );
}

/** Loads the workspace, seeds the demo on a fresh install, then renders the app. */
export function AppShell({ children }: { children: ReactNode }) {
  const query = useWorkspaceQuery();
  const [seeding, setSeeding] = useState(false);
  const [seedLabel, setSeedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data?.needsSeed || seeding) return;
    let cancelled = false;
    setSeeding(true);
    (async () => {
      try {
        for (let i = 0; i < 12; i++) {
          const result = await seedWorkspace({});
          if (cancelled) return;
          setSeedLabel(result.label);
          if (result.done) break;
        }
        await query.refetch();
      } catch (error) {
        toast.error('Couldn’t load the demo data. Reload to try again.');
        console.error(error);
      } finally {
        if (!cancelled) setSeeding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query.data?.needsSeed]);

  if (query.isPending || (query.data?.needsSeed && seeding)) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        <p className="text-ui text-ink-2">{seeding ? `Setting up your workspace — ${seedLabel ?? 'getting started'}…` : 'Loading…'}</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper">
        <EmptyState
          icon={<Warning size={22} weight="duotone" />}
          title="We couldn’t load your workspace"
          actions={
            <Button variant="primary" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {(query.error as Error)?.message ?? 'Something went wrong on the way to the server.'}
        </EmptyState>
      </div>
    );
  }

  return (
    <WorkspaceProvider data={query.data}>
      <TooltipProvider>
        <AppActionsProvider>
          <Shell>{children}</Shell>
        </AppActionsProvider>
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

export { useWorkspace };
