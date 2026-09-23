import { ArrowLeft, CalendarCheck, CalendarX, Check, Clock, MapPin, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getAvailability, manageBooking, type ManageBookingOutputType } from 'zitejs/api';
import { describeSlot, zoneAbbreviation, zoneCity } from '@project/shared/availability';
import { addDays, startOfMonth, todayIn, zonedParts } from '@project/shared/dates';
import { Badge, Button, Card, Field, Loading, Masthead, Notice, Page, Textarea, cn } from '../ui/kit';
import { useOrg } from '../lib/org';
import { CalendarSkeleton, MonthGrid, SlotColumn, TimezoneSelect, downloadIcs, guessTimezone, nextMonth, publicError } from './MeetingPage';

/**
 * The invitee's own page for a meeting they booked. Everything is keyed on the
 * token in the URL — there is no sign-in, and a wrong token is indistinguishable
 * from a missing one.
 *
 * Two things can be done here and both end somewhere unambiguous: moved (with
 * the new time in the invitee's own zone) or called off (with the page saying
 * so plainly and offering a fresh booking).
 */

type Booking = ManageBookingOutputType;

export default function BookingPage() {
  const { token = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const [timezone, setTimezone] = useState(() => guessTimezone());
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [justMoved, setJustMoved] = useState(false);

  const query = useQuery({
    queryKey: ['booking', token],
    queryFn: () => manageBooking({ token, action: 'get' }),
    retry: (count, error) => count < 2 && !/couldn’t find|NOT_FOUND/i.test(String((error as Error)?.message)),
  });

  const act = useMutation({
    mutationFn: manageBooking,
    onSuccess: (result, variables) => {
      qc.setQueryData(['booking', token], result);
      void qc.invalidateQueries({ queryKey: ['availability'] });
      setMode('view');
      setJustMoved(variables.action === 'reschedule');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (query.isPending || org.isPending) return <Loading label="Finding your booking…" />;
  if (query.isError || !query.data) {
    return (
      <Notice title="That link didn’t work">{publicError(query.error, 'The link may have expired, or the meeting may already have been canceled.')}</Notice>
    );
  }

  const booking = query.data;
  const orgName = org.data?.organizationName ?? '';
  const start = new Date(booking.start);
  const differentZones = zonedParts(booking.start, timezone).time !== zonedParts(booking.start, booking.hostTimezone).time;

  return (
    <Page>
      <Masthead name={orgName} logoUrl={org.data?.logoUrl}>
        Your meeting
      </Masthead>

      <Card className="flex flex-col gap-6">
        <header className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              booking.status === 'canceled' ? 'bg-danger/10 text-danger' : booking.status === 'past' ? 'bg-sunken text-ink-2' : 'bg-success/10 text-success',
            )}
          >
            {booking.status === 'canceled' ? <CalendarX size={22} /> : booking.status === 'past' ? <Clock size={22} /> : <Check size={22} weight="bold" />}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-display-sm text-ink">
              {booking.status === 'canceled' ? 'This meeting is canceled' : booking.status === 'past' ? 'This meeting has happened' : justMoved ? 'Your meeting has moved' : 'Your meeting is confirmed'}
            </h1>
            <p className="mt-1 text-body text-ink-2">
              {booking.status === 'canceled'
                ? `We’ve let ${booking.hostName} know. Nothing else to do.`
                : booking.status === 'past'
                  ? `It was with ${booking.hostName}. Book another time whenever suits.`
                  : `${booking.pageName} with ${booking.hostName}.`}
            </p>
          </div>
        </header>

        <dl className={cn('flex flex-col gap-3 border-y border-line py-5', booking.status === 'canceled' && 'opacity-70')}>
          <Row label="When">
            <div className={cn('font-medium text-ink', booking.status === 'canceled' && 'line-through decoration-ink-3')}>{describeSlot(booking.start, timezone)}</div>
            <div className="text-meta text-ink-2">
              {zoneCity(timezone)} · {zoneAbbreviation(timezone, start)} · {booking.durationMinutes} minutes
            </div>
            {differentZones && (
              <div className="mt-1.5 text-meta text-ink-2">
                {describeSlot(booking.start, booking.hostTimezone)} for {booking.hostName} ({zoneAbbreviation(booking.hostTimezone, start)}).
              </div>
            )}
          </Row>
          {booking.location && (
            <Row label="Where">
              <span className="inline-flex min-w-0 items-start gap-1.5">
                <MapPin size={16} className="mt-1 shrink-0 text-ink-3" />
                <span className="min-w-0 break-words">{booking.location}</span>
              </span>
            </Row>
          )}
          <Row label="With">
            {booking.hostName}
            {booking.hostTitle ? ` · ${booking.hostTitle}` : ''}
          </Row>
          {booking.canceledReason && (
            <Row label="Reason">
              <span className="text-ink-2">“{booking.canceledReason}”</span>
            </Row>
          )}
        </dl>

        {act.isError && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-body text-danger">{publicError(act.error, 'That didn’t work. Try again, or reply to your confirmation email.')}</p>}

        {mode === 'view' && (
          <div className="flex flex-col gap-4">
            {booking.status === 'scheduled' && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() =>
                    downloadIcs(
                      { start: booking.start, end: booking.end, pageName: booking.pageName, hostName: booking.hostName, location: booking.location, manageUrl: window.location.href, token },
                      orgName,
                    )
                  }
                >
                  <CalendarCheck size={17} /> Add to calendar
                </Button>
                {booking.canReschedule && <Button onClick={() => setMode('reschedule')}>Pick a new time</Button>}
                <Button variant="ghost" onClick={() => setMode('cancel')}>
                  Cancel the meeting
                </Button>
              </div>
            )}
            {booking.status === 'scheduled' && !booking.canReschedule && (
              <p className="text-meta text-ink-3">To move this one, reply to your confirmation email and {booking.hostName} will sort it out.</p>
            )}
            {(booking.status === 'canceled' || booking.status === 'past') && booking.slug && (
              <div>
                <Button variant="primary" onClick={() => (window.location.hash = `#/m/${booking.slug}`)}>
                  Book another time
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-meta text-ink-3">Times shown in</span>
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </div>
          </div>
        )}

        {mode === 'reschedule' && <Reschedule booking={booking} token={token} timezone={timezone} onTimezone={setTimezone} pending={act.isPending} onBack={() => setMode('view')} onPick={start => act.mutate({ token, action: 'reschedule', start, timezone })} />}

        {mode === 'cancel' && <CancelForm booking={booking} pending={act.isPending} onBack={() => setMode('view')} onCancel={reason => act.mutate({ token, action: 'cancel', reason })} />}
      </Card>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[90px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-ui text-ink-3">{label}</dt>
      <dd className="min-w-0 text-body text-ink">{children}</dd>
    </div>
  );
}

function Reschedule({
  booking,
  token,
  timezone,
  onTimezone,
  pending,
  onBack,
  onPick,
}: {
  booking: Booking;
  token: string;
  timezone: string;
  onTimezone: (tz: string) => void;
  pending: boolean;
  onBack: () => void;
  onPick: (start: string) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(todayIn(timezone)));
  const [day, setDay] = useState<string | null>(null);
  const monthEnd = useMemo(() => addDays(nextMonth(month), -1), [month]);

  const availability = useQuery({
    queryKey: ['availability', booking.slug, timezone, month, token],
    queryFn: () => getAvailability({ slug: booking.slug, timezone, from: month, to: monthEnd, bookingToken: token }),
  });
  const days = availability.data?.days ?? [];
  const bySlotDay = useMemo(() => new Map(days.map(d => [d.day, d.slots])), [days]);

  useEffect(() => {
    if (!days.length || (day && bySlotDay.has(day))) return;
    setDay(days[0]?.day ?? null);
  }, [days, day, bySlotDay]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title font-semibold text-ink">Pick a new time</h2>
        <div className="flex items-center gap-2">
          <TimezoneSelect value={timezone} onChange={onTimezone} />
          <Button variant="ghost" onClick={onBack} className="h-11 px-2 text-ui">
            <ArrowLeft size={15} /> Back
          </Button>
        </div>
      </div>

      {pending ? (
        <p className="text-body text-ink-2">Moving your meeting…</p>
      ) : availability.isPending ? (
        <CalendarSkeleton />
      ) : days.length === 0 ? (
        <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-body text-ink-2">Nothing is open this month. Try the next one.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_170px]">
          <MonthGrid month={month} onMonth={setMonth} today={todayIn(timezone)} lastDay={availability.data?.lastBookableDay ?? ''} selected={day} enabled={bySlotDay} onSelect={setDay} />
          <SlotColumn day={day} slots={day ? bySlotDay.get(day) ?? [] : []} timezone={timezone} duration={booking.durationMinutes} onPick={onPick} />
        </div>
      )}
      <p className="text-meta text-ink-3">Choosing a time moves the meeting straight away and tells {booking.hostName}.</p>
    </div>
  );
}

function CancelForm({ booking, pending, onBack, onCancel }: { booking: Booking; pending: boolean; onBack: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={e => {
        e.preventDefault();
        if (!pending) onCancel(reason.trim());
      }}
    >
      <div className="flex items-start gap-2">
        <Badge tone="danger">Canceling</Badge>
        <p className="text-body text-ink-2">
          This frees the time and lets {booking.hostName} know. You can book another whenever you like.
        </p>
      </div>
      <Field label="Anything you’d like to say?" hint="Optional — it goes straight to your host">
        <Textarea value={reason} maxLength={1000} placeholder="Something came up — I’ll rebook next week." onChange={e => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="danger" size="lg" loading={pending}>
          <X size={16} weight="bold" /> Cancel the meeting
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
