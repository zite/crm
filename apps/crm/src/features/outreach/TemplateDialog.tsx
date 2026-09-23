import { Eye, PencilSimple } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Segmented, SwitchRow, Textarea } from '../../ui/Form';
import { FieldButton, OptionsPicker } from '../../pickers/pickers';
import { missingFields } from '@project/shared/merge';
import { useWorkspace } from '../../lib/workspace';
import { MergeFieldMenu } from './MergeFieldMenu';
import { preview, sampleContext, TEMPLATE_CATEGORIES, type Template } from './model';
import { useTemplateActions } from './queries';

/**
 * Write a template and see it the way the buyer will. The preview renders the
 * same merge engine the sender uses against a sample contact, so a field that
 * would come through empty shows up here and not in someone's inbox.
 */
export function TemplateDialog({
  open,
  onOpenChange,
  template,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template | null;
  defaults?: { name?: string; category?: string; subject?: string; body?: string };
  onSaved?: (id: string) => void;
}) {
  const ws = useWorkspace();
  const { save } = useTemplateActions();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(true);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? defaults?.name ?? '');
    setCategory(template?.category ?? defaults?.category ?? '');
    setSubject(template?.subject ?? defaults?.subject ?? '');
    setBody(template?.body ?? defaults?.body ?? '');
    setShared(template ? template.shared : true);
    setMode('write');
    setError(null);
  }, [open, template?.id]);

  const ctx = useMemo(() => sampleContext(ws.me, ws.settings.organizationName), [ws.me, ws.settings.organizationName]);
  const missing = useMemo(() => [...new Set([...missingFields(subject, ctx), ...missingFields(body, ctx)])], [subject, body, ctx]);
  const categories = useMemo(() => [...new Set([...TEMPLATE_CATEGORIES, ...(category ? [category] : [])])], [category]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the template a name');
      return;
    }
    const result = await save.mutateAsync({ id: template?.id, name: name.trim(), subject: subject.trim(), body, category: category.trim(), shared });
    onOpenChange(false);
    toast.success(template ? 'Template saved' : 'Template created');
    onSaved?.(result.id);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? 'Edit template' : 'New template'}
      description="Merge fields are filled in when it sends, so one template works for everybody."
      submitLabel={template ? 'Save template' : 'Create template'}
      onSubmit={submit}
      size="lg"
      footerStart={
        <Segmented
          size="sm"
          value={mode}
          onChange={v => setMode(v as 'write' | 'preview')}
          options={[
            { value: 'write', label: 'Write', icon: <PencilSimple size={14} /> },
            { value: 'preview', label: 'Preview', icon: <Eye size={14} /> },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Name" required error={error ?? undefined}>
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="First touch — operations lead" invalid={Boolean(error)} />
          </Field>
          <Field label="Category">
            <OptionsPicker
              options={categories}
              value={category || null}
              onChange={v => setCategory(v ?? '')}
              allowEmpty
              placeholder="Uncategorised"
              trigger={<FieldButton placeholder={!category}>{category || 'Uncategorised'}</FieldButton>}
            />
          </Field>
        </div>

        {mode === 'write' ? (
          <>
            <Field label="Subject" action={<MergeFieldMenu target={subjectRef} value={subject} onChange={setSubject} label="Insert field" />}>
              <Input ref={subjectRef} value={subject} onChange={e => setSubject(e.target.value)} placeholder="A quicker way to run {{company.name}}" />
            </Field>
            <Field label="Message" action={<MergeFieldMenu target={bodyRef} value={body} onChange={setBody} label="Insert field" />}>
              <Textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} minRows={12} placeholder={'Hi {{contact.first_name | there}},\n\n'} />
            </Field>
          </>
        ) : (
          <div className="rounded-lg border border-line bg-sunken p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-micro font-semibold uppercase text-ink-3">Preview</span>
              <span className="text-meta text-ink-3">Rendered for {ctx['contact.name']} at {ctx['company.name']}</span>
            </div>
            <div className="rounded-md border border-line bg-card p-4">
              <div className="border-b border-line pb-2.5 text-title font-semibold text-ink">{preview(subject, ctx) || <span className="text-ink-3">No subject</span>}</div>
              <div className="whitespace-pre-wrap pt-3 text-body leading-6 text-ink">{preview(body, ctx) || <span className="text-ink-3">Nothing written yet.</span>}</div>
            </div>
          </div>
        )}

        {missing.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-meta text-warning">
            <Badge tone="warning">Empty for some contacts</Badge>
            {missing.join(', ')} — add a fallback like <code className="text-ink-2">{'{{contact.first_name | there}}'}</code>
          </p>
        )}

        <div className="rounded-lg border border-line px-4 py-1">
          <SwitchRow
            label="Shared with the team"
            description={shared ? 'Everyone can use it. Its owner and managers can change it.' : 'Only you and your managers can see this one.'}
            checked={shared}
            onCheckedChange={setShared}
          />
        </div>
      </div>
    </FormDialog>
  );
}

/** Registered in shell/CreateDialogs.tsx as the `template` kind. */
export default function CreateTemplateDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  return (
    <TemplateDialog
      open={open}
      onOpenChange={onOpenChange}
      defaults={{
        name: typeof defaults.name === 'string' ? defaults.name : undefined,
        category: typeof defaults.category === 'string' ? defaults.category : undefined,
        subject: typeof defaults.subject === 'string' ? defaults.subject : undefined,
        body: typeof defaults.body === 'string' ? defaults.body : undefined,
      }}
    />
  );
}
