import { ArrowDown, ArrowUp, Plus, X } from '@phosphor-icons/react';
import type { BookingQuestion } from '@project/shared/availability';
import { Button } from '../../ui/Button';
import { Checkbox, Input } from '../../ui/Form';
import { EmptyState } from '../../ui/Layout';
import { ChatText } from '@phosphor-icons/react';

/**
 * What a buyer is asked beyond name, email and company. Kept deliberately
 * plain: a label, whether it's required, and whether it wants a sentence or a
 * paragraph. Anything more belongs on a form.
 */
export function QuestionsEditor({ value, onChange, disabled }: { value: BookingQuestion[]; onChange: (next: BookingQuestion[]) => void; disabled?: boolean }) {
  const patch = (index: number, changes: Partial<BookingQuestion>) => onChange(value.map((q, i) => (i === index ? { ...q, ...changes } : q)));
  const move = (index: number, delta: number) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  if (!value.length) {
    return (
      <EmptyState
        compact
        icon={<ChatText size={20} weight="duotone" />}
        title="No questions"
        actions={
          disabled ? null : (
            <Button variant="secondary" size="sm" leading={<Plus size={15} />} onClick={() => onChange([{ id: `q${Date.now().toString(36)}`, label: '', required: false, long: true }])}>
              Add a question
            </Button>
          )
        }
      >
        Everyone is asked their name, email and company. Add a question when the answer would change how you prepare.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {value.map((question, index) => (
        <div key={question.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken/50 p-2">
          <Input
            value={question.label}
            disabled={disabled}
            maxLength={200}
            placeholder="What are you hoping to sort out?"
            aria-label={`Question ${index + 1}`}
            onChange={e => patch(index, { label: e.target.value })}
            className="min-w-[200px] flex-1"
          />
          <label className="flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-ui text-ink-2">
            <Checkbox checked={question.required} onCheckedChange={v => patch(index, { required: v })} disabled={disabled} label={`Make question ${index + 1} required`} />
            Required
          </label>
          <label className="flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-ui text-ink-2">
            <Checkbox checked={question.long} onCheckedChange={v => patch(index, { long: v })} disabled={disabled} label={`Give question ${index + 1} a long answer box`} />
            Long answer
          </label>
          {!disabled && (
            <span className="flex shrink-0 items-center">
              <Button variant="ghost" size="sm" icon aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={14} />
              </Button>
              <Button variant="ghost" size="sm" icon aria-label={`Move question ${index + 1} down`} disabled={index === value.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={14} />
              </Button>
              <Button variant="ghost" size="sm" icon aria-label={`Remove question ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                <X size={14} />
              </Button>
            </span>
          )}
        </div>
      ))}
      {!disabled && value.length < 20 && (
        <div>
          <Button variant="secondary" size="sm" leading={<Plus size={15} />} onClick={() => onChange([...value, { id: `q${Date.now().toString(36)}`, label: '', required: false, long: false }])}>
            Add a question
          </Button>
        </div>
      )}
    </div>
  );
}
