/**
 * Merge fields for templates, sequences and one-off emails.
 *
 *   Hi {{contact.first_name | there}},
 *
 * A field renders its value, or the fallback after `|`, or nothing. Unknown
 * fields render as empty rather than leaking `{{…}}` into a buyer's inbox;
 * `missingFields()` lets the composer warn before sending.
 */

export type MergeContext = Record<string, string | number | null | undefined>;

export const MERGE_FIELDS: Array<{ key: string; label: string; example: string }> = [
  { key: 'contact.first_name', label: 'Contact first name', example: 'Priya' },
  { key: 'contact.last_name', label: 'Contact last name', example: 'Raman' },
  { key: 'contact.name', label: 'Contact full name', example: 'Priya Raman' },
  { key: 'contact.title', label: 'Contact job title', example: 'Head of Operations' },
  { key: 'contact.email', label: 'Contact email', example: 'priya@example.com' },
  { key: 'company.name', label: 'Company name', example: 'Harbor Freight Co.' },
  { key: 'company.domain', label: 'Company domain', example: 'harborfreight.example' },
  { key: 'deal.name', label: 'Deal name', example: 'Harbor Freight — Platform' },
  { key: 'deal.amount', label: 'Deal amount', example: '$48,000' },
  { key: 'deal.close_date', label: 'Deal close date', example: 'Oct 30, 2026' },
  { key: 'sender.first_name', label: 'Your first name', example: 'Maya' },
  { key: 'sender.name', label: 'Your full name', example: 'Maya Brooks' },
  { key: 'sender.title', label: 'Your job title', example: 'Account Executive' },
  { key: 'sender.phone', label: 'Your phone', example: '(415) 555-0142' },
  { key: 'organization.name', label: 'Your organization', example: 'Ashgrove Software' },
  { key: 'meeting_link', label: 'Your meeting link', example: 'https://…/m/maya-intro' },
];

const TOKEN = /\{\{\s*([a-z_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

export function renderMerge(template: string, ctx: MergeContext): string {
  return (template ?? '').replace(TOKEN, (_, key: string, fallback?: string) => {
    const v = ctx[key.toLowerCase()];
    const s = v == null ? '' : String(v).trim();
    return s || (fallback ?? '');
  });
}

/** Fields used in the text that have no value and no fallback. */
export function missingFields(template: string, ctx: MergeContext): string[] {
  const out = new Set<string>();
  for (const m of (template ?? '').matchAll(TOKEN)) {
    const key = m[1].toLowerCase();
    const v = ctx[key];
    if ((v == null || String(v).trim() === '') && !m[2]) out.add(key);
  }
  return [...out];
}

export function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
