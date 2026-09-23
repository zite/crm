import { BracketsCurly } from '@phosphor-icons/react';
import { useRef, type RefObject } from 'react';
import { Button } from '../../ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { MERGE_FIELDS } from './model';

/**
 * Insert a merge field where the cursor is. Typing `{{contact.first_name}}` by
 * hand is how a buyer ends up reading `{{contact.first_name}}`, so the
 * catalogue is a menu and the example value is shown beside every field.
 */

const GROUPS = [
  { key: 'contact.', label: 'Contact' },
  { key: 'company.', label: 'Company' },
  { key: 'deal.', label: 'Deal' },
  { key: 'sender.', label: 'You' },
  { key: '', label: 'Organization' },
];

export type MergeTarget = RefObject<HTMLInputElement | HTMLTextAreaElement | null>;

/** Splice a token in at the cursor and hand the new text back, so state stays the source of truth. */
export function insertToken(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, token: string) {
  if (!el) return `${value}${token}`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  requestAnimationFrame(() => {
    el.focus();
    const caret = start + token.length;
    el.setSelectionRange(caret, caret);
  });
  return next;
}

export function MergeFieldMenu({
  target,
  value,
  onChange,
  label = 'Merge field',
  size = 'xs',
}: {
  target: MergeTarget;
  value: string;
  onChange: (next: string) => void;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  const latest = useRef(value);
  latest.current = value;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size={size} leading={<BracketsCurly size={14} />}>
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="max-h-[320px] overflow-y-auto">
        {GROUPS.map((group, i) => {
          const fields = MERGE_FIELDS.filter(f => (group.key ? f.key.startsWith(group.key) : !f.key.includes('.')));
          if (!fields.length) return null;
          return (
            <div key={group.label}>
              {i > 0 && <MenuSeparator />}
              <MenuLabel>{group.label}</MenuLabel>
              {fields.map(field => (
                <MenuItem key={field.key} hint={field.example} onSelect={() => onChange(insertToken(target.current, latest.current, `{{${field.key}}}`))}>
                  {field.label}
                </MenuItem>
              ))}
            </div>
          );
        })}
        <MenuSeparator />
        <MenuItem hint="if empty" onSelect={() => onChange(insertToken(target.current, latest.current, '{{contact.first_name | there}}'))}>
          First name, or “there”
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
