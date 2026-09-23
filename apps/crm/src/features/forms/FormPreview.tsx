import { cn } from '../../ui/cn';
import { initials } from '@project/shared/format';
import { useWorkspace } from '../../lib/workspace';
import type { FormField } from './formData';

/**
 * The form as a buyer sees it, beside the editor. It is deliberately inert —
 * nothing here submits — but it uses the same type, spacing and 44px targets as
 * the real page, so what you see is what they get.
 */
export function FormPreview({ name, intro, fields, submitLabel, slug, className }: { name: string; intro: string | null; fields: FormField[]; submitLabel: string; slug?: string; className?: string }) {
  const ws = useWorkspace();
  const brand = ws.settings.brandColor;
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-paper', className)}>
      {/* The bar carries the address this page will live at — a fake browser's
          traffic lights carry nothing. */}
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-2">
        <span className="truncate text-meta text-ink-3">{slug ? `/f/${slug}` : 'Not published yet'}</span>
      </div>
      <div className="max-h-[560px] overflow-y-auto p-5 sm:p-6">
        <div className="mx-auto w-full max-w-[420px]">
          <header className="mb-6 flex items-center gap-3">
            {ws.settings.logoUrl ? (
              <img src={ws.settings.logoUrl} alt="" className="h-9 w-9 rounded-md border border-line object-contain" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-[12px] font-semibold uppercase text-on-primary">{initials(ws.settings.organizationName).slice(0, 2)}</span>
            )}
            <span className="truncate text-ui font-semibold text-ink">{ws.settings.organizationName}</span>
          </header>

          <h2 className="font-display text-display-sm text-ink">{name || 'Untitled form'}</h2>
          {intro && <p className="mt-2 text-body leading-6 text-ink-2 whitespace-pre-wrap">{intro}</p>}

          <div className="mt-6 flex flex-col gap-4">
            {fields.map(field => (
              <div key={field.id} className="flex flex-col gap-1.5">
                <span className="text-ui font-medium text-ink">
                  {field.label}
                  {field.required && <span className="ml-0.5 text-danger">*</span>}
                </span>
                {field.type === 'long_text' ? (
                  <div className="min-h-[84px] rounded-md border border-control/70 bg-card px-3 py-2.5 text-body text-ink-3">{field.placeholder ?? ''}</div>
                ) : field.type === 'checkbox' ? (
                  <label className="flex items-center gap-2.5 text-body text-ink-2">
                    <span className="h-[18px] w-[18px] shrink-0 rounded-xs border border-control bg-card" />
                    {field.placeholder ?? 'Yes'}
                  </label>
                ) : field.type === 'select' ? (
                  <div className="flex h-11 items-center justify-between rounded-md border border-control/70 bg-card px-3 text-body text-ink-3">
                    <span>{field.placeholder ?? 'Choose one'}</span>
                    <span aria-hidden>▾</span>
                  </div>
                ) : (
                  <div className="flex h-11 items-center rounded-md border border-control/70 bg-card px-3 text-body text-ink-3">{field.placeholder ?? placeholderFor(field)}</div>
                )}
                {field.help && <span className="text-meta text-ink-3">{field.help}</span>}
              </div>
            ))}
            {fields.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-ui text-ink-3">Add a field and it shows up here.</p>}
          </div>

          <div className="mt-6 flex h-12 items-center justify-center rounded-md px-5 text-body font-medium text-white" style={{ backgroundColor: brand }}>
            {submitLabel || 'Send'}
          </div>
        </div>
      </div>
    </div>
  );
}

function placeholderFor(field: FormField) {
  if (field.type === 'email') return 'you@company.com';
  if (field.type === 'phone') return '(555) 000-0000';
  if (field.type === 'number') return '250';
  return '';
}
