import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor, memberById } from '@project/shared/server/actor';
import { getSettings, pagesLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { id, parseInput, today as todayInput } from '../server/input';
import { loadQuote, quoteItemRowSchema, quoteRowSchema, toItemRow } from '../server/quotes';

const inputSchema = z.object({ id, today: todayInput });

/** One quote, with its lines, its terms and the link the buyer was given. */
export default createEndpoint({
  description: 'Load one quote with its line items, terms and public link',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    quote: quoteRowSchema.extend({ terms: z.string(), buyerNote: z.string(), token: z.string(), acceptedTitle: z.string().nullable(), acceptedEmail: z.string().nullable() }),
    items: z.array(quoteItemRowSchema),
    publicUrl: z.string(),
    owner: z.object({ id: z.string(), name: z.string(), email: z.string(), title: z.string().nullable() }).nullable(),
    company: z.object({ id: z.string(), name: z.string(), logoUrl: z.string().nullable() }).nullable(),
    canEdit: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const settings = await getSettings();
    const today = data.today ?? todayIn(settings.timezone);
    const { row, record, items } = await loadQuote(data.id, today);
    const owner = await memberById(row.ownerId);
    const company = row.companyId ? await zite.sql({ query: `SELECT id, "name", "logoUrl" FROM "Companies" WHERE id::text = $1`, params: [row.companyId] }) : { rows: [] as Record<string, unknown>[] };
    const c = company.rows[0];
    return {
      quote: {
        ...row,
        terms: str(record.terms) ?? '',
        buyerNote: str(record.buyerNote) ?? '',
        token: str(record.token) ?? '',
        acceptedTitle: str(record.acceptedTitle) || null,
        acceptedEmail: str(record.acceptedEmail) || null,
      },
      items: items.map(toItemRow),
      publicUrl: record.token ? pagesLink(settings, `/q/${record.token}`) : '',
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email, title: owner.title } : null,
      company: c ? { id: String(c.id), name: str(c.name) ?? '', logoUrl: str(c.logoUrl) || null } : null,
      canEdit: row.storedStatus === 'Draft' && actor.role !== 'Viewer',
    };
  },
});
