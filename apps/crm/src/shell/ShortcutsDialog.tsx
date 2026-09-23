import { Dialog, DialogBody, DialogContent, DialogHeader } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Anywhere',
    items: [
      ['mod+k', 'Search and jump to anything'],
      ['c', 'New deal'],
      ['shift+c', 'New contact'],
      ['t', 'New task'],
      ['l', 'Log an activity on the open record'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Go to',
    items: [
      ['g h', 'Home'],
      ['g l', 'Leads'],
      ['g d', 'Deals'],
      ['g o', 'Companies'],
      ['g p', 'Contacts'],
      ['g t', 'Tasks'],
      ['g r', 'Reports'],
      ['g i', 'Inbox'],
      ['g s', 'Settings'],
    ],
  },
  {
    title: 'In a list',
    items: [
      ['j', 'Move down'],
      ['k', 'Move up'],
      ['enter', 'Open the row'],
      ['space', 'Peek the row'],
      ['x', 'Select the row'],
      ['mod+a', 'Select everything'],
      ['/', 'Search this list'],
      ['esc', 'Clear selection or close'],
    ],
  },
  {
    title: 'On a record',
    items: [
      ['a', 'Change the owner'],
      ['d', 'Change the close date'],
      ['mod+enter', 'Save the open form'],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Keyboard shortcuts" description="The app is built to be driven from the keyboard." />
        <DialogBody>
          <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {GROUPS.map(group => (
              <section key={group.title}>
                <h3 className="mb-2 text-micro font-semibold uppercase text-ink-3">{group.title}</h3>
                <dl className="flex flex-col">
                  {group.items.map(([keys, label]) => (
                    <div key={keys} className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
                      <dt className="text-ui text-ink">{label}</dt>
                      <dd className="flex shrink-0 items-center gap-1">
                        {keys.split(' ').map(k => (
                          <Kbd key={k} keys={k} />
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
