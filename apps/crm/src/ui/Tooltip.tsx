import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Kbd } from './Kbd';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </T.Provider>
  );
}

export function Tooltip({ content, shortcut, children, side = 'bottom', className }: { content: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        {/* Above every other layer (dialogs and menus sit at z-50) so a tooltip is
            never half-covered by the thing it is explaining, and padded off the
            viewport edge so it flips instead of hugging the window. */}
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn('z-[60] flex max-w-[260px] items-center gap-2 rounded-md bg-primary px-2 py-1 text-meta text-on-primary shadow-pop animate-pop-in', className)}
        >
          {content}
          {shortcut && <Kbd keys={shortcut} tone="inverse" />}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
