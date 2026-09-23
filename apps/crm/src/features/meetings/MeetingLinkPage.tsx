import { ArrowLeft, ArrowSquareOut, CalendarBlank, Copy, Trash, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DURATION_OPTIONS,
  LOCATION_KINDS,
  defaultAvailability,
  hasAnyAvailability,
  type Availability,
  type BookingQuestion,
  type LocationKind,
} from '@project/shared/availability';
import { slugify } from '@project/shared/tokens';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Field, FieldRow, Input, Segmented, Select, Switch, Textarea } from '../../ui/Form';
import { Card, DetailLayout, EmptyState, ListSkeleton, PageHeader, Section, Skeleton } from '../../ui/Layout';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { AvailabilityEditor } from './AvailabilityEditor';
import { BookingsTab } from './BookingsTab';
import { HostPicker } from './HostPicker';
import { PagePreview } from './PagePreview';
import { QuestionsEditor } from './QuestionsEditor';
import { TIMEZONES, durationLabel, zoneName } from './meetingHelpers';
import { useBookingPage, useDeleteBookingPage, useSaveBookingPage } from './queries';

type Draft = {
  name: string;
  slug: string;
  description: string;
  hostIds: string[];
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  windowDays: number;
  availability: Availability;
  timezone: string;
  location: { kind: LocationKind; value: string };
  questions: BookingQuestion[];
  active: boolean;
};

/**
 * One meeting link. The left column is the page a buyer will see, in the order
 * they will read it; the rail is the link itself and a live preview built from
 * the real slot calculator, so a host can see the effect of a change before
 * anyone else does.
 */
export function MeetingLinkPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'bookings' ? 'bookings' : 'setup';

  const query = useBookingPage(id);
  const remove = useDeleteBookingPage();
  const [draft, setDraft] = useState<Draft | null>(null);
  const loaded = query.data;
  useDocumentTitle(loaded?.page.name ?? 'Meeting link', ws.settings.organizationName);

  useEffect(() => {
    if (!loaded) return;
    const page = loaded.page;
    setDraft({
      name: page.name,
      slug: page.slug,
      description: page.description,
      hostIds: page.hostIds,
      durationMinutes: page.durationMinutes,
      bufferMinutes: page.bufferMinutes,
      minNoticeHours: page.minNoticeHours,
      windowDays: page.windowDays,
      availability: page.availability.length === 7 ? (page.availability as Availability) : defaultAvailability(),
      timezone: page.timezone,
      location: { kind: (page.location.kind as LocationKind) || 'video', value: page.location.value },
      questions: page.questions,
      active: page.active,
    });
  }, [loaded?.page.id, loaded?.page.name]);

  const save = useSaveBookingPage({
    onSaved: result => {
      toast.success('Meeting link saved');
      if (result.slug !== loaded?.page.slug) void query.refetch();
    },
  });

  const canEdit = Boolean(loaded?.canEdit) && ws.can('outreach.send');
  const dirty = useMemo(() => {
    if (!draft || !loaded) return false;
    const page = loaded.page;
    return (
      JSON.stringify({ ...draft, slug: slugify(draft.slug) }) !==
      JSON.stringify({
        name: page.name,
        slug: page.slug,
        description: page.description,
        hostIds: page.hostIds,
        durationMinutes: page.durationMinutes,
        bufferMinutes: page.bufferMinutes,
        minNoticeHours: page.minNoticeHours,
        windowDays: page.windowDays,
        availability: page.availability,
        timezone: page.timezone,
        location: { kind: page.location.kind, value: page.location.value },
        questions: page.questions,
        active: page.active,
      })
    );
  }, [draft, loaded]);

  const problems = useMemo(() => {
    if (!draft) return [];
    const list: string[] = [];
    if (!draft.name.trim()) list.push('It needs a name.');
    if (!draft.hostIds.length) list.push('It needs at least one host.');
    if (!hasAnyAvailability(draft.availability)) list.push('It needs at least one time range.');
    const longest = Math.max(0, ...draft.availability.flatMap(day => day.map(r => minutes(r.end) - minutes(r.start))));
    if (hasAnyAvailability(draft.availability) && longest < draft.durationMinutes) list.push(`Every time range is shorter than ${durationLabel(draft.durationMinutes)}.`);
    return list;
  }, [draft]);

  const submit = async () => {
    if (!draft || problems.length) return;
    await save.mutateAsync({
      id,
      name: draft.name.trim(),
      slug: draft.slug.trim() || undefined,
      description: draft.description,
      hostIds: draft.hostIds,
      durationMinutes: draft.durationMinutes,
      bufferMinutes: draft.bufferMinutes,
      minNoticeHours: draft.minNoticeHours,
      windowDays: draft.windowDays,
      availability: draft.availability,
      timezone: draft.timezone,
      location: draft.location,
      questions: draft.questions,
      active: draft.active,
    });
  };

  if (query.isPending) {
    return (
      <div className="px-5 py-6 sm:px-8">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6">
          <ListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (query.isError || !loaded || !draft) {
    return (
      <EmptyState
        icon={<Warning size={22} weight="duotone" />}
        title="That meeting link isn’t here"
        actions={
          <Button variant="secondary" asChild>
            <Link to="/outreach/meetings">Back to meeting links</Link>
          </Button>
        }
      >
        {errorMessage(query.error, 'It may have been deleted, or the link you followed is out of date.')}
      </EmptyState>
    );
  }

  const url = loaded.url;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => (d ? { ...d, [key]: value } : d));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <Link to="/outreach/meetings" className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-hover hover:text-ink">
            <ArrowLeft size={13} /> Meeting links
          </Link>
        }
        title={draft.name || 'Untitled meeting link'}
        description={draft.active ? 'Live — anyone with the link can book one of your open times.' : 'Paused — the page tells visitors it isn’t taking bookings.'}
        adornment={draft.active ? undefined : <Badge tone="neutral">Paused</Badge>}
        actions={
          <>
            <Button variant="secondary" size="sm" leading={<Copy size={16} />} disabled={!url} onClick={() => void copyText(url, 'Link copied')}>
              Copy link
            </Button>
            <Button variant="secondary" size="sm" leading={<ArrowSquareOut size={16} />} disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener')}>
              Open page
            </Button>
          </>
        }
        tabs={
          <Tabs
            items={[
              { value: 'setup', label: 'Setup' },
              { value: 'bookings', label: 'Bookings', count: loaded.counts.bookings },
            ]}
            value={tab}
            onChange={value => setParams(value === 'bookings' ? { tab: 'bookings' } : {}, { replace: true })}
          />
        }
      />

      {tab === 'bookings' ? (
        <div className="px-5 py-6 sm:px-8">
          <div className="mx-auto w-full max-w-[1120px]">
            <BookingsTab pageId={id} />
          </div>
        </div>
      ) : (
        <DetailLayout
          rail={
            <div className="flex flex-col gap-4">
              <Card padded className="flex flex-col gap-3">
                <div className="text-micro font-semibold uppercase text-ink-3">The link you share</div>
                {url ? (
                  <>
                    <div className="break-all rounded-md bg-sunken px-2.5 py-2 text-meta text-ink-2">{url}</div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" leading={<Copy size={15} />} onClick={() => void copyText(url, 'Link copied')} className="flex-1">
                        Copy
                      </Button>
                      <Button variant="ghost" size="sm" leading={<ArrowSquareOut size={15} />} onClick={() => window.open(url, '_blank', 'noopener')}>
                        Open
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-meta text-ink-2">
                    The public address is remembered the first time someone opens CRM Pages. Until then the link is <span className="text-ink">/m/{draft.slug || slugify(draft.name)}</span>.
                  </p>
                )}
                <div className="flex items-center justify-between border-t border-line pt-3">
                  <span className="text-ui text-ink">Taking bookings</span>
                  <Switch checked={draft.active} onCheckedChange={value => set('active', value)} disabled={!canEdit} />
                </div>
              </Card>

              <div>
                <div className="mb-2 text-micro font-semibold uppercase text-ink-3">What a buyer sees</div>
                <PagePreview
                  name={draft.name}
                  description={draft.description}
                  hostIds={draft.hostIds}
                  durationMinutes={draft.durationMinutes}
                  bufferMinutes={draft.bufferMinutes}
                  minNoticeHours={draft.minNoticeHours}
                  windowDays={draft.windowDays}
                  availability={draft.availability}
                  timezone={draft.timezone}
                  location={draft.location}
                />
              </div>

              <Card padded className="flex flex-col gap-2">
                <div className="text-micro font-semibold uppercase text-ink-3">So far</div>
                <div className="flex items-baseline justify-between text-ui">
                  <span className="text-ink-2">Booked</span>
                  <span className="tabular font-medium text-ink">{loaded.counts.bookings}</span>
                </div>
                <div className="flex items-baseline justify-between text-ui">
                  <span className="text-ink-2">Still to come</span>
                  <span className="tabular font-medium text-ink">{loaded.counts.upcoming}</span>
                </div>
                <div className="flex items-baseline justify-between text-ui">
                  <span className="text-ink-2">Canceled</span>
                  <span className="tabular font-medium text-ink">{loaded.counts.canceled}</span>
                </div>
                <Button variant="ghost" size="sm" leading={<CalendarBlank size={15} />} className="mt-1 self-start" onClick={() => setParams({ tab: 'bookings' }, { replace: true })}>
                  See them
                </Button>
              </Card>

              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  leading={<Trash size={15} />}
                  className="self-start text-danger hover:bg-danger/10 hover:text-danger"
                  onClick={async () => {
                    const ok = await actions.confirm({
                      title: `Delete ${draft.name}?`,
                      description:
                        loaded.counts.upcoming > 0
                          ? `The link stops working straight away, including for the ${loaded.counts.upcoming === 1 ? 'person who has' : `${loaded.counts.upcoming} people who have`} a meeting still to come. Those meetings stay in the calendar and on the timeline.`
                          : 'The link stops working straight away. Meetings already booked through it stay on their timelines.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    try {
                      await remove.mutateAsync({ id, confirmUpcoming: true });
                      toast.success(`${draft.name} deleted`);
                      navigate('/outreach/meetings');
                    } catch (e) {
                      toast.error(errorMessage(e, 'Couldn’t delete the meeting link'));
                    }
                  }}
                >
                  Delete this meeting link
                </Button>
              )}
            </div>
          }
        >
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8">
            {!canEdit && (
              <p className="rounded-md border border-line bg-sunken px-3 py-2 text-ui text-ink-2">
                You can read this meeting link but not change it. Its owner or a manager can.
              </p>
            )}
            {problems.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-ui text-warning">
                <span className="font-medium">Nobody can book this yet.</span> {problems.join(' ')}
              </div>
            )}

            <Section title="What it is" description="The words at the top of the public page">
              <div className="flex flex-col gap-4">
                <FieldRow>
                  <Field label="Name" required>
                    <Input value={draft.name} disabled={!canEdit} maxLength={120} onChange={e => set('name', e.target.value)} />
                  </Field>
                  <Field label="Link" hint="The end of the public address" error={!slugify(draft.slug) ? 'Use letters and numbers' : undefined}>
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-ui text-ink-3">/m/</span>
                      <Input value={draft.slug} disabled={!canEdit} maxLength={60} onChange={e => set('slug', e.target.value)} onBlur={e => set('slug', slugify(e.target.value))} />
                    </div>
                  </Field>
                </FieldRow>
                <Field label="Description" hint="A sentence or two about what happens in the meeting.">
                  <Textarea value={draft.description} disabled={!canEdit} maxLength={4000} minRows={3} onChange={e => set('description', e.target.value)} />
                </Field>
              </div>
            </Section>

            <Section title="Who takes it" description={draft.hostIds.length > 1 ? 'Bookings rotate through the list' : undefined}>
              <HostPicker value={draft.hostIds} onChange={value => set('hostIds', value)} disabled={!canEdit} />
              <p className="text-meta text-ink-2">
                {draft.hostIds.length > 1
                  ? 'Each booking goes to the next person in the list who is free at that time. Someone who already owns the contact keeps them.'
                  : 'Only times this person is free are offered.'}
              </p>
            </Section>

            <Section title="How long, and how far ahead">
              <div className="flex flex-col gap-4">
                <Field label="Length">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      value={DURATION_OPTIONS.includes(draft.durationMinutes as (typeof DURATION_OPTIONS)[number]) ? String(draft.durationMinutes) : 'custom'}
                      onChange={value => value !== 'custom' && set('durationMinutes', Number(value))}
                      options={[...DURATION_OPTIONS.map(m => ({ value: String(m), label: durationLabel(m) })), { value: 'custom', label: 'Custom' }]}
                    />
                    {!DURATION_OPTIONS.includes(draft.durationMinutes as (typeof DURATION_OPTIONS)[number]) && (
                      <span className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={5}
                          max={480}
                          step={5}
                          disabled={!canEdit}
                          value={draft.durationMinutes}
                          onChange={e => set('durationMinutes', Math.max(5, Math.min(480, Number(e.target.value) || 5)))}
                          className="w-24 tabular"
                          aria-label="Meeting length in minutes"
                        />
                        <span className="text-ui text-ink-2">minutes</span>
                      </span>
                    )}
                  </div>
                </Field>
                <FieldRow cols={3}>
                  <Field label="Gap between meetings" hint="Quiet time either side">
                    <Select value={String(draft.bufferMinutes)} disabled={!canEdit} onChange={e => set('bufferMinutes', Number(e.target.value))}>
                      {[0, 5, 10, 15, 30, 60].map(m => (
                        <option key={m} value={m}>
                          {m === 0 ? 'None' : `${m} minutes`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Shortest notice" hint="Nothing sooner than this">
                    <Select value={String(draft.minNoticeHours)} disabled={!canEdit} onChange={e => set('minNoticeHours', Number(e.target.value))}>
                      {[0, 1, 2, 4, 12, 24, 48, 72].map(h => (
                        <option key={h} value={h}>
                          {h === 0 ? 'Any time' : h < 24 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h / 24} ${h === 24 ? 'day' : 'days'}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Bookable up to" hint="How far ahead the page goes">
                    <Select value={String(draft.windowDays)} disabled={!canEdit} onChange={e => set('windowDays', Number(e.target.value))}>
                      {[7, 14, 21, 30, 45, 60, 90].map(d => (
                        <option key={d} value={d}>
                          {d} days out
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FieldRow>
              </div>
            </Section>

            <Section title="Where it happens">
              <div className="flex flex-col gap-3">
                <Segmented
                  value={draft.location.kind}
                  onChange={value => set('location', { ...draft.location, kind: value as LocationKind })}
                  options={LOCATION_KINDS.map(k => ({ value: k.value, label: k.label }))}
                />
                <Field label={draft.location.kind === 'video' ? 'Meeting link' : draft.location.kind === 'phone' ? 'What happens' : 'Address'} hint={LOCATION_KINDS.find(k => k.value === draft.location.kind)?.hint}>
                  <Input
                    value={draft.location.value}
                    disabled={!canEdit}
                    maxLength={400}
                    placeholder={draft.location.kind === 'video' ? 'https://meet.google.com/abc-defg-hij' : draft.location.kind === 'phone' ? 'We’ll call the number you give us.' : '1200 SE Water Ave, Suite 240, Portland, OR'}
                    onChange={e => set('location', { ...draft.location, value: e.target.value })}
                  />
                </Field>
              </div>
            </Section>

            <Section title="When you’re open" description={`Wall-clock time in ${zoneName(draft.timezone)}`}>
              <div className="flex flex-col gap-4">
                <Field label="Timezone" hint="The hours below are read in this zone, daylight saving included.">
                  <Select value={draft.timezone} disabled={!canEdit} onChange={e => set('timezone', e.target.value)} className="max-w-[320px]">
                    {[...new Set([draft.timezone, ...TIMEZONES])].map(tz => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className={cn('rounded-lg border border-line bg-card px-4 py-1', !canEdit && 'opacity-70')}>
                  <AvailabilityEditor value={draft.availability} onChange={value => set('availability', value)} disabled={!canEdit} />
                </div>
              </div>
            </Section>

            <Section title="What you ask" description="Beyond name, email and company">
              <QuestionsEditor value={draft.questions} onChange={value => set('questions', value)} disabled={!canEdit} />
            </Section>

            {canEdit && dirty && (
              <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur">
                <span className="text-meta text-ink-3">Unsaved changes</span>
                <div className="ml-auto flex gap-2">
                  {(
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const page = loaded.page;
                        setDraft({
                          name: page.name,
                          slug: page.slug,
                          description: page.description,
                          hostIds: page.hostIds,
                          durationMinutes: page.durationMinutes,
                          bufferMinutes: page.bufferMinutes,
                          minNoticeHours: page.minNoticeHours,
                          windowDays: page.windowDays,
                          availability: page.availability as Availability,
                          timezone: page.timezone,
                          location: { kind: page.location.kind as LocationKind, value: page.location.value },
                          questions: page.questions,
                          active: page.active,
                        });
                      }}
                    >
                      Discard
                    </Button>
                  )}
                  <Button variant="primary" size="sm" loading={save.isPending} disabled={problems.length > 0} onClick={() => void submit()}>
                    Save changes
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DetailLayout>
      )}
    </div>
  );
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
