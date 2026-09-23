import { zite } from 'zitejs/db';
import { getSettings, updateSettings, type OrgSettings } from './settings';

/**
 * Who a new inbound lead belongs to. Round robin rotates through the members
 * chosen in Settings → Lead routing (skipping anyone deactivated since), a
 * fixed member gets everything, and "unassigned" leaves leads for triage.
 * Forms and meeting links can override with their own assignment.
 */
export async function nextLeadOwner(opts: { settings?: OrgSettings; memberIds?: string[]; mode?: 'round_robin' | 'member' | 'unassigned'; memberId?: string | null } = {}): Promise<string | null> {
  const settings = opts.settings ?? (await getSettings());
  const mode = opts.mode ?? settings.leadRouting.mode;
  if (mode === 'unassigned') return null;
  const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "status" <> 'Deactivated' AND "role" IN ('Admin', 'Manager', 'Rep')`, params: [] });
  const active = new Set(rows.map(r => String(r.id)));
  if (mode === 'member') {
    const id = opts.memberId ?? settings.leadRouting.memberId;
    return id && active.has(id) ? id : null;
  }
  const pool = (opts.memberIds ?? settings.leadRouting.memberIds).filter(id => active.has(id));
  if (!pool.length) return null;
  const cursor = settings.leadRouting.cursor % pool.length;
  const owner = pool[cursor];
  if (!opts.memberIds) await updateSettings(settings.id, { leadRouting: { ...settings.leadRouting, cursor: cursor + 1 } });
  return owner;
}
