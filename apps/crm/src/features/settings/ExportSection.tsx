import { useMutation } from '@tanstack/react-query';
import { DownloadSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { exportRecords } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Checkbox, Segmented, Select, Switch } from '../../ui/Form';
import { VIEW_SCOPES, type ViewScope } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Explainer, Group, SectionHead, SettingRow } from './kit';

const HAS_STATUS: Partial<Record<ViewScope, string[]>> = {
  Deals: ['Open', 'Won', 'Lost'],
  Tasks: ['Open', 'Done'],
  Quotes: ['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired', 'Void'],
  Leads: ['New', 'Working', 'Nurturing', 'Qualified', 'Disqualified'],
};

/**
 * Export, from the server.
 *
 * Every ledger in the app pages its rows, so a "download what's on screen"
 * button would quietly hand someone the first fifty of nine hundred deals.
 * These filters are applied against the whole table instead.
 */
export function ExportSection() {
  const ws = useWorkspace();
  const [scope, setScope] = useState<ViewScope>('Deals');
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const statuses = HAS_STATUS[scope];

  const run = useMutation({
    mutationFn: () =>
      exportRecords({
        scope,
        filters: {
          ...(ownerIds.length ? { ownerIds } : {}),
          ...(status.length ? { status } : {}),
          ...(pipelineId && scope === 'Deals' ? { pipelineId } : {}),
          includeArchived,
        },
      }),
    onSuccess: result => {
      download(result.fileName, result.csv);
      toast.success(`${plural(result.rowCount, 'row')} exported${result.truncated ? ' — the file was capped at 2,000 rows' : ''}`);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t build that export')),
  });

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter(x => x !== value) : [...list, value]);

  return (
    <div className="flex flex-col gap-8">
      <SectionHead title="Export" description="Take a list out as a CSV. The file is built on the server from the whole table, so it is never capped at what happens to be loaded on screen." />

      <Group title="What to export">
        <Segmented value={scope} onChange={(v: ViewScope) => { setScope(v); setStatus([]); setPipelineId(''); }} options={VIEW_SCOPES.map(s => ({ value: s, label: s }))} className="max-w-full flex-wrap self-start" />
      </Group>

      <Group title="Narrow it down" note="Leave everything empty to export the lot.">
        <div>
          {scope === 'Deals' && (
            <SettingRow label="Pipeline" htmlFor="export-pipeline">
              <Select id="export-pipeline" value={pipelineId} onChange={e => setPipelineId(e.target.value)} className="max-w-sm">
                <option value="">Every pipeline</option>
                {ws.pipelines.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </SettingRow>
          )}
          {statuses && (
            <SettingRow label="Status" hint="None chosen means every status." align="start">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {statuses.map(s => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-ui text-ink">
                    <Checkbox checked={status.includes(s)} onCheckedChange={() => toggle(status, setStatus, s)} label={s} />
                    {s}
                  </label>
                ))}
              </div>
            </SettingRow>
          )}
          <SettingRow label="Owner" hint={`None chosen means everyone — all ${ws.activeMembers.length}.`} align="start">
            <div className="max-h-[200px] max-w-sm overflow-y-auto rounded-md border border-line">
              {ws.activeMembers.map(member => (
                <label key={member.id} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover/60">
                  <Checkbox checked={ownerIds.includes(member.id)} onCheckedChange={() => toggle(ownerIds, setOwnerIds, member.id)} label={member.name} />
                  <Avatar person={member} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{member.name}</span>
                </label>
              ))}
            </div>
          </SettingRow>
          {/* A SettingRow rather than a SwitchRow, so the control lines up with the
              pipeline, status and owner controls above it instead of sitting on the far right. */}
          {(scope === 'Deals' || scope === 'Companies' || scope === 'Contacts') && (
            <SettingRow label="Include archived records" hint="Archived records are left out by default." htmlFor="export-archived">
              <Switch id="export-archived" checked={includeArchived} onCheckedChange={setIncludeArchived} />
            </SettingRow>
          )}
        </div>
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" leading={<DownloadSimple size={16} />} onClick={() => run.mutate()} loading={run.isPending}>
          Export {scope.toLowerCase()}
        </Button>
        <span className="text-meta text-ink-3">Downloads straight to your computer. Nothing is stored.</span>
      </div>

      <Explainer summary="What is in the file">
        <p>Every column a person would want in a spreadsheet: names rather than ids, the owner’s name and email, amounts as plain numbers so they add up, and dates as ISO so they sort.</p>
        <p>Your own properties come along as their own columns, so an export and an import are the same shape — what comes out can go straight back in.</p>
        <p>A cell that begins with =, +, − or @ is prefixed with an apostrophe, so a spreadsheet can’t run something a stranger typed into your web form.</p>
        <p>Exports are capped at 2,000 rows. If you hit it, narrow by owner or status and take it in two passes.</p>
      </Explainer>
    </div>
  );
}

/** A blob download: the CSV came back from the server, so there is nothing to build here. */
function download(fileName: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
