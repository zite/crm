import { Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { FormDialog } from '../../ui/Dialog';
import { Checkbox } from '../../ui/Form';
import { plural } from '../../lib/format';
import { useCompanyActions } from './mutations';
import type { Company } from './companyHelpers';

/**
 * Deleting a company is refused while it still has contacts or deals, unless
 * you say to take them too — so this dialog names the exact counts before the
 * button is live, and the checkbox is the "yes, take them" the server needs.
 */
export default function DeleteCompanyDialog({
  open,
  onOpenChange,
  companies,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  onDone?: () => void;
}) {
  const actions = useCompanyActions();
  const [withRelated, setWithRelated] = useState(false);

  const contacts = companies.reduce((n, c) => n + c.contactCount, 0);
  const deals = companies.reduce((n, c) => n + c.openDealCount + c.wonDealCount, 0);
  const children = companies.reduce((n, c) => n + c.childCount, 0);
  const hasLinks = contacts > 0 || deals > 0;

  useEffect(() => {
    if (open) setWithRelated(false);
  }, [open]);

  const submit = async () => {
    try {
      await actions.remove.mutateAsync({ ids: companies.map(c => c.id), withRelated: hasLinks ? withRelated : undefined });
      onOpenChange(false);
      onDone?.();
    } catch {
      // The mutation already shows the server's sentence in a toast.
    }
  };

  const label = companies.length === 1 ? `“${companies[0].name}”` : plural(companies.length, 'company', 'companies');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={companies.length === 1 ? 'Delete this company?' : `Delete ${plural(companies.length, 'company', 'companies')}?`}
      submitLabel={withRelated ? 'Delete everything' : 'Delete'}
      onSubmit={submit}
      pending={actions.remove.isPending}
      disabled={hasLinks && !withRelated}
      destructive
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          {hasLinks ? (
            <>
              {label} still {companies.length === 1 ? 'has' : 'have'}{' '}
              <strong className="font-semibold">{[contacts ? plural(contacts, 'contact') : '', deals ? plural(deals, 'deal') : ''].filter(Boolean).join(' and ')}</strong> on{' '}
              {companies.length === 1 ? 'it' : 'them'}.
            </>
          ) : (
            <>{label} has nothing else attached to it.</>
          )}
        </p>

        {hasLinks && (
          <div className="rounded-lg border border-danger/40 bg-danger/[0.06] px-3 py-3 dark:bg-danger/10">
            <label className="flex items-start gap-2.5">
              <span className="pt-0.5">
                <Checkbox checked={withRelated} onCheckedChange={setWithRelated} label="Delete its contacts and deals too" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-medium text-ink">Delete its contacts and deals too</span>
                <span className="mt-1 block text-meta text-ink-2">
                  {deals ? `${plural(deals, 'deal')} go with their line items, buying groups and stage history. ` : ''}
                  {contacts ? `${plural(contacts, 'contact')} are deleted; their sequence enrollments end. ` : ''}
                  Quotes keep their numbers and stay in the quotes ledger.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="rounded-lg border border-line bg-sunken/60 px-3 py-3 text-meta text-ink-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-ui font-medium text-ink">
            <Warning size={15} className="text-warning" /> What happens
          </div>
          <ul className="flex flex-col gap-1">
            <li>· Calls, emails, meetings, notes, tasks and files that also belong to a contact, deal or lead keep those links.</li>
            <li>· Anything that only pointed at {companies.length === 1 ? 'this company' : 'these companies'} is deleted with {companies.length === 1 ? 'it' : 'them'}, rather than being left where nobody can see it.</li>
            {children > 0 && <li>· {plural(children, 'subsidiary', 'subsidiaries')} {children === 1 ? 'is' : 'are'} kept — {children === 1 ? 'it' : 'they'} simply stop having a parent company.</li>}
            <li>· This can’t be undone. Archiving keeps the record and hides it from the list.</li>
          </ul>
        </div>

        {hasLinks && !withRelated && <p className="text-meta text-ink-3">Tick the box above, or move the contacts and deals to another company first.</p>}
      </div>
    </FormDialog>
  );
}
