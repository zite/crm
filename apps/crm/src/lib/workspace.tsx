import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { bootstrap, type BootstrapOutputType } from 'zitejs/api';
import { formatMoney } from '@project/shared/money';
import type { Capability } from '@project/shared/roles';
import type { ChoiceList, Role } from '@project/shared/constants';
import { todayString } from './format';

/**
 * Everything the app knows before a page loads: you, the organization,
 * teammates, pipelines and stages, pick lists, tags, custom fields and saved
 * views — indexed, so no component ever re-fetches a name.
 *
 * After a write that changes any of it (a teammate, a stage, a tag, a view, a
 * count), call `invalidateWorkspace(queryClient)`.
 */

export type Workspace = BootstrapOutputType;
export type Member = Workspace['members'][number];
export type Stage = Workspace['stages'][number];
export type Pipeline = Workspace['pipelines'][number];
export type Tag = Workspace['tags'][number];
export type CustomField = Workspace['customFields'][number];
export type SavedView = Workspace['views'][number];

export const WORKSPACE_KEY = ['workspace'];

export function useWorkspaceQuery() {
  return useQuery({
    queryKey: WORKSPACE_KEY,
    queryFn: () => bootstrap({ today: todayString() }),
    staleTime: 60_000,
  });
}

export function invalidateWorkspace(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: WORKSPACE_KEY });
}

export type WorkspaceApi = Workspace & {
  memberById: (id: string | null | undefined) => Member | null;
  memberName: (id: string | null | undefined) => string;
  activeMembers: Member[];
  stageById: (id: string | null | undefined) => Stage | null;
  stagesFor: (pipelineId: string | null | undefined) => Stage[];
  openStagesFor: (pipelineId: string | null | undefined) => Stage[];
  pipelineById: (id: string | null | undefined) => Pipeline | null;
  defaultPipeline: Pipeline | null;
  tagById: (id: string | null | undefined) => Tag | null;
  choicesFor: (list: ChoiceList) => Workspace['choices'];
  fieldsFor: (object: 'Company' | 'Contact' | 'Deal' | 'Lead') => CustomField[];
  viewsFor: (scope: string) => SavedView[];
  can: (capability: Capability) => boolean;
  isAdmin: boolean;
  role: Role;
  money: (value: number | null | undefined, opts?: { compact?: boolean; cents?: boolean; sign?: boolean }) => string;
  today: string;
};

const Ctx = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ data, children }: { data: Workspace; children: ReactNode }) {
  const value = useMemo<WorkspaceApi>(() => {
    const members = new Map(data.members.map(m => [m.id, m]));
    const stages = new Map(data.stages.map(s => [s.id, s]));
    const pipelines = new Map(data.pipelines.map(p => [p.id, p]));
    const tags = new Map(data.tags.map(t => [t.id, t]));
    const stagesByPipeline = new Map<string, Stage[]>();
    for (const s of [...data.stages].sort((a, b) => a.position - b.position)) {
      if (!stagesByPipeline.has(s.pipelineId)) stagesByPipeline.set(s.pipelineId, []);
      stagesByPipeline.get(s.pipelineId)!.push(s);
    }
    const capabilities = new Set(data.capabilities);
    const livePipelines = data.pipelines.filter(p => !p.archived);
    return {
      ...data,
      memberById: id => (id ? members.get(id) ?? null : null),
      memberName: id => (id ? members.get(id)?.name ?? 'Someone' : 'Unassigned'),
      activeMembers: data.members.filter(m => m.status !== 'Deactivated'),
      stageById: id => (id ? stages.get(id) ?? null : null),
      stagesFor: pipelineId => (pipelineId ? stagesByPipeline.get(pipelineId) ?? [] : []),
      openStagesFor: pipelineId => (pipelineId ? (stagesByPipeline.get(pipelineId) ?? []).filter(s => s.kind === 'Open' && !s.archived) : []),
      pipelineById: id => (id ? pipelines.get(id) ?? null : null),
      defaultPipeline: livePipelines.find(p => p.isDefault) ?? livePipelines[0] ?? null,
      tagById: id => (id ? tags.get(id) ?? null : null),
      choicesFor: list => data.choices.filter(c => c.list === list && !c.archived),
      fieldsFor: object => data.customFields.filter(f => f.object === object && !f.archived).sort((a, b) => a.position - b.position),
      viewsFor: scope => data.views.filter(v => v.scope === scope).sort((a, b) => a.position - b.position),
      can: capability => capabilities.has(capability),
      isAdmin: data.me.role === 'Admin',
      role: data.me.role as Role,
      money: (value, opts) => formatMoney(value ?? 0, data.settings.currency, { cents: opts?.cents ?? false, compact: opts?.compact, sign: opts?.sign }),
      today: data.today,
    };
  }, [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

/** For components that may render before the workspace is ready (the shell's own skeleton). */
export function useWorkspaceOptional() {
  return useContext(Ctx);
}

export function useMe() {
  return useWorkspace().me;
}

export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  return () => invalidateWorkspace(qc);
}
