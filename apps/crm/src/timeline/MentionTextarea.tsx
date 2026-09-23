import { useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { Textarea } from '../ui/Form';
import { cn } from '../ui/cn';
import { useWorkspace } from '../lib/workspace';

/**
 * A textarea that completes @mentions against the team. The stored format is
 * `@[Name](member:id)`; MarkdownView renders it as a chip and the server
 * notifies whoever was named.
 */
export function MentionTextarea({ value, onChange, placeholder, minRows = 3, className, autoFocus, onSubmit }: { value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; className?: string; autoFocus?: boolean; onSubmit?: () => void }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const candidates = query
    ? ws.activeMembers.filter(m => m.name.toLowerCase().includes(query.text.toLowerCase()) || m.email.toLowerCase().startsWith(query.text.toLowerCase())).slice(0, 6)
    : [];

  const insert = (member: { id: string; name: string }) => {
    if (!query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(query.start + query.text.length + 1);
    onChange(`${before}@[${member.name}](member:${member.id}) ${after}`);
    setQuery(null);
    setActive(0);
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className={cn('relative', className)}>
      <Textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        minRows={minRows}
        placeholder={placeholder ?? 'Write a note — @ to mention a teammate'}
        onChange={e => {
          const next = e.target.value;
          onChange(next);
          const caret = e.target.selectionStart ?? next.length;
          const upto = next.slice(0, caret);
          const match = /(?:^|\s)@([\w.\- ]{0,30})$/.exec(upto);
          setQuery(match ? { text: match[1], start: caret - match[1].length - 1 } : null);
          setActive(0);
        }}
        onKeyDown={e => {
          if (query && candidates.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(a => Math.min(candidates.length - 1, a + 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(a => Math.max(0, a - 1));
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insert(candidates[active]);
              return;
            }
            if (e.key === 'Escape') {
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {query && candidates.length > 0 && (
        <div className="absolute bottom-2 left-2 z-20 w-[260px] overflow-hidden rounded-lg border border-line bg-card p-1 shadow-pop">
          {candidates.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => insert(m)}
              className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui', i === active && 'bg-hover')}
            >
              <Avatar person={m} size="sm" />
              <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
              <span className="text-meta text-ink-3">{m.title ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
