import { ArrowDown, ArrowUp, Plus } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { deleteChoice, deleteTag, saveChoice, saveTag } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Checkbox, Field, Input, Select } from '../../ui/Form';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { TagChip } from '../../ui/Chip';
import { Tabs } from '../../ui/Tabs';
import { CHOICE_LISTS, TAG_COLORS, type ChoiceList, type TagColor } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { plural } from '../../lib/format';
import { useAppActions } from '../../lib/app-actions';
import { useInvalidateWorkspace, useWorkspace, type Tag } from '../../lib/workspace';
import { Explainer, Group, Row, RowList, RowMenu, SectionHead } from './kit';

type Choice = ReturnType<typeof useWorkspace>['choices'][number];

const LIST_NOTES: Record<ChoiceList, string> = {
  Industry: 'What kind of business a company is in. Used on companies, on leads, and in the lead report.',
  'Lead Source': 'Where a company, contact, deal or lead came from. The source report counts by these.',
  'Lost Reason': 'Why a deal was lost. Asked for whenever a deal is marked lost, and counted in the loss report.',
  'Disqualify Reason': 'Why a lead went nowhere. Asked for in the review deck when a lead is disqualified.',
};

/**
 * The words a team picks from, and the tags it files things under.
 *
 * Choices are stored on records as text — that is what makes an export and a
 * report readable — so renaming one leaves every record still carrying the old
 * word. The rename dialog counts them first and offers to walk them over.
 */
export function ListsSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const invalidateWorkspace = useInvalidateWorkspace();
  const { confirm } = useAppActions();
  const [list, setList] = useState<ChoiceList>('Industry');
  const [choiceDialog, setChoiceDialog] = useState<{ choice: Choice | null } | null>(null);
  const [tagDialog, setTagDialog] = useState<{ tag: Tag | null } | null>(null);

  const values = useMemo(() => ws.choices.filter(c => c.list === list && !c.archived).sort((a, b) => a.position - b.position), [ws.choices, list]);
  const archived = useMemo(() => ws.choices.filter(c => c.list === list && c.archived), [ws.choices, list]);

  const afterWrite = () => {
    void invalidateWorkspace();
    invalidateRoots(qc, 'deals', 'deal', 'companies', 'contacts', 'leads', 'reports');
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveChoice>[0]) => saveChoice(input),
    onSuccess: result => {
      afterWrite();
      toast.success(result.recordsRelabelled ? `Saved, and ${plural(result.recordsRelabelled, 'record')} updated` : result.created ? 'Value added' : 'Value saved');
      setChoiceDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that value')),
  });

  const removeChoice = useMutation({
    mutationFn: (input: { choiceId: string; confirm?: boolean }) => deleteChoice(input),
    onSuccess: () => {
      afterWrite();
      toast.success('Value removed');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t remove that value')),
  });

  const saveTagM = useMutation({
    mutationFn: (input: Parameters<typeof saveTag>[0]) => saveTag(input),
    onSuccess: result => {
      afterWrite();
      toast.success(result.created ? 'Tag added' : 'Tag saved');
      setTagDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that tag')),
  });

  const removeTag = useMutation({
    mutationFn: (input: { tagId: string; confirm?: boolean }) => deleteTag(input),
    onSuccess: result => {
      afterWrite();
      toast.success(result.recordsUsing ? `“${result.name}” deleted and taken off ${plural(result.recordsUsing, 'record')}` : 'Tag deleted');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that tag')),
  });

  /* Both deletes ask the server first: it refuses with the real count, and that count is the confirmation. */
  const onDeleteChoice = async (choice: Choice) => {
    try {
      await deleteChoice({ choiceId: choice.id });
      afterWrite();
      toast.success('Value removed');
    } catch (error) {
      const ok = await confirm({ title: `Remove “${choice.label}”?`, description: errorMessage(error, 'It will stop being offered.'), confirmLabel: 'Remove it', destructive: true });
      if (ok) removeChoice.mutate({ choiceId: choice.id, confirm: true });
    }
  };

  const onDeleteTag = async (tag: Tag) => {
    try {
      await deleteTag({ tagId: tag.id });
      afterWrite();
      toast.success('Tag deleted');
    } catch (error) {
      const ok = await confirm({ title: `Delete the ${tag.name} tag?`, description: errorMessage(error, 'It will be taken off every record that carries it.'), confirmLabel: 'Delete tag', destructive: true });
      if (ok) removeTag.mutate({ tagId: tag.id, confirm: true });
    }
  };

  const move = (choice: Choice, delta: number) => {
    const ids = values.map(c => c.id);
    const from = ids.indexOf(choice.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    save.mutate({ choiceId: choice.id, list, label: choice.label, order: ids });
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead title="Lists & tags" description="The words your team picks from on a record, and the tags it files things under. Change them to match how you actually talk about your pipeline." />

      <Group
        title="Lists"
        action={
          <Button variant="secondary" size="sm" leading={<Plus size={15} weight="bold" />} onClick={() => setChoiceDialog({ choice: null })}>
            Add value
          </Button>
        }
      >
        <Tabs items={CHOICE_LISTS.map(l => ({ value: l, label: l, count: ws.choices.filter(c => c.list === l && !c.archived).length }))} value={list} onChange={v => setList(v as ChoiceList)} className="border-b border-line" />
        <p className="text-meta text-ink-2 text-pretty">{LIST_NOTES[list]}</p>
        <RowList empty={`Nothing in ${list} yet — add the first value.`}>
          {values.map((choice, index) => (
            <Row key={choice.id}>
              <span className="tabular w-6 shrink-0 text-meta text-ink-3">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ui text-ink">{choice.label}</span>
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="sm" icon aria-label={`Move ${choice.label} up`} disabled={index === 0 || save.isPending} onClick={() => move(choice, -1)}>
                  <ArrowUp size={15} />
                </Button>
                <Button variant="ghost" size="sm" icon aria-label={`Move ${choice.label} down`} disabled={index === values.length - 1 || save.isPending} onClick={() => move(choice, 1)}>
                  <ArrowDown size={15} />
                </Button>
              </div>
              <RowMenu label={`Actions for ${choice.label}`}>
                <MenuItem onSelect={() => setChoiceDialog({ choice })}>Rename value</MenuItem>
                <MenuItem onSelect={() => save.mutate({ choiceId: choice.id, list, label: choice.label, archived: true })}>Archive value</MenuItem>
                <MenuSeparator />
                <MenuItem destructive onSelect={() => void onDeleteChoice(choice)}>
                  Remove value
                </MenuItem>
              </RowMenu>
            </Row>
          ))}
        </RowList>
        {archived.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-meta text-ink-3">
            <span>Archived:</span>
            {archived.map(choice => (
              <button key={choice.id} type="button" onClick={() => save.mutate({ choiceId: choice.id, list, label: choice.label, archived: false })} className="rounded-xs px-1.5 py-0.5 text-ink-2 underline decoration-line-strong hover:bg-hover hover:text-ink">
                {choice.label}
              </button>
            ))}
            <span>— click to restore</span>
          </div>
        )}
      </Group>

      <Explainer summary="What happens to records when I rename a value">
        <p>
          Lists are stored on records as the word itself, not as a reference. That is deliberate: it is what makes an export readable in a spreadsheet and a report groupable without a join. The cost is that renaming
          “Website” to “Inbound” leaves every record that already said “Website” still saying it.
        </p>
        <p>So a rename counts those records first and offers to bring them along. Say no and the old records keep the old word — sometimes that is exactly right, because that is what was true at the time.</p>
      </Explainer>

      <Group
        title="Tags"
        note="Tags are references, so renaming one follows every record automatically. Use them for the things that cut across a pipeline — “Security review”, “Referenceable”, “Competitive”."
        action={
          <Button variant="secondary" size="sm" leading={<Plus size={15} weight="bold" />} onClick={() => setTagDialog({ tag: null })}>
            Add tag
          </Button>
        }
      >
        <RowList empty="No tags yet — add one and it becomes available on every company, contact, deal and lead.">
          {ws.tags.map(tag => (
            <Row key={tag.id}>
              <TagChip name={tag.name} color={tag.color} />
              <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{tag.description}</span>
              <RowMenu label={`Actions for ${tag.name}`}>
                <MenuItem onSelect={() => setTagDialog({ tag })}>Edit tag</MenuItem>
                <MenuSeparator />
                <MenuItem destructive onSelect={() => void onDeleteTag(tag)}>
                  Delete tag
                </MenuItem>
              </RowMenu>
            </Row>
          ))}
        </RowList>
      </Group>

      {choiceDialog && <ChoiceDialog list={list} choice={choiceDialog.choice} onClose={() => setChoiceDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
      {tagDialog && <TagDialog tag={tagDialog.tag} onClose={() => setTagDialog(null)} onSave={input => saveTagM.mutate(input)} pending={saveTagM.isPending} />}
    </div>
  );
}

function ChoiceDialog({ list, choice, onClose, onSave, pending }: { list: ChoiceList; choice: Choice | null; onClose: () => void; onSave: (input: Parameters<typeof saveChoice>[0]) => void; pending: boolean }) {
  const [label, setLabel] = useState(choice?.label ?? '');
  const [relabel, setRelabel] = useState(true);
  const [uses, setUses] = useState<number | null>(null);
  const renaming = Boolean(choice) && label.trim() !== choice?.label;

  /* Ask the server how many records carry the old word, the moment the label changes. */
  const count = async () => {
    if (!choice || uses != null) return;
    try {
      const result = await saveChoice({ choiceId: choice.id, list, label: choice.label, dryRun: true });
      setUses(result.recordsUsing);
    } catch {
      setUses(0);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={choice ? `Rename “${choice.label}”` : `Add to ${list}`}
      submitLabel={choice ? 'Save' : 'Add value'}
      onSubmit={() => onSave({ ...(choice ? { choiceId: choice.id } : {}), list, label: label.trim(), relabelRecords: renaming && relabel })}
      pending={pending}
      disabled={!label.trim()}
    >
      <div className="flex flex-col gap-4">
        <Field label="Value" required htmlFor="choice-label">
          <Input id="choice-label" autoFocus value={label} onChange={e => setLabel(e.target.value)} onFocus={() => void count()} maxLength={80} placeholder={list === 'Lost Reason' ? 'Chose a competitor' : 'Logistics'} />
        </Field>
        {renaming && (
          <label className="flex items-start gap-3 rounded-lg border border-line bg-sunken/60 px-4 py-3">
            <Checkbox checked={relabel} onCheckedChange={setRelabel} label="Update existing records" className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-ink">Update the records that still say “{choice?.label}”</span>
              <span className="mt-0.5 block text-meta text-ink-2">
                {uses == null ? 'Counting…' : uses === 0 ? 'Nothing uses it yet, so there is nothing to change.' : `${plural(uses, 'record')} would be rewritten, one at a time. Leave it off and history keeps the old word.`}
              </span>
            </span>
          </label>
        )}
      </div>
    </FormDialog>
  );
}

function TagDialog({ tag, onClose, onSave, pending }: { tag: Tag | null; onClose: () => void; onSave: (input: Parameters<typeof saveTag>[0]) => void; pending: boolean }) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState<TagColor>((tag?.color as TagColor) ?? 'slate');
  const [description, setDescription] = useState(tag?.description ?? '');
  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={tag ? `Edit the ${tag.name} tag` : 'New tag'}
      submitLabel={tag ? 'Save tag' : 'Add tag'}
      onSubmit={() => onSave({ ...(tag ? { tagId: tag.id } : {}), name: name.trim(), color, description: description.trim() })}
      pending={pending}
      disabled={!name.trim()}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required htmlFor="tag-name">
          <Input id="tag-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Security review" />
        </Field>
        <Field label="Colour" hint="Tag colours are for telling them apart, never for meaning — won, lost and overdue have their own.">
          <div className="flex flex-wrap items-center gap-2">
            {TAG_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c} className={color === c ? 'rounded-sm ring-2 ring-accent ring-offset-2 ring-offset-card' : 'rounded-sm'}>
                <TagChip name={name.trim() || c} color={c} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="What it means" hint="Shown in the tag picker, so nobody has to guess." htmlFor="tag-desc">
          <Input id="tag-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={200} placeholder="Waiting on their security questionnaire" />
        </Field>
      </div>
    </FormDialog>
  );
}
