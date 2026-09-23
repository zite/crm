import { CaretDown, CheckCircle, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getPublicForm, submitForm, type GetPublicFormOutputType } from 'zitejs/api';
import { useOrg } from '../lib/org';
import { Button, Card, cn, Field, Input, Masthead, Notice, Page, Textarea } from '../ui/kit';

/**
 * The form a buyer lands on. One column, the vendor's own colour, 44px targets,
 * and a real success state.
 *
 * It validates in the browser so a mistake is caught before a round trip — and
 * the server validates again, because a page cannot be trusted. `?embed=1`
 * drops the masthead and the page padding so it sits inside an iframe without a
 * second frame around it.
 */
type PublicForm = NonNullable<GetPublicFormOutputType['form']>;
type FormField = PublicForm['fields'][number];
type Values = Record<string, string | boolean>;

export default function FormPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const embed = params.get('embed') === '1';
  const org = useOrg();

  const query = useQuery({
    queryKey: ['public-form', slug],
    queryFn: () => getPublicForm({ slug }),
    retry: 1,
  });

  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ message: string } | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const firstInvalid = useRef<string | null>(null);

  const form = query.data?.state === 'live' ? query.data.form : null;
  const fields = useMemo(() => form?.fields ?? [], [form]);


  const send = useMutation({
    mutationFn: () =>
      submitForm({
        slug,
        answers: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== false)) as Record<string, string | boolean>,
        honeypot: honeypotRef.current?.value || undefined,
        utm: {
          source: params.get('utm_source') ?? undefined,
          medium: params.get('utm_medium') ?? undefined,
          campaign: params.get('utm_campaign') ?? undefined,
        },
        pageUrl: window.location.href.slice(0, 500),
        referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
      }),
    onSuccess: result => {
      if (!result.ok && result.fieldError) {
        setErrors({ [result.fieldError.key]: result.fieldError.message });
        focusField(result.fieldError.key);
        return;
      }
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      setDone({ message: result.successMessage });
    },
    onError: () => setErrors({ _form: 'Something went wrong sending that. Try again in a moment.' }),
  });

  // Inside an iframe these have to stay flat: a full-height centred card with its
  // own border is a second page inside someone else's.
  const notice = (title: string, body: string) =>
    embed ? (
      <div className="min-h-dvh bg-card px-6 py-12 text-center sm:px-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-2">
          <Warning size={22} weight="duotone" />
        </div>
        <h1 className="mt-4 font-display text-display-sm text-ink">{title}</h1>
        <p className="mx-auto mt-2 max-w-[42ch] text-body text-ink-2">{body}</p>
      </div>
    ) : (
      <Notice title={title}>{body}</Notice>
    );

  if (query.isPending || org.isPending) return <FormSkeleton embed={embed} />;
  if (query.isError) return notice('We couldn’t load this form', 'Check the link you were sent, or try again in a moment.');
  if (query.data?.state === 'paused') {
    return notice('This form is closed', 'It isn’t taking submissions right now. If someone sent you here, reply to their email and they’ll help.');
  }
  if (query.data?.state !== 'live' || !form) {
    return notice('That form isn’t here', 'The link may be out of date, or the form has been taken down.');
  }

  const orgName = org.data?.organizationName ?? '';

  const validate = () => {
    const next: Record<string, string> = {};
    firstInvalid.current = null;
    for (const field of fields) {
      const name = shortName(field);
      const raw = values[field.key];
      if (field.type === 'checkbox') {
        if (field.required && raw !== true) next[field.key] = 'Tick this box to send the form';
        continue;
      }
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) {
        if (field.required) next[field.key] = name ? `${name} is required` : 'This one is required';
        continue;
      }
      if (field.type === 'email' && !/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(text)) next[field.key] = 'That email address doesn’t look right';
      if (field.type === 'number' && !Number.isFinite(Number(text.replace(/[, ]/g, '')))) next[field.key] = name ? `${name} has to be a number` : 'This has to be a number';
      if (field.type === 'long_text' ? text.length > 4000 : text.length > 240) next[field.key] = name ? `${name} is too long` : 'That answer is too long';
    }
    setErrors(next);
    const firstKey = fields.find(f => next[f.key])?.key;
    if (firstKey) focusField(firstKey);
    return Object.keys(next).length === 0;
  };

  // In an iframe the card is the whole page, so it drops its frame and corners
  // rather than drawing a box inside the host's box.
  const cardClass = embed ? 'rounded-none border-0 shadow-none' : '';

  const body = done ? (
    <Card className={cn('text-center', cardClass)}>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle size={24} weight="duotone" />
      </div>
      <h1 className="font-display text-display-sm text-ink">Thanks</h1>
      <p className="mt-2 text-body leading-7 text-ink-2 whitespace-pre-wrap">{done.message}</p>
    </Card>
  ) : (
    <Card className={cardClass}>
      <h1 className="font-display text-display-sm text-ink">{form.name}</h1>
      {form.intro && <p className="mt-2.5 text-body leading-7 text-ink-2 whitespace-pre-wrap">{form.intro}</p>}

      <form
        className="mt-7 flex flex-col gap-5"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          if (send.isPending) return;
          if (!validate()) return;
          send.mutate();
        }}
      >
        {fields.map((field, index) => (
          <FieldControl
            key={field.id}
            field={field}
            autoFocus={index === 0 && !embed}
            value={values[field.key]}
            error={errors[field.key]}
            onChange={value => {
              setValues(v => ({ ...v, [field.key]: value }));
              if (errors[field.key]) setErrors(e => ({ ...e, [field.key]: '' }));
            }}
          />
        ))}

        {/* The honeypot: off-screen, never tabbed to, never announced. A person can't fill it. */}
        <input
          ref={honeypotRef}
          type="text"
          name="website_url_confirm"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] top-0 h-px w-px opacity-0"
          onChange={() => undefined}
        />

        {errors._form && <p className="text-meta text-danger">{errors._form}</p>}

        <Button type="submit" variant="primary" size="lg" loading={send.isPending} className="w-full">
          {send.isPending ? 'Sending…' : form.submitLabel}
        </Button>
        <p className="text-center text-meta text-ink-3">{orgName ? `Goes straight to the ${orgName} team.` : 'Goes straight to the team.'}</p>
      </form>
    </Card>
  );

  if (embed) {
    return (
      <div className="min-h-dvh bg-card">
        <div className="mx-auto w-full max-w-[640px]">{body}</div>
      </div>
    );
  }

  return (
    <Page width="md">
      {/* The masthead says who you are writing to. The form's own name is the
          heading two lines below it, so it doesn't say it twice. */}
      <Masthead name={orgName || 'Us'} logoUrl={org.data?.logoUrl}>
        {done ? 'Thanks for getting in touch' : undefined}
      </Masthead>
      {body}
    </Page>
  );
}

/** Shaped like the form it is about to become — never a spinner on a page a buyer lands on. */
function FormSkeleton({ embed }: { embed: boolean }) {
  const fields = (
    <div role="status" aria-label="Loading the form">
      <div className="skeleton h-7 w-2/5 rounded-md" />
      <div className="skeleton mt-3 h-4 w-4/5" />
      <div className="mt-8 flex flex-col gap-5">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton h-11 w-full rounded-md" />
          </div>
        ))}
        <div className="skeleton h-12 w-full rounded-md" />
      </div>
    </div>
  );
  if (embed) {
    return (
      <div className="min-h-dvh bg-card">
        <div className="mx-auto w-full max-w-[640px] p-6 sm:p-8">{fields}</div>
      </div>
    );
  }
  return (
    <Page width="md">
      <div className="mb-7 flex items-center gap-3">
        <div className="skeleton h-10 w-10 rounded-md" />
        <div className="skeleton h-4 w-40" />
      </div>
      <Card>{fields}</Card>
    </Page>
  );
}

/**
 * A label short enough to sit inside a sentence. A question or a consent line
 * gives "What are you trying to solve? is required", so those get a neutral
 * message instead of their own label read back at them.
 */
function shortName(field: FormField) {
  const label = field.label.trim();
  return label.length <= 28 && !/[?.!:,]$/.test(label) ? label : null;
}

function focusField(key: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(key)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function FieldControl({ field, value, error, onChange, autoFocus }: { field: FormField; value: string | boolean | undefined; error?: string; onChange: (value: string | boolean) => void; autoFocus?: boolean }) {
  // A screen reader has to hear the problem, not just see a red hairline, so the
  // message and the hint carry ids the control points at.
  const noteId = `note-${field.key}`;
  const shared = {
    'data-field': field.key,
    id: `field-${field.key}`,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': error || field.help ? noteId : undefined,
  } as const;
  const note = error ? <span id={noteId}>{error}</span> : field.help ? <span id={noteId}>{field.help}</span> : undefined;

  if (field.type === 'checkbox') {
    return (
      <div className="flex flex-col gap-1.5">
        {/* The whole label is the target — 47px tall for one line — and the box
            stays on the first line when a consent sentence wraps to three. */}
        <label className="flex cursor-pointer items-start gap-3 py-3 text-body text-ink">
          <input
            {...shared}
            type="checkbox"
            checked={value === true}
            autoFocus={autoFocus}
            onChange={e => onChange(e.target.checked)}
            className="mt-[3px] h-[18px] w-[18px] shrink-0 accent-[rgb(var(--accent))]"
          />
          <span>
            {field.label}
            {field.required && <span className="ml-0.5 text-danger">*</span>}
          </span>
        </label>
        {error ? <span id={noteId} className="text-meta text-danger">{error}</span> : field.help ? <span id={noteId} className="text-meta text-ink-3">{field.help}</span> : null}
      </div>
    );
  }

  return (
    <Field label={field.label} required={field.required} hint={error ? undefined : note} error={error ? note : undefined}>
      {field.type === 'long_text' ? (
        <Textarea {...shared} value={typeof value === 'string' ? value : ''} autoFocus={autoFocus} placeholder={field.placeholder ?? ''} invalid={Boolean(error)} onChange={e => onChange(e.target.value)} />
      ) : field.type === 'select' ? (
        // The caret is a real element in the ink scale, not a baked-in hex in a
        // data URI that stays warm grey when the page goes dark.
        <span className="relative block">
          <select
            {...shared}
            value={typeof value === 'string' ? value : ''}
            autoFocus={autoFocus}
            onChange={e => onChange(e.target.value)}
            className={cn(
              'h-11 w-full appearance-none rounded-md border bg-card px-3 pr-9 text-body text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
              error ? 'border-danger' : 'border-control/70',
              typeof value === 'string' && value ? 'text-ink' : 'text-ink-3',
              '[&>option]:text-ink',
            )}
          >
            <option value="">{field.placeholder ?? 'Choose one'}</option>
            {field.options.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <CaretDown size={14} weight="bold" aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
        </span>
      ) : (
        <Input
          {...shared}
          value={typeof value === 'string' ? value : ''}
          autoFocus={autoFocus}
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'text' : 'text'}
          inputMode={field.type === 'number' ? 'numeric' : field.type === 'phone' ? 'tel' : undefined}
          autoComplete={field.key === 'email' ? 'email' : field.key === 'name' ? 'name' : field.key === 'phone' ? 'tel' : field.key === 'companyName' ? 'organization' : 'off'}
          placeholder={field.placeholder ?? ''}
          invalid={Boolean(error)}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
