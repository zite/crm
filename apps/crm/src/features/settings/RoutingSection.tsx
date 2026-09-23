import { useMutation } from '@tanstack/react-query';
import { ArrowsClockwise, User, UsersFour } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateOrgSettings } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Checkbox, Select } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { errorMessage } from '../../lib/errors';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { Explainer, Group, SaveBar, SectionHead } from './kit';

type Mode = 'round_robin' | 'member' | 'unassigned';

const MODES: Array<{ value: Mode; label: string; blurb: string; icon: React.ReactNode }> = [
  { value: 'round_robin', label: 'Round robin', blurb: 'Take it in turns, in the order below. Anyone deactivated is skipped.', icon: <ArrowsClockwise size={18} /> },
  { value: 'member', label: 'One person', blurb: 'Everything goes to the same teammate, who triages and hands it on.', icon: <User size={18} /> },
  { value: 'unassigned', label: 'Nobody, for now', blurb: 'Leads land unowned and wait in the review deck for whoever gets there first.', icon: <UsersFour size={18} /> },
];

/** Who a new lead belongs to the moment it arrives. */
export function RoutingSection() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const routing = ws.settings.leadRouting;

  const initial = useMemo(
    () => ({ mode: routing.mode as Mode, memberIds: routing.memberIds.filter(id => ws.activeMembers.some(m => m.id === id)), memberId: routing.memberId }),
    [routing, ws.activeMembers],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // Viewers can't own a lead, so they are never in the pool.
  const assignable = ws.activeMembers.filter(m => m.role !== 'Viewer');

  const save = useMutation({
    mutationFn: () => updateOrgSettings({ leadRouting: form }),
    onSuccess: () => {
      void invalidate();
      toast.success('Lead routing saved');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save lead routing')),
  });

  const toggle = (id: string) => setForm(f => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter(x => x !== id) : [...f.memberIds, id] }));
  const invalid = (form.mode === 'round_robin' && form.memberIds.length === 0) || (form.mode === 'member' && !form.memberId);

  const next = form.mode === 'round_robin' ? assignable.find(m => m.id === form.memberIds[routing.cursor % Math.max(1, form.memberIds.length)]) : form.mode === 'member' ? ws.memberById(form.memberId) : null;

  return (
    <div className="flex flex-col gap-8">
      <SectionHead title="Lead routing" description="Every lead that arrives on its own — a form, a meeting booked from a link, an import with no owner — gets an owner from here." />

      <Group>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map(mode => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setForm(f => ({ ...f, mode: mode.value }))}
              aria-pressed={form.mode === mode.value}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors',
                form.mode === mode.value ? 'border-accent bg-accent/[0.06] dark:bg-accent/10' : 'border-line bg-card hover:bg-hover/60',
              )}
            >
              <span className={cn('flex items-center gap-2', form.mode === mode.value ? 'text-accent' : 'text-ink-2')}>
                {mode.icon}
                <span className="text-ui font-medium text-ink">{mode.label}</span>
              </span>
              <span className="text-meta text-ink-2 text-pretty">{mode.blurb}</span>
            </button>
          ))}
        </div>

        {form.mode === 'round_robin' && (
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
            <div className="border-b border-line bg-sunken px-4 py-2 text-micro font-semibold uppercase text-ink-3">The rotation</div>
            {assignable.map(member => (
              <label key={member.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover/60">
                <Checkbox checked={form.memberIds.includes(member.id)} onCheckedChange={() => toggle(member.id)} label={member.name} />
                <Avatar person={member} size="sm" />
                <span className="min-w-0 flex-1 truncate text-ui text-ink">{member.name}</span>
                <span className="shrink-0 text-meta text-ink-3">{member.role}</span>
              </label>
            ))}
            {assignable.length === 0 && <p className="px-4 py-6 text-center text-ui text-ink-2">Everyone on the team is a Viewer, and a Viewer can’t own a lead.</p>}
          </div>
        )}

        {form.mode === 'member' && (
          <div className="max-w-sm">
            <Select value={form.memberId ?? ''} onChange={e => setForm(f => ({ ...f, memberId: e.target.value || null }))} aria-label="Who new leads go to">
              <option value="">Choose a teammate</option>
              {assignable.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
                </option>
              ))}
            </Select>
          </div>
        )}

        {next && (
          <p className="text-ui text-ink-2">
            The next lead would go to <span className="font-medium text-ink">{next.name}</span>.
          </p>
        )}
        {form.mode === 'unassigned' && <p className="text-ui text-ink-2">New leads will arrive unowned and wait in the review deck.</p>}
        {invalid && <p className="text-meta text-danger">{form.mode === 'round_robin' ? 'Choose at least one teammate for the rotation.' : 'Choose who new leads should go to.'}</p>}

        <SaveBar dirty={dirty && !invalid} saving={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} label="Save routing" />
      </Group>

      <Explainer summary="What forms and meeting links do with this">
        <p>
          A <strong className="font-medium text-ink">form</strong> has its own assignment setting. Left on “Round robin” it uses the rotation above; set to a person, that person gets every lead from that form whatever this
          says. That is how a partner-referral form goes straight to the one person who handles partners.
        </p>
        <p>
          A <strong className="font-medium text-ink">meeting link</strong> is simpler: whoever hosts the link owns whatever the booking creates, because they are the one who will be on the call.
        </p>
        <p>
          An <strong className="font-medium text-ink">import</strong> uses the owner column in your file. Rows with no owner are left unassigned rather than fed through the rotation — three hundred leads dealt out in one
          second is not what a round robin is for.
        </p>
        <p>The rotation is by position, not by workload, and it restarts whenever you change who is in it. A teammate whose access is turned off is skipped without you having to remember to take them out.</p>
      </Explainer>
    </div>
  );
}
