import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateProfile } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Input, Select, SwitchRow, Textarea } from '../../ui/Form';
import { Segmented } from '../../ui/Form';
import { ROLE_DESCRIPTIONS } from '@project/shared/roles';
import type { Role } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { applyTheme, readTheme, type Theme } from '../../lib/theme';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { Group, SaveBar, SectionHead, SettingRow } from './kit';
import { timezonesWith } from './timezones';

/**
 * Your own profile. Everything here is yours alone — your role is shown but
 * not editable, because giving yourself a bigger role is exactly the thing
 * settings must never allow.
 */
export function ProfileSection() {
  const ws = useWorkspace();
  const invalidate = useInvalidateWorkspace();
  const me = ws.me;

  const initial = useMemo(
    () => ({
      name: me.name ?? '',
      title: me.title ?? '',
      phone: me.phone ?? '',
      timezone: me.timezone || ws.settings.timezone,
      emailSignature: me.signature ?? '',
    }),
    [me, ws.settings.timezone],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const prefs = (me.preferences ?? {}) as Record<string, unknown>;
  // Unset means "whatever the organization does"; once you touch it, it is yours.
  const digest = prefs.dailyDigest === undefined ? ws.settings.preferences.dailyDigest : prefs.dailyDigest === true;
  const [theme, setTheme] = useState<Theme>(readTheme);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateProfile>[0]) => updateProfile(patch),
    onSuccess: () => {
      void invalidate();
      toast.success('Profile saved');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save your profile')),
  });

  const setPreference = (key: 'dailyDigest' | 'taskReminders' | 'mentionEmails', value: boolean) => {
    save.mutate({ preferences: { [key]: value } });
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Your profile"
        description="How you appear on records and how you sign the email you send from here."
        actions={<Avatar person={me} size="xl" />}
      />

      <Group>
        <div>
          <SettingRow label="Name" hint="Shown on every record you own and in every activity you log." htmlFor="profile-name">
            <Input id="profile-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={120} className="max-w-sm" />
          </SettingRow>
          <SettingRow label="Job title" hint="Used in your email signature’s merge fields." htmlFor="profile-title">
            <Input id="profile-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Account Executive" maxLength={120} className="max-w-sm" />
          </SettingRow>
          <SettingRow label="Phone" htmlFor="profile-phone">
            <Input id="profile-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(415) 555-0142" maxLength={60} className="max-w-sm" />
          </SettingRow>
          <SettingRow label="Email" hint="You sign in with this address; it can’t be changed here.">
            <p className="text-ui text-ink-2">{me.email}</p>
          </SettingRow>
          <SettingRow label="Role" hint={ROLE_DESCRIPTIONS[me.role as Role]}>
            <Badge tone={me.role === 'Admin' ? 'accent' : 'neutral'}>{me.role}</Badge>
          </SettingRow>
          <SettingRow label="Timezone" hint="Due dates, meeting times and your daily digest follow this." htmlFor="profile-tz">
            <Select id="profile-tz" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className="max-w-sm">
              {timezonesWith(form.timezone, ws.settings.timezone).map(tz => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow label="Email signature" hint="Added to the bottom of email you send from a record." htmlFor="profile-sig" align="start">
            <Textarea id="profile-sig" value={form.emailSignature} onChange={e => setForm(f => ({ ...f, emailSignature: e.target.value }))} minRows={4} maxLength={2000} placeholder={`${form.name}\n${form.title || 'Your title'}\n${form.phone || ''}`} />
          </SettingRow>
        </div>
        <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(form)} onReset={() => setForm(initial)} />
      </Group>

      <Group title="Notifications" note="The inbox always fills up; these are the things that reach you outside it.">
        <div className="rounded-lg border border-line bg-card px-4 py-1 shadow-hairline">
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow
              label="Morning digest"
              description="One email before you start: what is due today, who you are meeting, and any lead still waiting."
              checked={digest}
              onCheckedChange={v => setPreference('dailyDigest', v)}
              disabled={save.isPending}
            />
          </div>
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow label="Task reminders" description="A nudge when something you own is due and still open." checked={prefs.taskReminders !== false} onCheckedChange={v => setPreference('taskReminders', v)} disabled={save.isPending} />
          </div>
          <div className="border-b border-line py-1.5 last:border-b-0">
            <SwitchRow label="Email me when I’m mentioned" description="Otherwise mentions wait for you in the inbox." checked={prefs.mentionEmails !== false} onCheckedChange={v => setPreference('mentionEmails', v)} disabled={save.isPending} />
          </div>
        </div>
      </Group>

      <Group title="Appearance" note="Stored in this browser, so you can run dark at home and light in the office.">
        <SettingRow label="Theme" hint="Match system follows whatever your computer is set to.">
          <Segmented
            value={theme}
            onChange={(v: Theme) => {
              setTheme(v);
              applyTheme(v);
            }}
            options={[
              { value: 'light' as Theme, label: 'Light' },
              { value: 'dark' as Theme, label: 'Dark' },
              { value: 'system' as Theme, label: 'Match system' },
            ]}
          />
        </SettingRow>
      </Group>
    </div>
  );
}
