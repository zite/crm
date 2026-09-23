import {
  ArrowUUpLeft,
  At,
  Bell,
  CalendarBlank,
  Clock,
  FileText,
  Lightning,
  ListChecks,
  NotePencil,
  PaperPlaneTilt,
  Prohibit,
  TrendUp,
  Trophy,
  UploadSimple,
  UserPlus,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { ListNotificationsOutputType } from 'zitejs/api';
import type { Tone } from '../../ui/Chip';

export type Notification = ListNotificationsOutputType['notifications'][number];

type Meta = { icon: ReactNode; label: string; tone: Tone };

/** One glyph and one word per notification kind — the kinds notify() documents. */
const META: Record<string, Meta> = {
  assigned: { icon: <ListChecks size={15} />, label: 'Assigned', tone: 'accent' },
  mention: { icon: <At size={15} />, label: 'Mention', tone: 'accent' },
  lead: { icon: <UserPlus size={15} />, label: 'New lead', tone: 'info' },
  deal_won: { icon: <Trophy size={15} weight="fill" />, label: 'Won', tone: 'success' },
  deal_lost: { icon: <Prohibit size={15} />, label: 'Lost', tone: 'danger' },
  deal_stage: { icon: <TrendUp size={15} />, label: 'Stage', tone: 'neutral' },
  task_due: { icon: <Clock size={15} />, label: 'Task due', tone: 'warning' },
  meeting_booked: { icon: <CalendarBlank size={15} />, label: 'Meeting', tone: 'info' },
  quote_viewed: { icon: <FileText size={15} />, label: 'Quote viewed', tone: 'info' },
  quote_accepted: { icon: <FileText size={15} />, label: 'Quote accepted', tone: 'success' },
  quote_declined: { icon: <FileText size={15} />, label: 'Quote declined', tone: 'danger' },
  form_submission: { icon: <NotePencil size={15} />, label: 'Form', tone: 'info' },
  sequence: { icon: <PaperPlaneTilt size={15} />, label: 'Sequence', tone: 'neutral' },
  automation: { icon: <Lightning size={15} />, label: 'Automation', tone: 'neutral' },
  import: { icon: <UploadSimple size={15} />, label: 'Import', tone: 'neutral' },
  reply: { icon: <ArrowUUpLeft size={15} />, label: 'Reply', tone: 'info' },
  system: { icon: <Bell size={15} />, label: 'Notice', tone: 'neutral' },
};

export const metaFor = (kind: string): Meta => META[kind] ?? META.system;

export type InboxFilter = 'all' | 'unread' | 'mentions' | 'assigned';

export const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'assigned', label: 'Assigned' },
];

export function matchesFilter(notification: Notification, filter: InboxFilter) {
  if (filter === 'unread') return !notification.readAt;
  if (filter === 'mentions') return notification.kind === 'mention';
  if (filter === 'assigned') return notification.kind === 'assigned' || notification.kind === 'task_due';
  return true;
}

/** Where a notification points. `link` is already a hash route ('/deals/<id>'). */
export function targetLabel(notification: Notification) {
  const type = notification.entityType;
  if (!notification.link) return null;
  const nouns: Record<string, string> = { deal: 'deal', company: 'company', contact: 'contact', lead: 'lead', task: 'task', quote: 'quote', activity: 'activity' };
  return `Open the ${nouns[type ?? ''] ?? 'record'}`;
}
