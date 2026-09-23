import { CopySimple, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '../../ui/Dialog';
import { EmptyState, ListSkeleton } from '../../ui/Layout';
import { Tooltip } from '../../ui/Tooltip';
import { CompanyMark } from '../../glyphs';
import { plural, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { useDuplicates } from './queries';
import { MergeDialog, type DuplicateRecord } from './MergeDialog';

/**
 * Two records for the same buyer. The banner sits on the record page when that
 * record is in a duplicate group; the dialog is the list-wide sweep from the
 * ⋯ menu. Both hand off to the same merge.
 */
export function DuplicateBanner({ type, id, onMerged }: { type: 'company' | 'contact'; id: string; onMerged?: (survivorId: string) => void }) {
  const ws = useWorkspace();
  const { data } = useDuplicates(type, id, Boolean(id));
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const group = data?.groups[0];
  if (!group || dismissed || !ws.can('records.edit')) return null;
  const others = group.records.filter(r => r.id !== id);
  const noun = type === 'company' ? 'company' : 'contact';
  // "company" doesn't pluralise with an "s".
  const nouns = type === 'company' ? 'other companies' : 'other contacts';

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/[0.07] px-4 py-3 dark:bg-warning/10">
        <CopySimple size={18} className="shrink-0 text-warning" />
        <p className="min-w-[200px] flex-1 basis-full text-ui text-ink sm:basis-0">
          <span className="font-medium">{group.reason}.</span>{' '}
          {others.length === 1 ? `“${others[0].name}” looks like the same ${noun}.` : `${plural(others.length, `other ${noun}`, nouns)} look like the same ${noun}.`}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Review and merge
        </Button>
        <Tooltip content="Hide this until the page reloads">
          <Button variant="ghost" size="sm" icon aria-label="Dismiss duplicate warning" onClick={() => setDismissed(true)}>
            <X size={15} />
          </Button>
        </Tooltip>
      </div>
      <MergeDialog open={open} onOpenChange={setOpen} type={type} records={group.records} onDone={onMerged} />
    </>
  );
}

/** The list-wide sweep: every group of duplicates, newest and biggest first. */
export function DuplicatesDialog({ open, onOpenChange, type }: { open: boolean; onOpenChange: (open: boolean) => void; type: 'company' | 'contact' }) {
  const ws = useWorkspace();
  const { data, isPending } = useDuplicates(type, null, open);
  const [merging, setMerging] = useState<DuplicateRecord[] | null>(null);
  const plural_ = type === 'company' ? 'companies' : 'contacts';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg" label="Duplicates">
          <DialogHeader
            title="Find duplicates"
            description={
              type === 'company'
                ? 'Companies that share a web domain, or whose names are the same once “Inc.” and “Ltd” are set aside.'
                : 'Contacts that share an email address.'
            }
          />
          <DialogBody className="px-4">
            {isPending ? (
              <ListSkeleton rows={4} />
            ) : !data?.groups.length ? (
              <EmptyState compact icon={<CopySimple size={22} weight="duotone" />} title={`No duplicate ${plural_}`}>
                Nothing in the {data?.scanned ?? 0} {plural_} we scanned looks like the same record twice.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.groups.map(group => (
                  <li key={group.key} className="rounded-lg border border-line bg-card">
                    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                      <Badge tone="warning">{group.reason}</Badge>
                      <span className="tabular text-meta text-ink-3">{plural(group.records.length, 'record')}</span>
                      {ws.can('records.edit') && (
                        <Button variant="secondary" size="xs" className="ml-auto" onClick={() => setMerging(group.records)}>
                          Review and merge
                        </Button>
                      )}
                    </div>
                    <ul className="flex flex-col divide-y divide-line">
                      {group.records.map((record, index) => (
                        <li key={record.id} className="flex items-center gap-3 px-3 py-2">
                          {type === 'company' ? (
                            <CompanyMark name={record.name} id={record.id} logoUrl={record.logoUrl} size="sm" />
                          ) : (
                            <Avatar person={{ id: record.id, name: record.name, avatarUrl: record.logoUrl }} size="md" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-ui text-ink">{record.name}</div>
                            <div className="truncate text-meta text-ink-3">{record.subtitle ?? '—'}</div>
                          </div>
                          {index === 0 && <Badge tone="accent">Oldest</Badge>}
                          <span className="shrink-0 text-meta text-ink-3">{record.createdAt ? shortDate(record.createdAt.slice(0, 10)) : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      {merging && <MergeDialog open onOpenChange={value => !value && setMerging(null)} type={type} records={merging} onDone={() => setMerging(null)} />}
    </>
  );
}
