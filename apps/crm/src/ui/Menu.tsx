import * as D from '@radix-ui/react-dropdown-menu';
import * as C from '@radix-ui/react-context-menu';
import { Check } from '@phosphor-icons/react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from './cn';
import { Kbd } from './Kbd';

/** Dropdown and context menus share one look: 14px rows, icons at 16, hints in ink-3. */
const contentClass = 'z-50 min-w-[190px] overflow-y-auto rounded-lg border border-line bg-card p-1 text-ink shadow-pop animate-pop-in';
// A menu longer than the window has to scroll, not clip: a stage or member list
// on a short laptop screen was losing its last rows with no way to reach them.
// Radix measures the gap for us; the var differs per primitive.
const menuHeight = 'max-h-[var(--radix-dropdown-menu-content-available-height)]';
const contextHeight = 'max-h-[var(--radix-context-menu-content-available-height)]';
const itemClass =
  'flex cursor-default select-none items-center gap-2.5 rounded-sm px-2 py-1.5 text-ui outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:shrink-0 [&_svg]:text-ink-3 data-[highlighted]:[&_svg]:text-ink-2';

export const Menu = D.Root;
export const MenuTrigger = D.Trigger;
export const MenuGroup = D.Group;
export const MenuSub = D.Sub;
export const MenuRadioGroup = D.RadioGroup;

export const MenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof D.Content>>(function MenuContent({ className, sideOffset = 6, align = 'start', ...props }, ref) {
  return (
    <D.Portal>
      <D.Content ref={ref} sideOffset={sideOffset} align={align} collisionPadding={8} className={cn(contentClass, menuHeight, className)} {...props} />
    </D.Portal>
  );
});

type ItemProps = ComponentPropsWithoutRef<typeof D.Item> & { icon?: ReactNode; shortcut?: string; hint?: ReactNode; destructive?: boolean };

export const MenuItem = forwardRef<HTMLDivElement, ItemProps>(function MenuItem({ className, icon, shortcut, hint, destructive, children, ...props }, ref) {
  return (
    <D.Item ref={ref} className={cn(itemClass, destructive && 'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger', className)} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-meta text-ink-3">{hint}</span>}
      {shortcut && <Kbd keys={shortcut} />}
    </D.Item>
  );
});

export const MenuCheckboxItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof D.CheckboxItem>>(function MenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <D.CheckboxItem ref={ref} className={cn(itemClass, 'pl-2', className)} {...props}>
      <span className="flex h-4 w-4 items-center justify-center">
        <D.ItemIndicator>
          <Check size={14} weight="bold" className="!text-accent" />
        </D.ItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </D.CheckboxItem>
  );
});

export const MenuRadioItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof D.RadioItem>>(function MenuRadioItem({ className, children, ...props }, ref) {
  return (
    <D.RadioItem ref={ref} className={cn(itemClass, 'pl-2', className)} {...props}>
      <span className="flex h-4 w-4 items-center justify-center">
        <D.ItemIndicator>
          <Check size={14} weight="bold" className="!text-accent" />
        </D.ItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </D.RadioItem>
  );
});

export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <D.Label className={cn('px-2 pb-1 pt-2 text-micro font-semibold uppercase text-ink-3', className)}>{children}</D.Label>;
}

export function MenuSeparator({ className }: { className?: string }) {
  return <D.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} />;
}

export const MenuSubTrigger = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof D.SubTrigger> & { icon?: ReactNode }>(function MenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <D.SubTrigger ref={ref} className={cn(itemClass, 'data-[state=open]:bg-hover', className)} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      <span className="text-ink-3">›</span>
    </D.SubTrigger>
  );
});

export const MenuSubContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof D.SubContent>>(function MenuSubContent({ className, ...props }, ref) {
  return (
    <D.Portal>
      <D.SubContent ref={ref} className={cn(contentClass, className)} {...props} />
    </D.Portal>
  );
});

/* Right-click menus on rows and cards. */
export const ContextMenu = C.Root;
export const ContextMenuTrigger = C.Trigger;

export const ContextMenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof C.Content>>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <C.Portal>
      <C.Content ref={ref} collisionPadding={8} className={cn(contentClass, contextHeight, className)} {...props} />
    </C.Portal>
  );
});

export const ContextMenuItem = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof C.Item> & { icon?: ReactNode; shortcut?: string; destructive?: boolean }>(function ContextMenuItem(
  { className, icon, shortcut, destructive, children, ...props },
  ref,
) {
  return (
    <C.Item ref={ref} className={cn(itemClass, destructive && 'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger', className)} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </C.Item>
  );
});

export function ContextMenuSeparator() {
  return <C.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <C.Label className="px-2 pb-1 pt-2 text-micro font-semibold uppercase text-ink-3">{children}</C.Label>;
}

export const ContextMenuSub = C.Sub;
export const ContextMenuSubTrigger = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof C.SubTrigger> & { icon?: ReactNode }>(function ContextMenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <C.SubTrigger ref={ref} className={cn(itemClass, 'data-[state=open]:bg-hover', className)} {...props}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      <span className="text-ink-3">›</span>
    </C.SubTrigger>
  );
});
export const ContextMenuSubContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof C.SubContent>>(function ContextMenuSubContent({ className, ...props }, ref) {
  return (
    <C.Portal>
      <C.SubContent ref={ref} className={cn(contentClass, className)} {...props} />
    </C.Portal>
  );
});
