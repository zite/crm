import { CalendarBlank, CalendarX, User } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { EmptyState, ListSkeleton, Section } from '../../ui/Layout';
import { Segmented } from '../../ui/Form';
import { useState } from 'react';
import { dateTime, time, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { durationLabel } from './meetingHelpers';
import { useBookings } from './queries';
import type { ListBookingsOutputType } from 'zitejs/api';

type Booking = ListBookingsOutputType['bookings'][number];

const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  Scheduled: 'info',
  Completed: 'success',
  'No Show': 'warning',
  Canceled: 'danger',
};

/**
 * What the link has actually produced. Upcoming first because that is what
 * someone opens this tab to check; past is the record of it working.
 */
export function BookingsTab({ pageId }: { pageId: string }) {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const query = useBookings({ pageId, when });
  const bookings = query.data?.bookings ?? [];
  const counts = query.data?.counts;

  return (
    <Section
      title={when === 'upcoming' ? 'Still to come' : 'Already happened'}
      count={query.isPending ? undefined : bookings.length}
      action={
        <Segmented
          size="sm"
          value={when}
          onChange={value => setWhen(value as 'upcoming' | 'past')}
          options={[
            { value: 'upcoming', label: `Upcoming${counts ? ` ${counts.upcoming}` : ''}` },
            { value: 'past', label: `Past${counts ? ` ${counts.past + counts.canceled}` : ''}` },
          ]}
        />
      }
    >
      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : bookings.length === 0 ? (
        <EmptyState
          compact
          icon={when === 'upcoming' ? <CalendarBlank size={20} weight="duotone" /> : <CalendarX size={20} weight="duotone" />}
          title={when === 'upcoming' ? 'Nothing booked yet' : 'Nothing behind us yet'}
        >
          {when === 'upcoming'
            ? 'Share the link in a signature, a sequence or a follow-up email and the meetings land here.'
            : 'Meetings move here once their time has passed, along with anything that was canceled.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col rounded-lg border border-line bg-card">
          {bookings.map(booking => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const ws = useWorkspace();
  const host = ws.memberById(booking.hostId);
  const canceled = booking.outcome === 'Canceled';
  const recordPath = booking.contactId ? `/contacts/${booking.contactId}` : booking.leadId ? `/leads/${booking.leadId}` : null;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hover/50">
      <div className="min-w-0 flex-1 basis-[200px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-medium text-ink', canceled && 'line-through decoration-ink-3')}>{booking.inviteeName}</span>
          {booking.outcome && <Badge tone={OUTCOME_TONE[booking.outcome] ?? 'neutral'}>{booking.outcome}</Badge>}
        </div>
        <div className="truncate text-meta text-ink-3">
          {booking.companyName ?? booking.inviteeEmail ?? 'No company'}
          {booking.bookedAt && ` · booked ${timeAgo(booking.bookedAt)}`}
        </div>
      </div>

      <div className="w-[190px] shrink-0">
        <div className="tabular text-ui text-ink">{dateTime(booking.occurredAt)}</div>
        <div className="text-meta text-ink-3">
          {booking.endsAt ? `until ${time(booking.endsAt)}` : ''}
          {booking.durationMinutes ? ` · ${durationLabel(booking.durationMinutes)}` : ''}
        </div>
      </div>

      <div className="flex w-[150px] shrink-0 items-center gap-2">
        {host ? (
          <>
            <Avatar person={host} size="xs" />
            <span className="truncate text-ui text-ink-2">{host.name}</span>
          </>
        ) : (
          <span className="text-ui text-ink-3">No host</span>
        )}
      </div>

      <div className="shrink-0">
        {recordPath ? (
          <Button variant="ghost" size="sm" leading={<User size={15} />} asChild>
            <Link to={recordPath}>{booking.contactId ? 'Contact' : 'Lead'}</Link>
          </Button>
        ) : (
          <span className="text-meta text-ink-3">No record</span>
        )}
      </div>
    </li>
  );
}
