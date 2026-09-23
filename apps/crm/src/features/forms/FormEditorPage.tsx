import { ArrowLeft, ArrowSquareOut, Check, Copy, DotsThree, Note, Pause, Play, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, EmptyState, PageHeader, Section, Skeleton } from '../../ui/Layout';
import { Field, FieldRow, Input, Switch, Textarea } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { FieldButton, MemberPicker, OptionsPicker, TagRow } from '../../pickers/pickers';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { percent, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { slugify } from '@project/shared/tokens';
import { FormFieldBuilder } from './FormFieldBuilder';
import { FormPreview } from './FormPreview';
import { FormSubmissions } from './FormSubmissions';
import { embedSnippet, publicUrl, useForm, useFormActions, type FormField } from './formData';

type Draft = {
  name: string;
  slug: string;
  intro: string;
  submitLabel: string;
  successMessage: string;
  redirectUrl: string;
  assignment: 'Round Robin' | 'Member' | 'Unassigned';
  assigneeId: string | null;
  source: string;
  notifyIds: string[];
  sequenceId: string | null;
  tagIds: string[];
  fields: FormField[];
};

/**
 * The form editor: settings on the left, the buyer's view on the right, so a
 * change to a label is visible before it is saved. Saving is explicit — a form
 * is public, and nobody should publish a half-finished question by accident.
 */
export function FormEditorPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const { save, remove } = useFormActions();
  const { data, isPending, isError } = useForm(id);
  const [tab, setTab] = useState<'build' | 'submissions'>('build');
  const [draft, setDraft] = useState<Draft | null>(null);
  useDocumentTitle(data?.form.name ?? 'Form', ws.settings.organizationName);

  useEffect(() => {
    if (!data) return;
    const f = data.form;
    setDraft({
      name: f.name,
      slug: f.slug,
      intro: f.intro ?? '',
      submitLabel: f.submitLabel,
      successMessage: f.successMessage,
      redirectUrl: f.redirectUrl ?? '',
      assignment: f.assignment,
      assigneeId: f.assigneeId,
      source: f.source,
      notifyIds: f.notifyIds,
      sequenceId: f.sequenceId,
      tagIds: f.tagIds,
      fields: f.fields,
    });
  }, [data?.form.id, data?.form.fields.length, data?.form.name]);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const f = data.form;
    return JSON.stringify({ ...draft, intro: draft.intro || null, redirectUrl: draft.redirectUrl || null }) !== JSON.stringify({ name: f.name, slug: f.slug, intro: f.intro, submitLabel: f.submitLabel, successMessage: f.successMessage, redirectUrl: f.redirectUrl, assignment: f.assignment, assigneeId: f.assigneeId, source: f.source, notifyIds: f.notifyIds, sequenceId: f.sequenceId, tagIds: f.tagIds, fields: f.fields });
  }, [data, draft]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data || !draft) {
    return (
      <EmptyState
        icon={<Note size={22} weight="duotone" />}
        title="That form isn’t here"
        actions={
          <Button variant="primary" onClick={() => navigate('/outreach/forms')}>
            Back to forms
          </Button>
        }
      >
        It may have been deleted, or the link is out of date.
      </EmptyState>
    );
  }

  const form = data.form;
  const pagesUrl = data.pagesUrl;
  const live = publicUrl(pagesUrl, form.slug);
  const canManage = ws.can('outreach.send');
  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));

  const submit = () =>
    save.mutate({
      id: form.id,
      name: draft.name.trim(),
      slug: draft.slug.trim() || undefined,
      intro: draft.intro.trim() || null,
      fields: draft.fields,
      status: form.status,
      submitLabel: draft.submitLabel.trim() || undefined,
      successMessage: draft.successMessage.trim() || undefined,
      redirectUrl: draft.redirectUrl.trim() || null,
      assignment: draft.assignment,
      assigneeId: draft.assigneeId,
      source: draft.source.trim() || undefined,
      notifyIds: draft.notifyIds,
      sequenceId: draft.sequenceId,
      tagIds: draft.tagIds,
    });

  const togglePaused = () =>
    save.mutate({
      id: form.id,
      name: form.name,
      slug: form.slug,
      status: form.status === 'Live' ? 'Paused' : 'Live',
      intro: form.intro,
      fields: form.fields,
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      redirectUrl: form.redirectUrl,
      assignment: form.assignment,
      assigneeId: form.assigneeId,
      source: form.source,
      notifyIds: form.notifyIds,
      sequenceId: form.sequenceId,
      tagIds: form.tagIds,
    });

  const assignee = ws.memberById(draft.assigneeId);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <Link to="/outreach/forms" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft size={13} /> Forms
          </Link>
        }
        title={form.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={form.status === 'Live' ? 'success' : 'neutral'} dot>
              {form.status}
            </Badge>
            <span className="text-ink-3">/f/{form.slug}</span>
            <span>
              {form.submissions.toLocaleString('en-US')} {form.submissions === 1 ? 'submission' : 'submissions'}
              {form.submissions > 0 && <span className="text-ink-3"> · {percent(form.conversion)} became leads</span>}
            </span>
            {form.lastSubmissionAt && <span className="text-ink-3">Last one {timeAgo(form.lastSubmissionAt)}</span>}
          </span>
        }
        actions={
          <>
            {form.newLeads > 0 && (
              <Button variant="secondary" size="sm" onClick={() => navigate(`/leads?form=${form.id}`)}>
                {form.newLeads} {form.newLeads === 1 ? 'lead' : 'leads'}
              </Button>
            )}
            {live && (
              <Button variant="secondary" size="sm" leading={<ArrowSquareOut size={15} />} onClick={() => window.open(live, '_blank', 'noopener')}>
                View
              </Button>
            )}
            {canManage && (
              <>
                {/* A disabled primary button reading "Saved" looks broken. When there
                    is nothing to save, say so quietly and keep the accent for work. */}
                {dirty || save.isPending ? (
                  <Button variant="primary" size="sm" onClick={submit} loading={save.isPending}>
                    Save changes
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-1 text-meta text-ink-3">
                    <Check size={14} /> Saved
                  </span>
                )}
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="secondary" size="sm" icon aria-label="Form actions">
                      <DotsThree size={18} weight="bold" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem icon={form.status === 'Live' ? <Pause size={16} /> : <Play size={16} />} onSelect={togglePaused}>
                      {form.status === 'Live' ? 'Pause the form' : 'Make it live'}
                    </MenuItem>
                    <MenuItem icon={<Copy size={16} />} onSelect={() => copyText(embedSnippet(pagesUrl, form.slug), 'Embed code copied')}>
                      Copy embed code
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      destructive
                      icon={<Trash size={16} />}
                      onSelect={async () => {
                        const ok = await appActions.confirm({
                          title: `Delete “${form.name}”?`,
                          description: `Its ${form.submissions} ${form.submissions === 1 ? 'submission record goes' : 'submission records go'} too. The leads and contacts it made stay exactly where they are.`,
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (!ok) return;
                        remove.mutate(form.id, { onSuccess: () => navigate('/outreach/forms') });
                      }}
                    >
                      Delete form
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </>
            )}
          </>
        }
        tabs={
          <Tabs
            value={tab}
            onChange={v => setTab(v as 'build' | 'submissions')}
            items={[
              { value: 'build', label: 'Build' },
              { value: 'submissions', label: 'Submissions', count: form.submissions },
            ]}
          />
        }
      />

      {tab === 'submissions' ? (
        <FormSubmissions formId={form.id} />
      ) : (
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-7">
            <Section title="The page">
              <div className="flex flex-col gap-4">
                <FieldRow>
                  <Field label="Name" hint="Only your team sees this.">
                    <Input value={draft.name} disabled={!canManage} onChange={e => set({ name: e.target.value })} />
                  </Field>
                  <Field label="Web address" hint={`Lives at /f/${draft.slug || 'your-form'}`}>
                    <Input value={draft.slug} disabled={!canManage} onChange={e => set({ slug: e.target.value })} onBlur={e => set({ slug: slugify(e.target.value) })} />
                  </Field>
                </FieldRow>
                <Field label="Intro" hint="A sentence above the fields.">
                  <Textarea value={draft.intro} disabled={!canManage} onChange={e => set({ intro: e.target.value })} minRows={2} />
                </Field>
                <FieldRow>
                  <Field label="Button">
                    <Input value={draft.submitLabel} disabled={!canManage} onChange={e => set({ submitLabel: e.target.value })} placeholder="Send" />
                  </Field>
                  <Field label="Redirect after sending" hint="Leave empty to show the message below.">
                    <Input value={draft.redirectUrl} disabled={!canManage} onChange={e => set({ redirectUrl: e.target.value })} placeholder="https://yoursite.com/thanks" />
                  </Field>
                </FieldRow>
                <Field label="Success message">
                  <Textarea value={draft.successMessage} disabled={!canManage} onChange={e => set({ successMessage: e.target.value })} minRows={2} />
                </Field>
              </div>
            </Section>

            <Section title="Fields" count={draft.fields.length} description="Use the arrows to reorder">
              <FormFieldBuilder fields={draft.fields} onChange={fields => set({ fields })} disabled={!canManage} />
            </Section>

            <Section title="What happens next">
              <div className="flex flex-col gap-4">
                <Field label="Assign new leads to">
                  <div className="flex flex-wrap items-center gap-2">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="secondary" size="md" disabled={!canManage}>
                          {draft.assignment === 'Round Robin' ? 'Round robin' : draft.assignment === 'Member' ? 'One teammate' : 'Nobody — triage them'}
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuLabel>Assignment</MenuLabel>
                        <MenuRadioGroup value={draft.assignment} onValueChange={v => set({ assignment: v as Draft['assignment'], assigneeId: v === 'Member' ? draft.assigneeId ?? ws.me.id : null })}>
                          <MenuRadioItem value="Round Robin">Round robin</MenuRadioItem>
                          <MenuRadioItem value="Member">One teammate</MenuRadioItem>
                          <MenuRadioItem value="Unassigned">Nobody — triage them</MenuRadioItem>
                        </MenuRadioGroup>
                      </MenuContent>
                    </Menu>
                    {draft.assignment === 'Member' && (
                      <MemberPicker
                        value={draft.assigneeId}
                        includeUnassigned={false}
                        onChange={assigneeId => set({ assigneeId })}
                        trigger={<FieldButton className="w-auto min-w-[180px]" icon={assignee ? <Avatar person={assignee} size="xs" /> : <Unassigned size="xs" />}>{assignee?.name ?? 'Choose a teammate'}</FieldButton>}
                      />
                    )}
                  </div>
                  {draft.assignment === 'Round Robin' && ws.settings.leadRouting.memberIds.length === 0 && (
                    <p className="mt-1.5 text-meta text-warning">Nobody is in the round robin yet, so new leads arrive unassigned. An admin sets the rotation in Settings → Routing.</p>
                  )}
                </Field>

                <Field label="Tell these teammates" hint="They get an inbox notification for every submission.">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {draft.notifyIds.map(memberId => {
                      const member = ws.memberById(memberId);
                      return (
                        <span key={memberId} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-card pl-1.5 pr-1 text-meta text-ink">
                          <Avatar person={member} size="xs" />
                          {member?.name ?? 'Someone'}
                          {canManage && (
                            <button type="button" aria-label={`Stop telling ${member?.name ?? 'them'}`} onClick={() => set({ notifyIds: draft.notifyIds.filter(x => x !== memberId) })} className="flex h-5 w-5 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink">
                              ×
                            </button>
                          )}
                        </span>
                      );
                    })}
                    {canManage && (
                      <MemberPicker
                        value={null}
                        includeUnassigned={false}
                        onChange={memberId => memberId && !draft.notifyIds.includes(memberId) && set({ notifyIds: [...draft.notifyIds, memberId] })}
                        trigger={
                          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-meta text-ink-3 hover:bg-hover hover:text-ink">
                            + Teammate
                          </button>
                        }
                      />
                    )}
                    {!draft.notifyIds.length && !canManage && <span className="text-ui text-ink-3">Nobody</span>}
                  </div>
                </Field>

                <FieldRow>
                  <Field label="Source on the lead" hint="What the leads report will call these.">
                    <OptionsPicker
                      options={ws.choicesFor('Lead Source').map(c => c.label)}
                      value={draft.source}
                      allowEmpty={false}
                      onChange={value => value && set({ source: value })}
                      trigger={<FieldButton>{draft.source}</FieldButton>}
                    />
                  </Field>
                  <Field label="Auto-enroll in a sequence" hint="Runs when the sender is already a contact.">
                    {data.sequences.length === 0 ? (
                      <p className="flex h-9 items-center text-ui text-ink-3">No sequences yet</p>
                    ) : (
                      <OptionsPicker
                        options={data.sequences.map(s => s.name)}
                        value={data.sequences.find(s => s.id === draft.sequenceId)?.name ?? null}
                        allowEmpty
                        placeholder="Don’t enroll"
                        onChange={value => set({ sequenceId: data.sequences.find(s => s.name === value)?.id ?? null })}
                        trigger={<FieldButton placeholder={!draft.sequenceId}>{data.sequences.find(s => s.id === draft.sequenceId)?.name ?? 'Don’t enroll'}</FieldButton>}
                      />
                    )}
                  </Field>
                </FieldRow>

                <Field label="Tag every lead">
                  <TagRow tagIds={draft.tagIds} onChange={canManage ? tagIds => set({ tagIds }) : undefined} />
                </Field>
              </div>
            </Section>

            <Section title="Put it on your site">
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui text-ink-2">Link</span>
                  <code className={cn('min-w-0 flex-1 truncate rounded-sm bg-sunken px-2 py-1 text-meta', live ? 'text-ink' : 'text-ink-3')}>{live || 'Open the public app once and its address is remembered here.'}</code>
                  <Button variant="secondary" size="sm" leading={<Copy size={14} />} disabled={!live} onClick={() => copyText(live, 'Link copied')}>
                    Copy
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-ui text-ink-2">Embed</span>
                  <pre className="overflow-x-auto rounded-md bg-sunken px-3 py-2.5 text-meta leading-5 text-ink">{embedSnippet(pagesUrl, draft.slug || form.slug)}</pre>
                  <Button variant="secondary" size="sm" leading={<Copy size={14} />} className="self-start" onClick={() => copyText(embedSnippet(pagesUrl, draft.slug || form.slug), 'Embed code copied')}>
                    Copy embed code
                  </Button>
                </div>
              </Card>
            </Section>

            {data.recent.length > 0 && (
              <Section title="Latest submissions" action={<Button variant="ghost" size="xs" onClick={() => setTab('submissions')}>See all</Button>}>
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
                  {data.recent.map(s => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-ui text-ink">{s.name ?? s.email ?? 'Anonymous'}</span>
                      <Badge tone={s.outcome === 'New Lead' ? 'accent' : s.outcome === 'Spam' ? 'neutral' : 'info'}>{s.outcome}</Badge>
                      <span className="shrink-0 text-meta text-ink-3">{s.submittedAt ? timeAgo(s.submittedAt) : ''}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[420px]">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-micro font-semibold uppercase text-ink-3">What they see</h2>
              {canManage && (
                <label className="ml-auto flex items-center gap-2 text-meta text-ink-3">
                  Live
                  <Switch checked={form.status === 'Live'} onCheckedChange={togglePaused} />
                </label>
              )}
            </div>
            <FormPreview name={draft.name} intro={draft.intro.trim() || null} fields={draft.fields} submitLabel={draft.submitLabel} slug={draft.slug || form.slug} />
          </aside>
        </div>
      )}
    </div>
  );
}
