import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Chipput } from '../../ui/Button';
import { FactRow } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { ChoicePicker, MemberPicker, TagRow } from '../../pickers/pickers';
import { fullDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { useLeadActions, type Lead } from './leadData';

/**
 * The lead's properties, edited where they are read. A value is a button that
 * turns into its editor; Enter saves, Esc puts it back. Empty values say what
 * they would be ("Add a phone number") rather than showing a dash you can't use.
 */
export function LeadFacts({ lead }: { lead: Lead }) {
  const ws = useWorkspace();
  const actions = useLeadActions();
  const canEdit = ws.can('records.edit') && !lead.convertedAt;
  const set = (patch: Parameters<typeof actions.setField>[1]) => actions.setField(lead.id, patch);

  return (
    <div className="flex flex-col gap-0.5 py-1">
      <FactRow label="Email">
        {lead.email ? (
          <a href={`mailto:${lead.email}`} className="truncate text-ui text-accent hover:underline">
            {lead.email}
          </a>
        ) : (
          <TextEdit value={null} placeholder="Add an email" onSave={v => set({ email: v })} canEdit={canEdit} />
        )}
      </FactRow>
      <FactRow label="Phone">
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className="truncate text-ui text-ink hover:text-accent">
            {lead.phone}
          </a>
        ) : (
          <TextEdit value={null} placeholder="Add a phone number" onSave={v => set({ phone: v })} canEdit={canEdit} />
        )}
      </FactRow>
      <FactRow label="Title">
        <TextEdit value={lead.title} placeholder="Add a title" onSave={v => set({ title: v })} canEdit={canEdit} />
      </FactRow>
      <FactRow label="Company">
        <TextEdit value={lead.companyName} placeholder="Add a company" onSave={v => set({ companyName: v })} canEdit={canEdit} />
      </FactRow>
      <FactRow label="Website">
        {lead.website ? (
          <a href={lead.website} target="_blank" rel="noreferrer" className="truncate text-ui text-accent hover:underline">
            {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        ) : (
          <TextEdit value={null} placeholder="Add a website" onSave={v => set({ website: v })} canEdit={canEdit} />
        )}
      </FactRow>
      <FactRow label="Employees">
        <TextEdit
          value={lead.employees == null ? null : String(lead.employees)}
          placeholder="Add a size"
          numeric
          format={v => `${Number(v).toLocaleString('en-US')} people`}
          onSave={v => set({ employees: v == null ? null : Number(v.replace(/[^0-9]/g, '')) || null })}
          canEdit={canEdit}
        />
      </FactRow>
      <FactRow label="Industry">
        {canEdit ? (
          <ChoicePicker list="Industry" value={lead.industry} onChange={value => set({ industry: value })} placeholder="Set industry" />
        ) : (
          <span className="text-ui">{lead.industry ?? '—'}</span>
        )}
      </FactRow>
      <FactRow label="Country">
        <TextEdit value={lead.country} placeholder="Add a country" onSave={v => set({ country: v })} canEdit={canEdit} />
      </FactRow>
      <FactRow label="Source">
        {canEdit ? (
          <ChoicePicker list="Lead Source" value={lead.source} onChange={value => set({ source: value })} placeholder="Set source" />
        ) : (
          <span className="text-ui">{lead.source ?? '—'}</span>
        )}
      </FactRow>
      {(lead.sourceDetail || lead.formName) && (
        <FactRow label="Came from">
          {lead.formId && lead.formName ? (
            <Link to={`/outreach/forms/${lead.formId}`} className="truncate text-ui text-accent hover:underline">
              {lead.formName}
            </Link>
          ) : (
            <span className="truncate text-ui text-ink-2">{lead.formName ?? lead.sourceDetail}</span>
          )}
        </FactRow>
      )}
      <FactRow label="Owner">
        {canEdit ? (
          <MemberPicker value={lead.ownerId} onChange={ownerId => actions.setOwner([lead.id], ownerId)} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ui">
            {lead.ownerId ? <Avatar person={ws.memberById(lead.ownerId)} size="xs" /> : <Unassigned size="xs" />} {ws.memberName(lead.ownerId)}
          </span>
        )}
      </FactRow>
      {(lead.utmSource || lead.utmMedium || lead.utmCampaign) && (
        <FactRow label="Campaign" align="start">
          <span className="flex flex-col gap-0.5 py-1 text-meta text-ink-2">
            {lead.utmSource && <span>Source · {lead.utmSource}</span>}
            {lead.utmMedium && <span>Medium · {lead.utmMedium}</span>}
            {lead.utmCampaign && <span>Campaign · {lead.utmCampaign}</span>}
          </span>
        </FactRow>
      )}
      {lead.status === 'Disqualified' && (
        <FactRow label="Reason">
          <span className="text-ui text-ink-2">{lead.disqualifyReason ?? '—'}</span>
        </FactRow>
      )}
      <FactRow label="Received">
        <span className="text-ui text-ink-2" title={lead.receivedAt ? fullDate(lead.receivedAt.slice(0, 10)) : ''}>
          {lead.receivedAt ? timeAgo(lead.receivedAt) : '—'}
        </span>
      </FactRow>
      <FactRow label="First reply">
        <span className="text-ui text-ink-2">{lead.firstResponseAt ? `${lead.responseHours != null && lead.responseHours < 1 ? 'under an hour' : `${Math.round(lead.responseHours ?? 0)}h`} after it came in` : 'Nobody yet'}</span>
      </FactRow>
      <FactRow label="Last activity">
        <span className="text-ui text-ink-2">{lead.lastActivityAt ? timeAgo(lead.lastActivityAt) : 'Nothing yet'}</span>
      </FactRow>
      <FactRow label="Tags" align="start">
        <TagRow tagIds={lead.tagIds} onChange={canEdit ? ids => actions.setTags([lead.id], ids) : undefined} />
      </FactRow>
    </div>
  );
}

/** A property that edits in place: click the value, type, Enter saves, Esc reverts. */
function TextEdit({ value, placeholder, onSave, canEdit, numeric, format }: { value: string | null; placeholder: string; onSave: (value: string | null) => void; canEdit: boolean; numeric?: boolean; format?: (value: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  if (!canEdit) return <span className={cn('truncate text-ui', value ? 'text-ink' : 'text-ink-3')}>{value ? (format ? format(value) : value) : '—'}</span>;

  if (editing) {
    return (
      <Input
        ref={inputRef}
        autoFocus
        value={draft}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim() || null;
          if (next !== (value ?? null)) onSave(next);
          setEditing(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
        className="h-7 text-ui"
      />
    );
  }

  return (
    <Chipput placeholder={!value} onClick={() => setEditing(true)}>
      {value ? (format ? format(value) : value) : placeholder}
    </Chipput>
  );
}
