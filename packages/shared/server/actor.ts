import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { includes, PIGMENTS, ROLES, type Role } from '../constants';
import { hashIndex } from '../format';
import { can, canDeleteRecord, canManageAsset, capabilitiesFor, type Capability } from '../roles';
import { isDemo } from './demoPreview';
import { getSettings } from './settings';

/**
 * The signed-in teammate.
 *
 * Every CRM endpoint resolves who is acting from the SESSION, never from an id
 * in the request, so nobody can log a call or win a deal as someone else. The
 * first person to open a fresh install becomes its Admin; everyone after joins
 * with the organization's default role (Settings → Members).
 */

export type Actor = { id: string; name: string; email: string; role: Role; created: boolean };

type UserLike = { email?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

export const asRole = (v: unknown): Role => (includes(ROLES, v) ? v : 'Rep');

export const colorFor = (seed: string) => PIGMENTS[hashIndex(seed, PIGMENTS.length)];

export function nameFromEmail(email: string) {
  return (
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\d+/g, '')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase()) || email
  );
}

const SEEN_EVERY_MS = 10 * 60 * 1000;

export async function getActor(context: { user?: UserLike }): Promise<Actor> {
  const email = context.user?.email?.trim().toLowerCase();
  if (!email) throw new ZiteError('You need to be signed in', 'UNAUTHORIZED');

  const { rows } = await zite.sql({
    query: `SELECT id, "name", "role", "status", "lastSeenAt" FROM "Members" WHERE LOWER("email") = $1 ORDER BY created_at ASC LIMIT 1`,
    params: [email],
  });
  const row = rows[0];
  if (row) {
    if (row.status === 'Deactivated') throw new ZiteError('Your access has been turned off. Ask an admin to reactivate you.', 'FORBIDDEN');
    const patch: Record<string, unknown> = {};
    if (row.status === 'Invited') patch.status = 'Active';
    const seen = row.lastSeenAt ? Date.parse(String(row.lastSeenAt)) : 0;
    if (Date.now() - seen > SEEN_EVERY_MS) patch.lastSeenAt = new Date().toISOString();
    if (Object.keys(patch).length && !isDemo(context)) await zite.members.update({ id: String(row.id), record: patch as never }).catch(() => undefined);
    return { id: String(row.id), name: String(row.name || nameFromEmail(email)), email, role: asRole(row.role), created: false };
  }

  if (isDemo(context)) return demoActor(context, email);

  const { rows: profile } = await zite.sql({ query: `SELECT "name", "image" FROM "ziteUsers" WHERE LOWER("email") = $1 LIMIT 1`, params: [email] });
  const name =
    [context.user?.firstName, context.user?.lastName].filter(Boolean).join(' ').trim() ||
    (profile[0]?.name ? String(profile[0].name) : '') ||
    nameFromEmail(email);
  const { rows: admins } = await zite.sql({ query: `SELECT 1 FROM "Members" WHERE "role" = 'Admin' AND "status" <> 'Deactivated' LIMIT 1`, params: [] });
  const role: Role = admins.length ? (await getSettings()).defaultRole : 'Admin';
  const created = await zite.members.create({
    record: {
      name,
      email,
      role,
      status: 'Active',
      color: colorFor(email),
      avatarUrl: profile[0]?.image ? String(profile[0].image) : null,
      lastSeenAt: new Date().toISOString(),
    },
  });
  return { id: created.id, name, email, role, created: true };
}

/**
 * The demo's database is read-only and refuses the whole request on any write,
 * so the visitor acts as the workspace's first Admin (or first teammate) and
 * sees the sample data as theirs.
 */
async function demoActor(context: { user?: UserLike }, email: string): Promise<Actor> {
  const { rows } = await zite.sql({
    query: `SELECT id, "name", "email", "role" FROM "Members" WHERE "status" = 'Active' ORDER BY CASE WHEN "role" = 'Admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
    params: [],
  });
  const row = rows[0];
  if (row) return { id: String(row.id), name: String(row.name || nameFromEmail(String(row.email ?? email))), email: String(row.email ?? email), role: asRole(row.role), created: false };
  return { id: '00000000-0000-0000-0000-000000000000', name: context.user?.firstName || 'Demo User', email, role: 'Admin', created: false };
}

const REFUSAL: Partial<Record<Capability, string>> = {
  'records.edit': 'Your role can view records but not change them',
  'records.delete': 'Only managers and admins can delete records they don’t own',
  'outreach.send': 'Your role can’t send email, enroll contacts or change meeting links',
  'outreach.manage': 'Only managers and admins can change shared templates, sequences, forms and meeting links',
  'quotes.manage': 'Your role can’t create or send quotes',
  'products.manage': 'Only managers and admins can change the price book',
  'reports.view': 'Your role can’t see reports',
  'quotas.manage': 'Only managers and admins can set quotas',
  'data.import': 'Only managers and admins can import data',
  'data.export': 'Only managers and admins can export data',
  'settings.manage': 'Only admins can change settings',
  'members.manage': 'Only admins can manage teammates',
};

export function assertCan(actor: Actor, capability: Capability) {
  if (!can(actor.role, capability)) throw new ZiteError(REFUSAL[capability] ?? 'You don’t have permission to do that', 'FORBIDDEN');
}

export function assertCanDelete(actor: Actor, ownerId: string | null | undefined, noun = 'record') {
  if (!canDeleteRecord(actor.role, actor.id, ownerId)) throw new ZiteError(`You can only delete a ${noun} you own`, 'FORBIDDEN');
}

export function assertCanManageAsset(actor: Actor, ownerId: string | null | undefined, noun = 'item') {
  if (!canManageAsset(actor.role, actor.id, ownerId)) throw new ZiteError(`Only its owner or a manager can change this ${noun}`, 'FORBIDDEN');
}

export { can, capabilitiesFor };

export type MemberLite = { id: string; name: string; email: string; role: Role; title: string | null; signature: string | null; phone: string | null };

export async function activeMembers(): Promise<MemberLite[]> {
  const { rows } = await zite.sql({
    query: `SELECT id, "name", "email", "role", "title", "emailSignature", "phone" FROM "Members" WHERE "status" <> 'Deactivated' ORDER BY "name" ASC`,
    params: [],
  });
  return rows.map(r => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    role: asRole(r.role),
    title: r.title ? String(r.title) : null,
    signature: r.emailSignature ? String(r.emailSignature) : null,
    phone: r.phone ? String(r.phone) : null,
  }));
}

export async function memberById(id: string | null | undefined): Promise<MemberLite | null> {
  if (!id) return null;
  const { rows } = await zite.sql({
    query: `SELECT id, "name", "email", "role", "title", "emailSignature", "phone", "status" FROM "Members" WHERE id::text = $1 LIMIT 1`,
    params: [id],
  });
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    role: asRole(r.role),
    title: r.title ? String(r.title) : null,
    signature: r.emailSignature ? String(r.emailSignature) : null,
    phone: r.phone ? String(r.phone) : null,
  };
}

/** Throws unless the id is an active member — for owner/assignee inputs. */
export async function assertMember(id: string | null | undefined, what = 'owner') {
  if (!id) return null;
  const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE id::text = $1 AND "status" <> 'Deactivated' LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError(`That ${what} isn’t an active teammate`, 'BAD_REQUEST');
  return id;
}
