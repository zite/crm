import { CaretDown, X } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { OptionPicker } from '../../pickers/OptionPicker';
import { useWorkspace } from '../../lib/workspace';

/**
 * Several hosts, in the order they take their turn. The kit has a single
 * MemberPicker; a meeting link needs a list, and the order is the round robin,
 * so the chips are removable and the picker adds to the end.
 */
export function HostPicker({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const ws = useWorkspace();
  const options = ws.activeMembers
    .filter(m => m.role !== 'Viewer')
    .map(m => ({ value: m.id, label: m.name, hint: m.title ?? undefined, keywords: m.email, icon: <Avatar person={m} size="xs" /> }));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((hostId, index) => {
        const member = ws.memberById(hostId);
        return (
          <span key={hostId} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card pl-1.5 pr-1 text-ui">
            <Avatar person={member ?? { name: 'Someone' }} size="xs" />
            <span className="max-w-[160px] truncate text-ink">{member?.name ?? 'Someone who left'}</span>
            {value.length > 1 && <span className="tabular text-meta text-ink-3">#{index + 1}</span>}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${member?.name ?? 'this host'}`}
                onClick={() => onChange(value.filter(v => v !== hostId))}
                className="flex h-5 w-5 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink"
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (
        <OptionPicker
          options={options.filter(o => !value.includes(o.value))}
          multiple
          values={value}
          onSelect={hostId => onChange([...value, hostId])}
          empty="Everyone is already a host"
          trigger={
            <Button variant="secondary" size="sm" trailing={<CaretDown size={13} />} className={cn(value.length === 0 && 'border-danger/50')}>
              {value.length ? 'Add a host' : 'Choose a host'}
            </Button>
          }
        />
      )}
    </div>
  );
}
