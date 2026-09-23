import { ArrowLeft, DotsThree, Eye, Lightning, Path, Pause, PencilSimple, Play, Trash, UserPlus } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { runSequences } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, EmptyState, FactRow, PageHeader, Skeleton } from '../../ui/Layout';
import { Input, Segmented, SwitchRow } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { MemberPicker } from '../../pickers/pickers';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CadenceTimeline } from './CadencePreview';
import { EnrollDialog } from './EnrollDialog';
import { EnrollmentsTable } from './EnrollmentsTable';
import { StepEditor } from './StepEditor';
import { clock, rate, sampleContext, SEQUENCE_STATUS_TONE, type SequenceSettings, type Step } from './model';
import { useSequence, useSequenceActions } from './queries';

type Tab = 'cadence' | 'people' | 'settings';

/**
 * One sequence: the cadence you edit, the people walking it, and the rules
 * that decide when a step may run and when someone comes off.
 *
 * Steps and settings are edited locally and saved in one go — a half-written
 * step should never reach the sender — so the header says plainly when there
 * is something unsaved.
 */
export function SequencePage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const { save, remove } = useSequenceActions();
  const { data, isPending, isError } = useSequence(id);
  const [tab, setTab] = useState<Tab>('cadence');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [settings, setSettings] = useState<SequenceSettings | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [enrolling, setEnrolling] = useState(false);
  const [running, setRunning] = useState(false);
  useDocumentTitle(data?.sequence.name ?? 'Sequence', ws.settings.organizationName);

  useEffect(() => {
    if (!data) return;
    setSteps(data.sequence.steps);
    setSettings(data.sequence.settings);
    setName(data.sequence.name);
  }, [data?.sequence.id, data?.sequence.createdAt]);

  const ctx = useMemo(() => sampleContext(ws.me, ws.settings.organizationName), [ws.me, ws.settings.organizationName]);

  const dirty = useMemo(() => {
    if (!data || !steps || !settings) return false;
    return JSON.stringify(steps) !== JSON.stringify(data.sequence.steps) || JSON.stringify(settings) !== JSON.stringify(data.sequence.settings);
  }, [data, steps, settings]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState icon={<Path size={22} weight="duotone" />} title="That sequence isn’t here" actions={<Button variant="primary" onClick={() => navigate('/outreach/sequences')}>Back to sequences</Button>}>
        It may have been deleted, or the link is out of date.
      </EmptyState>
    );
  }

  const sequence = data.sequence;
  const stats = data.stats;
  const canManage = data.canManage;
  const currentSteps = steps ?? sequence.steps;
  const currentSettings = settings ?? sequence.settings;
  const owner = ws.memberById(sequence.ownerId);

  const persist = async (patch: Partial<{ status: 'Active' | 'Paused' | 'Archived'; shared: boolean; ownerId: string | null; name: string; withSteps: boolean }>) => {
    await save.mutateAsync({
      id: sequence.id,
      name: (patch.name ?? name).trim() || sequence.name,
      description: sequence.description,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.shared === undefined ? {} : { shared: patch.shared }),
      ...(patch.ownerId === undefined ? {} : { ownerId: patch.ownerId }),
      ...(patch.withSteps ? { steps: currentSteps, settings: currentSettings } : {}),
    });
  };

  const saveChanges = async () => {
    await persist({ withSteps: true });
    toast.success('Sequence saved');
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await runSequences({});
      toast.success(
        result.considered === 0
          ? 'Nothing was due — the next step runs at its scheduled time'
          : `${result.sent + result.notSent} email${result.sent + result.notSent === 1 ? '' : 's'} and ${result.tasks} task${result.tasks === 1 ? '' : 's'} from ${result.considered} due step${result.considered === 1 ? '' : 's'}`,
      );
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t run the due steps'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <Link to="/outreach/sequences" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft size={13} /> Sequences
          </Link>
        }
        title={
          renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== sequence.name) void persist({ name });
                setRenaming(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(sequence.name);
                  setRenaming(false);
                }
              }}
              className="h-11 max-w-[560px] font-display text-display"
            />
          ) : (
            <button type="button" disabled={!canManage} onClick={() => setRenaming(true)} className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent">
              {sequence.name}
            </button>
          )
        }
        description={
          <span className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge tone={SEQUENCE_STATUS_TONE[sequence.status] ?? 'neutral'} dot={sequence.status === 'Active'}>
                {sequence.status}
              </Badge>
              <span>
                {currentSteps.length} {currentSteps.length === 1 ? 'step' : 'steps'} over {cumulative(currentSteps)} days
              </span>
              <span className="text-ink-3">·</span>
              <span>{stats.active + stats.paused} on it now</span>
            </span>
            {sequence.description && <span className="text-ink-2">{sequence.description}</span>}
          </span>
        }
        actions={
          <>
            {dirty && canManage && (
              <Button variant="primary" size="sm" loading={save.isPending} onClick={() => void saveChanges()}>
                Save changes
              </Button>
            )}
            {!dirty && canManage && (
              <Button variant="primary" size="sm" leading={<UserPlus size={16} />} onClick={() => setEnrolling(true)}>
                Enroll contacts
              </Button>
            )}
            {canManage && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm" icon aria-label="Sequence actions">
                    <DotsThree size={18} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  {sequence.status === 'Active' ? (
                    <MenuItem icon={<Pause size={16} />} onSelect={() => void persist({ status: 'Paused' })}>
                      Pause sending
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Play size={16} />} onSelect={() => void persist({ status: 'Active' })}>
                      Start sending
                    </MenuItem>
                  )}
                  <MenuItem icon={<PencilSimple size={16} />} onSelect={() => setRenaming(true)}>
                    Rename
                  </MenuItem>
                  {ws.can('outreach.manage') && (
                    <MenuItem icon={<Lightning size={16} />} disabled={running} onSelect={() => void runNow()}>
                      Run due steps now
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  {sequence.status !== 'Archived' && <MenuItem onSelect={() => void persist({ status: 'Archived' })}>Archive</MenuItem>}
                  <MenuItem
                    destructive
                    icon={<Trash size={16} />}
                    onSelect={async () => {
                      const ok = await actions.confirm({
                        title: `Delete “${sequence.name}”?`,
                        description: `Its ${stats.total} enrollment${stats.total === 1 ? '' : 's'} go too. The emails already sent and the tasks already created stay on their contacts.`,
                        confirmLabel: 'Delete',
                        destructive: true,
                      });
                      if (!ok) return;
                      remove.mutate([sequence.id], { onSuccess: () => navigate('/outreach/sequences') });
                    }}
                  >
                    Delete sequence
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </>
        }
        tabs={
          <Tabs
            items={[
              { value: 'cadence', label: 'Cadence', count: currentSteps.length },
              { value: 'people', label: 'People', count: stats.total },
              { value: 'settings', label: 'Settings' },
            ]}
            value={tab}
            onChange={v => setTab(v as Tab)}
          />
        }
      />

      {tab === 'people' ? (
        <EnrollmentsTable sequenceId={sequence.id} canManage={canManage} onEnroll={() => setEnrolling(true)} />
      ) : (
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            {tab === 'cadence' ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Segmented
                    size="sm"
                    value={mode}
                    onChange={v => setMode(v)}
                    options={[
                      { value: 'edit', label: 'Edit', icon: <PencilSimple size={14} /> },
                      { value: 'preview', label: 'Preview', icon: <Eye size={14} /> },
                    ]}
                  />
                  <span className="text-meta text-ink-3">
                    {mode === 'edit'
                      ? `${currentSteps.length} steps over ${currentSteps.length ? cumulative(currentSteps) : 0} days`
                      : `As ${ctx['contact.name']} at ${ctx['company.name']} would read it`}
                  </span>
                  {dirty && <span className="text-meta text-warning">Unsaved changes</span>}
                </div>
                {mode === 'edit' ? (
                  currentSteps.length === 0 ? (
                    <EmptyState
                      compact
                      icon={<Path size={22} weight="duotone" />}
                      title="No steps yet"
                      actions={canManage ? <Button variant="primary" onClick={() => setSteps([{ id: 's1', kind: 'auto_email', delayDays: 0, subject: '', body: 'Hi {{contact.first_name | there}},\n\n', note: '' }])}>Add the first step</Button> : undefined}
                    >
                      A sequence is a run of emails, calls and reminders spread over days. Add the first one and it goes out the moment someone is enrolled.
                    </EmptyState>
                  ) : (
                    <StepEditor steps={currentSteps} onChange={setSteps} readOnly={!canManage} />
                  )
                ) : (
                  <Card padded>
                    <CadenceTimeline steps={currentSteps} ctx={ctx} />
                  </Card>
                )}
              </>
            ) : (
              <SequenceSettingsPanel settings={currentSettings} onChange={setSettings} readOnly={!canManage} timezone={data.timezone} />
            )}
          </div>

          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[320px]">
            <Card className="p-4">
              <h2 className="mb-3 text-micro font-semibold uppercase text-ink-3">At a glance</h2>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Figure label="On it now" value={stats.active + stats.paused} hint={stats.paused ? `${stats.paused} paused` : 'Working through it'} />
                <Figure label="Finished" value={stats.finished} hint="Reached the last step" />
                <Figure label="Replied" value={`${rate(stats.replied, stats.total)}%`} hint={`${stats.replied} of ${stats.total}`} />
                <Figure label="Meetings" value={`${rate(stats.meetings, stats.total)}%`} hint={`${stats.meetings} booked`} />
              </div>
              <div className="border-t border-line pt-3">
                <FactRow label="Owner">
                  <MemberPicker
                    value={sequence.ownerId}
                    onChange={ownerId => void persist({ ownerId })}
                    includeUnassigned={false}
                    trigger={
                      <button type="button" disabled={!canManage} className="flex items-center gap-1.5 rounded-sm px-1 py-1 text-ui hover:bg-hover disabled:hover:bg-transparent">
                        {owner ? <Avatar person={owner} size="xs" /> : null}
                        <span className="truncate">{owner?.name ?? 'Unassigned'}</span>
                      </button>
                    }
                  />
                </FactRow>
                <FactRow label="Status">
                  <Badge tone={SEQUENCE_STATUS_TONE[sequence.status] ?? 'neutral'} dot={sequence.status === 'Active'}>
                    {sequence.status}
                  </Badge>
                </FactRow>
                <FactRow label="Shared">
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => void persist({ shared: !sequence.shared })}
                    className="rounded-sm px-1 py-0.5 text-ui text-ink hover:bg-hover disabled:hover:bg-transparent"
                  >
                    {sequence.shared ? 'The whole team' : 'Just the owner'}
                  </button>
                </FactRow>
                <FactRow label="Emails sent">
                  <span className="tabular text-ui text-ink">{stats.emailsSent.toLocaleString('en-US')}</span>
                </FactRow>
                <FactRow label="Open tasks">
                  <span className="tabular text-ui text-ink">{stats.openTasks.toLocaleString('en-US')}</span>
                </FactRow>
              </div>
              {sequence.status !== 'Active' && (
                <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-meta text-warning">
                  Nothing sends while this is {sequence.status.toLowerCase()}. People can still be enrolled and will pick up where they left off.
                </p>
              )}
            </Card>
          </aside>
        </div>
      )}

      {enrolling && <EnrollDialog open onOpenChange={setEnrolling} sequenceId={sequence.id} />}
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div>
      <div className="text-micro font-semibold uppercase text-ink-3">{label}</div>
      <div className="tabular font-display text-[24px] leading-8 text-ink">{value}</div>
      <div className="text-meta text-ink-3">{hint}</div>
    </div>
  );
}

function cumulative(steps: Step[]) {
  return steps.reduce((total, step, i) => total + (i === 0 ? 0 : step.delayDays), 0);
}

/** When a step may run, and what takes somebody off the sequence. */
function SequenceSettingsPanel({ settings, onChange, readOnly, timezone }: { settings: SequenceSettings; onChange: (next: SequenceSettings) => void; readOnly?: boolean; timezone: string }) {
  const set = (patch: Partial<SequenceSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <Card padded>
        <h2 className="text-title font-semibold text-ink">When steps run</h2>
        <p className="mt-1 text-body text-ink-2">Times are {timezone.replace(/_/g, ' ')}, the organization’s timezone.</p>
        <div className="mt-4 flex flex-col divide-y divide-line">
          <div className="pb-1">
            <SwitchRow label="Weekdays only" description="Nothing goes out on a Saturday or a Sunday — it waits for Monday." checked={settings.weekdaysOnly} onCheckedChange={v => set({ weekdaysOnly: v })} disabled={readOnly} />
          </div>
          <div className="flex flex-wrap items-end gap-4 pt-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="window-start" className="text-ui font-medium text-ink">
                Send between
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="window-start"
                  type="time"
                  disabled={readOnly}
                  value={settings.sendWindow.start}
                  onChange={e => set({ sendWindow: { ...settings.sendWindow, start: e.target.value || '08:00' } })}
                  className="w-[124px]"
                />
                <span className="text-ui text-ink-2">and</span>
                <Input
                  type="time"
                  aria-label="Send window ends"
                  disabled={readOnly}
                  value={settings.sendWindow.end}
                  onChange={e => set({ sendWindow: { ...settings.sendWindow, end: e.target.value || '17:00' } })}
                  className="w-[124px]"
                />
              </div>
            </div>
            <p className="flex-1 pb-2 text-meta text-ink-3">
              A step due outside the window waits for {clock(settings.sendWindow.start)} on the next allowed day.
            </p>
          </div>
        </div>
      </Card>

      <Card padded>
        <h2 className="text-title font-semibold text-ink">When someone comes off</h2>
        <p className="mt-1 text-body text-ink-2">Nobody should get step four after they’ve already answered step two.</p>
        <div className={cn('mt-3 flex flex-col divide-y divide-line')}>
          <SwitchRow label="They reply" description="An inbound email on their timeline ends the sequence." checked={settings.exitOnReply} onCheckedChange={v => set({ exitOnReply: v })} disabled={readOnly} />
          <SwitchRow label="They book a meeting" description="A meeting logged against the contact ends it." checked={settings.exitOnMeeting} onCheckedChange={v => set({ exitOnMeeting: v })} disabled={readOnly} />
          <SwitchRow label="A deal is created" description="Useful for cold outbound — once it’s a deal, a rep takes over." checked={settings.exitOnDeal} onCheckedChange={v => set({ exitOnDeal: v })} disabled={readOnly} />
        </div>
        <p className="mt-4 text-meta text-ink-3">Unsubscribing always ends a sequence, whatever these say.</p>
      </Card>
    </div>
  );
}
