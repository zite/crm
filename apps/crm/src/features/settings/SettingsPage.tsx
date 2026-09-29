import { Lock } from '@phosphor-icons/react';
import { lazy, Suspense } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../../ui/Layout';
import { Select } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { SectionSkeleton } from './kit';
import { GROUPS, SECTIONS, sectionFor } from './sections';

/**
 * Settings: a nav down the left, one reading-width column beside it. Sections
 * are lazy, so opening Profile doesn't pull in the importer, and each one owns
 * its own header — the nav never changes under you.
 *
 * Below `md` the nav becomes a select, because a list of twelve links above
 * the content you came for is a page you have to scroll past every time.
 */

const PAGES: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  profile: lazy(() => import('./ProfileSection').then(m => ({ default: m.ProfileSection }))),
  general: lazy(() => import('./GeneralSection').then(m => ({ default: m.GeneralSection }))),
  members: lazy(() => import('./TeammatesSection').then(m => ({ default: m.TeammatesSection }))),
  teams: lazy(() => import('./TeamsSection').then(m => ({ default: m.TeamsSection }))),
  pipelines: lazy(() => import('./PipelinesSection').then(m => ({ default: m.PipelinesSection }))),
  products: lazy(() => import('../products/ProductsSection').then(m => ({ default: m.ProductsSection }))),
  fields: lazy(() => import('./PropertiesSection').then(m => ({ default: m.PropertiesSection }))),
  lists: lazy(() => import('./ListsSection').then(m => ({ default: m.ListsSection }))),
  routing: lazy(() => import('./RoutingSection').then(m => ({ default: m.RoutingSection }))),
  automations: lazy(() => import('./AutomationsSection').then(m => ({ default: m.AutomationsSection }))),
  import: lazy(() => import('./ImportSection').then(m => ({ default: m.ImportSection }))),
  export: lazy(() => import('./ExportSection').then(m => ({ default: m.ExportSection }))),
  data: lazy(() => import('./DataSection').then(m => ({ default: m.DataSection }))),
};

export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const current = sectionFor(section);
  useDocumentTitle(current ? `${current.label} · Settings` : 'Settings', ws.settings.organizationName);

  const visible = SECTIONS.filter(s => (!s.capability || ws.can(s.capability)) && (!s.shownWhen || s.shownWhen(ws) || s.slug === section));
  if (!section) return <Navigate to="/settings/profile" replace />;
  if (!current) return <Navigate to="/settings/profile" replace />;

  const allowed = !current.capability || ws.can(current.capability);
  const Page = PAGES[current.slug];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-5 py-6 sm:px-8 md:flex md:gap-10">
      <nav aria-label="Settings sections" className="mb-6 shrink-0 md:mb-0 md:w-[188px]">
        <div className="md:hidden">
          <Select value={current.slug} onChange={e => navigate(`/settings/${e.target.value}`)} aria-label="Settings section">
            {GROUPS.map(group => {
              const items = visible.filter(s => s.group === group);
              if (!items.length) return null;
              return (
                <optgroup key={group} label={group}>
                  {items.map(s => (
                    <option key={s.slug} value={s.slug}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </div>
        <div className="hidden md:sticky md:top-6 md:block">
          {GROUPS.map(group => {
            const items = visible.filter(s => s.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-5 last:mb-0">
                <div className="mb-1.5 px-2 text-micro font-semibold uppercase text-ink-3">{group}</div>
                <ul className="flex flex-col gap-0.5">
                  {items.map(s => (
                    <li key={s.slug}>
                      <button
                        type="button"
                        onClick={() => navigate(`/settings/${s.slug}`)}
                        aria-current={s.slug === current.slug ? 'page' : undefined}
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-left text-ui transition-colors',
                          s.slug === current.slug ? 'bg-accent/[0.08] font-medium text-accent dark:bg-accent/15' : 'text-ink-2 hover:bg-hover hover:text-ink',
                        )}
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 flex-1 md:max-w-[720px]">
        {!allowed ? (
          <EmptyState icon={<Lock size={22} weight="duotone" />} title="That’s an admin setting">
            Your role can see the app but not change how it is set up. Ask an admin if something here needs to move.
          </EmptyState>
        ) : Page ? (
          <Suspense fallback={<SectionSkeleton />}>
            <Page />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
