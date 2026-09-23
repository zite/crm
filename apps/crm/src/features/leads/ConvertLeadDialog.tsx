import { ArrowRight, Buildings, CheckCircle, Trophy, User } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { convertLead } from 'zitejs/api';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, FieldRow, Input, Switch } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { CompanyMark } from '../../glyphs';
import { DatePicker, FieldButton, MemberPicker, RecordPicker, StagePicker } from '../../pickers/pickers';
import { errorMessage } from '../../lib/errors';
import { shortDate, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { invalidateLead, useLead, type Lead } from './leadData';

/**
 * Convert: the one moment a lead stops being an enquiry and becomes real work.
 *
 * It shows what it is about to do before it does it — the company it matched on
 * domain, the contact that already owns the email address, the deal it will
 * open — because a convert that silently duplicates a company is the thing
 * everyone hates about a CRM. Converting twice is safe: the server returns what
 * the lead already became.
 */
export function ConvertLeadDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; lead: Lead; onDone?: (result: { contactId: string | null; dealId: string | null }) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending } = useLead(open ? lead.id : null, { matches: true });

  const [companyMode, setCompanyMode] = useState<'match' | 'existing' | 'new' | 'none'>('match');
  const [pickedCompany, setPickedCompany] = useState<{ id: string; name: string } | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [linkContact, setLinkContact] = useState(true);
  const [makeDeal, setMakeDeal] = useState(true);
  const [dealName, setDealName] = useState('');
  const [amount, setAmount] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [closeDate, setCloseDate] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matchedCompany = data?.matches.companies[0] ?? null;
  const matchedContact = data?.matches.contact ?? null;

  useEffect(() => {
    if (!open) return;
    const pipeline = ws.defaultPipeline?.id ?? '';
    const close = new Date();
    close.setDate(close.getDate() + 45);
    setCompanyMode('match');
    setPickedCompany(null);
    setCompanyName(lead.companyName ?? '');
    setLinkContact(true);
    setMakeDeal(true);
    setDealName(`${lead.companyName || lead.name} — new business`);
    setAmount('');
    setPipelineId(pipeline);
    setStageId(ws.openStagesFor(pipeline)[0]?.id ?? '');
    setCloseDate(close.toLocaleDateString('en-CA'));
    setOwnerId(lead.ownerId ?? ws.me.id);
    setError(null);
  }, [open, lead.id]);

  // Once the matches arrive, default to whichever choice is truthful.
  useEffect(() => {
    if (!data || !open) return;
    if (matchedCompany) setCompanyMode('match');
    else if (lead.companyName) setCompanyMode('new');
    else setCompanyMode('none');
  }, [data?.lead.id, open]);

  const companySummary = useMemo(() => {
    if (companyMode === 'match') return matchedCompany ? { name: matchedCompany.name, id: matchedCompany.id, isNew: false } : lead.companyName ? { name: lead.companyName, id: null, isNew: true } : null;
    if (companyMode === 'existing') return pickedCompany ? { name: pickedCompany.name, id: pickedCompany.id, isNew: false } : null;
    if (companyMode === 'new') return companyName.trim() ? { name: companyName.trim(), id: null, isNew: true } : null;
    return null;
  }, [companyMode, matchedCompany, pickedCompany, companyName, lead.companyName]);

  const submit = async () => {
    if (companyMode === 'existing' && !pickedCompany) {
      setError('Choose the company to link, or make a new one');
      return;
    }
    if (companyMode === 'new' && !companyName.trim()) {
      setError('Give the company a name');
      return;
    }
    if (makeDeal && !dealName.trim()) {
      setError('Give the deal a name');
      return;
    }
    try {
      const amountValue = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : null;
      const result = await convertLead({
        leadId: lead.id,
        company:
          companyMode === 'existing'
            ? { mode: 'existing', companyId: pickedCompany?.id ?? null }
            : companyMode === 'new'
              ? { mode: 'new', name: companyName.trim() }
              : { mode: companyMode },
        contact: { mode: linkContact ? 'match' : 'new' },
        deal: makeDeal
          ? { create: true, name: dealName.trim(), amount: Number.isFinite(amountValue) ? amountValue : null, pipelineId: pipelineId || null, stageId: stageId || null, closeDate, ownerId }
          : { create: false },
        ownerId,
        today: todayString(),
      });
      invalidateLead(qc, lead.id);
      onOpenChange(false);
      const openWhatItBecame = result.dealId
        ? { label: 'Open deal', onClick: () => navigate(`/deals/${result.dealId}`) }
        : result.contactId
          ? { label: 'Open contact', onClick: () => navigate(`/contacts/${result.contactId}`) }
          : undefined;
      if (result.alreadyConverted) {
        toast.message(`${lead.name} was already converted — nothing changed`, { action: openWhatItBecame });
      } else {
        toast.success(result.dealId ? `Converted — ${result.dealName} is open` : `Converted — ${result.contactName} is now a contact`, { action: openWhatItBecame });
      }
      onDone?.({ contactId: result.contactId, dealId: result.dealId });
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t convert that lead'));
      throw e;
    }
  };

  const owner = ws.memberById(ownerId);
  const canEdit = ws.can('records.edit');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Convert ${lead.name}`}
      description="A contact, the company they work for, and — if you want it — the deal that follows."
      submitLabel={makeDeal ? 'Convert and open deal' : 'Convert'}
      onSubmit={submit}
      disabled={!canEdit || isPending}
      footerStart={<span className="hidden text-meta text-ink-3 sm:inline">The lead keeps its story and links to what it became.</span>}
    >
      <div className="flex flex-col gap-6">
        {/* What it becomes, in one line, before any of the controls. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-ui">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <User size={15} className="text-ink-3" />
            {matchedContact && linkContact ? matchedContact.name : lead.name}
          </span>
          {matchedContact && linkContact && <Badge tone="info">Existing contact</Badge>}
          {companySummary && (
            <>
              <ArrowRight size={13} className="text-ink-3" />
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Buildings size={15} className="text-ink-3" />
                {companySummary.name}
              </span>
              {companySummary.isNew ? <Badge tone="accent">New</Badge> : <Badge tone="info">Existing</Badge>}
            </>
          )}
          {makeDeal && (
            <>
              <ArrowRight size={13} className="text-ink-3" />
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Trophy size={15} className="text-ink-3" />
                {dealName.trim() || 'a deal'}
              </span>
            </>
          )}
        </div>

        {/* Company */}
        <section className="flex flex-col gap-3">
          <h3 className="text-micro font-semibold uppercase text-ink-3">Company</h3>
          {isPending ? (
            <p className="text-ui text-ink-3">Looking for a match…</p>
          ) : (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Company">
              {matchedCompany && (
                <ChoiceRow
                  autoFocus
                  selected={companyMode === 'match'}
                  onSelect={() => setCompanyMode('match')}
                  icon={<CompanyMark name={matchedCompany.name} id={matchedCompany.id} size="sm" />}
                  title={`Link ${matchedCompany.name}`}
                  hint={`${matchedCompany.domain ?? 'Matched on name'} · ${matchedCompany.contactCount} ${matchedCompany.contactCount === 1 ? 'contact' : 'contacts'} already`}
                />
              )}
              {lead.companyName && (
                <ChoiceRow
                  autoFocus={!matchedCompany}
                  selected={companyMode === 'new'}
                  onSelect={() => setCompanyMode('new')}
                  icon={<CompanyMark name={companyName || lead.companyName} id={lead.id} size="sm" />}
                  title={`Create ${companyName.trim() || lead.companyName}`}
                  hint={lead.website ? `From ${lead.website.replace(/^https?:\/\/(www\.)?/, '')}` : 'A new company record'}
                />
              )}
              <ChoiceRow
                autoFocus={!matchedCompany && !lead.companyName}
                selected={companyMode === 'existing'}
                onSelect={() => setCompanyMode('existing')}
                icon={<Buildings size={16} className="text-ink-3" />}
                title="Link a different company"
                hint="Search everything you already have"
              />
              <ChoiceRow selected={companyMode === 'none'} onSelect={() => setCompanyMode('none')} icon={<Unassigned size="sm" />} title="No company" hint="Just the person, for now" />
            </div>
          )}
          {companyMode === 'existing' && (
            <RecordPicker
              kind="company"
              value={pickedCompany}
              onChange={record => setPickedCompany(record)}
              trigger={
                <FieldButton placeholder={!pickedCompany} icon={pickedCompany ? <CompanyMark name={pickedCompany.name} id={pickedCompany.id} size="xs" /> : undefined} onClear={pickedCompany ? () => setPickedCompany(null) : undefined}>
                  {pickedCompany?.name ?? 'Search companies'}
                </FieldButton>
              }
            />
          )}
          {companyMode === 'new' && (
            <Field label="Company name" hint="Fix a typo from the form before it becomes a record.">
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Northgate Freight" />
            </Field>
          )}
        </section>

        {/* Contact */}
        <section className="flex flex-col gap-2">
          <h3 className="text-micro font-semibold uppercase text-ink-3">Contact</h3>
          {matchedContact ? (
            <div className="flex items-start gap-3 rounded-md border border-line bg-card px-3 py-2.5">
              <Avatar person={{ id: matchedContact.id, name: matchedContact.name }} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui font-medium text-ink">{matchedContact.name}</div>
                <div className="truncate text-meta text-ink-3">{[matchedContact.title, matchedContact.companyName].filter(Boolean).join(' · ') || matchedContact.email}</div>
                <p className="mt-1 text-meta text-ink-2">Already a contact with {lead.email}. Linking keeps one history instead of two.</p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 text-meta text-ink-3">
                Link
                <Switch checked={linkContact} onCheckedChange={setLinkContact} />
              </label>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-ui text-ink-2">
              A new contact for <span className="text-ink">{lead.name}</span>
              {lead.email ? <span className="text-ink-3"> · {lead.email}</span> : null}
            </p>
          )}
          <Field label="Owner" className="mt-1 max-w-[280px]">
            <MemberPicker value={ownerId} onChange={setOwnerId} trigger={<FieldButton icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>} />
          </Field>
        </section>

        {/* Deal */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-micro font-semibold uppercase text-ink-3">Deal</h3>
            <label className="flex cursor-pointer items-center gap-2 text-meta text-ink-3">
              {makeDeal ? 'Open one now' : 'No deal yet'}
              <Switch checked={makeDeal} onCheckedChange={setMakeDeal} />
            </label>
          </div>
          {makeDeal && (
            <div className="flex flex-col gap-4">
              <Field label="Name" required>
                <Input value={dealName} onChange={e => setDealName(e.target.value)} placeholder="Northgate Freight — new business" />
              </Field>
              <FieldRow cols={3}>
                <Field label="Amount" hint={`In ${ws.settings.currency}`}>
                  <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="48000" />
                </Field>
                <Field label="Stage">
                  <StagePicker pipelineId={pipelineId} value={stageId} onChange={setStageId} trigger={<FieldButton placeholder={!stageId}>{ws.stageById(stageId)?.name ?? 'Choose'}</FieldButton>} />
                </Field>
                <Field label="Close date">
                  <DatePicker value={closeDate} onChange={setCloseDate} trigger={<FieldButton placeholder={!closeDate}>{closeDate ? shortDate(closeDate) : 'Pick a date'}</FieldButton>} />
                </Field>
              </FieldRow>
              {ws.pipelines.filter(p => !p.archived).length > 1 && (
                <Field label="Pipeline" className="max-w-[280px]">
                  <FieldButton
                    onClick={() => {
                      const next = ws.pipelines.filter(p => !p.archived);
                      const index = next.findIndex(p => p.id === pipelineId);
                      const chosen = next[(index + 1) % next.length];
                      if (chosen) {
                        setPipelineId(chosen.id);
                        setStageId(ws.openStagesFor(chosen.id)[0]?.id ?? '');
                      }
                    }}
                  >
                    {ws.pipelineById(pipelineId)?.name ?? 'Choose'}
                  </FieldButton>
                </Field>
              )}
            </div>
          )}
        </section>

        {error && <p className="text-meta text-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}

function ChoiceRow({ selected, onSelect, icon, title, hint, autoFocus }: { selected: boolean; onSelect: () => void; icon: React.ReactNode; title: string; hint?: string; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      autoFocus={autoFocus}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected ? 'border-accent bg-accent/[0.07] dark:bg-accent/10' : 'border-line hover:border-line-strong hover:bg-hover/60',
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink">{title}</span>
        {hint && <span className="block truncate text-meta text-ink-3">{hint}</span>}
      </span>
      {selected && <CheckCircle size={16} weight="fill" className="shrink-0 text-accent" />}
    </button>
  );
}
