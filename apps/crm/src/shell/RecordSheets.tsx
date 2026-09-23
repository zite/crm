import { lazy, Suspense } from 'react';
import { useAppActions } from '../lib/app-actions';

/**
 * The peek sheets, mounted once for the whole app.
 *
 * `openPeek` is global state, so Space on a task row, a search hit or a
 * report drill-down opens the same sheet a list does. Each sheet is lazy and
 * only the one matching the current peek target is mounted, so nothing loads
 * until somebody peeks.
 */
const DealSheet = lazy(() => import('../features/deals/DealSheet').then(m => ({ default: m.DealSheet })));
const CompanySheet = lazy(() => import('../features/companies/CompanySheet').then(m => ({ default: m.CompanySheet })));
const ContactSheet = lazy(() => import('../features/contacts/ContactSheet').then(m => ({ default: m.ContactSheet })));
const LeadSheet = lazy(() => import('../features/leads/LeadSheet').then(m => ({ default: m.LeadSheet })));

export function RecordSheets() {
  const { peek } = useAppActions();
  if (!peek) return null;
  const Sheet = { deal: DealSheet, company: CompanySheet, contact: ContactSheet, lead: LeadSheet }[peek.type];
  if (!Sheet) return null;
  return (
    <Suspense fallback={null}>
      <Sheet />
    </Suspense>
  );
}
