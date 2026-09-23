import { ArrowSquareOut, EnvelopeSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, Section, Skeleton } from '../../ui/Layout';
import { Sheet, SheetBody, SheetHeader } from '../../ui/Sheet';
import { Money } from '../../glyphs';
import { Composer } from '../../timeline/Composer';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { plural } from '../../lib/format';
import { useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { RelatedDealsPanel } from '../companies/CompanyRelated';
import { DuplicateBanner } from '../companies/Duplicates';
import { useContact } from '../companies/queries';
import { ContactFacts } from './ContactFacts';
import { reachability } from './contactHelpers';

/** The peek: a contact opened over the list, so J/K keep walking the rows behind it. */
export function ContactSheet() {
  const { peek, openPeek } = useAppActions();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const open = peek?.type === 'contact';
  const { data, isPending } = useContact(open ? peek.id : null);
  const timeline = useTimeline('contact', open ? peek.id : null, { limit: 15 });
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const canEdit = ws.can('records.edit');

  const go = (path: string) => {
    openPeek(null);
    navigate(path);
  };

  const reach = data ? reachability(data.contact) : null;

  return (
    <Sheet open={open} onOpenChange={value => !value && openPeek(null)} width="lg" label="Contact">
      <SheetHeader
        onClose={() => openPeek(null)}
        actions={data && <Button variant="secondary" size="sm" leading={<ArrowSquareOut size={15} />} onClick={() => go(`/contacts/${data.contact.id}`)}>Open</Button>}
      >
        {isPending || !data ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar person={{ id: data.contact.id, name: data.contact.name, avatarUrl: data.contact.avatarUrl }} size="md" />
            <div className="min-w-0">
              <div className="truncate text-ui font-semibold text-ink">{data.contact.name}</div>
              <div className="truncate text-meta text-ink-3">{[data.contact.title, data.contact.companyName].filter(Boolean).join(' · ') || 'No title'}</div>
            </div>
          </div>
        )}
      </SheetHeader>
      <SheetBody>
        {isPending || !data ? (
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            <DuplicateBanner type="contact" id={data.contact.id} onMerged={survivorId => go(`/contacts/${survivorId}`)} />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-display text-[26px] leading-8 text-ink">
                <Money value={data.figures.openPipeline} compact />
              </span>
              <span className="text-meta text-ink-2">open across {plural(data.figures.openDeals, 'deal')}</span>
              {data.contact.unsubscribedAt ? <Badge tone="danger">Unsubscribed</Badge> : data.contact.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
              {ws.can('outreach.send') && reach?.canEmail && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                  leading={<EnvelopeSimple size={15} />}
                  onClick={() => setEmailTarget({ contactId: data.contact.id, companyId: data.contact.companyId, to: data.contact.email as string, name: data.contact.name })}
                >
                  Email
                </Button>
              )}
            </div>

            {data.company && (
              <Link
                to={`/companies/${data.company.id}`}
                onClick={() => openPeek(null)}
                className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-ui text-ink transition-colors hover:bg-hover"
              >
                <span className="truncate font-medium">{data.company.name}</span>
                <span className="truncate text-meta text-ink-3">{[data.company.type, data.company.industry].filter(Boolean).join(' · ')}</span>
                <ArrowSquareOut size={14} className="ml-auto shrink-0 text-ink-3" />
              </Link>
            )}

            <Card padded className="!p-4">
              <ContactFacts contact={data.contact} columns={2} />
            </Card>

            <RelatedDealsPanel filters={{ contactId: data.contact.id }} title="Deals they are on" emptyHint={`${data.contact.firstName ?? data.contact.name} isn’t in a buying group yet.`} />

            <Section title="Activity">
              <div className="flex flex-col gap-4">
                {canEdit && (
                  <Composer
                    links={{ contactId: data.contact.id, companyId: data.contact.companyId }}
                    onEmail={
                      reach?.canEmail && ws.can('outreach.send')
                        ? () => setEmailTarget({ contactId: data.contact.id, companyId: data.contact.companyId, to: data.contact.email as string, name: data.contact.name })
                        : undefined
                    }
                  />
                )}
                <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
              </div>
            </Section>
          </div>
        )}
      </SheetBody>
      <EmailDialog open={Boolean(emailTarget)} onOpenChange={value => !value && setEmailTarget(null)} target={emailTarget} />
    </Sheet>
  );
}
