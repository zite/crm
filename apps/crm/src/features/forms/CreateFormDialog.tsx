import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Field, Input, Textarea } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { errorMessage } from '../../lib/errors';
import { slugify } from '@project/shared/tokens';
import { useFormActions } from './formData';

/**
 * New form. It starts with the four fields every B2B form needs — name, work
 * email, company, and what they want — so it is usable the moment it is made;
 * the editor is where it gets specific.
 */
export function CreateFormDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const navigate = useNavigate();
  const { save } = useFormActions();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [intro, setIntro] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName((defaults.name as string) ?? '');
    setSlug('');
    setSlugTouched(false);
    setIntro('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name the form');
      return;
    }
    try {
      const result = await save.mutateAsync({ name: name.trim(), slug: (slugTouched ? slug : slugify(name)) || undefined, intro: intro.trim() || null });
      onOpenChange(false);
      // We land on the editor, so an "Open" action on the toast would point here.
      toast.success(`${result.form.name} is live at /f/${result.form.slug}`);
      navigate(`/outreach/forms/${result.form.id}`);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t create that form'));
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New form" description="A page a buyer fills in. You can change everything about it afterwards." submitLabel="Create form" onSubmit={submit} pending={save.isPending}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error ?? undefined} hint="Only your team sees this.">
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Request a demo" invalid={Boolean(error)} />
        </Field>
        <Field label="Web address" hint={`It will live at /f/${(slugTouched ? slug : slugify(name)) || 'your-form'}`}>
          <Input
            value={slugTouched ? slug : slugify(name)}
            onChange={e => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="request-a-demo"
          />
        </Field>
        <Field label="Intro" hint="A sentence above the fields. Optional.">
          <Textarea value={intro} onChange={e => setIntro(e.target.value)} minRows={3} placeholder="Tell us a little about your operation and we’ll set up a walkthrough." />
        </Field>
      </div>
    </FormDialog>
  );
}

export default CreateFormDialog;
