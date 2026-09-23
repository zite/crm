import { CalendarBlank, ClockCounterClockwise, ListChecks } from '@phosphor-icons/react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../ui/cn';

/**
 * The three Tasks surfaces. It sits in the `end` slot of each page's tab row —
 * it navigates between pages, so it is deliberately not styled as a tab.
 */
const LINKS = [
  { to: '/tasks', label: 'My tasks', icon: <ListChecks size={15} />, key: 'tasks' },
  { to: '/tasks/meetings', label: 'Meetings', icon: <CalendarBlank size={15} />, key: 'meetings' },
  { to: '/tasks/activity', label: 'Activity log', icon: <ClockCounterClockwise size={15} />, key: 'activity' },
];

export function TasksNav({ current }: { current: 'tasks' | 'meetings' | 'activity' }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Task surfaces">
      {LINKS.filter(link => link.key !== current).map(link => (
        <NavLink
          key={link.key}
          to={link.to}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-ui font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink')}
        >
          {link.icon}
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
