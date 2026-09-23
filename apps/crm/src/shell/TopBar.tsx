import { Bell, Books, CaretDown, Gear, Keyboard, List, MagnifyingGlass, Moon, Plus, SignOut, Sun, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Count } from '../ui/Chip';
import { Kbd, MOD } from '../ui/Kbd';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../ui/Menu';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../ui/cn';
import { OrgMark } from '../glyphs';
import { useAppActions } from '../lib/app-actions';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
import { useWorkspace } from '../lib/workspace';

/**
 * One top bar for the whole app: the organization on the left, the eight
 * sections in the middle, and search, inbox, New and the account menu on the
 * right. Below `lg` the sections collapse into a menu.
 */

const SECTIONS = [
  { to: '/home', label: 'Home' },
  { to: '/leads', label: 'Leads' },
  { to: '/deals', label: 'Deals' },
  { to: '/companies', label: 'Companies' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/outreach', label: 'Outreach' },
  { to: '/reports', label: 'Reports' },
];

export function TopBar() {
  const ws = useWorkspace();
  const actions = useAppActions();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn('relative flex h-[38px] items-center rounded-md px-2.5 text-ui font-medium transition-colors', isActive ? 'text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink');

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-2 border-b border-line bg-paper/95 px-3 backdrop-blur sm:px-4">
      <NavLink to="/home" className="flex shrink-0 items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover">
        <OrgMark name={ws.settings.organizationName} logoUrl={ws.settings.logoUrl} />
        <span className="hidden max-w-[190px] truncate text-title font-semibold text-ink xl:block">{ws.settings.organizationName}</span>
      </NavLink>

      <nav className="ml-1 hidden items-center gap-0.5 lg:flex">
        {SECTIONS.map(s => (
          <NavLink key={s.to} to={s.to} className={linkClass}>
            {({ isActive }) => (
              <>
                {s.label}
                {isActive && <span className="absolute -bottom-[11px] left-2.5 right-2.5 h-0.5 rounded-full bg-accent" />}
                {s.label === 'Leads' && ws.counts.newLeads > 0 && <Count className="ml-1.5">{ws.counts.newLeads}</Count>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="secondary" size="sm" className="hidden w-[184px] justify-start gap-2 px-2 text-ink-3 sm:flex" onClick={actions.openPalette}>
          <MagnifyingGlass size={16} />
          <span className="flex-1 text-left">Search</span>
          <Kbd keys="mod+k" />
        </Button>
        <Button variant="ghost" size="sm" icon aria-label="Search" className="sm:hidden" onClick={actions.openPalette}>
          <MagnifyingGlass size={18} />
        </Button>

        <Tooltip content="Inbox" shortcut="g+i">
          <Button variant="ghost" size="sm" icon aria-label={`Inbox${ws.counts.unread ? `, ${ws.counts.unread} unread` : ''}`} onClick={() => navigate('/inbox')} className="relative">
            <Bell size={18} />
            {ws.counts.unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-paper" />}
          </Button>
        </Tooltip>

        <Menu>
          <MenuTrigger asChild>
            <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />}>
              <span className="hidden sm:inline">New</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => actions.openCreate('deal')} shortcut="c">
              Deal
            </MenuItem>
            {ws.can('quotes.manage') && <MenuItem onSelect={() => actions.openCreate('quote')}>Quote</MenuItem>}
            <MenuItem onSelect={() => actions.openCreate('company')}>Company</MenuItem>
            <MenuItem onSelect={() => actions.openCreate('contact')} shortcut="shift+c">
              Contact
            </MenuItem>
            <MenuItem onSelect={() => actions.openCreate('lead')}>Lead</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => actions.openCreate('task')} shortcut="t">
              Task
            </MenuItem>
            <MenuItem onSelect={() => actions.openCreate('activity')} shortcut="l">
              Log activity
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger asChild>
            <button className="flex h-9 items-center gap-1 rounded-md px-1 hover:bg-hover" aria-label="Account menu">
              <Avatar person={ws.me} size="md" />
              <CaretDown size={12} className="text-ink-3" />
            </button>
          </MenuTrigger>
          <MenuContent align="end" className="min-w-[230px]">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <Avatar person={ws.me} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-ui font-medium text-ink">{ws.me.name}</div>
                <div className="truncate text-meta text-ink-3">{ws.me.email}</div>
              </div>
            </div>
            <MenuSeparator />
            <MenuItem icon={<Gear size={16} />} onSelect={() => navigate('/settings/profile')}>
              Your profile
            </MenuItem>
            {ws.can('settings.manage') && (
              <MenuItem icon={<Books size={16} />} onSelect={() => navigate('/settings/general')} shortcut="g+s">
                Settings
              </MenuItem>
            )}
            <MenuItem icon={<Keyboard size={16} />} onSelect={() => actions.setShortcutsOpen(true)} shortcut="?">
              Keyboard shortcuts
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Theme</MenuLabel>
            <MenuRadioGroup
              value={theme}
              onValueChange={v => {
                setTheme(v as Theme);
                applyTheme(v as Theme);
              }}
            >
              <MenuRadioItem value="light">Light</MenuRadioItem>
              <MenuRadioItem value="dark">Dark</MenuRadioItem>
              <MenuRadioItem value="system">Match system</MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>

        <Button variant="ghost" size="sm" icon aria-label="Sections" className="lg:hidden" onClick={() => setMenuOpen(o => !o)}>
          {menuOpen ? <X size={18} /> : <List size={18} />}
        </Button>
      </div>

      {menuOpen && (
        <div className="absolute inset-x-0 top-[60px] z-40 border-b border-line bg-card p-2 shadow-pop lg:hidden">
          <nav className="grid grid-cols-2 gap-1">
            {SECTIONS.map(s => (
              <NavLink key={s.to} to={s.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('rounded-md px-3 py-2.5 text-ui font-medium', isActive ? 'bg-accent/10 text-accent' : 'text-ink hover:bg-hover')}>
                {s.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

export { SECTIONS };
