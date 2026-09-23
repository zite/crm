import { ArrowSquareOut, Tray, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton } from '../../ui/Layout';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from '../../ui/Menu';
import { Sheet, SheetBody, SheetHeader } from '../../ui/Sheet';
import { Ledger, type Column } from '../../records/Ledger';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { cn } from '../../ui/cn';
import { errorMessage } from '../../lib/errors';
import { dateTime, timeAgo } from '../../lib/format';
import { SUBMISSION_OUTCOMES } from '@project/shared/constants';
import { OUTCOME_TONE, useSubmissions, type Submission } from './formData';

/** What a form actually produced: every submission, and what it became. */
export function FormSubmissions({ formId }: { formId: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [outcomes, setOutcomes] = useState<Array<(typeof SUBMISSION_OUTCOMES)[number]>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useSubmissions({ formId, search: search.trim() || undefined, outcomes: outcomes.length ? outcomes : undefined, limit: 300 });
  const submissions = query.data?.submissions ?? [];
  const isFiltered = Boolean(search.trim() || outcomes.length);

  const columns: Array<Column<Submission>> = [
    {
      key: 'who',
      header: 'Who',
      width: '30%',
      cell: s => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{s.name ?? s.email ?? 'Anonymous'}</div>
          <div className="truncate text-meta text-ink-3">{s.email ?? 'No email'}</div>
        </div>
      ),
    },
    { key: 'outcome', header: 'Outcome', width: '15%', cell: s => <Badge tone={OUTCOME_TONE[s.outcome] ?? 'neutral'}>{s.outcome}</Badge> },
    {
      key: 'became',
      header: 'Became',
      width: '25%',
      interactive: true,
      cell: s =>
        s.leadId ? (
          <button className="inline-flex min-w-0 items-center gap-1.5 truncate text-ui text-accent hover:underline" onClick={() => navigate(`/leads/${s.leadId}`)}>
            <span className="truncate">{s.leadName ?? 'Lead'}</span>
            {s.leadStatus && <span className="shrink-0 text-meta text-ink-3">{s.leadStatus}</span>}
            <ArrowSquareOut size={12} className="shrink-0" />
          </button>
        ) : s.contactId ? (
          <button className="inline-flex min-w-0 items-center gap-1.5 truncate text-ui text-accent hover:underline" onClick={() => navigate(`/contacts/${s.contactId}`)}>
            <span className="truncate">{s.contactName ?? 'Contact'}</span>
            <ArrowSquareOut size={12} className="shrink-0" />
          </button>
        ) : (
          <span className="text-ink-3">{s.outcome === 'Spam' ? 'Filtered out' : 'The record was deleted'}</span>
        ),
    },
    {
      key: 'source',
      header: 'Came from',
      width: '18%',
      hide: 'lg',
      cell: s => {
        const utm = s.utm as { source?: string; campaign?: string } | null;
        return <span className="truncate text-ink-3">{utm?.campaign ? `${utm.source ?? 'campaign'} · ${utm.campaign}` : s.referrer ? new URL(s.referrer).hostname.replace(/^www\./, '') : 'Direct'}</span>;
      },
    },
    { key: 'when', header: 'Submitted', width: '12%', hide: 'md', cell: s => <span className="text-ink-2" title={s.submittedAt ? dateTime(s.submittedAt) : ''}>{s.submittedAt ? timeAgo(s.submittedAt) : '—'}</span> },
  ];

  return (
    <div className="flex flex-col">
      <ListToolbar
        start={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm">
                Outcome
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Outcome</MenuLabel>
              {SUBMISSION_OUTCOMES.map(outcome => (
                <MenuCheckboxItem
                  key={outcome}
                  checked={outcomes.includes(outcome)}
                  onCheckedChange={() => setOutcomes(current => (current.includes(outcome) ? current.filter(o => o !== outcome) : [...current, outcome]))}
                  onSelect={e => e.preventDefault()}
                >
                  {outcome}
                </MenuCheckboxItem>
              ))}
            </MenuContent>
          </Menu>
        }
        count={submissions.length}
        countLabel="submission"
        search={search}
        onSearch={setSearch}
      />
      <FilterChips
        chips={outcomes.map(o => ({ key: o, label: `Outcome: ${o}`, onRemove: () => setOutcomes(current => current.filter(x => x !== o)) }))}
        onClear={isFiltered ? () => {
          setOutcomes([]);
          setSearch('');
        } : undefined}
      />

      {query.isPending ? (
        <ListSkeleton rows={6} />
      ) : query.isError ? (
        <EmptyState
          icon={<WarningCircle size={22} weight="duotone" />}
          title="The submissions didn’t load"
          actions={
            <Button variant="primary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error, 'Something went wrong fetching this form’s submissions.')}
        </EmptyState>
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={<Tray size={22} weight="duotone" />}
          title={isFiltered ? 'Nothing matches those filters' : 'No submissions yet'}
          actions={
            isFiltered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setOutcomes([]);
                  setSearch('');
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        >
          {isFiltered ? 'Try removing a filter.' : 'Once the form is on your website, everything people send lands here — with who it turned out to be.'}
        </EmptyState>
      ) : (
        <Ledger rows={submissions} columns={columns} getId={s => s.id} focusId={expanded} onRowClick={s => setExpanded(expanded === s.id ? null : s.id)} />
      )}

      {/* The answers open beside the list, not appended under 300 rows where a
          click on the first row looks like it did nothing. */}
      <AnswerSheet submission={submissions.find(s => s.id === expanded)} onClose={() => setExpanded(null)} />
    </div>
  );
}

function AnswerSheet({ submission, onClose }: { submission?: Submission; onClose: () => void }) {
  const navigate = useNavigate();
  const entries = Object.entries(submission?.answers ?? {});
  // The sheet covers the row it came from, so it carries the outcome itself.
  const became = submission?.leadId
    ? { label: submission.leadName ?? 'Lead', to: `/leads/${submission.leadId}` }
    : submission?.contactId
      ? { label: submission.contactName ?? 'Contact', to: `/contacts/${submission.contactId}` }
      : null;
  return (
    <Sheet open={Boolean(submission)} onOpenChange={value => !value && onClose()} label="Submission">
      <SheetHeader onClose={onClose} actions={submission && <Badge tone={OUTCOME_TONE[submission.outcome] ?? 'neutral'}>{submission.outcome}</Badge>}>
        <div className="min-w-0">
          <div className="truncate text-ui font-semibold text-ink">{submission?.name ?? submission?.email ?? 'Anonymous'}</div>
          <div className="truncate text-meta text-ink-3">{submission?.submittedAt ? dateTime(submission.submittedAt) : 'Submitted'}</div>
        </div>
      </SheetHeader>
      <SheetBody className="px-5 py-5">
        {became && (
          <button
            type="button"
            onClick={() => navigate(became.to)}
            className="mb-5 flex w-full items-center gap-2 rounded-md border border-line bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-micro font-semibold uppercase text-ink-3">Became</span>
              <span className="block truncate text-ui text-accent">{became.label}</span>
            </span>
            <ArrowSquareOut size={14} className="shrink-0 text-ink-3" />
          </button>
        )}
        {entries.length === 0 ? (
          <p className="text-ui text-ink-3">Nothing was recorded for this submission.</p>
        ) : (
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {entries.map(([key, value]) => (
              <div key={key} className={cn('min-w-0', String(value).length > 80 && 'sm:col-span-2')}>
                <dt className="text-micro font-semibold uppercase text-ink-3">{key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}</dt>
                <dd className="mt-0.5 text-ui text-ink whitespace-pre-wrap">{value === true ? 'Yes' : value === false ? 'No' : String(value)}</dd>
              </div>
            ))}
            {submission?.pageUrl && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-micro font-semibold uppercase text-ink-3">Page</dt>
                <dd className="mt-0.5 truncate text-ui text-ink-2">{submission.pageUrl}</dd>
              </div>
            )}
          </dl>
        )}
      </SheetBody>
    </Sheet>
  );
}
