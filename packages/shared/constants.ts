/**
 * Every fixed list of values in the CRM. Single-select values MUST match the
 * options on the live database field exactly (`zite.sql` returns the label,
 * and writing a label that isn't an option is rejected). If a feature needs a
 * new option, it has to be added to the live schema first — ask the lead.
 *
 * Lists an organization customizes (industries, lead sources, lost and
 * disqualify reasons) are rows in the Choices table instead, so admins can edit
 * them without a schema change.
 */

export const ROLES = ['Admin', 'Manager', 'Rep', 'Viewer'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['Active', 'Invited', 'Deactivated'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const COMPANY_TYPES = ['Prospect', 'Customer', 'Partner', 'Former Customer', 'Other'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const LEAD_STATUSES = ['New', 'Working', 'Nurturing', 'Qualified', 'Disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** Statuses a person works in; Qualified and Disqualified are outcomes. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ['New', 'Working', 'Nurturing'];

export const STAGE_KINDS = ['Open', 'Won', 'Lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const DEAL_STATUSES = ['Open', 'Won', 'Lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const FORECAST_CATEGORIES = ['Pipeline', 'Best Case', 'Commit', 'Closed', 'Omitted'] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export const DEAL_TYPES = ['New Business', 'Expansion', 'Renewal'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_CONTACT_ROLES = ['Decision Maker', 'Economic Buyer', 'Champion', 'Influencer', 'Technical Evaluator', 'End User', 'Blocker', 'Other'] as const;
export type DealContactRole = (typeof DEAL_CONTACT_ROLES)[number];

export const ACTIVITY_KINDS = ['Note', 'Call', 'Email', 'Meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const CALL_OUTCOMES = ['Connected', 'Left Voicemail', 'No Answer', 'Busy', 'Wrong Number'] as const;
export const MEETING_OUTCOMES = ['Scheduled', 'Completed', 'No Show', 'Canceled'] as const;
export const ACTIVITY_OUTCOMES = [...CALL_OUTCOMES, ...MEETING_OUTCOMES] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const DIRECTIONS = ['Outbound', 'Inbound'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Sent = delivered to the gateway; Logged = recorded by hand; Not Sent = deliberately skipped (unsubscribed, example address). */
export const EMAIL_DELIVERIES = ['Sent', 'Logged', 'Failed', 'Not Sent'] as const;
export type EmailDelivery = (typeof EMAIL_DELIVERIES)[number];

export const TASK_TYPES = ['To-do', 'Call', 'Email', 'Meeting', 'LinkedIn'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['Open', 'Done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['High', 'Normal', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const BILLING = ['One-time', 'Monthly', 'Annual'] as const;
export type Billing = (typeof BILLING)[number];

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired', 'Void'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const SEQUENCE_STATUSES = ['Active', 'Paused', 'Archived'] as const;
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number];

export const ENROLLMENT_STATUSES = ['Active', 'Paused', 'Finished', 'Exited'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const FORM_STATUSES = ['Live', 'Paused'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_ASSIGNMENTS = ['Round Robin', 'Member', 'Unassigned'] as const;
export type FormAssignment = (typeof FORM_ASSIGNMENTS)[number];

export const SUBMISSION_OUTCOMES = ['New Lead', 'Existing Lead', 'Existing Contact', 'Spam'] as const;
export type SubmissionOutcome = (typeof SUBMISSION_OUTCOMES)[number];

export const VIEW_SCOPES = ['Deals', 'Companies', 'Contacts', 'Leads', 'Tasks', 'Activities', 'Quotes'] as const;
export type ViewScope = (typeof VIEW_SCOPES)[number];

export const CUSTOM_FIELD_OBJECTS = ['Company', 'Contact', 'Deal', 'Lead'] as const;
export type CustomFieldObject = (typeof CUSTOM_FIELD_OBJECTS)[number];

export const CUSTOM_FIELD_TYPES = ['Text', 'Long Text', 'Number', 'Currency', 'Date', 'Select', 'Multi Select', 'Checkbox', 'URL'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CHOICE_LISTS = ['Industry', 'Lead Source', 'Lost Reason', 'Disqualify Reason'] as const;
export type ChoiceList = (typeof CHOICE_LISTS)[number];

export const QUOTA_PERIODS = ['Month', 'Quarter', 'Year'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const QUOTA_METRICS = ['Revenue', 'Deals Won', 'Meetings', 'Calls'] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

export const AUTOMATION_RUN_STATUSES = ['Succeeded', 'Failed', 'Skipped'] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const IMPORT_OBJECTS = ['Companies', 'Contacts', 'Deals', 'Leads'] as const;
export type ImportObject = (typeof IMPORT_OBJECTS)[number];

export const IMPORT_STATUSES = ['Running', 'Completed', 'Failed', 'Undone'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Record kinds that own a timeline, tasks, documents and custom fields. */
export const ENTITY_TYPES = ['company', 'contact', 'deal', 'lead'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** The id column on Activities / Tasks / Events / Documents that points at each entity. */
export const ENTITY_COLUMN: Record<EntityType, 'companyId' | 'contactId' | 'dealId' | 'leadId'> = {
  company: 'companyId',
  contact: 'contactId',
  deal: 'dealId',
  lead: 'leadId',
};

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'JPY', 'SGD', 'INR'] as const;

/** Muted pigments for company marks, tags and member colours — never used as meaning. */
export const PIGMENTS = ['#4f6d7a', '#7a5c4f', '#5f7a4f', '#6d5a7a', '#7a6a3f', '#3f6f6a', '#8a4f5a', '#4f5f8a', '#6a7a5a', '#80604a'] as const;

export const TAG_COLORS = ['slate', 'clay', 'moss', 'plum', 'ochre', 'teal', 'rose', 'navy'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
