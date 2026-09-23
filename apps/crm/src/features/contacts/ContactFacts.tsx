import { ArrowSquareOut, Info } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Chipput } from '../../ui/Button';
import { Badge } from '../../ui/Chip';
import { FactRow } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { Tooltip } from '../../ui/Tooltip';
import { CompanyMark } from '../../glyphs';
import { ChoicePicker, MemberPicker, RecordPicker, TagRow } from '../../pickers/pickers';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { externalUrl, hostLabel } from '../companies/companyHelpers';
import { ChipValue, CustomFieldRows, InlineSwitch, InlineText } from '../companies/inline';
import { useContactActions } from '../companies/mutations';
import type { Contact } from './contactHelpers';

/**
 * The contact's properties, edited in place. The page shows them in its 320px
 * rail; the peek sheet is three times as wide, so it asks for two columns
 * rather than leaving half the card empty.
 */
export function ContactFacts({ contact, columns = 1 }: { contact: Contact; columns?: 1 | 2 }) {
  const ws = useWorkspace();
  const actions = useContactActions();
  const canEdit = ws.can('records.edit');
  const save = (patch: Parameters<typeof actions.update.mutate>[0]['patch']) => actions.update.mutate({ ids: [contact.id], patch });

  return (
    <div className={cn('flex flex-col gap-0.5 py-1', columns === 2 && 'sm:grid sm:grid-cols-2 sm:gap-x-8')}>
      <FactRow label="Company">
        {canEdit ? (
          <ChipValue>
            <RecordPicker
              kind="company"
              value={contact.companyId ? { id: contact.companyId, name: contact.companyName ?? 'Company' } : null}
              onChange={record => actions.setCompany([contact.id], record?.id ?? null, record?.name ?? null)}
              trigger={
                <Chipput placeholder={!contact.companyId}>
                  {contact.companyId ? (
                    <>
                      <CompanyMark name={contact.companyName ?? '?'} id={contact.companyId} size="xs" className="mr-1.5" />
                      {/* The chip is a flex row, so the name needs its own box to ellipsise in. */}
                      <span className="truncate">{contact.companyName}</span>
                    </>
                  ) : (
                    'Link a company'
                  )}
                </Chipput>
              }
            />
          </ChipValue>
        ) : contact.companyId ? (
          <Link to={`/companies/${contact.companyId}`} className="truncate text-ui text-accent hover:underline">
            {contact.companyName}
          </Link>
        ) : (
          <span className="text-ui text-ink-3">—</span>
        )}
      </FactRow>
      <FactRow label="Job title">
        <InlineText value={contact.title} onSave={title => save({ title })} placeholder="Add a title" disabled={!canEdit} />
      </FactRow>
      <FactRow label="Email">
        <InlineText
          value={contact.email}
          onSave={email => save({ email })}
          placeholder="Add email"
          inputMode="email"
          disabled={!canEdit}
          render={value => (
            <a href={`mailto:${value}`} className="truncate text-accent hover:underline" onClick={e => e.stopPropagation()}>
              {value}
            </a>
          )}
        />
      </FactRow>
      <FactRow label="Phone">
        <InlineText
          value={contact.phone}
          onSave={phone => save({ phone })}
          placeholder="Add phone"
          inputMode="tel"
          disabled={!canEdit}
          render={value => (
            <a href={`tel:${value.replace(/[^\d+]/g, '')}`} className="truncate text-ink hover:text-accent" onClick={e => e.stopPropagation()}>
              {value}
            </a>
          )}
        />
      </FactRow>
      <FactRow label="Mobile">
        <InlineText
          value={contact.mobile}
          onSave={mobile => save({ mobile })}
          placeholder="Add mobile"
          inputMode="tel"
          disabled={!canEdit}
          render={value => (
            <a href={`tel:${value.replace(/[^\d+]/g, '')}`} className="truncate text-ink hover:text-accent" onClick={e => e.stopPropagation()}>
              {value}
            </a>
          )}
        />
      </FactRow>
      <FactRow label="LinkedIn">
        <InlineText
          value={contact.linkedinUrl}
          onSave={linkedinUrl => save({ linkedinUrl })}
          placeholder="Add LinkedIn"
          inputMode="url"
          disabled={!canEdit}
          render={value => (
            <a href={externalUrl(value) ?? '#'} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-1 text-accent hover:underline" onClick={e => e.stopPropagation()}>
              <span className="truncate">{hostLabel(value).replace('linkedin.com', 'LinkedIn')}</span>
              <ArrowSquareOut size={12} className="shrink-0" />
            </a>
          )}
        />
      </FactRow>
      <FactRow label="Owner">
        {canEdit ? (
          <ChipValue>
            <MemberPicker value={contact.ownerId} onChange={ownerId => actions.setOwner([contact.id], ownerId)} />
          </ChipValue>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ui">
            {contact.ownerId ? <Avatar person={ws.memberById(contact.ownerId)} size="xs" /> : <Unassigned size="xs" />} <span className="truncate">{ws.memberName(contact.ownerId)}</span>
          </span>
        )}
      </FactRow>
      <FactRow label="Source">
        {canEdit ? (
          <ChipValue>
            <ChoicePicker list="Lead Source" value={contact.source} onChange={source => save({ source })} placeholder="Set source" />
          </ChipValue>
        ) : (
          <span className="truncate text-ui">{contact.source ?? '—'}</span>
        )}
      </FactRow>
      <FactRow label="Timezone">
        <InlineText value={contact.timezone} onSave={timezone => save({ timezone })} placeholder="Add timezone" disabled={!canEdit} />
      </FactRow>
      <FactRow label="Location">
        <InlineText
          value={[contact.city, contact.country].filter(Boolean).join(', ') || null}
          onSave={value => {
            const [city = '', country = ''] = (value ?? '').split(',').map(s => s.trim());
            save({ city: city || null, country: country || null });
          }}
          placeholder="Add location"
          disabled={!canEdit}
        />
      </FactRow>
      <FactRow label="Do not contact">
        <InlineSwitch checked={contact.doNotContact} onChange={value => actions.setDoNotContact([contact.id], value)} label="Nobody emails them" disabled={!canEdit} />
      </FactRow>
      <FactRow label="Unsubscribed">
        {contact.unsubscribedAt ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge tone="danger">Unsubscribed</Badge>
            <Tooltip content={`They unsubscribed on ${dateTime(contact.unsubscribedAt)}. Only the contact can undo this, from a link in one of your emails.`}>
              <span className="inline-flex text-ink-3">
                <Info size={14} />
              </span>
            </Tooltip>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-ui text-ink">No</span>
            <Tooltip content="Only the contact can unsubscribe, from the link at the bottom of your emails.">
              <span className="inline-flex text-ink-3">
                <Info size={14} />
              </span>
            </Tooltip>
          </span>
        )}
      </FactRow>
      <FactRow label="Last contacted">
        <span className="text-ui text-ink-2">{contact.lastContactedAt ? timeAgo(contact.lastContactedAt) : 'Never'}</span>
      </FactRow>
      <FactRow label="Tags" align="start">
        <TagRow tagIds={contact.tagIds} onChange={canEdit ? tagIds => actions.setTags([contact.id], tagIds) : undefined} />
      </FactRow>
      <CustomFieldRows object="Contact" values={contact.customFields} onSave={customFields => save({ customFields })} canEdit={canEdit} />
    </div>
  );
}
