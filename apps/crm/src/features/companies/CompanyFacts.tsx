import { ArrowSquareOut } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Chipput } from '../../ui/Button';
import { Badge } from '../../ui/Chip';
import { FactRow } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { CompanyMark } from '../../glyphs';
import { ChoicePicker, DatePicker, MemberPicker, OptionsPicker, RecordPicker, TagRow } from '../../pickers/pickers';
import { COMPANY_TYPES } from '@project/shared/constants';
import { fullDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { COMPANY_TYPE_TONE, externalUrl, hostLabel, type Company } from './companyHelpers';
import { ChipValue, CustomFieldRows, InlineText } from './inline';
import { useCompanyActions } from './mutations';

/**
 * The company's properties, edited in place. The page shows them in its 320px
 * rail; the peek sheet is three times as wide, so it asks for two columns
 * rather than leaving half the card empty.
 */
export function CompanyFacts({ company, parentName, columns = 1 }: { company: Company; parentName?: string | null; columns?: 1 | 2 }) {
  const ws = useWorkspace();
  const actions = useCompanyActions();
  const canEdit = ws.can('records.edit');
  const save = (patch: Parameters<typeof actions.update.mutate>[0]['patch']) => actions.update.mutate({ ids: [company.id], patch });

  return (
    <div className={cn('flex flex-col gap-0.5 py-1', columns === 2 && 'sm:grid sm:grid-cols-2 sm:gap-x-8')}>
      <FactRow label="Owner">
        {canEdit ? (
          <ChipValue>
            <MemberPicker value={company.ownerId} onChange={ownerId => actions.setOwner([company.id], ownerId)} />
          </ChipValue>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-ui">
            {company.ownerId ? <Avatar person={ws.memberById(company.ownerId)} size="xs" /> : <Unassigned size="xs" />} <span className="truncate">{ws.memberName(company.ownerId)}</span>
          </span>
        )}
      </FactRow>
      <FactRow label="Type">
        {canEdit ? (
          <ChipValue>
            <OptionsPicker
              options={[...COMPANY_TYPES]}
              value={company.type}
              allowEmpty={false}
              onChange={type => type && actions.setType([company.id], type)}
              trigger={
                <Chipput placeholder={!company.type}>
                  {company.type ? <Badge tone={COMPANY_TYPE_TONE[company.type] ?? 'neutral'}>{company.type}</Badge> : 'Set type'}
                </Chipput>
              }
            />
          </ChipValue>
        ) : company.type ? (
          // A viewer sees the same fact, so it keeps its badge.
          <Badge tone={COMPANY_TYPE_TONE[company.type] ?? 'neutral'}>{company.type}</Badge>
        ) : (
          <span className="text-ui text-ink-3">—</span>
        )}
      </FactRow>
      <FactRow label="Industry">
        {canEdit ? (
          <ChipValue>
            <ChoicePicker list="Industry" value={company.industry} onChange={industry => save({ industry })} placeholder="Set industry" />
          </ChipValue>
        ) : (
          <span className="truncate text-ui">{company.industry ?? '—'}</span>
        )}
      </FactRow>
      <FactRow label="Employees">
        <InlineText
          value={company.employees == null ? null : String(company.employees)}
          onSave={value => save({ employees: value == null ? null : Number(value) })}
          placeholder="Set headcount"
          inputMode="numeric"
          disabled={!canEdit}
          parse={raw => {
            if (!raw) return null;
            const n = Math.round(Number(raw.replace(/[,\s]/g, '')));
            return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
          }}
          render={value => <span className="tabular truncate">{Number(value).toLocaleString('en-US')}</span>}
        />
      </FactRow>
      <FactRow label="Annual revenue">
        <InlineText
          value={company.annualRevenue == null ? null : String(company.annualRevenue)}
          onSave={value => save({ annualRevenue: value == null ? null : Number(value) })}
          placeholder="Set revenue"
          inputMode="decimal"
          disabled={!canEdit}
          parse={raw => {
            if (!raw) return null;
            const n = Number(raw.replace(/[$,\s]/g, ''));
            return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
          }}
          render={value => <span className="tabular truncate">{ws.money(Number(value), { compact: Number(value) >= 1_000_000 })}</span>}
        />
      </FactRow>
      <FactRow label="Phone">
        <InlineText
          value={company.phone}
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
      <FactRow label="Website">
        <InlineText
          value={company.website ?? company.domain}
          onSave={website => save({ website, ...(company.domain ? {} : { domain: website }) })}
          placeholder="Add website"
          inputMode="url"
          disabled={!canEdit}
          render={value => (
            <a href={externalUrl(value) ?? '#'} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-1 text-accent hover:underline" onClick={e => e.stopPropagation()}>
              <span className="truncate">{hostLabel(value)}</span>
              <ArrowSquareOut size={12} className="shrink-0" />
            </a>
          )}
        />
      </FactRow>
      <FactRow label="LinkedIn">
        <InlineText
          value={company.linkedinUrl}
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
      <FactRow label="Address" align="start">
        <InlineText
          multiline
          value={[company.address, [company.city, company.region].filter(Boolean).join(', '), [company.postalCode, company.country].filter(Boolean).join(' ')].filter(Boolean).join('\n') || null}
          onSave={value => {
            const [address = '', locality = '', rest = ''] = (value ?? '').split('\n');
            const [city = '', region = ''] = locality.split(',').map(s => s.trim());
            const parts = rest.trim().split(/\s+/);
            const postalCode = parts.length > 1 ? parts[0] : '';
            const country = parts.length > 1 ? parts.slice(1).join(' ') : rest.trim();
            save({ address: address.trim() || null, city: city || null, region: region || null, postalCode: postalCode || null, country: country || null });
          }}
          placeholder="Add address"
          disabled={!canEdit}
        />
      </FactRow>
      <FactRow label="Source">
        {canEdit ? (
          <ChipValue>
            <ChoicePicker list="Lead Source" value={company.source} onChange={source => save({ source })} placeholder="Set source" />
          </ChipValue>
        ) : (
          <span className="truncate text-ui">{company.source ?? '—'}</span>
        )}
      </FactRow>
      <FactRow label="Customer since">
        {canEdit ? (
          <ChipValue>
            <DatePicker value={company.customerSince} onChange={customerSince => save({ customerSince })} placeholder="Set the date" />
          </ChipValue>
        ) : (
          <span className="truncate text-ui">{company.customerSince ? fullDate(company.customerSince) : '—'}</span>
        )}
      </FactRow>
      <FactRow label="Parent company">
        {canEdit ? (
          <ChipValue>
            <RecordPicker
              kind="company"
              value={company.parentCompanyId ? { id: company.parentCompanyId, name: parentName ?? company.parentName ?? 'Parent' } : null}
              onChange={record => save({ parentCompanyId: record?.id ?? null })}
              trigger={
                <Chipput placeholder={!company.parentCompanyId}>
                  {company.parentCompanyId ? (
                    <>
                      <CompanyMark name={company.parentName ?? parentName ?? '?'} id={company.parentCompanyId} size="xs" className="mr-1.5" />
                      {/* The chip is a flex row, so the name needs its own box to ellipsise in. */}
                      <span className="truncate">{company.parentName ?? parentName ?? 'Parent'}</span>
                    </>
                  ) : (
                    'Set parent'
                  )}
                </Chipput>
              }
            />
          </ChipValue>
        ) : company.parentCompanyId ? (
          <Link to={`/companies/${company.parentCompanyId}`} className="truncate text-ui text-accent hover:underline">
            {company.parentName ?? parentName ?? 'Parent company'}
          </Link>
        ) : (
          <span className="text-ui text-ink-3">—</span>
        )}
      </FactRow>
      <FactRow label="Last activity">
        <span className="text-ui text-ink-2">{company.lastActivityAt ? timeAgo(company.lastActivityAt) : 'Nothing yet'}</span>
      </FactRow>
      <FactRow label="Tags" align="start">
        <TagRow tagIds={company.tagIds} onChange={canEdit ? tagIds => actions.setTags([company.id], tagIds) : undefined} />
      </FactRow>
      <CustomFieldRows object="Company" values={company.customFields} onSave={customFields => save({ customFields })} canEdit={canEdit} />
    </div>
  );
}
