import { Copy, Plus, X } from '@phosphor-icons/react';
import { useId } from 'react';
import { toast } from 'sonner';
import { WEEKDAYS, copyToAllDays, formatTime, mergeRanges, minutesOfDay, timeOfMinutes, type Availability } from '@project/shared/availability';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { Tooltip } from '../../ui/Tooltip';
import { hoursPerWeek } from './meetingHelpers';

/**
 * The hours a host is open, one row per weekday. Everything is wall-clock in
 * the page's own timezone — the calculator turns it into instants, so a host
 * types "9:00" once and it stays 9:00 through a daylight-saving change.
 *
 * Times are `<input type="time">`: a native control that is keyboard-first,
 * localised, and already understood by everyone who has ever filled in a
 * calendar.
 */

// Monday first: it is a work week, not a calendar month.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilityEditor({ value, onChange, disabled }: { value: Availability; onChange: (next: Availability) => void; disabled?: boolean }) {
  const switchId = useId();
  const setDay = (day: number, ranges: Array<{ start: string; end: string }>) => {
    const next = value.map((d, i) => (i === day ? ranges : d));
    onChange(next);
  };

  const toggleDay = (day: number, open: boolean) => {
    if (!open) return setDay(day, []);
    // Borrow the nearest day that is already open, so turning Saturday on
    // doesn't mean typing four numbers.
    const template = ORDER.map(d => value[d]).find(d => d.length) ?? [{ start: '09:00', end: '17:00' }];
    setDay(day, template.map(r => ({ ...r })));
  };

  const addRange = (day: number) => {
    const ranges = value[day];
    const last = ranges[ranges.length - 1];
    const startMinutes = last ? Math.min((minutesOfDay(last.end) ?? 0) + 60, 23 * 60) : 9 * 60;
    setDay(day, [...ranges, { start: timeOfMinutes(startMinutes), end: timeOfMinutes(Math.min(startMinutes + 60, 24 * 60)) }]);
  };

  const editRange = (day: number, index: number, patch: { start?: string; end?: string }) => {
    setDay(
      day,
      value[day].map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const tidy = (day: number) => setDay(day, mergeRanges(value[day].filter(r => (minutesOfDay(r.end) ?? 0) > (minutesOfDay(r.start) ?? 0))));

  const copyDay = (day: number) => {
    onChange(copyToAllDays(value, day));
    toast.success(`${WEEKDAYS[day]}’s hours copied to every day`);
  };

  return (
    <div className="flex flex-col">
      {ORDER.map(day => {
        const ranges = value[day];
        const open = ranges.length > 0;
        return (
          <div key={day} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0', !open && 'text-ink-3')}>
            <div className="flex w-[132px] shrink-0 items-center gap-2.5 pt-1">
              <Switch id={`${switchId}-${day}`} checked={open} onCheckedChange={value => toggleDay(day, value)} disabled={disabled} />
              <label htmlFor={`${switchId}-${day}`} className={cn('cursor-pointer text-ui font-medium', open ? 'text-ink' : 'text-ink-3')}>
                {WEEKDAYS[day]}
              </label>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {!open ? (
                <span className="pt-1.5 text-ui text-ink-3">Closed</span>
              ) : (
                ranges.map((range, index) => {
                  const invalid = (minutesOfDay(range.end) ?? 0) <= (minutesOfDay(range.start) ?? 0);
                  return (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={range.start}
                        step={300}
                        disabled={disabled}
                        aria-label={`${WEEKDAYS[day]} window ${index + 1} start`}
                        onChange={e => editRange(day, index, { start: e.target.value })}
                        onBlur={() => tidy(day)}
                        className={cn(
                          'tabular h-9 w-[116px] rounded-md border border-control/60 bg-card px-2 text-ui text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
                          invalid && 'border-danger',
                        )}
                      />
                      <span className="text-ui text-ink-3">to</span>
                      <input
                        type="time"
                        value={range.end}
                        step={300}
                        disabled={disabled}
                        aria-label={`${WEEKDAYS[day]} window ${index + 1} end`}
                        onChange={e => editRange(day, index, { end: e.target.value })}
                        onBlur={() => tidy(day)}
                        className={cn(
                          'tabular h-9 w-[116px] rounded-md border border-control/60 bg-card px-2 text-ui text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
                          invalid && 'border-danger',
                        )}
                      />
                      {invalid && <span className="text-meta text-danger">The end has to come after the start</span>}
                      {!disabled && ranges.length > 1 && (
                        <Button variant="ghost" size="sm" icon aria-label={`Remove this window on ${WEEKDAYS[day]}`} onClick={() => setDay(day, ranges.filter((_, i) => i !== index))}>
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {open && !disabled && (
              <div className="flex shrink-0 items-center gap-1 pt-0.5">
                <Tooltip content="Add another window that day">
                  <Button variant="ghost" size="sm" icon aria-label={`Add a window on ${WEEKDAYS[day]}`} onClick={() => addRange(day)}>
                    <Plus size={15} />
                  </Button>
                </Tooltip>
                <Tooltip content="Copy these hours to every day">
                  <Button variant="ghost" size="sm" icon aria-label={`Copy ${WEEKDAYS[day]}’s hours to every day`} onClick={() => copyDay(day)}>
                    <Copy size={15} />
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
        );
      })}
      <p className="pt-3 text-meta text-ink-2">
        {hoursPerWeek(value)}
        {value.some(d => d.length) && ` · first slot ${formatTime(ORDER.map(d => value[d]).find(d => d.length)?.[0].start ?? '09:00')}`}
      </p>
    </div>
  );
}
