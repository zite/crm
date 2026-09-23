import { useMemo } from 'react';
import { cn } from '../ui/cn';
import { useWorkspace } from '../lib/workspace';

const MENTION = /@\[([^\]]{1,80})\]\(member:([A-Za-z0-9-]{6,64})\)/g;

/**
 * Notes and emails are plain text with @mentions. We render paragraphs, simple
 * lists and mention chips — deliberately not a full Markdown engine, because
 * everything here was typed into a textarea.
 */
export function MarkdownView({ text, className, clamp }: { text: string | null | undefined; className?: string; clamp?: number }) {
  const ws = useWorkspace();
  const blocks = useMemo(() => (text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/).filter(Boolean), [text]);
  if (!text?.trim()) return null;
  return (
    <div className={cn('prose-crm', className)} style={clamp ? { display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const isList = lines.every(l => /^[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i}>
              {lines.map((line, j) => (
                <li key={j}>{renderInline(line.replace(/^[-*]\s+/, ''), ws.memberById)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <span key={j}>
                {renderInline(line, ws.memberById)}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(line: string, memberById: (id: string) => { name: string } | null) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    const member = memberById(match[2]);
    parts.push(
      <span key={`${index}-m`} className="mention">
        @{member?.name ?? match[1]}
      </span>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts;
}

/** Strip mention markup for previews and subjects. */
export const plainText = (text: string | null | undefined) => (text ?? '').replace(MENTION, '@$1');
