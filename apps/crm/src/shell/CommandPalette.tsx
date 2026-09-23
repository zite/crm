import { ArrowRight, Buildings, ChatCircleDots, MagnifyingGlass, Plus, Trophy, User } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { cn } from '../ui/cn';
import { CompanyMark } from '../glyphs';
import { useAppActions } from '../lib/app-actions';
import { useSearch } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { SECTIONS } from './TopBar';

type Item = { id: string; label: string; hint?: string; icon?: React.ReactNode; group: string; run: () => void };

/**
 * ⌘K: search every record, then jump anywhere or create anything. Typed input
 * searches the server; with an empty box it offers navigation and create
 * actions, which is what people use it for most.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openCreate } = useAppActions();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { data, isFetching } = useSearch(query, undefined, paletteOpen);

  useEffect(() => {
    if (!paletteOpen) {
      setQuery('');
      setActive(0);
    }
  }, [paletteOpen]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string, label: string, group = 'Go to') => ({ id: `go:${to}`, label, group, icon: <ArrowRight size={15} />, run: () => navigate(to) });
    const records: Item[] = (data?.hits ?? []).map(hit => ({
      id: `${hit.kind}:${hit.id}`,
      label: hit.title,
      hint: hit.subtitle ?? undefined,
      group: { company: 'Companies', contact: 'Contacts', deal: 'Deals', lead: 'Leads' }[hit.kind] ?? 'Records',
      icon:
        hit.kind === 'company' ? (
          <CompanyMark name={hit.title} id={hit.id} size="xs" />
        ) : hit.kind === 'contact' ? (
          <User size={15} />
        ) : hit.kind === 'deal' ? (
          <Trophy size={15} />
        ) : (
          <ChatCircleDots size={15} />
        ),
      run: () => navigate(`/${hit.kind === 'company' ? 'companies' : `${hit.kind}s`}/${hit.id}`),
    }));
    const navigation = SECTIONS.map(s => go(s.to, s.label)).concat(go('/inbox', 'Inbox'), ws.can('settings.manage') ? [go('/settings/general', 'Settings')] : []);
    const creates: Item[] = [
      { id: 'new:deal', label: 'New deal', group: 'Create', icon: <Plus size={15} />, run: () => openCreate('deal') },
      { id: 'new:company', label: 'New company', group: 'Create', icon: <Plus size={15} />, run: () => openCreate('company') },
      { id: 'new:contact', label: 'New contact', group: 'Create', icon: <Plus size={15} />, run: () => openCreate('contact') },
      { id: 'new:lead', label: 'New lead', group: 'Create', icon: <Plus size={15} />, run: () => openCreate('lead') },
      { id: 'new:task', label: 'New task', group: 'Create', icon: <Plus size={15} />, run: () => openCreate('task') },
    ];
    const q = query.trim().toLowerCase();
    const filterStatic = (list: Item[]) => (q ? list.filter(i => i.label.toLowerCase().includes(q)) : list);
    return q.length > 1 ? [...records, ...filterStatic(navigation), ...filterStatic(creates)] : [...navigation, ...creates];
  }, [data, navigate, openCreate, query, ws]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return [...map.entries()];
  }, [items]);
  const flat = groups.flatMap(([, list]) => list);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.querySelector('[data-palette-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, items.length]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    setPaletteOpen(false);
    item.run();
  };

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent size="md" label="Search" className="top-[18vh] translate-y-0">
        <div
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(a => Math.min(flat.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(a => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(flat[active]);
            }
          }}
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <MagnifyingGlass size={18} className="shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search companies, contacts, deals and leads"
              className="h-14 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
            />
            <Kbd keys="esc" />
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-2">
            {flat.length === 0 && (
              <div className="px-3 py-10 text-center text-ui text-ink-3">{isFetching ? 'Searching…' : query.trim().length > 1 ? `Nothing matches “${query}”` : 'Start typing'}</div>
            )}
            {groups.map(([group, list]) => (
              <div key={group} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-micro font-semibold uppercase text-ink-3">{group}</div>
                {list.map(item => {
                  const index = flat.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-palette-active={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run(item)}
                      className={cn('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left', index === active ? 'bg-hover' : '')}
                    >
                      <span className="text-ink-3">{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui text-ink">{item.label}</span>
                        {item.hint && <span className="block truncate text-meta text-ink-3">{item.hint}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
