import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DURATION_OPTIONS, defaultAvailability } from '@project/shared/availability';
import { slugify } from '@project/shared/tokens';
import { Field, Input, Segmented } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { useWorkspace } from '../../lib/workspace';
import { HostPicker } from './HostPicker';
import { durationLabel } from './meetingHelpers';
import { useSaveBookingPage } from './queries';

/**
 * New meeting link. Three decisions — what it's called, who takes it, how long
 * — and then straight into the editor, which is where hours and questions
 * belong. Registered in shell/CreateDialogs.tsx as the `meetingLink` kind.
 */
export function CreateMeetingLinkDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults?: Record<string, unknown> }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [hostIds, setHostIds] = useState<string[]>([ws.me.id]);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    if (!open) return;
    setName(typeof defaults?.name === 'string' ? defaults.name : '');
    setHostIds(Array.isArray(defaults?.hostIds) ? (defaults.hostIds as string[]) : [ws.me.id]);
    setDuration(typeof defaults?.durationMinutes === 'number' ? defaults.durationMinutes : 30);
  }, [open, defaults, ws.me.id]);

  const save = useSaveBookingPage({
    onSaved: result => {
      onOpenChange(false);
      toast.success('Meeting link created');
      navigate(`/outreach/meetings/${result.id}`);
    },
  });

  const slug = slugify(name);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New meeting link"
      description="The hours, the questions and the wording come next — this gets it started."
      submitLabel="Create"
      pending={save.isPending}
      disabled={!name.trim() || hostIds.length === 0}
      onSubmit={async () => {
        await save.mutateAsync({
          name: name.trim(),
          hostIds,
          durationMinutes: duration,
          bufferMinutes: 10,
          minNoticeHours: 12,
          windowDays: 30,
          availability: defaultAvailability(),
          timezone: ws.me.timezone || ws.settings.timezone,
          location: { kind: 'video', value: '' },
          questions: [],
          active: true,
        });
      }}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" hint={slug ? `Buyers will see /m/${slug}` : 'What a buyer sees at the top of the page'} required>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="30-minute intro" autoFocus maxLength={120} />
        </Field>
        <Field label="Hosts" hint={hostIds.length > 1 ? 'Bookings go round the list in turn, skipping anyone who is busy.' : 'Add more than one and bookings rotate between them.'} required>
          <HostPicker value={hostIds} onChange={setHostIds} />
        </Field>
        <Field label="How long">
          <Segmented
            value={String(duration)}
            onChange={value => setDuration(Number(value))}
            options={DURATION_OPTIONS.map(m => ({ value: String(m), label: durationLabel(m) }))}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

export default CreateMeetingLinkDialog;
