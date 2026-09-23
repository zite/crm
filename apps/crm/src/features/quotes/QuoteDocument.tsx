import { CheckCircle, Prohibit, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn';
import { OrgMark } from '../../glyphs';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ReadOnlyLine, TotalsBlock } from './LineItemsEditor';
import { localDay, type EditableLine } from './lineItems';

/**
 * The quote as the buyer reads it, rendered inside the app so a rep can check
 * the document before sending it. The public page shows the same figures from
 * the same arithmetic — only the chrome differs.
 */
export function QuoteDocument({
  number,
  title,
  companyName,
  contactName,
  lines,
  taxRate,
  expiresOn,
  terms,
  buyerNote,
  status,
  sentAt,
  acceptedName,
  acceptedTitle,
  acceptedAt,
  declinedAt,
  declineReason,
  preparedBy,
  className,
}: {
  number: string;
  title: string;
  companyName: string | null;
  contactName: string | null;
  lines: EditableLine[];
  taxRate: number;
  expiresOn: string | null;
  terms: string;
  buyerNote: string;
  status: string;
  sentAt?: string | null;
  acceptedName?: string | null;
  acceptedTitle?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  declineReason?: string | null;
  preparedBy?: { name: string; title: string | null; email: string } | null;
  className?: string;
}) {
  const ws = useWorkspace();

  let stamp: ReactNode = null;
  if (acceptedAt) {
    stamp = (
      <Stamp tone="success" icon={<CheckCircle size={18} weight="fill" />}>
        Accepted by {acceptedName ?? 'the buyer'}
        {acceptedTitle ? `, ${acceptedTitle}` : ''} on {fullDate(localDay(acceptedAt))}
      </Stamp>
    );
  } else if (declinedAt) {
    stamp = (
      <Stamp tone="danger" icon={<XCircle size={18} />}>
        Declined on {fullDate(localDay(declinedAt))}
        {declineReason ? ` — ${declineReason}` : ''}
      </Stamp>
    );
  } else if (status === 'Void') {
    stamp = (
      <Stamp tone="danger" icon={<Prohibit size={18} />}>
        Withdrawn — the buyer’s link says so too.
      </Stamp>
    );
  } else if (status === 'Expired') {
    stamp = <Stamp tone="warning">This quote expired on {expiresOn ? fullDate(expiresOn) : 'its expiry date'}. Duplicate it to send a fresh one.</Stamp>;
  }

  return (
    <article className={cn('overflow-hidden rounded-lg border border-line bg-card shadow-hairline', className)}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <OrgMark name={ws.settings.organizationName} logoUrl={ws.settings.logoUrl} className="h-9 w-9" />
          <div className="min-w-0">
            <div className="truncate text-title font-semibold text-ink">{ws.settings.organizationName}</div>
            {ws.settings.mailingAddress && <div className="truncate text-meta text-ink-3">{ws.settings.mailingAddress}</div>}
          </div>
        </div>
        <div className="text-right text-meta text-ink-2">
          <div className="font-mono text-ui tracking-[0.04em] text-ink">{number || 'Not numbered yet'}</div>
          <div>{sentAt ? `Sent ${fullDate(localDay(sentAt))}` : 'Draft'}</div>
          {expiresOn && <div>Valid until {fullDate(expiresOn)}</div>}
        </div>
      </header>

      <div className="px-5 py-6 sm:px-7">
        <h2 className="font-display text-display-sm text-ink">{title || 'Untitled quote'}</h2>
        <p className="mt-1 text-body text-ink-2">
          Prepared for {companyName ?? 'your team'}
          {contactName ? ` · ${contactName}` : ''}
        </p>

        {buyerNote.trim() && (
          <div className="prose-crm mt-5 rounded-lg bg-sunken px-4 py-3.5 text-ink">
            {buyerNote.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between border-b border-line bg-sunken px-3 py-2 text-micro font-semibold uppercase text-ink-3">
            <span>Item</span>
            <span>Amount</span>
          </div>
          {lines.length ? lines.map(line => <ReadOnlyLine key={line.id} line={line} />) : <p className="px-3 py-6 text-center text-ui text-ink-3">No lines on this quote yet.</p>}
        </div>

        <TotalsBlock lines={lines} taxRate={taxRate} inset="row" className="mt-5" />

        {stamp && <div className="mt-6">{stamp}</div>}

        {terms.trim() && (
          <section className="mt-7 border-t border-line pt-5">
            <h3 className="text-micro font-semibold uppercase text-ink-3">Terms</h3>
            <div className="prose-crm mt-2 text-meta leading-5 text-ink-2">
              {terms.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        )}

        {preparedBy && (
          <p className="mt-6 text-meta text-ink-3">
            Prepared by {preparedBy.name}
            {preparedBy.title ? `, ${preparedBy.title}` : ''} · {preparedBy.email}
          </p>
        )}
      </div>
    </article>
  );
}

function Stamp({ tone, icon, children }: { tone: 'success' | 'danger' | 'warning'; icon?: ReactNode; children: ReactNode }) {
  const tones = {
    success: 'bg-success/10 text-success dark:bg-success/15',
    danger: 'bg-danger/10 text-danger dark:bg-danger/15',
    warning: 'bg-warning/10 text-warning dark:bg-warning/15',
  };
  return <div className={cn('flex items-center gap-2.5 rounded-lg px-4 py-3 text-ui font-medium', tones[tone])}>{icon}<span>{children}</span></div>;
}
