import { DownloadSimple, FilePdf, FileText, Image as ImageIcon, Paperclip, Trash, UploadSimple } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { deleteDocument, saveDocument } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyState, Section, Skeleton } from '../ui/Layout';
import { cn } from '../ui/cn';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { shortDate } from '../lib/format';
import { invalidate, useDocuments } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

/**
 * Files on a record — contracts, security questionnaires, the signed order
 * form. One panel for every record type; drop a file on it or pick one.
 */
export function FilesPanel({ type, id, className, title = 'Files' }: { type: 'company' | 'contact' | 'deal' | 'lead'; id: string; className?: string; title?: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { confirm } = useAppActions();
  const { data, isPending } = useDocuments(type, id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canEdit = ws.can('records.edit');

  const upload = async (files: FileList | File[]) => {
    const list = [...files].slice(0, 10);
    if (!list.length) return;
    setBusy(true);
    try {
      // Sequential: live Zite rate-limits bursts of writes.
      for (const file of list) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} is over 25MB`);
          continue;
        }
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        await saveDocument({
          name: file.name,
          url: fileUrl,
          size: file.size,
          contentType: file.type || undefined,
          companyId: type === 'company' ? id : null,
          contactId: type === 'contact' ? id : null,
          dealId: type === 'deal' ? id : null,
          leadId: type === 'lead' ? id : null,
        });
      }
      invalidate(qc, 'documents', 'timeline');
      toast.success(list.length === 1 ? 'File added' : `${list.length} files added`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t add that file'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (documentId: string, name: string) => {
    const ok = await confirm({ title: `Remove ${name}?`, description: 'It disappears from this record for everyone.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    try {
      await deleteDocument({ id: documentId });
      invalidate(qc, 'documents');
      toast.success('File removed');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t remove that file'));
    }
  };

  const documents = data?.documents ?? [];

  return (
    <Section
      title={title}
      count={documents.length || undefined}
      className={className}
      action={
        canEdit ? (
          <Button variant="ghost" size="xs" leading={<UploadSimple size={14} />} loading={busy} onClick={() => inputRef.current?.click()}>
            Add
          </Button>
        ) : undefined
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onDragOver={e => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={cn('rounded-lg border transition-colors', dragging ? 'border-accent bg-accent/[0.06]' : 'border-line bg-card')}
      >
        {isPending ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            compact
            icon={<Paperclip size={22} weight="duotone" />}
            title="No files yet"
            actions={
              canEdit ? (
                <Button variant="primary" size="sm" leading={<UploadSimple size={15} />} onClick={() => inputRef.current?.click()}>
                  Add a file
                </Button>
              ) : undefined
            }
          >
            {canEdit ? 'Contracts, security questionnaires, the signed order form — drop one here or add it.' : 'Nothing has been attached to this record.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {documents.map(doc => (
              <li key={doc.id} className="group flex items-center gap-3 px-3 py-2.5">
                <FileGlyph contentType={doc.contentType} />
                <div className="min-w-0 flex-1">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="block truncate text-ui text-ink hover:text-accent">
                    {doc.name}
                  </a>
                  <div className="flex items-center gap-1.5 text-meta text-ink-3">
                    {doc.uploadedById && <Avatar person={ws.memberById(doc.uploadedById)} size="xs" />}
                    <span className="truncate">
                      {ws.memberName(doc.uploadedById)} · {doc.createdAt ? shortDate(doc.createdAt.slice(0, 10)) : ''} {doc.size ? `· ${formatSize(doc.size)}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button variant="ghost" size="xs" icon aria-label={`Download ${doc.name}`} asChild>
                    <a href={doc.url} target="_blank" rel="noreferrer" download>
                      <DownloadSimple size={15} />
                    </a>
                  </Button>
                  {canEdit && (
                    <Button variant="ghost" size="xs" icon aria-label={`Remove ${doc.name}`} onClick={() => remove(doc.id, doc.name)}>
                      <Trash size={15} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function FileGlyph({ contentType }: { contentType: string | null }) {
  const type = contentType ?? '';
  const icon = type.includes('pdf') ? <FilePdf size={18} /> : type.startsWith('image/') ? <ImageIcon size={18} /> : type ? <FileText size={18} /> : <Paperclip size={18} />;
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-2">{icon}</span>;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
