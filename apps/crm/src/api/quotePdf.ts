import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { Pdf } from 'zitejs/pdf';
import { getActor, memberById } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { slugify } from '@project/shared/tokens';
import { id, parseInput, today as todayInput } from '../server/input';
import { loadQuote, renderQuoteHtml } from '../server/quotes';

const inputSchema = z.object({ id, today: todayInput });

/**
 * The quote as a PDF: the organization's name and logo, the number, the lines,
 * the totals, the terms and where it stands. Rendered server-side, so what is
 * downloaded matches what the buyer sees to the cent.
 */
export default createEndpoint({
  description: 'Render a quote as a PDF and return its URL',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ url: z.string(), filename: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = data.today ?? todayIn(settings.timezone);
    const { row, record, items } = await loadQuote(data.id, today);
    const owner = await memberById(row.ownerId);

    const html = renderQuoteHtml({
      quote: row,
      items,
      settings,
      terms: str(record.terms) ?? '',
      buyerNote: str(record.buyerNote) ?? '',
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    });

    const filename = `${slugify(`${row.number} ${row.companyName ?? row.title}`) || 'quote'}.pdf`;
    try {
      const result = await Pdf.renderHtml({ html, filename });
      return { url: result.url, filename: result.filename ?? filename };
    } catch (e) {
      console.error('quotePdf failed', e instanceof Error ? e.message : e);
      throw new ZiteError('The PDF couldn’t be rendered. Try again in a moment.', 'CONFLICT');
    }
  },
});
