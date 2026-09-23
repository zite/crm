import { ArrowDown, ArrowUp, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { deleteCustomField, saveCustomField } from 'zitejs/api';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Select, SwitchRow, Textarea } from '../../ui/Form';
import { EmptyState } from '../../ui/Layout';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { CUSTOM_FIELD_OBJECTS, CUSTOM_FIELD_TYPES, type CustomFieldObject, type CustomFieldType } from '@project/shared/constants';
import { fieldKey } from '@project/shared/customFields';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { useAppActions } from '../../lib/app-actions';
import { useInvalidateWorkspace, useWorkspace, type CustomField } from '../../lib/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { Explainer, Group, Row, RowList, RowMenu, SectionHead } from './kit';

const NOUNS: Record<CustomFieldObject, string> = { Company: 'Companies', Contact: 'Contacts', Deal: 'Deals', Lead: 'Leads' };

const NEEDS_OPTIONS = (type: CustomFieldType) => type === 'Select' || type === 'Multi Select';

/**
 * Custom properties, per object.
 *
 * The label is free to change; the key never is. Every record's value is filed
 * under that key, and every import column maps to it — change the key and the
 * data is still there but nothing can find it. So it is generated once, shown
 * as read-only, and said out loud in the dialog.
 */
export function PropertiesSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const invalidateWorkspace = useInvalidateWorkspace();
  const { confirm } = useAppActions();
  const [object, setObject] = useState<CustomFieldObject>('Deal');
  const [dialog, setDialog] = useState<{ field: CustomField | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const all = useMemo(() => ws.customFields.filter(f => f.object === object).sort((a, b) => a.position - b.position), [ws.customFields, object]);
  const live = all.filter(f => !f.archived);
  const archived = all.filter(f => f.archived);

  const afterWrite = () => {
    void invalidateWorkspace();
    invalidateRoots(qc, 'deals', 'deal', 'companies', 'contacts', 'leads');
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveCustomField>[0]) => saveCustomField(input),
    onSuccess: result => {
      afterWrite();
      toast.success(result.created ? 'Property added' : 'Property saved');
      setDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that property')),
  });

  const remove = useMutation({
    mutationFn: (input: { fieldId: string; confirm?: boolean }) => deleteCustomField(input),
    onSuccess: () => {
      afterWrite();
      toast.success('Property deleted');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that property')),
  });

  /** The first call always refuses and tells us what is at stake; that message is the confirmation. */
  const onDelete = async (field: CustomField) => {
    try {
      await deleteCustomField({ fieldId: field.id });
      afterWrite();
      toast.success('Property deleted');
    } catch (error) {
      const ok = await confirm({
        title: `Delete ${field.label}?`,
        description: errorMessage(error, 'This property will be removed from every form and report.'),
        confirmLabel: 'Delete property',
        destructive: true,
      });
      if (ok) remove.mutate({ fieldId: field.id, confirm: true });
    }
  };

  const move = (field: CustomField, delta: number) => {
    const ids = live.map(f => f.id);
    const from = ids.indexOf(field.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    save.mutate({ fieldId: field.id, object: field.object as CustomFieldObject, label: field.label, type: field.type as CustomFieldType, options: field.options, helpText: field.helpText ?? undefined, required: field.required, order: ids });
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Properties"
        description="The fields your team added on top of the ones the CRM ships with. They show on the record page, in filters, on import and on export."
        actions={
          <Button variant="primary" leading={<Plus size={16} weight="bold" />} onClick={() => setDialog({ field: null })}>
            New property
          </Button>
        }
      />

      <Tabs
        items={CUSTOM_FIELD_OBJECTS.map(o => ({ value: o, label: NOUNS[o], count: ws.customFields.filter(f => f.object === o && !f.archived).length }))}
        value={object}
        onChange={v => setObject(v as CustomFieldObject)}
        className="border-b border-line"
      />

      {live.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={22} weight="duotone" />}
          title={`No extra ${NOUNS[object].toLowerCase()} properties`}
          actions={
            <Button variant="primary" onClick={() => setDialog({ field: null })}>
              Add the first one
            </Button>
          }
        >
          Add the handful of things your team asks about every time — the current system, the contract end date, the number of sites.
        </EmptyState>
      ) : (
        <Group>
          <RowList>
            {live.map((field, index) => (
              <Row key={field.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-ui font-medium text-ink">{field.label}</span>
                    {field.required && <Badge tone="warning">Required</Badge>}
                  </div>
                  <div className="truncate text-meta text-ink-3">
                    {field.type}
                    {NEEDS_OPTIONS(field.type as CustomFieldType) ? ` · ${field.options.length} options` : ''} · key <code className="font-mono">{field.key}</code>
                    {field.helpText ? ` · ${field.helpText}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="sm" icon aria-label={`Move ${field.label} up`} disabled={index === 0 || save.isPending} onClick={() => move(field, -1)}>
                    <ArrowUp size={15} />
                  </Button>
                  <Button variant="ghost" size="sm" icon aria-label={`Move ${field.label} down`} disabled={index === live.length - 1 || save.isPending} onClick={() => move(field, 1)}>
                    <ArrowDown size={15} />
                  </Button>
                </div>
                <RowMenu label={`Actions for ${field.label}`}>
                  <MenuItem onSelect={() => setDialog({ field })}>Edit property</MenuItem>
                  <MenuItem
                    onSelect={() =>
                      save.mutate({ fieldId: field.id, object: field.object as CustomFieldObject, label: field.label, type: field.type as CustomFieldType, options: field.options, helpText: field.helpText ?? undefined, required: field.required, archived: true })
                    }
                  >
                    Archive property
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem destructive onSelect={() => void onDelete(field)}>
                    Delete property
                  </MenuItem>
                </RowMenu>
              </Row>
            ))}
          </RowList>
        </Group>
      )}

      {archived.length > 0 && (
        <Group title="Archived" note="Hidden everywhere, but every value a record already holds is kept — restore it and they are all back." action={
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? 'Hide' : `Show ${archived.length}`}
          </Button>
        }>
          {showArchived && (
            <RowList>
              {archived.map(field => (
                <Row key={field.id}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ui text-ink-2">{field.label}</div>
                    <div className="truncate text-meta text-ink-3">
                      {field.type} · key <code className="font-mono">{field.key}</code>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      save.mutate({ fieldId: field.id, object: field.object as CustomFieldObject, label: field.label, type: field.type as CustomFieldType, options: field.options, helpText: field.helpText ?? undefined, required: field.required, archived: false })
                    }
                  >
                    Restore
                  </Button>
                </Row>
              ))}
            </RowList>
          )}
        </Group>
      )}

      <Explainer summary="Archiving keeps the values; deleting doesn’t">
        <p>
          <strong className="font-medium text-ink">Archive</strong> takes the property off every form, filter and report, but the value each record holds stays exactly where it is. Restore the property and every one of them
          reappears — nothing is lost while you decide.
        </p>
        <p>
          <strong className="font-medium text-ink">Delete</strong> is for a property added by mistake. We’ll tell you how many records still hold a value before you go ahead, because those values stop being reachable.
        </p>
        <p>A property’s key and type are fixed once it exists, for the same reason: both are how the stored values are found and read.</p>
      </Explainer>

      {dialog && <PropertyDialog object={object} field={dialog.field} onClose={() => setDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
    </div>
  );
}

function PropertyDialog({ object, field, onClose, onSave, pending }: { object: CustomFieldObject; field: CustomField | null; onClose: () => void; onSave: (input: Parameters<typeof saveCustomField>[0]) => void; pending: boolean }) {
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<CustomFieldType>((field?.type as CustomFieldType) ?? 'Text');
  const [options, setOptions] = useState((field?.options ?? []).join('\n'));
  const [helpText, setHelpText] = useState(field?.helpText ?? '');
  const [required, setRequired] = useState(field?.required ?? false);

  const optionList = options.split('\n').map(o => o.trim()).filter(Boolean);
  const key = field?.key ?? fieldKey(label);
  const valid = Boolean(label.trim()) && (!NEEDS_OPTIONS(type) || optionList.length > 0);

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={field ? `Edit ${field.label}` : `New ${object.toLowerCase()} property`}
      submitLabel={field ? 'Save property' : 'Add property'}
      onSubmit={() => onSave({ ...(field ? { fieldId: field.id } : {}), object: (field?.object as CustomFieldObject) ?? object, label: label.trim(), type, options: optionList, helpText: helpText.trim(), required })}
      pending={pending}
      disabled={!valid}
    >
      <div className="flex flex-col gap-4">
        <Field label="Label" required hint={key ? `Stored as ${key} — fixed once the property exists, so every record and every import column keeps finding it.` : undefined} htmlFor="prop-label">
          <Input id="prop-label" autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Contract end date" maxLength={60} />
        </Field>
        <Field label="Type" hint={field ? 'The type can’t change once records hold values. Archive this and add a new one instead.' : undefined} htmlFor="prop-type">
          <Select id="prop-type" value={type} onChange={e => setType(e.target.value as CustomFieldType)} disabled={Boolean(field)}>
            {CUSTOM_FIELD_TYPES.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        {NEEDS_OPTIONS(type) && (
          <Field label="Options" required hint="One per line, in the order they should appear." htmlFor="prop-options">
            <Textarea id="prop-options" value={options} onChange={e => setOptions(e.target.value)} minRows={4} placeholder={'Spreadsheets\nHomegrown\nLegacy system\nA competitor'} />
          </Field>
        )}
        <Field label="Help text" hint="One line under the field, for whoever fills it in." htmlFor="prop-help">
          <Input id="prop-help" value={helpText} onChange={e => setHelpText(e.target.value)} maxLength={240} placeholder="Who else are they looking at?" />
        </Field>
        <SwitchRow label="Required" description="A record can’t be saved without it. Imports are exempt, so a partial spreadsheet still comes in." checked={required} onCheckedChange={setRequired} />
      </div>
    </FormDialog>
  );
}
