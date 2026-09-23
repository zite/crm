import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowCounterClockwise, CheckCircle, FileArrowUp, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { importRecords, listImports, undoImport } from 'zitejs/api';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Field, Segmented, Select, Textarea } from '../../ui/Form';
import { Skeleton } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { IMPORT_OBJECTS, type ImportObject } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { plural, timeAgo } from '../../lib/format';
import { useAppActions } from '../../lib/app-actions';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { CUSTOM_PREFIX, MATCH_LABEL, checkRow, guessMapping, importFieldsFor, readSheet } from './importCore';
import { Explainer, Group, SectionHead } from './kit';

const NOUN: Record<ImportObject, string> = { Companies: 'companies', Contacts: 'contacts', Deals: 'deals', Leads: 'leads' };

const SAMPLE: Record<ImportObject, string> = {
  Companies: 'Company Name,Domain,Industry,Employees,Owner\nHarbor Freight Collective,harborfreight.example,Logistics,820,maya@yourcompany.com',
  Contacts: 'First Name,Last Name,Email,Job Title,Company\nPriya,Raman,priya@harborfreight.example,Head of Operations,Harbor Freight Collective',
  Deals: 'Deal Name,Company,Amount,Close Date,Stage,Owner\nHarbor Freight — Platform,Harbor Freight Collective,48000,2026-11-30,Proposal,maya@yourcompany.com',
  Leads: 'First Name,Last Name,Email,Company,Source\nSam,Whitfield,sam@northwind.example,Northwind Supply,Event',
};

/**
 * The importer: paste or choose a file, check the mapping we guessed, look at
 * the first rows with their errors, then bring it in.
 *
 * The preview runs the same parser and the same per-cell rules the server
 * does, so what you approve is what happens — and every record created is
 * stamped with the import, which is what makes Undo exact.
 */
export function ImportSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const invalidateWorkspace = useInvalidateWorkspace();
  const { confirm } = useAppActions();
  const fileInput = useRef<HTMLInputElement>(null);

  const [object, setObject] = useState<ImportObject>('Companies');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [mode, setMode] = useState<'create' | 'upsert'>('create');
  const [touched, setTouched] = useState(false);

  const fields = useMemo(() => importFieldsFor(object, ws.customFields), [object, ws.customFields]);
  const sheet = useMemo(() => (csv.trim() ? readSheet(csv) : { headers: [], rows: [] }), [csv]);

  // A fresh guess whenever the file or the object changes, until someone edits the mapping by hand.
  const activeMapping = useMemo(() => (touched && mapping.length === sheet.headers.length ? mapping : guessMapping(sheet.headers, fields)), [touched, mapping, sheet.headers, fields]);

  const preview = useMemo(() => sheet.rows.slice(0, 8).map(cells => checkRow(fields, activeMapping, cells)), [sheet.rows, fields, activeMapping]);
  const allChecked = useMemo(() => sheet.rows.map(cells => checkRow(fields, activeMapping, cells)), [sheet.rows, fields, activeMapping]);
  const badRows = allChecked.filter(r => r.errors.length).length;
  const mapped = new Set(activeMapping.filter(Boolean) as string[]);
  const missingRequired = fields.filter(f => f.required && !mapped.has(f.key));
  const canName = object === 'Companies' || object === 'Deals' ? mapped.has('name') : mapped.has('name') || mapped.has('firstName') || mapped.has('lastName') || mapped.has('email');
  const blocked = !sheet.rows.length || !canName || (missingRequired.length > 0 && !(mapped.has('name') || mapped.has('firstName')));

  const history = useQuery({ queryKey: ['imports'], queryFn: () => listImports({}) });

  const reset = () => {
    setCsv('');
    setFileName('');
    setMapping([]);
    setTouched(false);
  };

  const run = useMutation({
    mutationFn: () => importRecords({ object, fileName: fileName || `${NOUN[object]}.csv`, csv, mapping: activeMapping, mode }),
    onSuccess: result => {
      invalidateRoots(qc, 'imports', 'companies', 'contacts', 'deals', 'deal', 'leads', 'home', 'reports');
      void invalidateWorkspace();
      toast.success(`${plural(result.created, `new ${object === 'Companies' ? 'company' : NOUN[object].replace(/s$/, '')}`)} imported${result.updated ? `, ${result.updated} updated` : ''}${result.skipped ? `, ${result.skipped} skipped` : ''}`);
      reset();
    },
    onError: error => toast.error(errorMessage(error, 'The import couldn’t run')),
  });

  const undo = useMutation({
    mutationFn: (importId: string) => undoImport({ importId }),
    onSuccess: result => {
      invalidateRoots(qc, 'imports', 'companies', 'contacts', 'deals', 'deal', 'leads', 'home', 'reports');
      toast.success(result.kept ? `${plural(result.deleted, 'record')} removed, ${result.kept} kept because they’ve been worked since` : `${plural(result.deleted, 'record')} removed`);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t undo that import')),
  });

  const onUndo = async (entry: { id: string; fileName: string; createdCount: number }) => {
    const check = await undoImport({ importId: entry.id, dryRun: true }).catch(() => null);
    if (!check) {
      toast.error('Couldn’t work out what that import created');
      return;
    }
    const ok = await confirm({
      title: `Undo ${entry.fileName}?`,
      description:
        check.deleted === 0
          ? 'Nothing it created can be removed — every record has been worked since.'
          : `${plural(check.deleted, 'record')} will be deleted.${check.kept ? ` ${plural(check.kept, 'record')} will be kept because ${check.keptReasons[0]?.name ?? 'one'} ${check.keptReasons[0]?.reason ?? 'has been worked since'}.` : ''} Records the import only updated keep their new values.`,
      confirmLabel: check.deleted === 0 ? 'Close' : 'Undo import',
      destructive: check.deleted > 0,
    });
    if (ok && check.deleted > 0) undo.mutate(entry.id);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error('That file is over 4MB — split it and import in two passes');
      return;
    }
    setCsv(await file.text());
    setFileName(file.name);
    setTouched(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHead title="Import" description="Bring companies, contacts, deals or leads in from a spreadsheet. Nothing is written until you have seen the first rows and what we made of them." />

      <Group title="What are you importing?">
        <Segmented value={object} onChange={(v: ImportObject) => { setObject(v); setTouched(false); }} options={IMPORT_OBJECTS.map(o => ({ value: o, label: o }))} className="self-start" />
      </Group>

      <Group title="Your file" note="A CSV with a header row. Paste it here, or choose the file.">
        <div className="flex flex-col gap-3">
          <Textarea value={csv} onChange={e => { setCsv(e.target.value); setFileName(fileName || 'pasted.csv'); setTouched(false); }} minRows={5} placeholder={SAMPLE[object]} aria-label="CSV contents" className="font-mono text-meta" />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={e => void onFile(e.target.files?.[0])} />
            <Button variant="secondary" size="sm" leading={<UploadSimple size={15} />} onClick={() => fileInput.current?.click()}>
              Choose a file
            </Button>
            {fileName && <span className="truncate text-meta text-ink-2">{fileName}</span>}
            {csv && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </Group>

      {sheet.headers.length > 0 && (
        <>
          <Group title="Columns" note={`We guessed these from your headers. Anything set to “Skip” is ignored. Matching is on ${MATCH_LABEL[object]}.`}>
            <div className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
              {sheet.headers.map((header, index) => (
                <div key={index} className="grid gap-2 border-b border-line px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-ui font-medium text-ink">{header}</div>
                    <div className="truncate text-meta text-ink-3">{sheet.rows[0]?.[index] || <span className="italic">empty</span>}</div>
                  </div>
                  <Select
                    value={activeMapping[index] ?? ''}
                    onChange={e => {
                      const next = [...activeMapping];
                      next[index] = e.target.value || null;
                      setMapping(next);
                      setTouched(true);
                    }}
                    aria-label={`What ${header} is`}
                    className="h-8 text-ui"
                  >
                    <option value="">Skip this column</option>
                    {fields.map(f => (
                      <option key={f.key} value={f.key} disabled={activeMapping.includes(f.key) && activeMapping[index] !== f.key}>
                        {f.label}
                        {f.required ? ' *' : ''}
                        {f.key.startsWith(CUSTOM_PREFIX) ? ' (yours)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {missingRequired.length > 0 && !canName && <p className="text-meta text-danger">Map a column to {missingRequired.map(f => f.label).join(' or ')} before importing.</p>}
          </Group>

          <Group
            title={sheet.rows.length <= 8 ? `All ${plural(sheet.rows.length, 'row')}` : `First 8 of ${plural(sheet.rows.length, 'row')}`}
            note={badRows ? `${plural(badRows, 'row')} can’t be read and will be skipped.` : 'Every row reads cleanly.'}
          >
            <div className="overflow-x-auto rounded-lg border border-line bg-card shadow-hairline">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="bg-sunken">
                    <th className="w-14 px-3 py-2 text-left text-micro font-semibold uppercase text-ink-3">#</th>
                    {activeMapping.map((key, i) =>
                      key ? (
                        <th key={i} className="px-3 py-2 text-left text-micro font-semibold uppercase text-ink-3">
                          {fields.find(f => f.key === key)?.label ?? key}
                        </th>
                      ) : null,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index} className={cn('border-t border-line', row.errors.length && 'bg-danger/[0.06] dark:bg-danger/[0.12]')}>
                      {/* The wash alone is too quiet to be the only mark on a row that will be skipped. */}
                      <td className="px-3 py-2 text-meta text-ink-3">
                        <span className="flex items-center gap-1">
                          {row.errors.length > 0 && <WarningCircle size={14} weight="fill" className="shrink-0 text-danger" aria-label="This row will be skipped" />}
                          {index + 2}
                        </span>
                      </td>
                      {activeMapping.map((key, i) =>
                        key ? (
                          <td key={i} className="max-w-[220px] truncate px-3 py-2 text-ui text-ink">
                            {formatCell(row.values[key])}
                          </td>
                        ) : null,
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.some(r => r.errors.length > 0) && (
              <ul className="flex flex-col gap-1">
                {preview.map((row, index) => (row.errors.length ? <li key={index} className="text-meta text-danger">Row {index + 2}: {row.errors.join('; ')}</li> : null))}
              </ul>
            )}
          </Group>

          <Group title="What to do with a row that already exists">
            <Segmented
              className="self-start"
              value={mode}
              onChange={(v: 'create' | 'upsert') => setMode(v)}
              options={[
                { value: 'create' as const, label: 'Create only' },
                { value: 'upsert' as const, label: 'Create and update' },
              ]}
            />
            <p className="text-meta text-ink-2">
              {mode === 'create'
                ? `A row that matches an existing record on ${MATCH_LABEL[object]} is skipped and counted, and nothing already here changes.`
                : `A row that matches on ${MATCH_LABEL[object]} updates that record. An empty cell means “the file didn’t say”, so it never wipes a value you already have.`}
            </p>
          </Group>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-card px-4 py-3 shadow-pop">
            <span className="min-w-0 flex-1 text-ui text-ink-2">
              {plural(sheet.rows.length - badRows, 'row')} ready{badRows ? `, ${badRows} will be skipped` : ''}
            </span>
            <Button variant="primary" leading={<FileArrowUp size={16} />} onClick={() => run.mutate()} loading={run.isPending} disabled={blocked}>
              Import {NOUN[object]}
            </Button>
          </div>
        </>
      )}

      <Group title="Recent imports" note="Every record an import created is stamped with it, which is what makes undo exact.">
        {history.isPending ? (
          <Skeleton className="h-28 rounded-lg" />
        ) : (history.data?.imports.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-ui text-ink-2">Nothing has been imported yet.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
            {history.data?.imports.map(entry => (
              <div key={entry.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="mt-0.5 shrink-0">{entry.status === 'Failed' ? <WarningCircle size={17} weight="fill" className="text-danger" /> : <CheckCircle size={17} weight="fill" className={entry.undoneAt ? 'text-ink-3' : 'text-success'} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                    <span className="truncate text-ui font-medium text-ink">{entry.fileName}</span>
                    <Badge tone="neutral">{entry.object}</Badge>
                    {entry.undoneAt && <Badge tone="neutral">Undone</Badge>}
                  </div>
                  <div className="text-meta text-ink-3">
                    {entry.createdCount} created · {entry.updatedCount} updated · {entry.skippedCount} skipped · {entry.actorName ?? 'someone'} · {entry.createdAt ? timeAgo(entry.createdAt) : ''}
                  </div>
                  {entry.errors.length > 0 && <div className="mt-0.5 truncate text-meta text-danger">Row {entry.errors[0].row}: {entry.errors[0].message}{entry.errors.length > 1 ? ` (+${entry.errors.length - 1} more)` : ''}</div>}
                </div>
                {!entry.undoneAt && entry.remaining > 0 && (
                  <Button variant="secondary" size="sm" leading={<ArrowCounterClockwise size={14} />} onClick={() => void onUndo(entry)} loading={undo.isPending && undo.variables === entry.id}>
                    Undo
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Group>

      <Explainer summary="What undo does, and what it can’t">
        <p>Undo deletes exactly the records that import created — nothing else. It knows which ones because each carries the import’s id, so a record you added by hand the same afternoon is never caught up in it.</p>
        <p>
          A record that has been worked since — it has a deal on it, a contact under it, a logged call or an open task — is kept, and the dialog names it. Deleting it would take that work with it, which is not what
          “undo the import” means to anyone.
        </p>
        <p>Records the import only <em>updated</em> keep their new values. The old ones were overwritten at the time, and inventing them back would be worse than leaving them.</p>
      </Explainer>
    </div>
  );
}

function formatCell(value: unknown) {
  if (value == null || value === '') return <span className="text-ink-3">—</span>;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}
