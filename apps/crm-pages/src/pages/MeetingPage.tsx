import { ArrowLeft, CalendarCheck, CaretLeft, CaretRight, Check, Clock, Globe, MapPin, Phone, VideoCamera } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { bookMeeting, getAvailability, getMeetingPage, type GetMeetingPageOutputType } from 'zitejs/api';
import { COMMON_TIMEZONES, describeSlot, zoneAbbreviation, zoneCity } from '@project/shared/availability';
import { addDays, isValidTimezone, startOfMonth, todayIn, zonedParts } from '@project/shared/dates';
import { Button, Card, Field, Input, Loading, Masthead, Notice, Page, Textarea, cn } from '../ui/kit';
import { useOrg } from '../lib/org';
import { EMAIL_RE } from '../lib/format';

/**
 * The page a buyer lands on to book time. One column, the vendor's colour, and
 * three steps that are always visible in order: pick a day, pick a time, say
 * who you are.
 *
 * Every time on this page is shown in the VISITOR's timezone, with the zone
 * named beside it and a picker to change it, because the single most common way
 * a booking page goes wrong is a buyer assuming the times are theirs.
 *
 * The slot list comes from the server (which runs the same calculator it will
 * use to accept the booking), so a time offered here is a time that was free
 * when it was offered — and the server checks again when the form is sent.
 */

type MeetingPageData = GetMeetingPageOutputType;

export default function MeetingPage() {
  const { slug = '' } = useParams();
  const org = useOrg();
  const [timezone, setTimezone] = useState(() => guessTimezone());
  const [month, setMonth] = useState(() => startOfMonth(todayIn(guessTimezone())));
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<Awaited<ReturnType<typeof bookMeeting>> | null>(null);

  const page = useQuery({
    queryKey: ['meeting', slug],
    queryFn: () => getMeetingPage({ slug }),
    retry: (count, error) => count < 2 && !/doesn’t exist|isn’t taking|NOT_FOUND/i.test(String((error as Error)?.message)),
  });

  const monthEnd = useMemo(() => addDays(nextMonth(month), -1), [month]);
  const availability = useQuery({
    queryKey: ['availability', slug, timezone, month],
    queryFn: () => getAvailability({ slug, timezone, from: month, to: monthEnd }),
    enabled: Boolean(page.data),
  });

  const days = availability.data?.days ?? [];
  const bySlotDay = useMemo(() => new Map(days.map(d => [d.day, d.slots])), [days]);

  // Land on the first day that has something, so the page is never a dead end.
  useEffect(() => {
    if (!days.length || (day && bySlotDay.has(day))) return;
    setDay(days[0]?.day ?? null);
    setSlot(null);
  }, [days, day, bySlotDay]);

  const book = useMutation({
    mutationFn: bookMeeting,
    onSuccess: result => {
      setBooked(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (page.isPending || org.isPending) return <Loading label="Loading the page…" />;
  if (page.isError || !page.data) {
    return (
      <Notice title="This link isn’t available">{publicError(page.error, 'The link may have expired. Check the one you were sent.')}</Notice>
    );
  }

  const data = page.data;
  const orgName = org.data?.organizationName ?? '';

  if (booked) {
    return (
      <Page>
        <Masthead name={orgName} logoUrl={org.data?.logoUrl}>
          {data.name}
        </Masthead>
        <Confirmation booking={booked} orgName={orgName} timezone={timezone} onChangeTimezone={setTimezone} />
      </Page>
    );
  }

  return (
    <Page>
      <Masthead name={orgName} logoUrl={org.data?.logoUrl}>
        Book a time
      </Masthead>

      <Card className="flex flex-col gap-6">
        <MeetingHeader data={data} />

        {slot ? (
          <BookingForm
            data={data}
            slot={slot}
            timezone={timezone}
            pending={book.isPending}
            error={book.isError ? publicError(book.error, 'We couldn’t book that time. Try another one.') : null}
            onBack={() => setSlot(null)}
            onSubmit={values => book.mutate({ slug, start: slot, timezone, ...values })}
          />
        ) : (
          <div className="flex flex-col gap-5 border-t border-line pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-title font-semibold text-ink">Pick a time</h2>
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </div>

            {availability.isPending ? (
              <CalendarSkeleton />
            ) : availability.isError ? (
              <p className="text-body text-danger">We couldn’t load the available times. Reload the page and try again.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_170px]">
                <MonthGrid
                  month={month}
                  onMonth={setMonth}
                  today={todayIn(timezone)}
                  lastDay={availability.data?.lastBookableDay ?? ''}
                  selected={day}
                  enabled={bySlotDay}
                  onSelect={value => {
                    setDay(value);
                    setSlot(null);
                  }}
                />
                <SlotColumn day={day} slots={day ? bySlotDay.get(day) ?? [] : []} timezone={timezone} duration={data.durationMinutes} onPick={setSlot} />
              </div>
            )}

            {!availability.isPending && days.length === 0 && (
              <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-body text-ink-2">
                Nothing is open this month. Try the next one, or reply to the email that brought you here.
              </p>
            )}
          </div>
        )}
      </Card>
    </Page>
  );
}

/* ---------------------------------------------------------------- pieces */

export function MeetingHeader({ data }: { data: Pick<MeetingPageData, 'name' | 'description' | 'durationMinutes' | 'location' | 'hosts' | 'roundRobin'> }) {
  const host = data.hosts[0];
  const LocationIcon = data.location.kind === 'video' ? VideoCamera : data.location.kind === 'phone' ? Phone : MapPin;
  // Several hosts means the meeting goes to whoever is free, so the page names
  // them all rather than implying one — and says which, in the confirmation.
  const names = data.hosts.map(h => h.name);
  return (
    <header className="flex flex-col gap-4">
      {host && (
        <div className="flex items-center gap-3">
          {data.roundRobin ? (
            <span className="flex shrink-0 -space-x-2">
              {data.hosts.slice(0, 3).map(h => (
                <HostAvatar key={h.name} host={h} size={38} className="ring-2 ring-card" />
              ))}
            </span>
          ) : (
            <HostAvatar host={host} />
          )}
          <div className="min-w-0">
            <div className="truncate text-ui font-medium text-ink">{names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : host.name}</div>
            <div className="truncate text-meta text-ink-2">{names.length > 1 ? 'Whoever’s free at the time you pick' : host.title}</div>
          </div>
        </div>
      )}
      <h1 className="font-display text-display-sm text-ink">{data.name}</h1>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-ui text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <Clock size={16} /> {data.durationMinutes} minutes
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LocationIcon size={16} /> <span className="truncate">{data.location.label}</span>
        </span>
      </div>
      {data.description && <p className="whitespace-pre-line text-body leading-7 text-ink-2">{data.description}</p>}
    </header>
  );
}

export function HostAvatar({ host, size = 44, className }: { host: { name: string; avatarUrl: string | null; color: string | null }; size?: number; className?: string }) {
  if (host.avatarUrl) return <img src={host.avatarUrl} alt="" className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  const initials = host.name
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white', className)}
      style={{ width: size, height: size, backgroundColor: host.color || '#4f6d7a', fontSize: Math.round(size / 2.8) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** A month of days, with the bookable ones raised and the rest plainly out of reach. */
function MonthGrid({
  month,
  onMonth,
  today,
  lastDay,
  selected,
  enabled,
  onSelect,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  lastDay: string;
  selected: string | null;
  enabled: Map<string, string[]>;
  onSelect: (day: string) => void;
}) {
  const first = new Date(`${month}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  // Monday-first grid.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(month, i))];
  const prev = previousMonth(month);
  const next = nextMonth(month);
  const canGoBack = prev >= startOfMonth(today);
  const canGoForward = !lastDay || next <= lastDay;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-ui font-semibold text-ink">
          {first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canGoBack}
            onClick={() => onMonth(prev)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-35"
          >
            <CaretLeft size={15} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canGoForward}
            onClick={() => onMonth(next)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-35"
          >
            <CaretRight size={15} />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
          <div key={i} className="pb-1 text-center text-micro font-semibold uppercase text-ink-3">
            {label}
          </div>
        ))}
        {cells.map((day, index) => {
          if (!day) return <div key={`pad${index}`} />;
          const open = (enabled.get(day)?.length ?? 0) > 0;
          const isToday = day === today;
          const isSelected = day === selected;
          return (
            <button
              key={day}
              type="button"
              disabled={!open}
              aria-label={`${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}${open ? '' : ' — nothing free'}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(day)}
              className={cn(
                'tabular relative flex h-11 items-center justify-center rounded-md text-ui transition-colors',
                isSelected
                  ? 'bg-accent font-semibold text-on-accent'
                  : open
                    ? 'bg-sunken font-medium text-ink hover:bg-accent/10 hover:text-accent'
                    : 'text-ink-3',
                isToday && !isSelected && 'ring-1 ring-inset ring-line-strong',
              )}
            >
              {Number(day.slice(8, 10))}
              {open && !isSelected && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotColumn({ day, slots, timezone, duration, onPick }: { day: string | null; slots: string[]; timezone: string; duration: number; onPick: (slot: string) => void }) {
  if (!day) return <div className="text-body text-ink-2">Pick a day to see the times.</div>;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-3 text-ui font-semibold text-ink">
        {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}
      </div>
      {slots.length === 0 ? (
        <p className="text-body text-ink-2">Nothing free that day.</p>
      ) : (
        // On a phone the page scrolls; on a desktop the list scrolls in its column.
        // The height is a whole number of rows (7 × 44px + 6 × 8px), so the list never
        // ends on a button sliced in half — which reads as broken rather than scrollable.
        <div className="flex flex-col gap-2 sm:max-h-[356px] sm:overflow-y-auto sm:pr-1">
          {slots.map(iso => (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className="tabular h-11 shrink-0 rounded-md border border-line-strong bg-card text-body font-medium text-ink transition-colors hover:border-accent hover:bg-accent/[0.07] hover:text-accent"
            >
              {clockLabel(iso, timezone)}
            </button>
          ))}
        </div>
      )}
      {/* The count says how many there are, so a list taller than its column doesn't hide times silently. */}
      {slots.length > 0 && (
        <p className="mt-3 text-meta text-ink-3">
          {slots.length === 1 ? '1 time' : `${slots.length} times`} · {duration} minutes each
        </p>
      )}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_170px]">
      <div>
        <div className="skeleton mb-3 h-6 w-36 rounded-sm" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="skeleton h-11 rounded-md" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="skeleton mb-1 h-6 w-28 rounded-sm" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-11 rounded-md" />
        ))}
      </div>
    </div>
  );
}

type FormValues = { name: string; email: string; company: string; notes: string; answers: Array<{ id: string; label: string; value: string }>; website: string };

function BookingForm({
  data,
  slot,
  timezone,
  pending,
  error,
  onBack,
  onSubmit,
}: {
  data: MeetingPageData;
  slot: string;
  timezone: string;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const [values, setValues] = useState({ name: '', email: '', company: '', notes: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const problems: Record<string, string> = {};
  if (!values.name.trim()) problems.name = 'We need a name for the invite';
  if (!EMAIL_RE.test(values.email.trim())) problems.email = 'Check the email address';
  for (const question of data.questions) {
    if (question.required && !(answers[question.id] ?? '').trim()) problems[question.id] = 'This one is needed';
  }
  const valid = Object.keys(problems).length === 0;

  return (
    <form
      className="flex flex-col gap-5 border-t border-line pt-6"
      onSubmit={e => {
        e.preventDefault();
        setTouched(true);
        if (!valid || pending) return;
        onSubmit({
          ...values,
          name: values.name.trim(),
          email: values.email.trim(),
          company: values.company.trim(),
          notes: values.notes.trim(),
          website,
          answers: data.questions.map(q => ({ id: q.id, label: q.label, value: (answers[q.id] ?? '').trim() })).filter(a => a.value),
        });
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-micro font-semibold uppercase text-ink-3">Your time</div>
          <div className="mt-1 text-title font-semibold text-ink">{describeSlot(slot, timezone)}</div>
          <div className="text-meta text-ink-2">
            {zoneCity(timezone)} · {zoneAbbreviation(timezone, new Date(slot))} · {data.durationMinutes} minutes
          </div>
        </div>
        <Button type="button" variant="ghost" onClick={onBack} className="h-9 px-2 text-ui">
          <ArrowLeft size={15} /> Change
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Your name" required error={touched ? problems.name : undefined}>
          <Input ref={firstField} value={values.name} maxLength={120} autoComplete="name" invalid={touched && Boolean(problems.name)} onChange={e => setValues({ ...values, name: e.target.value })} />
        </Field>
        <Field label="Email" required error={touched ? problems.email : undefined} hint={touched && problems.email ? undefined : 'Where the invitation goes'}>
          <Input value={values.email} type="email" maxLength={200} autoComplete="email" invalid={touched && Boolean(problems.email)} onChange={e => setValues({ ...values, email: e.target.value })} />
        </Field>
        <Field label="Company" hint="Optional">
          <Input value={values.company} maxLength={160} autoComplete="organization" onChange={e => setValues({ ...values, company: e.target.value })} />
        </Field>
        {data.questions.map(question =>
          question.long ? (
            <Field key={question.id} label={question.label} required={question.required} error={touched ? problems[question.id] : undefined}>
              <Textarea value={answers[question.id] ?? ''} maxLength={2000} invalid={touched && Boolean(problems[question.id])} onChange={e => setAnswers({ ...answers, [question.id]: e.target.value })} />
            </Field>
          ) : (
            <Field key={question.id} label={question.label} required={question.required} error={touched ? problems[question.id] : undefined}>
              <Input value={answers[question.id] ?? ''} maxLength={2000} invalid={touched && Boolean(problems[question.id])} onChange={e => setAnswers({ ...answers, [question.id]: e.target.value })} />
            </Field>
          ),
        )}
        <Field label="Anything else?" hint="Optional — it goes in the invitation">
          <Textarea value={values.notes} maxLength={4000} onChange={e => setValues({ ...values, notes: e.target.value })} />
        </Field>

        {/* A person never sees this; a bot fills everything in. */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
          </label>
        </div>
      </div>

      {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-body text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" loading={pending} className="min-w-[180px]">
          Confirm the meeting
        </Button>
        <span className="text-meta text-ink-3">You can move or cancel it any time.</span>
      </div>
    </form>
  );
}

function Confirmation({
  booking,
  orgName,
  timezone,
  onChangeTimezone,
}: {
  booking: Awaited<ReturnType<typeof bookMeeting>>;
  orgName: string;
  timezone: string;
  onChangeTimezone: (tz: string) => void;
}) {
  const start = new Date(booking.start);
  const differentZones = zonedParts(booking.start, timezone).time !== zonedParts(booking.start, booking.hostTimezone).time;
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <Check size={22} weight="bold" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-display-sm text-ink">You’re booked</h1>
          <p className="mt-1 text-body text-ink-2">
            We’ve emailed the details to you and to {booking.hostName}. {orgName ? `Looking forward to it.` : ''}
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-3 border-y border-line py-5">
        <Row label="What">
          {booking.pageName} with {booking.hostName}
        </Row>
        <Row label="When">
          <div className="font-medium text-ink">{describeSlot(booking.start, timezone)}</div>
          <div className="text-meta text-ink-2">
            {zoneCity(timezone)} · {zoneAbbreviation(timezone, start)}
          </div>
          {differentZones && (
            <div className="mt-1.5 text-meta text-ink-2">
              That’s {describeSlot(booking.start, booking.hostTimezone)} for {booking.hostName} ({zoneAbbreviation(booking.hostTimezone, start)}).
            </div>
          )}
        </Row>
        <Row label="How long">{booking.durationMinutes} minutes</Row>
        <Row label="Where">{booking.location}</Row>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => downloadIcs(booking, orgName)}>
          <CalendarCheck size={17} /> Add to calendar
        </Button>
        {booking.manageUrl ? (
          <Button onClick={() => (window.location.href = booking.manageUrl)}>
            Reschedule or cancel
          </Button>
        ) : (
          <span className="text-meta text-ink-3">The reschedule link is in your confirmation email.</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-meta text-ink-3">Times shown in</span>
        <TimezoneSelect value={timezone} onChange={onChangeTimezone} />
      </div>
    </Card>
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

/* ------------------------------------------------------- shared helpers */

/**
 * A sentence a buyer can read. The caller wraps a failure as
 * `API call failed (404): {"message":"…","code":"NOT_FOUND"}`; the endpoints
 * already write their messages for people, so dig ours out and never show the
 * wrapper.
 */
export function publicError(error: unknown, fallback: string): string {
  const raw = String((error as Error)?.message ?? '');
  if (!raw) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'You appear to be offline. Check your connection and try again.';
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  const stripped = raw.replace(/^API call failed \(\d+\):\s*/, '').trim();
  return stripped && stripped.length < 300 && !stripped.startsWith('{') ? stripped : fallback;
}

export function guessTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The zone picker. Deliberately a native select: it works on every phone. */
export function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const zones = useMemo(() => [...new Set([value, ...COMMON_TIMEZONES])].filter(isValidTimezone), [value]);
  return (
    <label className="inline-flex h-11 items-center gap-2 rounded-md border border-line-strong bg-card pl-3 pr-1.5 text-ui text-ink-2">
      <Globe size={16} className="shrink-0" />
      <span className="sr-only">Timezone</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="h-full max-w-[180px] cursor-pointer truncate bg-transparent pr-1 text-ink focus:outline-none">
        {zones.map(zone => (
          <option key={zone} value={zone}>
            {zoneCity(zone)} ({zoneAbbreviation(zone)})
          </option>
        ))}
      </select>
    </label>
  );
}

/** '9:30 am' in a timezone. */
export function clockLabel(iso: string, timezone: string) {
  const { time } = zonedParts(iso, timezone);
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const previousMonth = (month: string) => shiftMonth(month, -1);
export const nextMonth = (month: string) => shiftMonth(month, 1);

function shiftMonth(month: string, delta: number) {
  const d = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)).toISOString().slice(0, 10);
}

/**
 * The calendar file, built in the browser so no round trip is needed and the
 * download works even if the confirmation email is slow.
 */
export function downloadIcs(
  booking: { start: string; end: string; pageName: string; hostName: string; location: string; manageUrl: string; token: string },
  orgName: string,
) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escape(orgName || 'CRM')}//Meeting links//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.token}@meeting-links`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(booking.start)}`,
    `DTEND:${stamp(booking.end)}`,
    `SUMMARY:${escape(`${booking.pageName} with ${booking.hostName}`)}`,
    `LOCATION:${escape(booking.location)}`,
    `DESCRIPTION:${escape([booking.location, booking.manageUrl ? `Reschedule or cancel: ${booking.manageUrl}` : ''].filter(Boolean).join('\n'))}`,
    booking.manageUrl ? `URL:${booking.manageUrl}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  // iCalendar wants CRLF; some clients reject a file without it.
  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${booking.pageName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'meeting'}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { MonthGrid, SlotColumn, CalendarSkeleton };
