import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteView, saveView } from 'zitejs/api';
import { Button } from '../ui/Button';
import { FormDialog } from '../ui/Dialog';
import { Field, Input, SwitchRow } from '../ui/Form';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { invalidateWorkspace, useWorkspace, type SavedView } from '../lib/workspace';
import type { ViewScope } from '@project/shared/constants';

/** Save the current filters, sort and layout as a view others can use. */
export function SaveViewDialog({ open, onOpenChange, scope, config, existing }: { open: boolean; onOpenChange: (open: boolean) => void; scope: ViewScope; config: Record<string, unknown>; existing?: SavedView | null }) {
  const qc = useQueryClient();
  const ws = useWorkspace();
  const { confirm } = useAppActions();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setShared(existing?.shared ?? true);
    setError(null);
  }, [open, existing]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Name the view');
      return;
    }
    setPending(true);
    try {
      await saveView({ id: existing?.id, name: name.trim(), scope, config, shared });
      await invalidateWorkspace(qc);
      toast.success(existing ? 'View updated' : 'View saved');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save that view'));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete “${existing.name}”?`,
      description: existing.shared ? 'It disappears for everyone on the team. The records themselves are untouched.' : 'The records themselves are untouched.',
      confirmLabel: 'Delete view',
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      await deleteView({ id: existing.id });
      await invalidateWorkspace(qc);
      toast.success('View deleted');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t delete that view'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Update view' : 'Save as view'}
      submitLabel={existing ? 'Update view' : 'Save view'}
      onSubmit={submit}
      pending={pending}
      size="sm"
      footerStart={
        existing && (existing.ownerId === ws.me.id || ws.can('outreach.manage')) ? (
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={remove} disabled={pending}>
            Delete view
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error ?? undefined}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Closing this quarter" invalid={Boolean(error)} />
        </Field>
        <SwitchRow label="Share with the team" description={ws.can('outreach.manage') ? 'Everyone sees it in the views menu.' : 'Your teammates will see this view too.'} checked={shared} onCheckedChange={setShared} />
      </div>
    </FormDialog>
  );
}
