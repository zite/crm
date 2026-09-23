import type { ConditionField, ConditionOp } from '@project/shared/server/automationsEngine';

/**
 * An automation, read out loud.
 *
 * The list is the product here: a page of rules nobody can read is a page
 * nobody trusts, and a rule nobody trusts gets switched off. So every rule
 * renders as one sentence — "When a deal is won, create a task 'Hand off to
 * onboarding' for the owner" — built from the same pieces the builder edits.
 *
 * No React and no server imports: the builder, the list and the run log all
 * read from here, so they can never describe the same rule differently.
 */

export type TriggerOption = { value: string; label: string; when: string; subject: 'deal' | 'lead' | 'contact' | 'company'; note: string };

export const TRIGGER_OPTIONS: TriggerOption[] = [
  { value: 'deal.created', label: 'A deal is created', when: 'When a deal is created', subject: 'deal', note: 'However it was made — by hand, from a lead, or by an import.' },
  { value: 'deal.stage_changed', label: 'A deal changes stage', when: 'When a deal moves stage', subject: 'deal', note: 'Fires on every move, including into Won and Lost.' },
  { value: 'deal.won', label: 'A deal is won', when: 'When a deal is won', subject: 'deal', note: 'The moment it reaches the pipeline’s Won stage.' },
  { value: 'deal.lost', label: 'A deal is lost', when: 'When a deal is lost', subject: 'deal', note: 'The moment it reaches the pipeline’s Lost stage.' },
  { value: 'deal.stalled', label: 'A deal stalls', when: 'When a deal stalls', subject: 'deal', note: 'Checked every morning: an open deal past its stage’s rotting days, once per stall.' },
  { value: 'lead.created', label: 'A lead is added', when: 'When a lead is added', subject: 'lead', note: 'Any new lead, from any source.' },
  { value: 'lead.status_changed', label: 'A lead changes status', when: 'When a lead’s status changes', subject: 'lead', note: 'New → Working → Nurturing, or out to Qualified or Disqualified.' },
  { value: 'lead.converted', label: 'A lead is converted', when: 'When a lead is converted', subject: 'lead', note: 'It has become a contact, and usually a company and a deal.' },
  { value: 'contact.created', label: 'A contact is added', when: 'When a contact is added', subject: 'contact', note: 'Any new person, however they arrived.' },
  { value: 'company.created', label: 'A company is added', when: 'When a company is added', subject: 'company', note: 'Any new company, however it arrived.' },
  { value: 'form.submitted', label: 'A form is submitted', when: 'When a form is submitted', subject: 'lead', note: 'Someone filled in one of your web forms.' },
  { value: 'meeting.booked', label: 'A meeting is booked', when: 'When a meeting is booked', subject: 'contact', note: 'Someone chose a time on one of your meeting links.' },
  { value: 'quote.accepted', label: 'A quote is accepted', when: 'When a quote is accepted', subject: 'deal', note: 'The buyer accepted it on its public page.' },
  { value: 'quote.declined', label: 'A quote is declined', when: 'When a quote is declined', subject: 'deal', note: 'The buyer declined it on its public page.' },
  { value: 'task.completed', label: 'A task is completed', when: 'When a task is completed', subject: 'deal', note: 'Any task, on any record.' },
  { value: 'activity.logged', label: 'An activity is logged', when: 'When an activity is logged', subject: 'deal', note: 'A note, call, email or meeting was recorded.' },
];

export const triggerOption = (value: string) => TRIGGER_OPTIONS.find(t => t.value === value) ?? TRIGGER_OPTIONS[0];

export type ConditionOption = { value: ConditionField; label: string; ops: ConditionOp[]; kind: 'stage' | 'pipeline' | 'member' | 'tag' | 'number' | 'choice' | 'text'; choices?: string[]; subjects: Array<'deal' | 'lead' | 'contact' | 'company'> };

export const CONDITION_OPTIONS: ConditionOption[] = [
  { value: 'pipeline', label: 'Pipeline', ops: ['is', 'isNot'], kind: 'pipeline', subjects: ['deal'] },
  { value: 'stage', label: 'Stage', ops: ['is', 'isNot'], kind: 'stage', subjects: ['deal'] },
  { value: 'amount', label: 'Amount', ops: ['gte', 'lte'], kind: 'number', subjects: ['deal'] },
  { value: 'dealType', label: 'Deal type', ops: ['is', 'isNot'], kind: 'choice', choices: ['New Business', 'Expansion', 'Renewal'], subjects: ['deal'] },
  { value: 'owner', label: 'Owner', ops: ['is', 'isNot'], kind: 'member', subjects: ['deal', 'lead', 'contact', 'company'] },
  { value: 'source', label: 'Source', ops: ['is', 'isNot'], kind: 'text', subjects: ['deal', 'lead', 'contact', 'company'] },
  { value: 'tag', label: 'Tag', ops: ['is', 'isNot'], kind: 'tag', subjects: ['deal', 'lead', 'contact', 'company'] },
  { value: 'leadScore', label: 'Lead score', ops: ['gte', 'lte'], kind: 'number', subjects: ['lead'] },
  { value: 'leadStatus', label: 'Lead status', ops: ['is', 'isNot'], kind: 'choice', choices: ['New', 'Working', 'Nurturing', 'Qualified', 'Disqualified'], subjects: ['lead'] },
  { value: 'companyType', label: 'Company type', ops: ['is', 'isNot'], kind: 'choice', choices: ['Prospect', 'Customer', 'Partner', 'Former Customer', 'Other'], subjects: ['deal', 'contact', 'company'] },
];

export const conditionOption = (field: string) => CONDITION_OPTIONS.find(c => c.value === field) ?? CONDITION_OPTIONS[0];

export const ACTION_OPTIONS = [
  { value: 'createTask', label: 'Create a task' },
  { value: 'notify', label: 'Notify a teammate' },
  { value: 'sendEmail', label: 'Send a templated email' },
  { value: 'setField', label: 'Set a field' },
  { value: 'enrollSequence', label: 'Enroll the contact in a sequence' },
] as const;

export const SET_FIELD_OPTIONS = [
  { value: 'owner', label: 'Owner', kind: 'member' as const },
  { value: 'forecastCategory', label: 'Forecast category', kind: 'choice' as const, choices: ['Pipeline', 'Best Case', 'Commit', 'Closed', 'Omitted'] },
  { value: 'dealType', label: 'Deal type', kind: 'choice' as const, choices: ['New Business', 'Expansion', 'Renewal'] },
  { value: 'leadStatus', label: 'Lead status', kind: 'choice' as const, choices: ['New', 'Working', 'Nurturing', 'Qualified', 'Disqualified'] },
  { value: 'addTag', label: 'Add a tag', kind: 'tag' as const },
];

export type Names = {
  member: (id: string | null | undefined) => string;
  stage: (id: string | null | undefined) => string;
  pipeline: (id: string | null | undefined) => string;
  tag: (id: string | null | undefined) => string;
  template: (id: string | null | undefined) => string;
  sequence: (id: string | null | undefined) => string;
  money: (n: number) => string;
};

type LooseCondition = { field: string; op: string; value: string };
type LooseAction = Record<string, unknown>;

export function conditionSentence(c: LooseCondition, names: Names): string {
  const negative = c.op === 'isNot';
  switch (c.field) {
    case 'pipeline':
      return `its pipeline is${negative ? 'n’t' : ''} ${names.pipeline(c.value)}`;
    case 'stage':
      return `its stage is${negative ? 'n’t' : ''} ${names.stage(c.value)}`;
    case 'amount':
      return `the amount is ${c.op === 'lte' ? 'at most' : 'at least'} ${names.money(Number(c.value) || 0)}`;
    case 'dealType':
      return `it is${negative ? 'n’t' : ''} a ${c.value} deal`;
    case 'owner':
      return c.value === 'unassigned' ? `it has ${negative ? 'an' : 'no'} owner` : `its owner is${negative ? 'n’t' : ''} ${names.member(c.value)}`;
    case 'source':
      return `its source is${negative ? 'n’t' : ''} ${c.value}`;
    case 'tag':
      return `it is${negative ? 'n’t' : ''} tagged ${names.tag(c.value)}`;
    case 'leadScore':
      return `the lead scores ${c.op === 'lte' ? 'at most' : 'at least'} ${c.value}`;
    case 'leadStatus':
      return `the lead is${negative ? 'n’t' : ''} ${c.value}`;
    case 'companyType':
      return `the company is${negative ? 'n’t' : ''} a ${String(c.value).toLowerCase()}`;
    default:
      return 'a condition is met';
  }
}

const dueWords = (days: number | undefined) => (days == null || days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`);

/** "an email task", "a call task" — the article follows the word, not the field. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

export function actionSentence(a: LooseAction, names: Names): string {
  const who = (id: unknown) => (!id || id === 'owner' ? 'the owner' : names.member(String(id)));
  switch (a.type) {
    case 'createTask': {
      const kind = String(a.taskType ?? 'To-do').toLowerCase();
      return `create ${article(kind)} ${kind} task “${String(a.title ?? '')}” for ${who(a.memberId)}, ${dueWords(a.dueInDays as number | undefined)}`;
    }
    case 'notify':
      return `notify ${who(a.memberId)}`;
    case 'sendEmail':
      return `email the contact the “${names.template(String(a.templateId ?? ''))}” template`;
    case 'setField': {
      switch (a.field) {
        case 'owner':
          return a.value === 'unassigned' || !a.value ? 'clear the owner' : `make ${names.member(String(a.value))} the owner`;
        case 'addTag':
          return `add the tag ${names.tag(String(a.value ?? ''))}`;
        case 'forecastCategory':
          return `set the forecast category to ${String(a.value ?? '')}`;
        case 'dealType':
          return `set the deal type to ${String(a.value ?? '')}`;
        case 'leadStatus':
          return `move the lead to ${String(a.value ?? '')}`;
        default:
          return 'set a field';
      }
    }
    case 'enrollSequence':
      return `enroll the contact in “${names.sequence(String(a.sequenceId ?? ''))}”`;
    default:
      return 'do nothing';
  }
}

/** The whole rule as one sentence: "When a deal is won and the amount is at least $50,000, create a task …". */
export function automationSentence(rule: { trigger: string; conditions: LooseCondition[]; actions: LooseAction[] }, names: Names) {
  const when = triggerOption(rule.trigger).when;
  const conditions = rule.conditions.map(c => conditionSentence(c, names));
  const actions = rule.actions.map(a => actionSentence(a, names));
  return {
    when,
    conditions,
    actions,
    full: `${when}${conditions.length ? ` and ${conditions.join(' and ')}` : ''}, ${actions.length ? joinList(actions) : 'do nothing'}.`,
  };
}

export function joinList(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const OP_LABEL: Record<string, string> = { is: 'is', isNot: 'is not', gte: 'is at least', lte: 'is at most' };
