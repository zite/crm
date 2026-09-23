import { DayPicker } from 'react-day-picker';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from './cn';

/** react-day-picker in the CRM's clothes. Used by DatePicker. */
export function Calendar({ selected, onSelect, month, onMonthChange, className }: { selected?: Date; onSelect: (d: Date | undefined) => void; month?: Date; onMonthChange?: (d: Date) => void; className?: string }) {
  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      month={month}
      onMonthChange={onMonthChange}
      showOutsideDays
      weekStartsOn={1}
      className={cn('p-3', className)}
      components={{
        IconLeft: () => <CaretLeft size={14} />,
        IconRight: () => <CaretRight size={14} />,
      }}
      classNames={{
        months: 'flex flex-col',
        month: 'space-y-3',
        caption: 'flex items-center justify-between px-1',
        caption_label: 'text-ui font-semibold text-ink',
        nav: 'flex items-center gap-1',
        nav_button: 'inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-2 hover:bg-hover',
        nav_button_previous: '',
        nav_button_next: '',
        table: 'w-full border-collapse',
        head_row: 'flex',
        head_cell: 'w-9 text-micro font-semibold uppercase text-ink-3',
        row: 'flex w-full mt-1',
        cell: 'p-0',
        day: 'tabular inline-flex h-9 w-9 items-center justify-center rounded-sm text-ui text-ink hover:bg-hover',
        day_today: 'font-semibold text-accent',
        day_selected: 'bg-accent text-on-accent hover:bg-accent',
        day_outside: 'text-ink-3/70',
        day_disabled: 'opacity-40',
      }}
    />
  );
}
