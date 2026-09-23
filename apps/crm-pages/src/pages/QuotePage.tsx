import { CheckCircle, Clock, Prohibit, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getPublicQuote, respondToQuote, type GetPublicQuoteOutputType } from 'zitejs/api';
import { Button, Card, Field, Input, Loading, Masthead, Notice, Page, Textarea, cn } from '../ui/kit';
import { longDate, money as formatMoney } from '../lib/format';
import { useOrg } from '../lib/org';

/** The calendar day a timestamp fell on here — slicing the ISO string gives the UTC day. */
const localDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-CA') : null);

/**
 * The quote a buyer opens from their email. One column, the vendor's colour,
 * and a document they can read end to end before deciding. Opening it is the
 * rep's signal that it landed; accepting or declining is the answer, recorded
 * against the deal.
 */
export default function QuotePage() {
  const { token = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<'none' | 'accept' | 'decline'>('none');
  const answered = useRef<'Accepted' | 'Declined' | null>(null);

  const query = useQuery({
    queryKey: ['quote', token],
    queryFn: () => getPublicQuote({ token }),
    enabled: token.length > 8,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (org.isPending || query.isPending) return <Loading label="Opening the quote…" width="lg" />;

  if (query.isError || !query.data) {
    return (
      <Notice title="This quote link isn’t valid">
        It may have expired, been withdrawn, or the address was copied incompletely. Ask {org.data?.organizationName ?? 'whoever sent it'} for a new link.
      </Notice>
    );
  }

  const quote = query.data;
  const currency = quote.currency;
  const cash = (n: number) => formatMoney(n, currency);
  const orgName = org.data?.organizationName ?? '';

  const respond = async (input: Parameters<typeof respondToQuote>[0]) => {
    const result = await respondToQuote(input);
    answered.current = result.status;
    setPanel('none');
    await qc.invalidateQueries({ queryKey: ['quote', token] });
    return result;
  };

  return (
    <Page width="lg">
      <Masthead name={orgName} logoUrl={org.data?.logoUrl}>
        Quote {quote.number}
      </Masthead>

      {answered.current && <AnsweredBanner status={answered.current} />}

      <Card padded={false}>
        {/* flex-1 on the title and shrink-0 on the facts keeps the two side by side and
            lets a long title wrap, instead of dropping a right-aligned block onto its own
            line where it reads as floating in the middle of the page. */}
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-6 py-6 sm:px-8">
          <div className="min-w-[min(100%,260px)] flex-1">
            <h1 className="font-display text-display-sm text-ink">{quote.title || 'Your quote'}</h1>
            <p className="mt-1 text-body text-ink-2">
              Prepared for {quote.companyName ?? 'your team'}
              {quote.contactName ? ` · ${quote.contactName}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-meta text-ink-2 sm:text-right">
            <div className="font-mono text-ui tracking-[0.04em] text-ink">{quote.number}</div>
            {quote.sentAt && <div>Issued {longDate(localDay(quote.sentAt))}</div>}
            {quote.expiresOn && <div>Valid until {longDate(quote.expiresOn)}</div>}
          </div>
        </header>

        {quote.buyerNote.trim() && (
          <div className="border-b border-line bg-sunken px-6 py-5 text-body text-ink sm:px-8">
            {quote.buyerNote.split(/\n{2,}/).map((p, i) => (
              <p key={i} className={cn(i > 0 && 'mt-3')}>
                {p}
              </p>
            ))}
          </div>
        )}

        <div className="px-6 py-6 sm:px-8">
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line bg-sunken px-4 py-2.5 text-micro font-semibold uppercase text-ink-3">
              <span>Item</span>
              <span>Amount</span>
            </div>
            {quote.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-ui text-ink-3">This quote has no lines.</p>
            ) : (
              quote.items.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-6 border-b border-line px-4 py-4 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-body font-medium text-ink">{item.name}</div>
                    {item.description && <p className="mt-0.5 text-meta text-ink-2">{item.description}</p>}
                    <div className="mt-1 text-meta text-ink-3">
                      {item.quantity} × {cash(item.unitPrice)} · {item.billingLabel}
                      {item.discount > 0 && ` · ${item.discount}% off`}
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-body text-ink">{cash(item.total)}</div>
                </div>
              ))
            )}
          </div>

          <dl className="ml-auto mt-5 w-full max-w-[320px] text-body">
            {/* Each line's Amount is already net of its own discount, so a bare
                "Subtotal" reads as a sum of the column above and doesn't match it. */}
            <Row label={quote.discountTotal > 0 ? 'Subtotal before discounts' : 'Subtotal'} value={cash(quote.subtotal)} />
            {quote.discountTotal > 0 && <Row label="Discount" value={`−${cash(quote.discountTotal)}`} />}
            {quote.taxRate > 0 && <Row label={`Tax (${quote.taxRate}%)`} value={cash(quote.tax)} />}
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line-strong pt-3">
              <dt className="font-medium text-ink">Total</dt>
              <dd className="tabular font-display text-[26px] leading-8 text-ink">{cash(quote.total)}</dd>
            </div>
          </dl>
        </div>

        {quote.terms.trim() && (
          <section className="border-t border-line px-6 py-6 text-meta leading-5 text-ink-2 sm:px-8">
            <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">Terms</h2>
            {quote.terms.split(/\n{2,}/).map((p, i) => (
              <p key={i} className={cn(i > 0 && 'mt-2')}>
                {p}
              </p>
            ))}
          </section>
        )}
      </Card>

      <div className="mt-6">
        <Decision quote={quote} orgName={orgName} panel={panel} setPanel={setPanel} respond={respond} />
      </div>

      {quote.preparedBy && (
        <p className="mt-6 text-center text-meta text-ink-3">
          Questions? {quote.preparedBy.name}
          {quote.preparedBy.title ? `, ${quote.preparedBy.title}` : ''}
          {quote.preparedBy.email ? ` · ${quote.preparedBy.email}` : ''}
        </p>
      )}
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular text-ink">{value}</dd>
    </div>
  );
}

function AnsweredBanner({ status }: { status: 'Accepted' | 'Declined' }) {
  return (
    <div
      className={cn(
        'mb-5 flex items-center gap-3 rounded-lg px-4 py-3.5 text-body font-medium',
        status === 'Accepted' ? 'bg-success/10 text-success' : 'bg-sunken text-ink-2',
      )}
    >
      {status === 'Accepted' ? <CheckCircle size={20} weight="fill" /> : <XCircle size={20} />}
      {status === 'Accepted' ? 'Thank you — your acceptance has been sent through.' : 'Thank you — we have passed that on.'}
    </div>
  );
}

type Quote = GetPublicQuoteOutputType;

/** Accept, decline, or the state that says why neither is on offer. */
function Decision({
  quote,
  orgName,
  panel,
  setPanel,
  respond,
}: {
  quote: Quote;
  orgName: string;
  panel: 'none' | 'accept' | 'decline';
  setPanel: (p: 'none' | 'accept' | 'decline') => void;
  respond: (input: Parameters<typeof respondToQuote>[0]) => Promise<{ status: string }>;
}) {
  if (quote.status === 'Accepted') {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle size={24} weight="fill" />
        </div>
        <h2 className="font-display text-display-sm text-ink">Accepted</h2>
        <p className="mt-2 text-body text-ink-2">
          {quote.acceptedName ?? 'You'}
          {quote.acceptedTitle ? `, ${quote.acceptedTitle},` : ''} accepted this quote{quote.acceptedAt ? ` on ${longDate(localDay(quote.acceptedAt))}` : ''}. {orgName} will be in touch about next
          steps.
        </p>
      </Card>
    );
  }

  if (quote.status === 'Declined') {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-2">
          <XCircle size={24} />
        </div>
        <h2 className="font-display text-display-sm text-ink">Declined</h2>
        <p className="mt-2 text-body text-ink-2">
          This quote was declined{quote.declinedAt ? ` on ${longDate(localDay(quote.declinedAt))}` : ''}. If that was a mistake, reply to the email and {orgName} can send a fresh one.
        </p>
      </Card>
    );
  }

  if (quote.status === 'Void') {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-2">
          <Prohibit size={24} />
        </div>
        <h2 className="font-display text-display-sm text-ink">Withdrawn</h2>
        <p className="mt-2 text-body text-ink-2">{orgName} has withdrawn this quote. Ask them for an up-to-date one.</p>
      </Card>
    );
  }

  if (quote.status === 'Expired') {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Clock size={24} />
        </div>
        <h2 className="font-display text-display-sm text-ink">This quote has expired</h2>
        <p className="mt-2 text-body text-ink-2">
          It was valid until {quote.expiresOn ? longDate(quote.expiresOn) : 'its expiry date'}. Reply to the email and {orgName} will send you current pricing.
        </p>
      </Card>
    );
  }

  if (panel === 'accept') return <AcceptForm quote={quote} onCancel={() => setPanel('none')} respond={respond} />;
  if (panel === 'decline') return <DeclineForm onCancel={() => setPanel('none')} respond={respond} />;

  return (
    <Card>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">Ready to go ahead?</h2>
          <p className="mt-1 text-body text-ink-2">
            Accepting records your name and the date against this quote{quote.expiresOn ? `, which holds until ${longDate(quote.expiresOn)}` : ''}.
          </p>
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <Button variant="primary" size="lg" className="flex-1 sm:flex-none" onClick={() => setPanel('accept')}>
            Accept quote
          </Button>
          <Button variant="secondary" size="lg" className="flex-1 sm:flex-none" onClick={() => setPanel('decline')}>
            Decline
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AcceptForm({
  quote,
  onCancel,
  respond,
}: {
  quote: Quote;
  onCancel: () => void;
  respond: (input: Parameters<typeof respondToQuote>[0]) => Promise<{ status: string }>;
}) {
  const { token = '' } = useParams();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const submit = useMutation({
    mutationFn: () => respond({ token, action: 'accept', name: name.trim(), title: title.trim(), email: email.trim() || undefined, authorized, website }),
    onError: e => setError((e as Error)?.message ?? 'That didn’t go through. Try again.'),
  });

  return (
    <Card>
      <h2 className="font-display text-display-sm text-ink">Accept {quote.number}</h2>
      <p className="mt-1 text-body text-ink-2">Type your name as you would sign it. We record it against the quote with today’s date.</p>
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={e => {
          e.preventDefault();
          setError(null);
          if (name.trim().length < 2) return setError('Type your full name');
          if (!title.trim()) return setError('Add your job title');
          if (!authorized) return setError('Please confirm you’re authorised to accept this');
          submit.mutate();
        }}
      >
        <Field label="Full name" required>
          <Input ref={firstField} value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Priya Raman" />
        </Field>
        <Field label="Job title" required>
          <Input value={title} onChange={e => setTitle(e.target.value)} autoComplete="organization-title" placeholder="Operations Director" />
        </Field>
        <Field label="Email" hint="So we can send you a copy of what you accepted.">
          <Input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@company.com" />
        </Field>

        {/* Honeypot: hidden from people, irresistible to bots. */}
        <input value={website} onChange={e => setWebsite(e.target.value)} name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-sunken px-3.5 py-3">
          <input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
          <span className="text-body text-ink">
            I’m authorised to accept this quote on behalf of {quote.companyName ?? 'my organization'}.
          </span>
        </label>

        {error && <p className="text-ui text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="lg" onClick={onCancel} disabled={submit.isPending}>
            Back
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={submit.isPending}>
            Accept this quote
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeclineForm({ onCancel, respond }: { onCancel: () => void; respond: (input: Parameters<typeof respondToQuote>[0]) => Promise<{ status: string }> }) {
  const { token = '' } = useParams();
  const [reason, setReason] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => respond({ token, action: 'decline', reason: reason.trim() || undefined, website }),
    onError: e => setError((e as Error)?.message ?? 'That didn’t go through. Try again.'),
  });

  return (
    <Card>
      <h2 className="font-display text-display-sm text-ink">Decline this quote</h2>
      <p className="mt-1 text-body text-ink-2">No explanation needed — but anything you tell us helps.</p>
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={e => {
          e.preventDefault();
          setError(null);
          submit.mutate();
        }}
      >
        <Field label="Anything you want to add" hint="Optional.">
          <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="The timing doesn’t work for us this quarter." />
        </Field>
        <input value={website} onChange={e => setWebsite(e.target.value)} name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        {error && <p className="text-ui text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="lg" onClick={onCancel} disabled={submit.isPending}>
            Back
          </Button>
          <Button type="submit" variant="danger" size="lg" loading={submit.isPending}>
            Decline
          </Button>
        </div>
      </form>
    </Card>
  );
}
