import { lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { useAppActions, type CreateKind } from '../lib/app-actions';

/**
 * Every "New …" dialog in one place. Each area registers its own file here,
 * default-exporting `({ open, onOpenChange, defaults })`; the dialog resets its
 * state whenever `open` turns true and documents the `defaults` keys it reads
 * at the top of its file.
 */
const REGISTRY: Partial<Record<CreateKind, React.LazyExoticComponent<React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }>>>> = {
  deal: lazy(() => import('../features/deals/CreateDealDialog')),
  quote: lazy(() => import('../features/quotes/CreateQuoteDialog')),
  product: lazy(() => import('../features/products/ProductDialog')),
  company: lazy(() => import('../features/companies/CreateCompanyDialog')),
  contact: lazy(() => import('../features/contacts/CreateContactDialog')),
  task: lazy(() => import('../features/tasks/CreateTaskDialog')),
  activity: lazy(() => import('../timeline/LogActivityDialog')),
  lead: lazy(() => import('../features/leads/CreateLeadDialog')),
  form: lazy(() => import('../features/forms/CreateFormDialog')),
  meetingLink: lazy(() => import('../features/meetings/CreateMeetingLinkDialog')),
  sequence: lazy(() => import('../features/outreach/CreateSequenceDialog')),
  template: lazy(() => import('../features/outreach/TemplateDialog')),
};

export function CreateDialogs() {
  const { createRequest, closeCreate } = useAppActions();
  if (!createRequest) return null;
  const Dialog = REGISTRY[createRequest.kind];
  if (!Dialog) {
    toast.message(`Creating a ${createRequest.kind} isn’t available here yet`);
    closeCreate();
    return null;
  }
  return (
    <Suspense fallback={null}>
      <Dialog key={createRequest.nonce} open onOpenChange={open => !open && closeCreate()} defaults={createRequest.defaults} />
    </Suspense>
  );
}
