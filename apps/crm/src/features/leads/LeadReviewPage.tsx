import { ArrowLeft, ArrowRight, BookmarkSimple, CheckCircle, Prohibit, SkipForward, Trophy, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, PageHeader, Skeleton } from '../../ui/Layout';
import { Kbd } from '../../ui/Kbd';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { CompanyMark } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { useHotkeys } from '../../lib/hotkeys';
import { timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { ConvertLeadDialog } from './ConvertLeadDialog';
import { DisqualifyDialog } from './DisqualifyDialog';
import { LeadScoreDial } from './LeadGlyphs';
import { useLead, useLeadActions, useLeads, type Lead } from './leadData';

/**
 * The review deck: one lead at a time, big and calm.
 *
 * Triage is the job nobody does because a table of thirty rows asks you to hold
 * everything at once. Here there is one lead, everything known about it, and
 * four decisions — and the deck moves on by itself, so a rep can work the whole
 * queue from the keyboard without ever reaching for the mouse.
 */
export function LeadReviewPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const actions = useLeadActions();
  const [index, setIndex] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [decided, setDecided] = useState(0);
  const [converting, setConverting] = useState(false);
  const [disqualifying, setDisqualifying] = useState(false);
  useDocumentTitle('Review leads', ws.settings.organizationName);

  const query = useLeads({ filters: { status: ['New'] }, sort: { key: 'score', dir: 'desc' }, limit: 200 });
  const all = useMemo(() => query.data?.leads ?? [], [query.data]);

  // A lead you skipped and then decided from elsewhere is gone: only count the
  // ones still in the deck, or "bring back 3 skipped" brings back nothing.
  const liveSkipped = useMemo(() => skipped.filter(id => all.some(l => l.id === id)), [skipped, all]);

  // Skipping puts a lead at the back of today's deck rather than changing it.
  const deck = useMemo(() => {
    const skippedSet = new Set(liveSkipped);
    return [...all.filter(l => !skippedSet.has(l.id)), ...all.filter(l => skippedSet.has(l.id))];
  }, [all, liveSkipped]);

  const current = deck[Math.min(index, Math.max(0, deck.length - 1))] ?? null;
  const detail = useLead(current?.id, { matches: false });
  // Warm the next card so its score reasons are already there when it slides in,
  // instead of the card growing a line a beat after you land on it.
  useLead(deck[index + 1]?.id, { matches: false });
  const canEdit = ws.can('records.edit');
  const busy = converting || disqualifying || appActions.paletteOpen;

  // The queue you sat down to, not what is left of it: deciding a lead removes it
  // from the query, so counting what remains would read "1 of 7, 1 of 6, 1 of 5".
  const queueSize = decided + all.length;
  const place = Math.min(decided + index, Math.max(0, queueSize - 1));

  // When a lead leaves the deck (it stopped being New), the next one slides in.
  useEffect(() => {
    if (index > 0 && index >= deck.length) setIndex(Math.max(0, deck.length - 1));
  }, [deck.length, index]);

  const advance = useCallback(() => {
    setDecided(d => d + 1);
    // The decided lead drops out of the query, so staying put shows the next one.
    setIndex(i => (i >= deck.length - 1 ? Math.max(0, deck.length - 2) : i));
  }, [deck.length]);

  const startWorking = useCallback(() => {
    if (!current || !canEdit) return;
    actions.startWorking([current.id], ws.me.id);
    advance();
  }, [current, canEdit, actions, ws.me.id, advance]);

  const nurture = useCallback(() => {
    if (!current || !canEdit) return;
    actions.setStatus([current.id], 'Nurturing');
    advance();
  }, [current, canEdit, actions, advance]);

  const skip = useCallback(() => {
    if (!current) return;
    setSkipped(s => (s.includes(current.id) ? s : [...s, current.id]));
    setIndex(i => Math.min(i + 1, Math.max(0, deck.length - 1)));
  }, [current, deck.length]);

  useHotkeys(
    {
      '1': () => {
        if (!current || !canEdit) return false;
        startWorking();
      },
      '2': () => {
        if (!current || !canEdit) return false;
        setConverting(true);
      },
      '3': () => {
        if (!current || !canEdit) return false;
        nurture();
      },
      '4': () => {
        if (!current || !canEdit) return false;
        setDisqualifying(true);
      },
      j: () => {
        if (!deck.length) return false;
        setIndex(i => Math.min(i + 1, deck.length - 1));
      },
      k: () => {
        if (!deck.length) return false;
        setIndex(i => Math.max(0, i - 1));
      },
      s: () => {
        if (!current) return false;
        skip();
      },
      enter: () => {
        if (!current) return false;
        // Enter on a focused button is that button's, not the deck's — otherwise
        // tabbing to "Start working" and pressing Enter opens the lead instead.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest('button, a[href], [role="button"]')) return false;
        navigate(`/leads/${current.id}`);
      },
      esc: () => {
        navigate('/leads');
      },
    },
    { enabled: !busy },
  );

  // The deck is one column: the header sits on the same left edge as the card
  // rather than out at the page gutter with 300px of nothing between them.
  const COLUMN = 'mx-auto w-full max-w-[784px]';

  if (query.isPending) {
    return (
      <div className={cn(COLUMN, 'flex flex-col gap-4 px-5 py-10 sm:px-8')}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-1 w-full" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className={cn(COLUMN, 'px-5 py-10 sm:px-8')}>
        <EmptyState
          icon={<WarningCircle size={22} weight="duotone" />}
          title="The deck didn’t load"
          actions={
            <>
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => navigate('/leads')}>
                Back to leads
              </Button>
            </>
          }
        >
          {errorMessage(query.error, 'Something went wrong fetching the new leads.')}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        className={COLUMN}
        eyebrow={
          <Link to="/leads" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft size={13} /> Leads
          </Link>
        }
        title="Review"
        description={current ? `Decide one at a time. ${place + 1} of ${queueSize} new ${queueSize === 1 ? 'lead' : 'leads'}.` : undefined}
        actions={
          current && (
            <div className="flex items-center gap-1">
              <Tooltip content="Previous lead" shortcut="K">
                <Button variant="ghost" size="sm" icon aria-label="Previous lead" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))}>
                  <ArrowLeft size={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Next lead" shortcut="J">
                <Button variant="ghost" size="sm" icon aria-label="Next lead" disabled={index >= deck.length - 1} onClick={() => setIndex(i => Math.min(deck.length - 1, i + 1))}>
                  <ArrowRight size={16} />
                </Button>
              </Tooltip>
            </div>
          )
        }
      />

      {/* Progress through the queue, as one hairline rule: decided behind you,
          the card you are on in accent, the rest still waiting. One lead is not
          a queue, so it gets no rule. */}
      {current && queueSize > 1 && (
        <div className={cn(COLUMN, 'px-5 pt-5 sm:px-8')}>
          {queueSize <= 24 ? (
            <div className="flex items-center gap-1" aria-hidden>
              {Array.from({ length: queueSize }, (_, i) => (
                <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i < place ? 'bg-ink/50' : i === place ? 'bg-accent' : 'bg-line-strong')} />
              ))}
            </div>
          ) : (
            <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((place + 1) / queueSize) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      <div className={cn(COLUMN, 'px-5 py-6 sm:px-8')}>
        <div className="w-full">
          {!current ? (
            <EmptyState
              icon={<CheckCircle size={22} weight="duotone" />}
              title={decided > 0 ? `You worked through ${decided} ${decided === 1 ? 'lead' : 'leads'}` : 'No new leads waiting'}
              actions={
                <Button variant="primary" onClick={() => navigate('/leads')}>
                  Back to leads
                </Button>
              }
            >
              {decided > 0 ? 'The deck is empty. ' : ''}New leads land here the moment a form is submitted or someone adds one.
            </EmptyState>
          ) : (
            <article className="flex flex-col gap-6 rounded-xl border border-line bg-card p-5 shadow-hairline animate-deck-in sm:p-7" key={current.id}>
              <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <CompanyMark name={current.companyName ?? current.name} id={current.companyName ?? current.id} size="xl" className="hidden sm:inline-flex" />
                <CompanyMark name={current.companyName ?? current.name} id={current.companyName ?? current.id} size="lg" className="sm:hidden" />
                {/* min-w keeps the identity block from shrinking to a column of
                    one-word lines: on a phone the score wraps to its own row. */}
                <div className="min-w-[190px] flex-1">
                  <h2 className="font-display text-display-sm text-ink">{current.name}</h2>
                  <p className="mt-0.5 text-body text-ink-2">{[current.title, current.companyName].filter(Boolean).join(' at ') || 'No title given'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
                    {current.email && (
                      <a href={`mailto:${current.email}`} className="text-accent hover:underline">
                        {current.email}
                      </a>
                    )}
                    {current.phone && <span>{current.phone}</span>}
                    {current.receivedAt && <span>Came in {timeAgo(current.receivedAt)}</span>}
                    {liveSkipped.includes(current.id) && <Badge tone="neutral">Skipped earlier</Badge>}
                  </div>
                </div>
                <LeadScoreDial score={current.score} rating={current.rating} />
              </header>

              {current.message && <blockquote className="rounded-lg border border-line bg-sunken/60 px-4 py-3 text-body leading-6 text-ink whitespace-pre-wrap">{current.message}</blockquote>}

              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Fact label="Company size" value={current.employees ? `${current.employees.toLocaleString('en-US')} people` : null} />
                <Fact label="Industry" value={current.industry} />
                <Fact label="Country" value={current.country} />
                <Fact label="Source" value={current.formName ?? current.source} />
                <Fact label="Website" value={current.website?.replace(/^https?:\/\/(www\.)?/, '')} href={current.website} />
                <Fact
                  label="Owner"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      {current.ownerId ? <Avatar person={ws.memberById(current.ownerId)} size="xs" /> : <Unassigned size="xs" />}
                      {ws.memberName(current.ownerId)}
                    </span>
                  }
                />
                {(current.utmSource || current.utmMedium || current.utmCampaign) && (
                  <Fact label="Campaign" value={[current.utmSource, current.utmMedium, current.utmCampaign].filter(Boolean).join(' · ')} />
                )}
              </dl>

              {/* The reasons arrive a beat after the card. Holding the space stops
                  the buttons sliding down under the cursor as you work the deck. */}
              {detail.isPending || detail.data?.scoreReasons.length ? (
                <section className="min-h-[42px]">
                  <h3 className="text-micro font-semibold uppercase text-ink-3">Why it scores {current.score}</h3>
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-2">
                    {(detail.data?.scoreReasons ?? []).map(reason => (
                      <li key={reason} className="tabular whitespace-nowrap">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {canEdit ? (
                <div className="flex flex-col gap-3 border-t border-line pt-5">
                  <div className="flex flex-wrap gap-2">
                    <DeckButton keyLabel="1" variant="primary" icon={<CheckCircle size={16} />} onClick={startWorking}>
                      Start working
                    </DeckButton>
                    <DeckButton keyLabel="2" variant="secondary" icon={<Trophy size={16} />} onClick={() => setConverting(true)}>
                      Convert
                    </DeckButton>
                    <DeckButton keyLabel="3" variant="secondary" icon={<BookmarkSimple size={16} />} onClick={nurture}>
                      Nurture
                    </DeckButton>
                    <DeckButton keyLabel="4" variant="secondary" icon={<Prohibit size={16} />} onClick={() => setDisqualifying(true)}>
                      Disqualify
                    </DeckButton>
                    {/* Skip isn't a decision, so it sits apart from the four that are —
                        and drops its keycap, which the hint line below already carries. */}
                    <Button variant="ghost" size="md" className="ml-auto" leading={<SkipForward size={16} />} onClick={skip}>
                      Skip
                    </Button>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys="1" />–<Kbd keys="4" /> decide
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys="s" /> skip
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys="j" />
                      <Kbd keys="k" /> move
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys="enter" /> open the full lead
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Kbd keys="esc" /> back to the list
                    </span>
                  </p>
                </div>
              ) : (
                <p className="border-t border-line pt-5 text-ui text-ink-2">Your role can read leads but not triage them.</p>
              )}
            </article>
          )}
        </div>
      </div>

      {current && (
        <>
          <ConvertLeadDialog open={converting} onOpenChange={setConverting} lead={current} onDone={() => advance()} />
          <DisqualifyDialog open={disqualifying} onOpenChange={setDisqualifying} leadIds={[current.id]} leadName={current.name} onDone={advance} />
        </>
      )}
    </div>
  );
}

function Fact({ label, value, href }: { label: string; value: React.ReactNode; href?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro font-semibold uppercase text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-ui text-ink">
        {value ? (
          href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-ink-3">Not given</span>
        )}
      </dd>
    </div>
  );
}

function DeckButton({ keyLabel, children, icon, variant, onClick }: { keyLabel: string; children: React.ReactNode; icon?: React.ReactNode; variant: 'primary' | 'secondary' | 'ghost'; onClick: () => void }) {
  return (
    <Button variant={variant} size="md" leading={icon} onClick={onClick} trailing={<Kbd keys={keyLabel} tone={variant === 'primary' ? 'inverse' : 'default'} className="ml-1" />}>
      {children}
    </Button>
  );
}

export type { Lead };
