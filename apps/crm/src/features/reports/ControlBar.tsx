import { CaretLeft, CaretRight, DownloadSimple, Funnel, Users } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { useWorkspace } from '../../lib/workspace';
import { useReportControls } from './controls';
import type { PeriodKind } from '@project/shared/dates';

/**
 * Period, pipeline and people — the three questions every report on this tab
 * row answers. It sits under the tabs and never moves, so switching reports
 * keeps the same window in view.
 */
export function ControlBar({ onExport, exportLabel = 'Export CSV', pipelineRequired, extra }: { onExport?: () => void; exportLabel?: string; pipelineRequired?: boolean; extra?: React.ReactNode }) {
  const ws = useWorkspace();
  const controls = useReportControls();
  const pipelines = ws.pipelines.filter(pipeline => !pipeline.archived);
  const activePipelineId = pipelineRequired ? controls.pipelineId ?? ws.defaultPipeline?.id ?? '' : controls.pipelineId;
  const pipelineName = activePipelineId ? ws.pipelineById(activePipelineId)?.name ?? 'Pipeline' : 'All pipelines';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-5 py-3 sm:px-8">
      <Segmented
        size="sm"
        value={controls.period}
        onChange={value => controls.set({ period: value as PeriodKind, offset: 0 })}
        options={[
          { value: 'Month', label: 'Month' },
          { value: 'Quarter', label: 'Quarter' },
          { value: 'Year', label: 'Year' },
        ]}
      />

      <div className="flex items-center gap-0.5 rounded-md border border-line-strong bg-card">
        <Button variant="ghost" size="sm" icon aria-label={`Previous ${controls.period.toLowerCase()}`} className="rounded-r-none" onClick={() => controls.set({ offset: controls.offset - 1 })}>
          <CaretLeft size={15} weight="bold" />
        </Button>
        <span className="tabular min-w-[92px] px-1 text-center text-ui font-medium text-ink">{controls.label}</span>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Next ${controls.period.toLowerCase()}`}
          className="rounded-l-none"
          disabled={controls.offset >= 4}
          onClick={() => controls.set({ offset: controls.offset + 1 })}
        >
          <CaretRight size={15} weight="bold" />
        </Button>
      </div>
      {controls.offset !== 0 && (
        <Button variant="ghost" size="sm" onClick={() => controls.set({ offset: 0 })}>
          Today
        </Button>
      )}

      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" leading={<Funnel size={15} />} className={cn(controls.pipelineId && 'text-ink')}>
            {pipelineName}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Pipeline</MenuLabel>
          {!pipelineRequired && <MenuItem onSelect={() => controls.set({ pipelineId: null })}>All pipelines</MenuItem>}
          {pipelines.map(pipeline => (
            <MenuItem key={pipeline.id} onSelect={() => controls.set({ pipelineId: pipeline.id })}>
              {pipeline.name}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" leading={<Users size={15} />}>
            {controls.whoLabel}
          </Button>
        </MenuTrigger>
        <MenuContent className="max-h-[70vh] overflow-y-auto">
          <MenuLabel>Whose numbers</MenuLabel>
          <MenuItem onSelect={() => controls.set({ who: { kind: 'everyone' } })}>Everyone</MenuItem>
          <MenuItem onSelect={() => controls.set({ who: { kind: 'me' } })}>Just me</MenuItem>
          {ws.teams.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Teams</MenuLabel>
              {ws.teams.map(team => (
                <MenuItem key={team.id} onSelect={() => controls.set({ who: { kind: 'team', id: team.id } })}>
                  {team.name}
                </MenuItem>
              ))}
            </>
          )}
          <MenuSeparator />
          <MenuLabel>Teammates</MenuLabel>
          {ws.activeMembers.map(member => (
            <MenuItem key={member.id} icon={<Avatar person={member} size="xs" />} onSelect={() => controls.set({ who: { kind: 'member', id: member.id } })}>
              {member.name}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      {controls.isNarrowed && (
        <Button variant="ghost" size="sm" onClick={controls.reset}>
          Clear filters
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {extra}
        {onExport && (
          <Button variant="secondary" size="sm" leading={<DownloadSimple size={15} />} onClick={onExport}>
            {exportLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
