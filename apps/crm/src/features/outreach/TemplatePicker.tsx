import { CaretDown } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import { OptionPicker, type Option } from '../../pickers/OptionPicker';
import { useTemplates } from './queries';

/**
 * Pick a template inside the email composer. It fills the subject and the body
 * with the template's own text — merge fields and all, because the server
 * renders them at send time against the real contact.
 *
 * `templateId` goes back with the send so the template's use count is the
 * number of emails it actually sent, not the number of times it was opened.
 */
export function TemplatePicker({
  onPick,
  disabled,
  label = 'Use a template',
}: {
  onPick: (template: { id: string; name: string; subject: string; body: string }) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isPending } = useTemplates(false);
  const templates = data?.templates ?? [];

  const options: Option[] = useMemo(
    () =>
      [...templates]
        .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
        .map(t => ({
          value: t.id,
          label: t.name,
          hint: t.category || undefined,
          group: t.category || 'Uncategorised',
          keywords: `${t.subject} ${t.category}`,
        })),
    [templates],
  );

  return (
    <OptionPicker
      open={open}
      onOpenChange={setOpen}
      options={options}
      value={null}
      width={300}
      align="end"
      placeholder="Search templates"
      empty={isPending ? 'Loading…' : 'No templates yet'}
      onSelect={id => {
        const t = templates.find(x => x.id === id);
        if (t) onPick({ id: t.id, name: t.name, subject: t.subject, body: t.body });
      }}
      trigger={
        <Button variant="ghost" size="xs" disabled={disabled} trailing={<CaretDown size={12} weight="bold" />}>
          {label}
        </Button>
      }
    />
  );
}
