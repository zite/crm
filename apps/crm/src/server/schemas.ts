import { z } from 'zod';

/**
 * Zod shapes shared by several endpoints, so a deal row or a task row has one
 * definition and the generated client types match across every surface.
 * (zod stays in the app: packages/shared must not import it.)
 */

const id = z.string().min(1).max(64);
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const nextStepSchema = z
  .object({ taskId: z.string(), title: z.string(), type: z.string(), dueDate: z.string().nullable(), dueTime: z.string().nullable(), ownerId: z.string().nullable() })
  .nullable();

export const dealFilterSchema = z.object({
  ids: z.array(id).max(2000).optional(),
  pipelineId: id.optional(),
  status: z.array(z.enum(['Open', 'Won', 'Lost'])).optional(),
  stageIds: z.array(id).optional(),
  /** Member ids; 'none' matches unowned deals. */
  ownerIds: z.array(z.string()).optional(),
  teamId: id.optional(),
  companyId: id.optional(),
  contactId: id.optional(),
  tagIds: z.array(id).optional(),
  types: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  lostReasons: z.array(z.string()).optional(),
  forecastCategories: z.array(z.string()).optional(),
  closeFrom: dayStr.optional(),
  closeTo: dayStr.optional(),
  closedFrom: dayStr.optional(),
  closedTo: dayStr.optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  stalled: z.boolean().optional(),
  closingOverdue: z.boolean().optional(),
  noNextStep: z.boolean().optional(),
  search: z.string().max(120).optional(),
  archived: z.boolean().optional(),
  /** Custom field key → exact value. */
  custom: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type DealFilters = z.infer<typeof dealFilterSchema>;

export const dealRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  pipelineId: z.string(),
  stageId: z.string(),
  ownerId: z.string().nullable(),
  amount: z.number().nullable(),
  closeDate: z.string().nullable(),
  status: z.enum(['Open', 'Won', 'Lost']),
  /** Effective probability (override, else stage). */
  probability: z.number(),
  probabilityOverride: z.number().nullable(),
  weighted: z.number(),
  /** Effective forecast category (set, else derived from probability). */
  forecastCategory: z.string(),
  forecastCategorySet: z.boolean(),
  type: z.string().nullable(),
  source: z.string().nullable(),
  /** Free-text "next step" note typed on the deal (the task-based next step is `nextStep`). */
  nextStepNote: z.string().nullable(),
  lostReason: z.string().nullable(),
  closedAt: z.string().nullable(),
  stageEnteredAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  position: z.number(),
  tagIds: z.array(z.string()),
  customFields: z.record(z.any()),
  archived: z.boolean(),
  quoteCount: z.number(),
  nextStep: nextStepSchema,
});

export const taskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.enum(['Open', 'Done']),
  priority: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  ownerId: z.string().nullable(),
  createdById: z.string().nullable(),
  companyId: z.string().nullable(),
  contactId: z.string().nullable(),
  dealId: z.string().nullable(),
  leadId: z.string().nullable(),
  notes: z.string().nullable(),
  completedAt: z.string().nullable(),
  enrollmentId: z.string().nullable(),
  createdAt: z.string().nullable(),
  /** Names of the linked records, for display. */
  companyName: z.string().nullable(),
  contactName: z.string().nullable(),
  dealName: z.string().nullable(),
  leadName: z.string().nullable(),
});

export const attendeeSchema = z.object({ name: z.string(), email: z.string().nullable().optional(), contactId: z.string().nullable().optional(), memberId: z.string().nullable().optional() });

export const activityRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['Note', 'Call', 'Email', 'Meeting']),
  subject: z.string(),
  body: z.string().nullable(),
  occurredAt: z.string(),
  endsAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  outcome: z.string().nullable(),
  direction: z.string().nullable(),
  emailFrom: z.string().nullable(),
  emailTo: z.string().nullable(),
  emailCc: z.string().nullable(),
  delivery: z.string().nullable(),
  location: z.string().nullable(),
  attendees: z.array(attendeeSchema),
  ownerId: z.string().nullable(),
  createdById: z.string().nullable(),
  companyId: z.string().nullable(),
  contactId: z.string().nullable(),
  dealId: z.string().nullable(),
  leadId: z.string().nullable(),
  enrollmentId: z.string().nullable(),
  bookingPageId: z.string().nullable(),
  pinned: z.boolean(),
  companyName: z.string().nullable(),
  contactName: z.string().nullable(),
  dealName: z.string().nullable(),
  leadName: z.string().nullable(),
});

export const eventRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  summary: z.string(),
  actorId: z.string().nullable(),
  occurredAt: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  data: z.record(z.any()).nullable(),
});

export const documentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  size: z.number().nullable(),
  contentType: z.string().nullable(),
  uploadedById: z.string().nullable(),
  createdAt: z.string().nullable(),
  companyId: z.string().nullable(),
  contactId: z.string().nullable(),
  dealId: z.string().nullable(),
  leadId: z.string().nullable(),
});

export const entityRef = z.object({ type: z.enum(['company', 'contact', 'deal', 'lead']), id });
