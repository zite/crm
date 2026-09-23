import type { Role } from './constants';

/**
 * What each role may do, as capabilities rather than role checks sprinkled
 * through the code. The server enforces these (`assertCan`); the client uses
 * the same table only to hide or disable controls that would be refused.
 *
 *   Admin   — everything, including teammates, pipelines, fields and settings
 *   Manager — the whole team's records, quotas, imports/exports, shared outreach and the price book
 *   Rep     — works records (create, edit, email, quote); deletes only what they own
 *   Viewer  — reads everything, changes nothing
 */

export const CAPABILITIES = [
  'records.edit',
  'records.delete',
  'outreach.send',
  'outreach.manage',
  'quotes.manage',
  'products.manage',
  'reports.view',
  'quotas.manage',
  'data.import',
  'data.export',
  'settings.manage',
  'members.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, readonly Capability[]> = {
  Admin: CAPABILITIES,
  Manager: ['records.edit', 'records.delete', 'outreach.send', 'outreach.manage', 'quotes.manage', 'products.manage', 'reports.view', 'quotas.manage', 'data.import', 'data.export'],
  Rep: ['records.edit', 'outreach.send', 'quotes.manage', 'reports.view'],
  Viewer: ['reports.view'],
};

export function capabilitiesFor(role: Role): Capability[] {
  return [...(MATRIX[role] ?? [])];
}

export function can(role: Role | null | undefined, capability: Capability) {
  return Boolean(role && MATRIX[role]?.includes(capability));
}

/** Deleting: anyone with records.delete, or a rep deleting a record they own. */
export function canDeleteRecord(role: Role | null | undefined, actorId: string, ownerId: string | null | undefined) {
  if (can(role, 'records.delete')) return true;
  return can(role, 'records.edit') && Boolean(ownerId) && ownerId === actorId;
}

/** Shared outreach assets (templates, sequences, forms, meeting links): managers edit anyone's, others their own. */
export function canManageAsset(role: Role | null | undefined, actorId: string, ownerId: string | null | undefined) {
  if (can(role, 'outreach.manage')) return true;
  return can(role, 'outreach.send') && (!ownerId || ownerId === actorId);
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Admin: 'Everything, including teammates, pipelines, custom fields, automations and settings.',
  Manager: 'All records, quotas, imports and exports, the price book, and shared templates and sequences.',
  Rep: 'Creates and works records, sends email, enrolls sequences and builds quotes. Deletes only their own records.',
  Viewer: 'Can see everything, including reports, but can’t change anything.',
};
