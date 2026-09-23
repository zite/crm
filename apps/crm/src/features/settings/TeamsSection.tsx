import { useMutation } from '@tanstack/react-query';
import { Plus, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { deleteTeam, saveTeam } from 'zitejs/api';
import { Avatar, AvatarStack } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { EmptyState } from '../../ui/Layout';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { errorMessage } from '../../lib/errors';
import { useAppActions } from '../../lib/app-actions';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { Group, Row, RowList, RowMenu, SectionHead } from './kit';

type Team = ReturnType<typeof useWorkspace>['teams'][number];

/** Teams: the grouping reports and quotas roll up through. */
export function TeamsSection() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const { confirm } = useAppActions();
  const [dialog, setDialog] = useState<{ team: Team | null } | null>(null);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveTeam>[0]) => saveTeam(input),
    onSuccess: result => {
      void invalidate();
      toast.success(result.created ? 'Team created' : 'Team saved');
      setDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that team')),
  });

  const remove = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ teamId }),
    onSuccess: result => {
      void invalidate();
      toast.success(result.membersFreed ? `Team deleted — ${result.membersFreed} ${result.membersFreed === 1 ? 'teammate is' : 'teammates are'} now on no team` : 'Team deleted');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that team')),
  });

  const onDelete = async (team: Team) => {
    const members = ws.members.filter(m => m.teamId === team.id);
    const ok = await confirm({
      title: `Delete the ${team.name} team?`,
      description: members.length ? `${members.length} ${members.length === 1 ? 'teammate' : 'teammates'} will end up on no team. Nothing they own changes.` : 'Nobody is on it, so nothing else changes.',
      confirmLabel: 'Delete team',
      destructive: true,
    });
    if (ok) remove.mutate(team.id);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Teams"
        description="Group your teammates so the team report, quota roll-ups and “my team’s deals” know who belongs together."
        actions={
          <Button variant="primary" leading={<Plus size={16} weight="bold" />} onClick={() => setDialog({ team: null })}>
            New team
          </Button>
        }
      />

      {ws.teams.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={22} weight="duotone" />}
          title="No teams yet"
          actions={
            <Button variant="primary" onClick={() => setDialog({ team: null })}>
              Create the first team
            </Button>
          }
        >
          Most teams of five or more end up with two: the people who find deals and the people who close them.
        </EmptyState>
      ) : (
        <Group>
          <RowList>
            {ws.teams.map(team => {
              const members = ws.members.filter(m => m.teamId === team.id && m.status !== 'Deactivated');
              const lead = ws.memberById(team.leadId);
              return (
                <Row key={team.id}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ui font-medium text-ink">{team.name}</div>
                    <div className="truncate text-meta text-ink-3">
                      {lead ? `Led by ${lead.name}` : 'No lead'} · {members.length === 1 ? '1 member' : `${members.length} members`}
                      {team.description ? ` · ${team.description}` : ''}
                    </div>
                  </div>
                  {members.length > 0 && <AvatarStack people={members} max={4} />}
                  <RowMenu label={`Actions for ${team.name}`}>
                    <MenuItem onSelect={() => setDialog({ team })}>Edit team</MenuItem>
                    <MenuSeparator />
                    <MenuItem destructive onSelect={() => void onDelete(team)}>
                      Delete team
                    </MenuItem>
                  </RowMenu>
                </Row>
              );
            })}
          </RowList>
        </Group>
      )}

      {dialog && <TeamDialog team={dialog.team} onClose={() => setDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
    </div>
  );
}

function TeamDialog({ team, onClose, onSave, pending }: { team: Team | null; onClose: () => void; onSave: (input: Parameters<typeof saveTeam>[0]) => void; pending: boolean }) {
  const ws = useWorkspace();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [leadId, setLeadId] = useState(team?.leadId ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(team ? ws.members.filter(m => m.teamId === team.id).map(m => m.id) : []);

  const toggle = (id: string) => setMemberIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={team ? `Edit ${team.name}` : 'New team'}
      submitLabel={team ? 'Save team' : 'Create team'}
      onSubmit={() => onSave({ ...(team ? { teamId: team.id } : {}), name: name.trim(), description: description.trim(), leadId: leadId || null, memberIds })}
      pending={pending}
      disabled={!name.trim()}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required htmlFor="team-name">
          <Input id="team-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Account executives" maxLength={80} />
        </Field>
        <Field label="What they do" htmlFor="team-desc">
          <Textarea id="team-desc" value={description} onChange={e => setDescription(e.target.value)} minRows={2} maxLength={400} placeholder="Runs every new-business deal from first call to signature." />
        </Field>
        <Field label="Team lead" hint="Shown on the team report; they don’t get extra permissions." htmlFor="team-lead">
          <Select id="team-lead" value={leadId} onChange={e => setLeadId(e.target.value)}>
            <option value="">No lead</option>
            {ws.activeMembers.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Members" hint="Someone can only be on one team at a time.">
          <div className="max-h-[260px] overflow-y-auto rounded-md border border-line">
            {ws.activeMembers.map(member => {
              const otherTeam = member.teamId && member.teamId !== team?.id ? ws.teams.find(t => t.id === member.teamId) : null;
              return (
                <label key={member.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover/60">
                  <Checkbox checked={memberIds.includes(member.id)} onCheckedChange={() => toggle(member.id)} label={member.name} />
                  <Avatar person={member} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{member.name}</span>
                  {otherTeam && <span className="shrink-0 text-meta text-ink-3">now on {otherTeam.name}</span>}
                </label>
              );
            })}
          </div>
        </Field>
      </div>
    </FormDialog>
  );
}
