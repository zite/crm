import { Lock } from '@phosphor-icons/react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { EmptyState, PageHeader } from '../../ui/Layout';
import { Tabs } from '../../ui/Tabs';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { ReportControlsProvider } from './controls';
import { OverviewReport } from './OverviewReport';
import { PipelineReport } from './PipelineReport';
import { ForecastReport } from './ForecastReport';
import { ActivityReport } from './ActivityReport';
import { LeadsReport } from './LeadsReport';
import { TeamReport } from './TeamReport';

/**
 * Reports: six views of the same question — how is the quarter going? One
 * header, one tab row, one control bar, and each tab answers a narrower
 * version of it.
 *
 * Mounted at `/reports/*`, so the nested routes below own the rest of the path.
 */
const TABS = [
  { value: 'overview', label: 'Overview', to: '/reports', end: true },
  { value: 'pipeline', label: 'Pipeline', to: '/reports/pipeline' },
  { value: 'forecast', label: 'Forecast', to: '/reports/forecast' },
  { value: 'activity', label: 'Activity', to: '/reports/activity' },
  { value: 'leads', label: 'Leads', to: '/reports/leads' },
  { value: 'team', label: 'Team & quotas', to: '/reports/team' },
];

export function ReportsPage() {
  const ws = useWorkspace();
  useDocumentTitle('Reports', ws.settings.organizationName);

  if (!ws.can('reports.view')) {
    return (
      <div className="px-5 py-6 sm:px-8">
        <EmptyState icon={<Lock size={22} weight="duotone" />} title="Reports aren’t open to your role">
          Ask an admin to change your role if you need to see how the team is tracking.
        </EmptyState>
      </div>
    );
  }

  return (
    <ReportControlsProvider>
      <div className="flex min-h-full flex-col">
        <PageHeader
          title="Reports"
          description="How the quarter is going — the pipeline behind it, and who is carrying it."
          tabs={<Tabs items={TABS} />}
        />
        <Routes>
          <Route index element={<OverviewReport />} />
          <Route path="pipeline" element={<PipelineReport />} />
          <Route path="forecast" element={<ForecastReport />} />
          <Route path="activity" element={<ActivityReport />} />
          <Route path="leads" element={<LeadsReport />} />
          <Route path="team" element={<TeamReport />} />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </div>
    </ReportControlsProvider>
  );
}

export default ReportsPage;
