import { useMutation } from '@tanstack/react-query';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateOrgSettings } from 'zitejs/api';
import { Input, Select, SwitchRow, Textarea } from '../../ui/Form';
import { Button } from '../../ui/Button';
import { CURRENCIES } from '@project/shared/constants';
import { formatMoney } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { copyText } from '../../lib/clipboard';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { OrgMark } from '../../glyphs';
import { Explainer, Group, ReadOnlyValue, SaveBar, SectionHead, SettingRow } from './kit';
import { MONTHS, timezonesWith } from './timezones';
import { LoadSample, useLoadSample } from './SampleLoad';

type SaveCurrency = NonNullable<Parameters<typeof updateOrgSettings>[0]['currency']>;

/**
 * The organization itself: its name, its face to buyers, and the money and
 * calendar every figure in the app is counted in.
 */
export function GeneralSection() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const s = ws.settings;
  // Offered only to an admin while the workspace is still empty, and kept on
  // screen while it runs so a refetch mid-load can't pull it away. The server
  // refuses on the same rule, so a stale offer only ever shows an error.
  const sample = useLoadSample();
  const offerSample = (ws.isAdmin && ws.sample.canLoad && !sample.checking) || sample.load.isPending;

  const initial = useMemo(
    () => ({
      organizationName: s.organizationName,
      logoUrl: s.logoUrl ?? '',
      brandColor: s.brandColor,
      currency: s.currency,
      timezone: s.timezone,
      fiscalYearStartMonth: s.fiscalYearStartMonth,
      mailingAddress: s.mailingAddress,
      emailFooter: s.emailFooter,
    }),
    [s],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const validColor = /^#[0-9a-fA-F]{6}$/.test(form.brandColor);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateOrgSettings>[0]) => updateOrgSettings(patch),
    onSuccess: () => {
      void invalidate();
      toast.success('Settings saved');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save those settings')),
  });

  const savePreference = (key: 'stalledEnabled' | 'requireLostReason' | 'dailyDigest', value: boolean) => save.mutate({ preferences: { ...s.preferences, [key]: value } });

  return (
    <div className="flex flex-col gap-8">
      <SectionHead title="General" description="What your organization is called, how it looks to the people you sell to, and the money and calendar it keeps." />

      <Group>
        <div>
          <SettingRow label="Organization name" hint="Shown in the top bar, on every public page, and at the foot of every email." htmlFor="org-name">
            <div className="flex items-center gap-3">
              <OrgMark name={form.organizationName || 'Your organization'} logoUrl={form.logoUrl || null} />
              <Input id="org-name" value={form.organizationName} onChange={e => setForm(f => ({ ...f, organizationName: e.target.value }))} maxLength={120} className="max-w-sm" />
            </div>
          </SettingRow>
          <SettingRow label="Logo URL" hint="An https:// address. Left empty, your initials are used instead." htmlFor="org-logo">
            <Input id="org-logo" value={form.logoUrl} onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…/logo.png" maxLength={600} className="max-w-sm" />
          </SettingRow>
          <SettingRow label="Brand colour" hint="The accent on your public pages — forms, meeting links, quotes and unsubscribe." htmlFor="org-color" align="start">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  id="org-color"
                  type="color"
                  value={validColor ? form.brandColor : '#1d4e80'}
                  onChange={e => setForm(f => ({ ...f, brandColor: e.target.value }))}
                  aria-label="Brand colour"
                  className="h-9 w-12 cursor-pointer rounded-md border border-control/60 bg-card p-1"
                />
                <Input value={form.brandColor} onChange={e => setForm(f => ({ ...f, brandColor: e.target.value }))} invalid={!validColor} maxLength={7} className="w-32 font-mono" />
                {!validColor && <span className="text-meta text-danger">Use a colour like #1d4e80</span>}
              </div>
              <BrandPreview color={validColor ? form.brandColor : '#1d4e80'} org={form.organizationName || 'Your organization'} logoUrl={form.logoUrl || null} />
            </div>
          </SettingRow>
        </div>
        <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate({ ...form, currency: form.currency as SaveCurrency, logoUrl: form.logoUrl.trim() || null })} onReset={() => setForm(initial)} />
      </Group>

      <Group title="Money and calendar" note="Every amount, quota and report in the app is counted in these.">
        <div>
          <SettingRow label="Currency" hint={`Amounts render as ${formatMoney(1234567.89, form.currency, { cents: false })}.`} htmlFor="org-currency">
            <Select id="org-currency" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="max-w-[200px]">
              {CURRENCIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow label="Timezone" hint="The day a scheduled job, a digest and a “today” count belong to." htmlFor="org-tz">
            <Select id="org-tz" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className="max-w-sm">
              {timezonesWith(form.timezone).map(tz => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow label="Fiscal year starts" hint="Quarters in the forecast and on quotas count from this month." htmlFor="org-fy">
            <Select id="org-fy" value={String(form.fiscalYearStartMonth)} onChange={e => setForm(f => ({ ...f, fiscalYearStartMonth: Number(e.target.value) }))} className="max-w-[200px]">
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </SettingRow>
        </div>
      </Group>

      <Group title="Email footer" note="Sent with every sequence email, because bulk email has to say who it is from and where they are.">
        <div>
          <SettingRow label="Mailing address" hint="A real postal address. Required by anti-spam law in most countries." htmlFor="org-address" align="start">
            <Textarea id="org-address" value={form.mailingAddress} onChange={e => setForm(f => ({ ...f, mailingAddress: e.target.value }))} minRows={3} maxLength={400} placeholder={'1201 SE Water Ave, Suite 300\nPortland, OR 97214'} />
          </SettingRow>
          <SettingRow label="Footer line" hint="One line above the address — how you describe yourselves." htmlFor="org-footer" align="start">
            <Textarea id="org-footer" value={form.emailFooter} onChange={e => setForm(f => ({ ...f, emailFooter: e.target.value }))} minRows={2} maxLength={600} placeholder="Operations software for people who move things." />
          </SettingRow>
        </div>
      </Group>

      <Group title="How the app behaves" note="These change what everyone sees, so they save the moment you switch them.">
        <div className="rounded-lg border border-line bg-card px-4 py-1 shadow-hairline">
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow
              label="Show stalled deals"
              description="A deal past its stage’s day limit is badged “Stalled 12d” on the board, in lists and on Home."
              checked={s.preferences.stalledEnabled}
              onCheckedChange={v => savePreference('stalledEnabled', v)}
              disabled={save.isPending}
            />
          </div>
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow
              label="Ask for a reason when a deal is lost"
              description="Marking a deal lost picks from the Lost Reason list. Off, the reason is optional — and the loss report goes quiet."
              checked={s.preferences.requireLostReason}
              onCheckedChange={v => savePreference('requireLostReason', v)}
              disabled={save.isPending}
            />
          </div>
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow
              label="Send everyone a morning digest"
              description="The default for new teammates; anyone can turn their own off in their profile."
              checked={s.preferences.dailyDigest}
              onCheckedChange={v => savePreference('dailyDigest', v)}
              disabled={save.isPending}
            />
          </div>
        </div>
        <LeadResponseRow />
      </Group>

      <Group title="Public pages" note="Forms, meeting links, quotes and unsubscribe all live on one address.">
        <SettingRow label="Public pages URL" hint="Recorded automatically the first time someone opens one of your public pages." align="start">
          <ReadOnlyValue value={s.pagesUrl} empty="Not recorded yet — open one of your forms or meeting links once and it appears here." onCopy={() => void copyText(s.pagesUrl ?? '')} />
        </SettingRow>
        <Explainer summary="Why isn’t this something I type?">
          <p>
            Every link the CRM puts in an email — a quote to accept, a meeting to book, an unsubscribe — has to point at the address your buyers can actually reach. Typed by hand, that is one character away from a link that
            silently goes nowhere.
          </p>
          <p>So CRM Pages records its own address the first time a page is opened, and every link is built from that. If it moves, open a page on the new address once and this follows.</p>
        </Explainer>
        {s.pagesUrl && (
          <div>
            <Button variant="secondary" size="sm" asChild trailing={<ArrowSquareOut size={14} />}>
              <a href={s.pagesUrl} target="_blank" rel="noreferrer">
                Open your public pages
              </a>
            </Button>
          </div>
        )}
      </Group>

      {offerSample && (
        <div className="border-t border-line pt-6">
          <LoadSample {...sample} />
        </div>
      )}
    </div>
  );
}

function LeadResponseRow() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const [hours, setHours] = useState(String(ws.settings.preferences.leadResponseHours));
  useEffect(() => setHours(String(ws.settings.preferences.leadResponseHours)), [ws.settings.preferences.leadResponseHours]);
  const save = useMutation({
    mutationFn: (value: number) => updateOrgSettings({ preferences: { ...ws.settings.preferences, leadResponseHours: value } }),
    onSuccess: () => {
      void invalidate();
      toast.success('Lead response target saved');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that target')),
  });
  const value = Number(hours);
  const valid = Number.isFinite(value) && value >= 1 && value <= 336;
  const changed = valid && value !== ws.settings.preferences.leadResponseHours;
  return (
    <SettingRow label="Lead response target" hint="A new lead nobody has touched inside this many hours is called out on Home and in the lead report." htmlFor="org-lead-hours">
      <div className="flex items-center gap-2">
        <Input id="org-lead-hours" type="number" min={1} max={336} value={hours} onChange={e => setHours(e.target.value)} invalid={!valid} className="w-24" />
        <span className="text-ui text-ink-2">hours</span>
        {changed && (
          <Button variant="secondary" size="sm" onClick={() => save.mutate(value)} loading={save.isPending}>
            Save
          </Button>
        )}
      </div>
    </SettingRow>
  );
}

/** What a buyer sees: the same paper and ink, with the organization's accent on the one button. */
function BrandPreview({ color, org, logoUrl }: { color: string; org: string; logoUrl: string | null }) {
  return (
    <figure className="max-w-sm overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <OrgMark name={org} logoUrl={logoUrl} />
        <span className="truncate text-meta font-medium text-ink-2">{org}</span>
      </div>
      <div className="px-4 py-4">
        <p className="font-display text-[19px] leading-6 text-ink">Book a walkthrough</p>
        <p className="mt-1 text-meta text-ink-2">Thirty minutes, and we’ll show you the part you asked about.</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-md px-3 text-ui font-medium text-white" style={{ backgroundColor: color }}>
            Choose a time
          </span>
          <span className="text-ui font-medium underline decoration-2 underline-offset-[3px]" style={{ color, textDecorationColor: `${color}66` }}>
            Or email us
          </span>
        </div>
      </div>
      <figcaption className="border-t border-line bg-sunken px-4 py-2 text-micro font-semibold uppercase text-ink-3">Your public pages</figcaption>
    </figure>
  );
}
