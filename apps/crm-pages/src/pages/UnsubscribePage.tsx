import { CheckCircle, EnvelopeSimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getUnsubscribe, setUnsubscribe } from 'zitejs/api';
import { applyBrand } from '../lib/brand';
import { Button, Card, Loading, Masthead, Notice, Page } from '../ui/kit';

/**
 * The page at the bottom of every sequence email.
 *
 * It says plainly what it will do before it does it, does it in one click, and
 * then says what happened — including how to undo it, because people
 * unsubscribe by accident. It never shows the address or the name behind the
 * link: the token is the only secret and a leaked one must not become a
 * lookup tool.
 */
export default function UnsubscribePage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [justChanged, setJustChanged] = useState<'off' | 'on' | null>(null);

  const query = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: () => getUnsubscribe({ token }),
    enabled: token.length >= 16,
    retry: false,
  });

  useEffect(() => {
    if (query.data?.brandColor) applyBrand(query.data.brandColor);
  }, [query.data?.brandColor]);

  const change = useMutation({
    mutationFn: (unsubscribed: boolean) => setUnsubscribe({ token, unsubscribed }),
    onSuccess: (result) => {
      setJustChanged(result.unsubscribed ? 'off' : 'on');
      void qc.invalidateQueries({ queryKey: ['unsubscribe', token] });
    },
  });

  if (token.length < 16 || query.isError) {
    return (
      <Notice title="This link isn’t valid any more">
        Unsubscribe links come from the footer of an email we sent you. Check the most recent one, or reply to it and ask us to take you off the list.
      </Notice>
    );
  }
  if (query.isPending || !query.data) return <Loading label="Just a moment…" width="sm" />;

  const org = query.data;
  const unsubscribed = org.unsubscribed;

  return (
    <Page width="sm">
      <Masthead name={org.organizationName} logoUrl={org.logoUrl}>
        Email preferences
      </Masthead>

      <Card>
        {justChanged ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle size={24} weight="duotone" />
            </span>
            <div>
              <h1 className="font-display text-display-sm text-ink">{justChanged === 'off' ? 'You’re unsubscribed' : 'You’re back on the list'}</h1>
              <p className="mt-2 text-body text-ink-2">
                {justChanged === 'off'
                  ? `${org.organizationName} has stopped its marketing and follow-up emails to this address, and taken you off any sequence you were on. Someone may still reply to you directly if you write to them.`
                  : `${org.organizationName} can email this address again.`}
              </p>
            </div>
            {/* Don't clear `justChanged` here: onSuccess sets it to the new value, and
                clearing it first drops straight back to the other branch mid-request —
                the card flashes to the opposite state and the button never shows loading. */}
            <Button variant="ghost" loading={change.isPending} onClick={() => change.mutate(justChanged === 'on')}>
              {justChanged === 'off' ? 'Actually, keep emailing me' : 'Unsubscribe after all'}
            </Button>
            {change.isError && <p className="text-meta text-danger">That didn’t go through. Try again in a moment.</p>}
          </div>
        ) : unsubscribed ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
                <EnvelopeSimple size={20} weight="duotone" />
              </span>
              <div>
                <h1 className="font-display text-display-sm text-ink">You’re already unsubscribed</h1>
                <p className="mt-2 text-body text-ink-2">{org.organizationName} isn’t sending marketing or follow-up email to this address.</p>
              </div>
            </div>
            <Button variant="primary" size="lg" loading={change.isPending} onClick={() => change.mutate(false)}>
              Start emailing me again
            </Button>
            {change.isError && <p className="text-meta text-danger">That didn’t go through. Try again in a moment.</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
                <EnvelopeSimple size={20} weight="duotone" />
              </span>
              <div>
                <h1 className="font-display text-display-sm text-ink">Unsubscribe from {org.organizationName}</h1>
                <p className="mt-2 text-body text-ink-2">
                  This stops the marketing and follow-up emails to this address, and takes you off anything already scheduled. It takes effect straight away, and you can change your mind on this page.
                </p>
              </div>
            </div>
            <Button variant="primary" size="lg" loading={change.isPending} onClick={() => change.mutate(true)}>
              Unsubscribe
            </Button>
            {change.isError && <p className="text-meta text-danger">That didn’t go through. Try again in a moment.</p>}
          </div>
        )}
      </Card>

      {org.mailingAddress && <p className="mt-6 whitespace-pre-line text-center text-meta text-ink-3">{org.mailingAddress}</p>}
    </Page>
  );
}
