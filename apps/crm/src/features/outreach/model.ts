import { CheckSquare, EnvelopeSimple, LinkedinLogo, PaperPlaneTilt, Phone } from '@phosphor-icons/react';
import { createElement, type ReactNode } from 'react';
import { MERGE_FIELDS, renderMerge, type MergeContext } from '@project/shared/merge';
import type { GetSequenceOutputType, ListEnrollmentsOutputType, ListSequencesOutputType, ListTemplatesOutputType } from 'zitejs/api';
import type { Tone } from '../../ui/Chip';

/**
 * The shapes and words the outreach area works in. Types come from the
 * endpoints themselves, so the client and the sender can never drift: change
 * the step schema in `saveSequence` and every screen here stops compiling.
 */

export type Template = ListTemplatesOutputType['templates'][number];
export type SequenceRow = ListSequencesOutputType['sequences'][number];
export type Sequence = GetSequenceOutputType['sequence'];
export type SequenceStats = GetSequenceOutputType['stats'];
export type Step = Sequence['steps'][number];
export type StepKind = Step['kind'];
export type SequenceSettings = Sequence['settings'];
export type Enrollment = ListEnrollmentsOutputType['enrollments'][number];

/** What each kind of step is, in the words a rep would use. */
export const STEP_KINDS: Array<{ value: StepKind; label: string; verb: string; hint: string; icon: ReactNode; automatic: boolean }> = [
  { value: 'auto_email', label: 'Automated email', verb: 'Send', hint: 'We send it for you at the scheduled time.', icon: createElement(PaperPlaneTilt, { size: 15 }), automatic: true },
  { value: 'manual_email', label: 'Email to write', verb: 'Write', hint: 'You get a task with the draft in it.', icon: createElement(EnvelopeSimple, { size: 15 }), automatic: false },
  { value: 'call', label: 'Call', verb: 'Call', hint: 'A call task lands on the owner’s list.', icon: createElement(Phone, { size: 15 }), automatic: false },
  { value: 'todo', label: 'To-do', verb: 'Do', hint: 'Anything else you want remembering.', icon: createElement(CheckSquare, { size: 15 }), automatic: false },
  { value: 'linkedin', label: 'LinkedIn', verb: 'Connect', hint: 'A LinkedIn task lands on the owner’s list.', icon: createElement(LinkedinLogo, { size: 15 }), automatic: false },
];

export const stepKind = (kind: StepKind) => STEP_KINDS.find(k => k.value === kind) ?? STEP_KINDS[0];

export const isEmailStep = (kind: StepKind) => kind === 'auto_email' || kind === 'manual_email';

/** "Day 0", "Day 3" — each step's day counted from the moment someone is enrolled. */
export function cumulativeDays(steps: Step[]): number[] {
  let total = 0;
  return steps.map((step, i) => (total += i === 0 ? 0 : step.delayDays));
}

export function cadenceLength(steps: Step[]) {
  const days = cumulativeDays(steps);
  return days.length ? days[days.length - 1] : 0;
}

export const SEQUENCE_STATUS_TONE: Record<string, Tone> = { Active: 'success', Paused: 'warning', Archived: 'neutral' };
export const ENROLLMENT_STATUS_TONE: Record<string, Tone> = { Active: 'accent', Paused: 'warning', Finished: 'neutral', Exited: 'neutral' };

/** The eight categories a sales team actually files templates under. Free text, so anything else is kept. */
export const TEMPLATE_CATEGORIES = ['Intro', 'Follow-up', 'Pricing', 'Security review', 'Re-engagement', 'Renewal', 'Meeting recap', 'Breakup'];

/**
 * The contact a preview is rendered against: the catalogue's own examples, with
 * the signed-in person standing in as the sender so a signature reads right.
 */
export function sampleContext(me?: { name?: string; title?: string | null; phone?: string | null } | null, organizationName?: string): MergeContext {
  const ctx: MergeContext = Object.fromEntries(MERGE_FIELDS.map(f => [f.key, f.example]));
  if (me?.name) {
    ctx['sender.name'] = me.name;
    ctx['sender.first_name'] = me.name.split(' ')[0];
  }
  if (me?.title) ctx['sender.title'] = me.title;
  if (me?.phone) ctx['sender.phone'] = me.phone;
  if (organizationName) ctx['organization.name'] = organizationName;
  return ctx;
}

export const preview = (text: string, ctx: MergeContext) => renderMerge(text ?? '', ctx);

export { MERGE_FIELDS };

/** A fresh step, ready to edit. Ids only have to be unique inside one sequence. */
export function blankStep(index: number, kind: StepKind = 'auto_email'): Step {
  return { id: `s${index + 1}-${Date.now().toString(36)}`, kind, delayDays: index === 0 ? 0 : 2, subject: '', body: '', note: '' };
}

export const DEFAULT_SETTINGS: SequenceSettings = {
  weekdaysOnly: true,
  sendWindow: { start: '08:00', end: '17:00' },
  exitOnReply: true,
  exitOnMeeting: true,
  exitOnDeal: false,
};

/** '09:30' → '9:30am', for the send window and the next-run column. */
export function clock(hhmm: string) {
  const [h, m] = (hhmm ?? '').split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')}${suffix}`;
}

/** 'Replied' → the tone that says whether an exit was a good outcome. */
export function exitTone(reason: string): Tone {
  if (reason === 'Replied' || reason === 'Meeting booked' || reason === 'Deal created') return 'success';
  if (reason === 'Unsubscribed') return 'danger';
  return 'neutral';
}

export const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
