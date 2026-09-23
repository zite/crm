import { CheckCircle, Clock, Eye, FileDashed, PaperPlaneTilt, Prohibit, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Badge, type Tone } from '../../ui/Chip';
import type { QuoteStatus } from '@project/shared/constants';

/**
 * A quote's state is the one place colour carries meaning here: accepted is
 * success, declined and void are danger, an expiry that has passed is warning.
 * Everything still in play is ink or the pen.
 */
export const QUOTE_TONE: Record<QuoteStatus, Tone> = {
  Draft: 'neutral',
  Sent: 'info',
  Viewed: 'accent',
  Accepted: 'success',
  Declined: 'danger',
  Expired: 'warning',
  Void: 'neutral',
};

const ICONS: Record<QuoteStatus, ReactNode> = {
  Draft: <FileDashed size={13} />,
  Sent: <PaperPlaneTilt size={13} />,
  Viewed: <Eye size={13} />,
  Accepted: <CheckCircle size={13} weight="fill" />,
  Declined: <XCircle size={13} />,
  Expired: <Clock size={13} />,
  Void: <Prohibit size={13} />,
};

export const QUOTE_STATUS_HINT: Record<QuoteStatus, string> = {
  Draft: 'Not sent yet — only your team can see it.',
  Sent: 'With the buyer, not opened yet.',
  Viewed: 'The buyer has opened it.',
  Accepted: 'Signed off on the quote page.',
  Declined: 'The buyer said no.',
  Expired: 'Past its expiry date — send a fresh one.',
  Void: 'Withdrawn. The link tells the buyer so.',
};

export function QuoteStatusBadge({ status, className }: { status: string; className?: string }) {
  const key = (status in QUOTE_TONE ? status : 'Draft') as QuoteStatus;
  return (
    <Badge tone={QUOTE_TONE[key]} icon={ICONS[key]} className={className}>
      {key}
    </Badge>
  );
}

/** Once a quote leaves the building it is a record of what was offered. */
export const isLocked = (storedStatus: string) => storedStatus !== 'Draft';
