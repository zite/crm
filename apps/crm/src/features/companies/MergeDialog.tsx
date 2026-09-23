import { ArrowRight, Buildings, User } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import type { FindDuplicatesOutputType } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { FormDialog } from '../../ui/Dialog';
import { Checkbox, Segmented } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { CompanyMark } from '../../glyphs';
import { plural, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { useCompanyActions, useContactActions } from './mutations';

export type DuplicateRecord = FindDuplicatesOutputType['groups'][number]['records'][number];

/**
 * Merge duplicates into one record. The older record always survives — Zite
 * won't let an app rewrite `created_at`, so keeping the older id is the only
 * way to keep the older creation date, and it keeps every link people already
 * have. Where the newer row knows more, "the newest record" fills the values.
 */
export function MergeDialog({
  open,
  onOpenChange,
  type,
  records,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'company' | 'contact';
  records: DuplicateRecord[];
  onDone?: (survivorId: string) => void;
}) {
  const ws = useWorkspace();
  const companyActions = useCompanyActions();
  const contactActions = useContactActions();
  const merge = type === 'company' ? companyActions.merge : contactActions.merge;

  const ordered = useMemo(() => [...records].sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '')), [records]);
  const survivor = ordered[0];
  const others = ordered.slice(1);
  const [chosen, setChosen] = useState<string[]>([]);
  const [prefer, setPrefer] = useState<'survivor' | 'newest'>('survivor');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChosen(others.map(r => r.id));
    setPrefer('survivor');
    setError(null);
  }, [open, records]);

  const merging = others.filter(r => chosen.includes(r.id));
  const moved = merging.reduce(
    (acc, r) => ({ deals: acc.deals + r.dealCount, contacts: acc.contacts + r.contactCount, activities: acc.activities + r.activityCount }),
    { deals: 0, contacts: 0, activities: 0 },
  );

  const noun = type === 'company' ? 'company' : 'contact';
  // "company" doesn't pluralise with an "s", so every count carries its own plural.
  const nouns = type === 'company' ? 'companies' : 'contacts';
  const mark = (record: DuplicateRecord) =>
    type === 'company' ? <CompanyMark name={record.name} id={record.id} logoUrl={record.logoUrl} size="md" /> : <Avatar person={{ id: record.id, name: record.name, avatarUrl: record.logoUrl }} size="lg" />;

  const submit = async () => {
    if (!survivor || !merging.length) {
      setError(`Choose at least one other ${noun} to merge in`);
      return;
    }
    try {
      await merge.mutateAsync({ survivorId: survivor.id, duplicateIds: merging.map(r => r.id), prefer });
      onOpenChange(false);
      onDone?.(survivor.id);
    } catch {
      // The mutation already shows the server's sentence in a toast.
    }
  };

  if (!survivor) return null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge ${nouns}`}
      description={`Everything on the others moves onto the ${noun} you keep, then they are deleted. This can’t be undone.`}
      submitLabel={merging.length ? `Merge ${plural(merging.length, noun, nouns)} in` : 'Merge'}
      onSubmit={submit}
      pending={merge.isPending}
      size="lg"
      destructive
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-micro font-semibold uppercase text-ink-3">Kept — the older record</h3>
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2.5 dark:bg-accent/10">
            {mark(survivor)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui font-medium text-ink">{survivor.name}</div>
              <div className="truncate text-meta text-ink-3">{survivor.subtitle ?? 'No details'}</div>
            </div>
            <div className="shrink-0 text-right text-meta text-ink-3">
              <div>Added {survivor.createdAt ? shortDate(survivor.createdAt.slice(0, 10)) : '—'}</div>
              <div>{ws.memberName(survivor.ownerId)}</div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-micro font-semibold uppercase text-ink-3">Merged in and deleted</h3>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
            {others.map(record => {
              const selected = chosen.includes(record.id);
              return (
                <li key={record.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => setChosen(current => (current.includes(record.id) ? current.filter(x => x !== record.id) : [...current, record.id]))}
                    label={`Merge ${record.name}`}
                  />
                  {mark(record)}
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-ui', selected ? 'text-ink' : 'text-ink-3')}>{record.name}</div>
                    <div className="truncate text-meta text-ink-3">
                      {[record.dealCount ? plural(record.dealCount, 'deal') : '', record.contactCount ? plural(record.contactCount, 'contact') : '', record.activityCount ? plural(record.activityCount, 'activity', 'activities') : '']
                        .filter(Boolean)
                        .join(' · ') || 'Nothing logged on it'}
                    </div>
                  </div>
                  <span className="shrink-0 text-meta text-ink-3">Added {record.createdAt ? shortDate(record.createdAt.slice(0, 10)) : '—'}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-micro font-semibold uppercase text-ink-3">Where two records disagree</h3>
          <Segmented
            value={prefer}
            onChange={value => setPrefer(value as 'survivor' | 'newest')}
            options={[
              { value: 'survivor', label: 'Keep the older details' },
              { value: 'newest', label: 'Prefer the newest details' },
            ]}
          />
          <p className="text-meta text-ink-2">
            {prefer === 'survivor'
              ? `Blanks on ${survivor.name} are filled in from the others; anything already set stays as it is.`
              : `Values from the newest record win, and anything it leaves blank falls back to ${survivor.name}.`}
          </p>
        </section>

        <section className="rounded-lg border border-line bg-sunken/60 px-3 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-ui font-medium text-ink">
            {type === 'company' ? <Buildings size={16} /> : <User size={16} />}
            What moves onto {survivor.name}
            <ArrowRight size={14} className="text-ink-3" />
          </div>
          <ul className="flex flex-col gap-1 text-meta text-ink-2">
            {type === 'company' ? (
              <>
                <li>· Deals ({moved.deals}) — with their quotes, line items and stage history</li>
                <li>· Contacts ({moved.contacts}) — and any subsidiaries</li>
                <li>· Activity ({moved.activities}) — calls, emails, meetings and notes</li>
                <li>· Tasks, files, converted leads and the whole history rail</li>
                <li>· Tags are combined; custom fields fill in the blanks</li>
              </>
            ) : (
              <>
                <li>· Deals ({moved.deals}) — including their place in each buying group</li>
                <li>· Activity ({moved.activities}) — calls, emails, meetings and notes</li>
                <li>· Tasks, files, quotes, sequence enrollments and form submissions</li>
                <li>· Do not contact and unsubscribed stay set if either record had them</li>
                <li>· Tags are combined; custom fields fill in the blanks</li>
              </>
            )}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-meta text-danger">
            {merging.length
              ? `Deleted for good: ${merging.map(r => `“${r.name}”`).join(', ')}. Links to ${merging.length === 1 ? 'it' : 'them'} will land on ${survivor.name}.`
              : 'Nothing is selected yet, so nothing will be merged or deleted.'}
          </p>
        </section>

        {error && <p className="text-meta text-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}
