import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  listQuotas,
  reportActivity,
  reportForecast,
  reportLeads,
  reportPipeline,
  reportTeam,
  saveQuota,
  type ListQuotasInputType,
  type ReportActivityInputType,
  type ReportForecastInputType,
  type ReportLeadsInputType,
  type ReportPipelineInputType,
  type ReportTeamInputType,
  type SaveQuotaInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';

/**
 * Report queries. Everything lives under the `reports` key, so a write
 * anywhere in the app that touches a deal, an activity or a quota can throw
 * the whole area away with one prefix invalidation.
 *
 * Every input that changes a figure is in the key — a report keyed without its
 * period would happily show last quarter's number under this quarter's label.
 */
export const reportKeys = {
  pipeline: (input: ReportPipelineInputType) => ['reports', 'pipeline', input] as const,
  forecast: (input: ReportForecastInputType) => ['reports', 'forecast', input] as const,
  activity: (input: ReportActivityInputType) => ['reports', 'activity', input] as const,
  leads: (input: ReportLeadsInputType) => ['reports', 'leads', input] as const,
  team: (input: ReportTeamInputType) => ['reports', 'team', input] as const,
  quotas: (input: ListQuotasInputType) => ['reports', 'quotas', input] as const,
};

// Keeping the last answer on screen while the next one loads stops the page
// jumping every time someone steps a quarter back.
const shared = { staleTime: 30_000, placeholderData: keepPreviousData };

export function usePipelineReport(input: ReportPipelineInputType) {
  return useQuery({ queryKey: reportKeys.pipeline(input), queryFn: () => reportPipeline(input), ...shared });
}

export function useForecastReport(input: ReportForecastInputType) {
  return useQuery({ queryKey: reportKeys.forecast(input), queryFn: () => reportForecast(input), ...shared });
}

export function useActivityReport(input: ReportActivityInputType) {
  return useQuery({ queryKey: reportKeys.activity(input), queryFn: () => reportActivity(input), ...shared });
}

export function useLeadsReport(input: ReportLeadsInputType) {
  return useQuery({ queryKey: reportKeys.leads(input), queryFn: () => reportLeads(input), ...shared });
}

export function useTeamReport(input: ReportTeamInputType) {
  return useQuery({ queryKey: reportKeys.team(input), queryFn: () => reportTeam(input), ...shared });
}

export function useQuotas(input: ListQuotasInputType, enabled = true) {
  return useQuery({ queryKey: reportKeys.quotas(input), queryFn: () => listQuotas(input), enabled, ...shared });
}

/** Saving a quota changes attainment everywhere, so the whole area is invalidated. */
export function useSaveQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveQuotaInputType) => saveQuota(input),
    onSuccess: result => {
      const parts = [result.saved ? `${result.saved === 1 ? 'Quota' : `${result.saved} quotas`} saved` : '', result.cleared ? `${result.cleared} cleared` : ''].filter(Boolean);
      toast.success(parts.join(' · ') || 'Nothing to save');
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that quota')),
  });
}
