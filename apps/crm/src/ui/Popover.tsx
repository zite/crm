import * as P from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export const PopoverContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof P.Content>>(function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }, ref) {
  return (
    <P.Portal>
      <P.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        // Same rule as the menus: taller than the window means scroll, not clip.
        className={cn('z-50 min-w-[200px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-lg border border-line bg-card text-ink shadow-pop animate-pop-in', className)}
        {...props}
      />
    </P.Portal>
  );
});
