import { useMutation } from '@tanstack/react-query';
import { Check, Minus, UserPlus } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { deactivateMember, saveMember, updateOrgSettings } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Select } from '../../ui/Form';
import { MenuItem, MenuLabel, MenuSeparator } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { CAPABILITIES, ROLE_DESCRIPTIONS, can, type Capability } from '@project/shared/roles';
import { ROLES, type Role } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { plural, timeAgo } from '../../lib/format';
import { useAppActions } from '../../lib/app-actions';
import { useInvalidateWorkspace, useWorkspace, type Member } from '../../lib/workspace';
import { Explainer, Group, Row, RowList, RowMenu, SectionHead, SettingRow } from './kit';

/**
 * The roster.
 *
 * An invite is a teammate with the status Invited: there is no pending-invite
 * limbo to chase, they simply become Active the first time they sign in with
 * that address. And nobody is ever deleted — their name is on work that
 * happened.
 */

const CAPABILITY_WORDS: Record<Capability, string> = {
  'records.edit': 'Create and edit records',
  'records.delete': 'Delete anyone’s records',
  'outreach.send': 'Send email and enroll sequences',
  'outreach.manage': 'Change shared templates, sequences and forms',
  'quotes.manage': 'Build and send quotes',
  'products.manage': 'Change the price book',
  'reports.view': 'See reports',
  'quotas.manage': 'Set quotas',
  'data.import': 'Import data',
  'data.export': 'Export data',
  'settings.manage': 'Change settings',
  'members.manage': 'Manage teammates',
};

export function TeammatesSection() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const { confirm } = useAppActions();
  const [dialog, setDialog] = useState<{ member: Member | null } | null>(null);

  const active = ws.members.filter(m => m.status !== 'Deactivated');
  const deactivated = ws.members.filter(m => m.status === 'Deactivated');

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveMember>[0]) => saveMember(input),
    onSuccess: result => {
      void invalidate();
      toast.success(result.invited ? `${result.name} has been invited` : 'Teammate saved');
      setDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that teammate')),
  });

  const setActive = useMutation({
    mutationFn: (vars: { memberId: string; active: boolean }) => deactivateMember(vars),
    onSuccess: result => {
      void invalidate();
      if (result.status === 'Deactivated') {
        toast.success(result.openRecords ? `Access turned off — ${result.openRecords} open ${result.openRecords === 1 ? 'record is' : 'records are'} still theirs` : 'Access turned off');
      } else toast.success('Access turned back on');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t change that teammate')),
  });

  const defaultRole = useMutation({
    mutationFn: (role: Role) => updateOrgSettings({ defaultRole: role }),
    onSuccess: () => {
      void invalidate();
      toast.success('Default role saved');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save the default role')),
  });

  const onDeactivate = async (member: Member) => {
    const ok = await confirm({
      title: `Turn off ${member.name}’s access?`,
      description: 'They stop being able to sign in and drop out of every owner picker. Their name stays on the deals, calls and notes they worked — nothing is deleted, and you can turn this back on.',
      confirmLabel: 'Turn off access',
      destructive: true,
    });
    if (ok) setActive.mutate({ memberId: member.id, active: false });
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Teammates"
        description="Who is on the team, what each of them can do, and who gets the next new lead."
        actions={
          <Button variant="primary" leading={<UserPlus size={16} />} onClick={() => setDialog({ member: null })}>
            Invite teammate
          </Button>
        }
      />

      {/* A bare "1" beside the heading says nothing on a one-person team. */}
      <Group title="On the team" action={<span className="tabular text-ui text-ink-3">{plural(active.length, 'teammate')}</span>}>
        <RowList>
          {active.map(member => (
            <MemberRow key={member.id} member={member} onEdit={() => setDialog({ member })} onDeactivate={() => onDeactivate(member)} />
          ))}
        </RowList>
      </Group>

      {deactivated.length > 0 && (
        <Group title="No longer working here" note="Kept so their name still reads correctly on old deals, calls and notes." action={<span className="tabular text-ui text-ink-3">{plural(deactivated.length, 'person', 'people')}</span>}>
          <RowList>
            {deactivated.map(member => (
              <Row key={member.id}>
                <Avatar person={member} size="md" className="opacity-60" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui text-ink-2">{member.name}</div>
                  <div className="truncate text-meta text-ink-3">{member.email}</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setActive.mutate({ memberId: member.id, active: true })} loading={setActive.isPending}>
                  Reactivate
                </Button>
              </Row>
            ))}
          </RowList>
        </Group>
      )}

      <Group title="What each role can do" note="The server enforces this list; the app only uses it to hide what would be refused.">
        <CapabilityMatrix />
      </Group>

      <Group title="New teammates">
        <SettingRow label="Default role" hint="What someone gets the first time they open the app. The very first person is always an Admin." htmlFor="default-role">
          <Select id="default-role" value={ws.settings.defaultRole} onChange={e => defaultRole.mutate(e.target.value as Role)} disabled={defaultRole.isPending} className="max-w-[220px]">
            {ROLES.filter(r => r !== 'Admin').map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </SettingRow>
        <Explainer summary="Why can’t I delete a teammate?">
          <p>Every deal, call, note and quote in the CRM carries the id of the person who did it. Delete the person and all of that turns into “Someone” — the history stops being true, and a report by rep stops adding up.</p>
          <p>Turning access off does the thing you actually wanted: they can’t sign in, they disappear from every picker and from the round robin, and their work stays attributed.</p>
        </Explainer>
      </Group>

      {dialog && <MemberDialog member={dialog.member} onClose={() => setDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
    </div>
  );
}

function MemberRow({ member, onEdit, onDeactivate }: { member: Member; onEdit: () => void; onDeactivate: () => void }) {
  const ws = useWorkspace();
  const team = ws.teams.find(t => t.id === member.teamId);
  return (
    <Row>
      <Avatar person={member} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ui font-medium text-ink">{member.name}</span>
          {member.id === ws.me.id && <span className="shrink-0 text-meta text-ink-3">You</span>}
          {member.status === 'Invited' && <Badge tone="info">Invited</Badge>}
        </div>
        <div className="truncate text-meta text-ink-3">
          {member.email}
          {member.title ? ` · ${member.title}` : ''}
          {team ? ` · ${team.name}` : ''}
        </div>
      </div>
      <div className="hidden w-[100px] shrink-0 text-meta text-ink-3 sm:block">{member.lastSeenAt ? timeAgo(member.lastSeenAt) : member.status === 'Invited' ? 'Not yet' : '—'}</div>
      <Badge tone={member.role === 'Admin' ? 'accent' : 'neutral'} className="shrink-0">
        {member.role}
      </Badge>
      <RowMenu label={`Actions for ${member.name}`}>
        <MenuItem onSelect={onEdit}>Edit teammate</MenuItem>
        <MenuSeparator />
        <MenuLabel>Access</MenuLabel>
        <MenuItem destructive disabled={member.id === ws.me.id} onSelect={onDeactivate}>
          Turn off access
        </MenuItem>
      </RowMenu>
    </Row>
  );
}

/**
 * Four roles against twelve capabilities. At 390px the whole grid can't fit, so
 * the capability column is pinned and the roles scroll under it — without that,
 * Rep and Viewer fall off the edge with nothing to say they are there.
 */
function CapabilityMatrix() {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card shadow-hairline">
      <table className="w-full min-w-[440px] border-collapse">
        <thead>
          <tr className="bg-sunken">
            <th className="sticky left-0 z-10 bg-sunken px-4 py-2 text-left text-micro font-semibold uppercase text-ink-3">Can</th>
            {ROLES.map(role => (
              <th key={role} className="w-[68px] px-2 py-2 text-center text-micro font-semibold uppercase text-ink-3">
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map(capability => (
            <tr key={capability} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-ui font-normal text-ink">
                {CAPABILITY_WORDS[capability]}
              </th>
              {ROLES.map(role => (
                <td key={role} className="px-2 py-2 text-center">
                  {can(role, capability) ? (
                    <Check size={15} weight="bold" className="mx-auto text-success" aria-label="Yes" />
                  ) : (
                    <Minus size={15} className="mx-auto text-ink-3" aria-label="No" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberDialog({ member, onClose, onSave, pending }: { member: Member | null; onClose: () => void; onSave: (input: Parameters<typeof saveMember>[0]) => void; pending: boolean }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState(member?.email ?? '');
  const [name, setName] = useState(member?.name ?? '');
  const [title, setTitle] = useState(member?.title ?? '');
  const [role, setRole] = useState<Role>((member?.role as Role) ?? ws.settings.defaultRole);
  const [teamId, setTeamId] = useState(member?.teamId ?? '');

  const submit = () => {
    if (member) onSave({ memberId: member.id, name: name.trim(), title: title.trim(), role, teamId: teamId || null });
    else onSave({ email: email.trim(), name: name.trim() || undefined, title: title.trim() || undefined, role, teamId: teamId || null });
  };

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={member ? `Edit ${member.name}` : 'Invite a teammate'}
      description={member ? undefined : 'They join the moment they sign in with this address — there’s nothing for them to accept.'}
      submitLabel={member ? 'Save' : 'Send invite'}
      onSubmit={submit}
      pending={pending}
      disabled={!member && !email.trim()}
    >
      <div className="flex flex-col gap-4">
        {!member && (
          <Field label="Email address" required htmlFor="invite-email">
            <Input id="invite-email" autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@yourcompany.com" />
          </Field>
        )}
        <Field label="Name" hint={member ? undefined : 'Optional — we’ll work it out from the address if you leave it blank.'} htmlFor="invite-name">
          <Input id="invite-name" autoFocus={Boolean(member)} value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Job title" htmlFor="invite-title">
          <Input id="invite-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Account Executive" maxLength={120} />
        </Field>
        <Field label="Role" hint={ROLE_DESCRIPTIONS[role]} htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={e => setRole(e.target.value as Role)}>
            {ROLES.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" hint="Teams roll up in reports and quotas." htmlFor="invite-team">
          <Select id="invite-team" value={teamId} onChange={e => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {ws.teams.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {member?.id === ws.me.id && role !== 'Admin' && <p className={cn('text-meta text-warning')}>Changing your own role to {role} takes away your access to these settings.</p>}
      </div>
    </FormDialog>
  );
}
