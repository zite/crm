import { ArrowLeft, ArrowSquareOut, CaretRight, Copy, DotsThree, DownloadSimple, Eye, FilePdf, PaperPlaneTilt, PencilSimple, Prohibit } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { duplicateQuote, getDeal, listLineItems, quotePdf, saveQuote, voidQuote } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card, DetailLayout, EmptyState, FactRow, PageHeader, Section, Skeleton } from '../../ui/Layout';
import { Field, Input, Segmented, Textarea } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Money } from '../../glyphs';
import { DatePicker, FieldButton, MemberPicker, RecordPicker } from '../../pickers/pickers';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { fullDate, timeAgo, todayString } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { LineItemsEditor, TotalsBlock } from './LineItemsEditor';
import { QuoteDocument } from './QuoteDocument';
import { QUOTE_STATUS_HINT, QuoteStatusBadge } from './quoteStatus';
import { SendQuoteDialog } from './SendQuoteDialog';
import { fromLineItems, fromQuoteItems, isComplete, toPayload, totalsOf, type EditableLine } from './lineItems';
import { invalidateQuotes, useQuote } from './queries';
import type { QuoteStatus } from '@project/shared/constants';

type Draft = {
  title: string;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  ownerId: string | null;
  lines: EditableLine[];
  taxRate: number;
  expiresOn: string | null;
  terms: string;
  buyerNote: string;
};

const fingerprint = (d: Draft) =>
  JSON.stringify({ ...d, companyName: undefined, contactName: undefined, dealName: undefined, lines: toPayload(d.lines) });

/** `/quotes/new?deal=…` starts a draft from the deal's line items, then becomes a real quote. */
function NewQuote() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dealId = params.get('deal');
  const companyId = params.get('company');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const [deal, items] = await Promise.all([
          dealId ? getDeal({ id: dealId, today: todayString() }).catch(() => null) : Promise.resolve(null),
          dealId ? listLineItems({ dealId }).catch(() => null) : Promise.resolve(null),
        ]);
        const created = await saveQuote({
          title: deal?.deal.name ?? 'New quote',
          dealId: dealId || null,
          companyId: companyId || deal?.deal.companyId || null,
          items: toPayload(fromLineItems(items?.items ?? [])),
          today: todayString(),
        });
        invalidateQuotes(qc, { dealId });
        navigate(`/quotes/${created.id}`, { replace: true });
      } catch (e) {
        setError(errorMessage(e, 'Couldn’t start that quote'));
      }
    })();
  }, [dealId, companyId, navigate, qc]);

  if (error) {
    return (
      <EmptyState icon={<FilePdf size={22} weight="duotone" />} title="That quote couldn’t be started" actions={<Button variant="primary" onClick={() => navigate('/quotes')}>Back to quotes</Button>}>
        {error}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4 px-5 py-8 sm:px-8">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function QuoteEditorPage() {
  const { id = '' } = useParams();
  if (id === 'new') return <NewQuote />;
  return <QuoteEditor id={id} />;
}

function QuoteEditor({ id }: { id: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const actions = useAppActions();
  const { data, isPending, isError } = useQuote(id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [renaming, setRenaming] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  useDocumentTitle(data ? `${data.quote.number} · ${data.quote.title}` : 'Quote', ws.settings.organizationName);

  // Load the server's version whenever it actually changes — including right
  // after our own save, which is what clears the "unsaved" state.
  const loadedFp = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const next: Draft = {
      title: data.quote.title,
      companyId: data.quote.companyId,
      companyName: data.quote.companyName,
      contactId: data.quote.contactId,
      contactName: data.quote.contactName,
      dealId: data.quote.dealId,
      dealName: data.quote.dealName,
      ownerId: data.quote.ownerId,
      lines: fromQuoteItems(data.items),
      taxRate: data.quote.taxRate,
      expiresOn: data.quote.expiresOn,
      terms: data.quote.terms,
      buyerNote: data.quote.buyerNote,
    };
    const fp = fingerprint(next);
    if (loadedFp.current === fp) return;
    loadedFp.current = fp;
    setBaseline(fp);
    setDraft(next);
  }, [data]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveQuote({
        id,
        title: d.title,
        dealId: d.dealId,
        companyId: d.companyId,
        contactId: d.contactId,
        ownerId: d.ownerId,
        items: toPayload(d.lines),
        taxRate: d.taxRate,
        expiresOn: d.expiresOn,
        terms: d.terms,
        buyerNote: d.buyerNote,
        today: todayString(),
      }),
    onSuccess: () => {
      invalidateQuotes(qc, { quoteId: id, dealId: draft?.dealId ?? null });
      setShowErrors(false);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that quote')),
  });

  const duplicate = useMutation({
    mutationFn: () => duplicateQuote({ id, today: todayString() }),
    onSuccess: result => {
      invalidateQuotes(qc, { dealId: draft?.dealId ?? null });
      toast.success(`Copied into ${result.number}`);
      navigate(`/quotes/${result.id}`);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t duplicate that quote')),
  });

  // The error check comes first: `draft` is only ever filled from `data`, so a
  // failed load would otherwise sit on the skeleton for good.
  if (isError || (!isPending && !data)) {
    return (
      <EmptyState icon={<FilePdf size={22} weight="duotone" />} title="That quote isn’t here" actions={<Button variant="primary" onClick={() => navigate('/quotes')}>Back to quotes</Button>}>
        It may have been deleted, or the link is out of date.
      </EmptyState>
    );
  }

  if (isPending || !draft || !data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const quote = data.quote;
  const locked = quote.storedStatus !== 'Draft';
  const canEdit = ws.can('quotes.manage') && !locked;
  const dirty = fingerprint(draft) !== baseline;
  const totals = totalsOf(draft.lines, draft.taxRate);
  const patch = (next: Partial<Draft>) => setDraft(d => (d ? { ...d, ...next } : d));

  const saveDraft = async (quiet?: boolean) => {
    if (!isComplete(draft.lines)) {
      setShowErrors(true);
      toast.error('Every line needs a description');
      return false;
    }
    await save.mutateAsync(draft);
    if (!quiet) toast.success('Draft saved');
    return true;
  };

  const openSend = async () => {
    if (!draft.lines.length) {
      toast.error('Add at least one line before sending');
      return;
    }
    if (dirty && !(await saveDraft(true))) return;
    setSendOpen(true);
  };

  const downloadPdf = async () => {
    if (pdfPending) return;
    setPdfPending(true);
    try {
      if (dirty && canEdit) await saveDraft(true);
      const result = await quotePdf({ id, today: todayString() });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t render that PDF'));
    } finally {
      setPdfPending(false);
    }
  };

  const doVoid = async () => {
    const ok = await actions.confirm({
      title: `Void ${quote.number}?`,
      description: 'The buyer’s link will say the quote has been withdrawn. The record and its number stay.',
      confirmLabel: 'Void quote',
      destructive: true,
    });
    if (!ok) return;
    try {
      await voidQuote({ ids: [id] });
      invalidateQuotes(qc, { quoteId: id, dealId: draft.dealId });
      toast.success(`${quote.number} voided`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t void that quote'));
    }
  };

  const preview = (
    <QuoteDocument
      number={quote.number}
      title={draft.title}
      companyName={draft.companyName}
      contactName={draft.contactName}
      lines={draft.lines}
      taxRate={draft.taxRate}
      expiresOn={draft.expiresOn}
      terms={draft.terms}
      buyerNote={draft.buyerNote}
      status={quote.status}
      sentAt={quote.sentAt}
      acceptedName={quote.acceptedName}
      acceptedTitle={quote.acceptedTitle}
      acceptedAt={quote.acceptedAt}
      declinedAt={quote.declinedAt}
      declineReason={quote.declineReason}
      preparedBy={data.owner ? { name: data.owner.name, title: data.owner.title, email: data.owner.email } : null}
    />
  );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <>
            <Link to="/quotes" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft size={13} /> Quotes
            </Link>
            <CaretRight size={11} className="text-ink-3" />
            <span className="font-mono tracking-[0.04em] text-ink-2">{quote.number}</span>
          </>
        }
        title={
          canEdit && renaming ? (
            <Input
              autoFocus
              value={draft.title}
              onChange={e => patch({ title: e.target.value })}
              onBlur={() => setRenaming(false)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  patch({ title: quote.title });
                  setRenaming(false);
                }
              }}
              aria-label="Quote title"
              placeholder="Name this quote"
              className="h-12 w-full max-w-[640px] font-display text-[26px] leading-9 sm:text-[30px]"
            />
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setRenaming(true)}
              className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent"
            >
              {draft.title || 'Name this quote'}
            </button>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-title font-semibold text-ink">
              <Money value={totals.total} cents />
            </span>
            <QuoteStatusBadge status={quote.status} />
            <span className="text-ink-2">{QUOTE_STATUS_HINT[(quote.status in QUOTE_STATUS_HINT ? quote.status : 'Draft') as QuoteStatus]}</span>
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" size="sm" loading={save.isPending} disabled={!dirty} onClick={() => void saveDraft()}>
                {dirty ? 'Save draft' : 'Saved'}
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" leading={<PaperPlaneTilt size={16} />} onClick={() => void openSend()}>
                Send
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="sm" icon aria-label="Quote actions">
                  <DotsThree size={18} weight="bold" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<DownloadSimple size={16} />} disabled={pdfPending} onSelect={() => void downloadPdf()}>
                  {pdfPending ? 'Rendering the PDF…' : 'Download PDF'}
                </MenuItem>
                {ws.can('quotes.manage') && (
                  <MenuItem icon={<Copy size={16} />} onSelect={() => duplicate.mutate()}>
                    Duplicate
                  </MenuItem>
                )}
                {data.publicUrl && quote.storedStatus !== 'Draft' && (
                  <MenuItem icon={<ArrowSquareOut size={16} />} onSelect={() => window.open(data.publicUrl, '_blank', 'noopener,noreferrer')}>
                    Open the buyer’s page
                  </MenuItem>
                )}
                {ws.can('quotes.manage') && quote.storedStatus !== 'Void' && quote.storedStatus !== 'Accepted' && (
                  <>
                    <MenuSeparator />
                    <MenuItem destructive icon={<Prohibit size={16} />} onSelect={() => void doVoid()}>
                      Void quote
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />

      <DetailLayout
        rail={
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">Details</h2>
              <FactRow label="Status">
                <QuoteStatusBadge status={quote.status} />
              </FactRow>
              <FactRow label="Number">
                <span className="font-mono text-ui tracking-[0.04em] text-ink">{quote.number}</span>
              </FactRow>
              <FactRow label="Owner">
                <MemberPicker
                  value={draft.ownerId}
                  onChange={ownerId => canEdit && patch({ ownerId })}
                  trigger={
                    <button type="button" disabled={!canEdit} className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-ui hover:bg-hover disabled:hover:bg-transparent">
                      <Avatar person={ws.memberById(draft.ownerId)} size="xs" />
                      {ws.memberName(draft.ownerId)}
                    </button>
                  }
                />
              </FactRow>
              <FactRow label="Expires">
                {canEdit ? (
                  <DatePicker value={draft.expiresOn} onChange={expiresOn => patch({ expiresOn })} placeholder="Set an expiry" />
                ) : (
                  <span className="text-ui text-ink">{draft.expiresOn ? fullDate(draft.expiresOn) : 'No expiry'}</span>
                )}
              </FactRow>
              <FactRow label="Currency">
                <span className="text-ui text-ink-2">{quote.currency}</span>
              </FactRow>
            </Card>

            {quote.storedStatus !== 'Draft' && (
              <Card className="p-4">
                <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">The buyer’s page</h2>
                {data.publicUrl ? (
                  <>
                    <p className="break-all text-meta text-ink-2">{data.publicUrl}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button variant="secondary" size="xs" onClick={() => void copyText(data.publicUrl, 'Link copied')}>
                        Copy link
                      </Button>
                      <Button variant="ghost" size="xs" leading={<ArrowSquareOut size={14} />} onClick={() => window.open(data.publicUrl, '_blank', 'noopener,noreferrer')}>
                        Open
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-meta text-warning">No public address is recorded yet — open the CRM Pages app once and links start working.</p>
                )}
                <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-meta">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Sent</dt>
                    <dd className="text-ink-2">{quote.sentAt ? timeAgo(quote.sentAt) : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Opened</dt>
                    <dd className="text-ink-2">{quote.viewedAt ? `${timeAgo(quote.viewedAt)} · ${quote.viewCount} ${quote.viewCount === 1 ? 'view' : 'views'}` : 'Not yet'}</dd>
                  </div>
                  {quote.acceptedAt && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-3">Accepted</dt>
                      <dd className="text-success">{quote.acceptedName ?? 'Yes'}</dd>
                    </div>
                  )}
                  {quote.declinedAt && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-3">Declined</dt>
                      <dd className="text-danger">{timeAgo(quote.declinedAt)}</dd>
                    </div>
                  )}
                </dl>
              </Card>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {locked && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken px-4 py-3">
              <Eye size={18} className="text-ink-2" />
              <p className="min-w-0 flex-1 text-ui text-ink-2">
                {quote.storedStatus === 'Void'
                  ? 'This quote was voided, so it stays exactly as the buyer last saw it.'
                  : `Sent ${quote.sentAt ? timeAgo(quote.sentAt) : ''} — this is the record of what the buyer was shown, so it can’t be edited.`}{' '}
                Duplicate it to make changes.
              </p>
              {ws.can('quotes.manage') && (
                <Button variant="secondary" size="sm" leading={<Copy size={15} />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
                  Duplicate
                </Button>
              )}
            </div>
          )}

          {canEdit && (
            <Segmented
              value={mode}
              onChange={value => setMode(value as 'edit' | 'preview')}
              options={[
                { value: 'edit', label: 'Build', icon: <PencilSimple size={15} /> },
                { value: 'preview', label: 'What the buyer sees', icon: <Eye size={15} /> },
              ]}
              className="self-start"
            />
          )}

          {mode === 'preview' || !canEdit ? (
            preview
          ) : (
            <>
              <Section title="Who it’s for">
                <Card className="flex flex-col gap-3 p-4">
                  <Field label="Company">
                    <RecordPicker
                      kind="company"
                      value={draft.companyId ? { id: draft.companyId, name: draft.companyName ?? 'Company' } : null}
                      onChange={record => patch({ companyId: record?.id ?? null, companyName: record?.name ?? null })}
                      trigger={<FieldButton aria-label="Company" placeholder={!draft.companyId} onClear={draft.companyId ? () => patch({ companyId: null, companyName: null }) : undefined}>{draft.companyName ?? 'Choose a company'}</FieldButton>}
                    />
                  </Field>
                  <Field label="Contact" hint="Who the quote is addressed to, and where it is sent by default.">
                    <RecordPicker
                      kind="contact"
                      value={draft.contactId ? { id: draft.contactId, name: draft.contactName ?? 'Contact' } : null}
                      onChange={record => patch({ contactId: record?.id ?? null, contactName: record?.name ?? null })}
                      trigger={<FieldButton aria-label="Contact" placeholder={!draft.contactId} onClear={draft.contactId ? () => patch({ contactId: null, contactName: null }) : undefined}>{draft.contactName ?? 'Choose a contact'}</FieldButton>}
                    />
                  </Field>
                  <Field label="Deal" hint="Accepting this quote lands on the deal’s timeline.">
                    <RecordPicker
                      kind="deal"
                      value={draft.dealId ? { id: draft.dealId, name: draft.dealName ?? 'Deal' } : null}
                      onChange={record => patch({ dealId: record?.id ?? null, dealName: record?.name ?? null })}
                      trigger={<FieldButton aria-label="Deal" placeholder={!draft.dealId} onClear={draft.dealId ? () => patch({ dealId: null, dealName: null }) : undefined}>{draft.dealName ?? 'Link a deal'}</FieldButton>}
                    />
                  </Field>
                </Card>
              </Section>

              <Section title="Line items" count={draft.lines.length}>
                <div className="flex flex-col gap-4">
                  <LineItemsEditor lines={draft.lines} onChange={lines => patch({ lines })} showErrors={showErrors} />
                  <TotalsBlock lines={draft.lines} taxRate={draft.taxRate} onTaxRateChange={taxRate => patch({ taxRate })} inset="grid" />
                </div>
              </Section>

              <Section title="Note to the buyer" description="Shown at the top of their page and in the PDF">
                <Textarea value={draft.buyerNote} minRows={3} placeholder="A line or two about what you agreed." onChange={e => patch({ buyerNote: e.target.value })} aria-label="Note to the buyer" />
              </Section>

              <Section
                title="Terms"
                action={
                  draft.terms !== ws.settings.quoteDefaults.terms ? (
                    <Button variant="ghost" size="xs" onClick={() => patch({ terms: ws.settings.quoteDefaults.terms })}>
                      Reset to the default
                    </Button>
                  ) : undefined
                }
              >
                <Textarea value={draft.terms} minRows={5} onChange={e => patch({ terms: e.target.value })} aria-label="Terms" />
              </Section>
            </>
          )}
        </div>
      </DetailLayout>

      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        quote={{ ...quote, title: draft.title, total: totals.total, expiresOn: draft.expiresOn }}
        publicUrl={data.publicUrl}
        onSent={() => setMode('preview')}
      />
    </div>
  );
}
