import { Clock, MapPin, VideoCamera, Phone } from '@phosphor-icons/react';
import { computeSlots, describeLocation, slotOptionsFor, zoneAbbreviation, type Availability, type MeetingLocation } from '@project/shared/availability';
import { zonedParts } from '@project/shared/dates';
import { Avatar } from '../../ui/Avatar';
import { OrgMark } from '../../glyphs';
import { useWorkspace } from '../../lib/workspace';
import { durationLabel } from './meetingHelpers';

/**
 * What the buyer sees, at a quarter of the size. It is drawn from the same slot
 * calculator the public page uses, so a host editing their hours watches the
 * real times appear — not a mock-up that could be wrong.
 */
export function PagePreview({
  name,
  description,
  hostIds,
  durationMinutes,
  bufferMinutes,
  minNoticeHours,
  windowDays,
  availability,
  timezone,
  location,
}: {
  name: string;
  description: string;
  hostIds: string[];
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  windowDays: number;
  availability: Availability;
  timezone: string;
  location: MeetingLocation;
}) {
  const ws = useWorkspace();
  const hosts = hostIds.map(id => ws.memberById(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const days = computeSlots(slotOptionsFor({ availability, durationMinutes, bufferMinutes, minNoticeHours, windowDays, timezone }, { visitorTimezone: timezone }));
  const first = days[0] ?? null;
  const LocationIcon = location.kind === 'video' ? VideoCamera : location.kind === 'phone' ? Phone : MapPin;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="flex flex-col gap-3 border-b border-line bg-card px-4 py-4">
        <div className="flex items-center gap-2">
          <OrgMark name={ws.settings.organizationName} logoUrl={ws.settings.logoUrl} className="h-6 w-6 text-[10px]" />
          <span className="truncate text-meta font-medium text-ink-2">{ws.settings.organizationName}</span>
        </div>
        <div>
          <h4 className="font-display text-[19px] leading-7 text-ink">{name || 'Untitled meeting link'}</h4>
          {hosts.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Avatar person={hosts[0]} size="xs" />
              <span className="truncate text-meta text-ink-2">{hosts.length === 1 ? [hosts[0].name, hosts[0].title].filter(Boolean).join(' · ') : `${hosts[0].name} and ${hosts.length - 1} other${hosts.length > 2 ? 's' : ''}`}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} /> {durationLabel(durationMinutes)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <LocationIcon size={14} /> <span className="truncate">{describeLocation(location)}</span>
          </span>
        </div>
        {description && <p className="line-clamp-3 text-meta leading-5 text-ink-2">{description}</p>}
      </div>

      <div className="px-4 py-3">
        {first ? (
          <>
            <div className="text-micro font-semibold uppercase text-ink-3">
              {new Date(`${first.day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · {zoneAbbreviation(timezone)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {first.slots.slice(0, 6).map(slot => (
                <span key={slot} className="tabular inline-flex h-7 items-center rounded-sm border border-line-strong bg-card px-2 text-meta text-ink">
                  {formatSlot(slot, timezone)}
                </span>
              ))}
              {first.slots.length > 6 && <span className="inline-flex h-7 items-center text-meta text-ink-3">+{first.slots.length - 6} more</span>}
            </div>
            <p className="mt-2.5 text-meta text-ink-3">
              {days.length} {days.length === 1 ? 'day' : 'days'} bookable in the next {windowDays} days.
            </p>
          </>
        ) : (
          <p className="text-meta text-warning">No times can be booked yet — open some hours below.</p>
        )}
      </div>
    </div>
  );
}

function formatSlot(iso: string, timezone: string) {
  const { time } = zonedParts(iso, timezone);
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}
