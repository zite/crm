import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateActivity } from 'zitejs/api';
import { FormDialog } from '../../ui/Dialog';
import { Field, FieldRow, Input } from '../../ui/Form';
import { DatePicker, FieldButton } from '../../pickers/pickers';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import type { Meeting } from './meetingHelpers';

/** Move a meeting. The end time follows the duration it already had. */
export function RescheduleMeetingDialog({ meeting, onOpenChange }: { meeting: Meeting | null; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meeting) return;
    const start = new Date(meeting.occurredAt);
    setDay(start.toLocaleDateString('en-CA'));
    setTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);
    setError(null);
  }, [meeting?.id]);

  if (!meeting) return null;

  const submit = async () => {
    if (!day) {
      setError('Pick a day');
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Use a time like 09:30');
      return;
    }
    setPending(true);
    try {
      const occurredAt = new Date(`${day}T${time}:00`);
      const minutes = meeting.durationMinutes ?? (meeting.endsAt ? Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.occurredAt)) / 60_000) : 30);
      await updateActivity({
        id: meeting.id,
        occurredAt: occurredAt.toISOString(),
        endsAt: new Date(occurredAt.getTime() + Math.max(5, minutes) * 60_000).toISOString(),
        outcome: 'Scheduled',
      });
      invalidate(qc, 'timeline', 'home', 'deals', 'deal');
      toast.success(`Moved to ${shortDate(day)}`);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t move that meeting'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open onOpenChange={onOpenChange} title="Reschedule meeting" description={meeting.subject} submitLabel="Move meeting" onSubmit={submit} pending={pending} size="sm">
      <FieldRow>
        <Field label="Day" required>
          <DatePicker value={day} onChange={setDay} clearable={false} trigger={<FieldButton placeholder={!day}>{day ? shortDate(day) : 'Pick a day'}</FieldButton>} />
        </Field>
        <Field label="Start time" required hint="24-hour, like 09:30" error={error ?? undefined}>
          <Input autoFocus value={time} onChange={e => setTime(e.target.value)} placeholder="09:30" invalid={Boolean(error)} />
        </Field>
      </FieldRow>
    </FormDialog>
  );
}
