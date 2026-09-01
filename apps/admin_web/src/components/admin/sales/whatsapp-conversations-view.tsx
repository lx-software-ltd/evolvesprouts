'use client';

import { useEffect, useState } from 'react';

import { ConversationNameCell } from './conversation-name-cell';
import { InboxImportStatus } from './inbox-import-status';

import { useAutoSelectContactConversation } from '@/hooks/use-auto-select-contact-conversation';
import { useLocationSearchParam } from '@/hooks/use-query-tab-state';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';
import { useWhatsAppConversations } from '@/hooks/use-whatsapp-conversations';
import { useWhatsAppMessages } from '@/hooks/use-whatsapp-messages';
import { toErrorMessage } from '@/hooks/hook-errors';
import { createAdminAsset, deleteAdminAsset, uploadFileToPresignedUrl } from '@/lib/assets-api';
import { formatDate } from '@/lib/format';
import { formatInboxConversationName } from '@/lib/inbox-conversation-name';
import { ADMIN_CONVERSATION_QUERY_PARAM } from '@/lib/contact-related-links';
import {
  createWhatsAppExportImportJob,
  listInboxImportJobs,
  type InboxImportJobSummary,
} from '@/lib/inbox-import-api';
import { ViewIcon } from '@/components/icons/action-icons';
import { AdminCollapsibleSection } from '@/components/ui/admin-collapsible-section';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { FileUploadButton } from '@/components/ui/file-upload-button';
import { Label } from '@/components/ui/label';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { StatusBanner } from '@/components/status-banner';

function formatWhen(value: string | null): string {
  if (!value) {
    return '—';
  }
  return formatDate(value);
}

const MAX_EXPORT_BYTES = 15 * 1024 * 1024;

export function WhatsAppConversationsView() {
  const party = useRelatedPartySearchParams();
  const conversationId = useLocationSearchParam(ADMIN_CONVERSATION_QUERY_PARAM);
  const list = useWhatsAppConversations(party);
  const [selectedId, setSelectedId] = useAutoSelectContactConversation(
    party.partyFilterKey,
    list.conversations[0]?.id ?? null,
    list.isLoading,
    conversationId
  );
  const detail = useWhatsAppMessages(selectedId);
  const [exportFile, setExportFile] = useState<File | null>(null);
  const [counterpartyWaId, setCounterpartyWaId] = useState('');
  const [businessNames, setBusinessNames] = useState('');
  const [importJob, setImportJob] = useState<InboxImportJobSummary | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listInboxImportJobs('/v1/admin/whatsapp/import-jobs')
      .then((jobs) => {
        if (!cancelled) {
          setImportJob(jobs[0] ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImportJob(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImportExport() {
    if (!exportFile) {
      return;
    }
    if (exportFile.size > MAX_EXPORT_BYTES) {
      setImportError('Export file exceeds 15MB.');
      return;
    }
    setIsImporting(true);
    setImportError('');
    let uploadedAssetId: string | null = null;
    try {
      const createdAsset = await createAdminAsset({
        title: exportFile.name,
        description: 'WhatsApp chat export',
        assetType: 'document',
        fileName: exportFile.name,
        contentType: exportFile.type || 'application/octet-stream',
        visibility: 'restricted',
      });
      if (!createdAsset.asset?.id || !createdAsset.upload.uploadUrl) {
        throw new Error('Could not prepare the WhatsApp export upload.');
      }
      uploadedAssetId = createdAsset.asset.id;
      await uploadFileToPresignedUrl({
        uploadUrl: createdAsset.upload.uploadUrl,
        uploadMethod: createdAsset.upload.uploadMethod,
        uploadHeaders: createdAsset.upload.uploadHeaders,
        file: exportFile,
      });
      const names = businessNames
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const job = await createWhatsAppExportImportJob({
        attachmentAssetId: uploadedAssetId,
        counterpartyWaId: counterpartyWaId.trim() || undefined,
        businessDisplayNames: names,
      });
      setImportJob(job);
      setExportFile(null);
      await list.refetch();
    } catch (error) {
      if (uploadedAssetId) {
        try {
          await deleteAdminAsset(uploadedAssetId);
        } catch {
          // Keep the original import error.
        }
      }
      setImportError(toErrorMessage(error, 'Could not import the WhatsApp export.'));
    } finally {
      setIsImporting(false);
    }
  }

  const selected = list.conversations.find((row) => row.id === selectedId) ?? null;

  return (
    <div className='space-y-4'>
      {selected ? (
        <AdminEditorCard
          title={
            formatInboxConversationName({
              contactName: selected.contactName,
              profileName: selected.profileName,
            }) || selected.waId
          }
          description={`Inbound ${selected.inboundCount} · outbound ${selected.outboundCount}`}
          actions={
            <Button type='button' variant='secondary' onClick={() => setSelectedId(null)}>
              Close
            </Button>
          }
        >
          {detail.error ? (
            <StatusBanner variant='error' title='Messages'>
              {detail.error}
            </StatusBanner>
          ) : null}
          {detail.isLoading ? <p className='text-sm text-slate-600'>Loading messages…</p> : null}
          {!detail.isLoading && detail.messages.length === 0 && !detail.error ? (
            <p className='text-sm text-slate-600'>No messages captured yet.</p>
          ) : null}
          <ol className='space-y-2'>
            {detail.messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.direction === 'inbound'
                    ? 'rounded-md border border-slate-200 bg-slate-50 p-3'
                    : 'rounded-md border border-emerald-100 bg-emerald-50 p-3'
                }
              >
                <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
                  {message.direction} · {message.messageType} · {formatWhen(message.sentAt)}
                </p>
                <p className='mt-1 text-sm text-slate-800'>{message.body || '(no text body)'}</p>
              </li>
            ))}
          </ol>
        </AdminEditorCard>
      ) : null}

      <PaginatedTableCard
        title='WhatsApp conversations'
        description='Inbound Cloud API messages and coexistence echoes captured from Meta webhooks.'
        isLoading={list.isLoading}
        isLoadingMore={list.isLoadingMore}
        hasMore={list.hasMore}
        error={list.error}
        onLoadMore={list.loadMore}
        toolbar={
          <div className='mb-3 space-y-3'>
            <AdminCollapsibleSection
              id='whatsapp-export-import-section'
              title='Import WhatsApp export'
              disabled={isImporting}
            >
              <p className='mb-3 text-sm text-slate-600'>
                Cloud API cannot pull old WhatsApp chats. Upload a Business App .txt or .zip
                export. Contacts are created when missing; no new sales leads are opened.
              </p>
              {importError ? (
                <StatusBanner variant='error' title='WhatsApp export'>
                  {importError}
                </StatusBanner>
              ) : null}
              <InboxImportStatus job={importJob} />
              <form
                id='whatsapp-export-import'
                className='space-y-3'
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleImportExport();
                }}
              >
                <div>
                  <Label htmlFor='whatsapp-export-file'>Chat export (.txt or .zip, max 15MB)</Label>
                  <FileUploadButton
                    id='whatsapp-export-file'
                    accept='.txt,.zip,text/plain,application/zip'
                    disabled={isImporting}
                    selectedFileName={exportFile?.name ?? null}
                    emptyLabel='No file selected'
                    buttonLabel='Choose export'
                    onChange={(event) => {
                      setExportFile(event.target.files?.[0] ?? null);
                    }}
                  />
                </div>
                <label className='flex flex-col gap-1 text-sm text-slate-700'>
                  Counterparty WhatsApp number (optional)
                  <Input
                    value={counterpartyWaId}
                    onChange={(event) => setCounterpartyWaId(event.target.value)}
                    placeholder='85291234567'
                    disabled={isImporting}
                  />
                </label>
                <label className='flex flex-col gap-1 text-sm text-slate-700'>
                  Business display names (optional, comma-separated)
                  <Input
                    value={businessNames}
                    onChange={(event) => setBusinessNames(event.target.value)}
                    placeholder='Names that are outbound in the export'
                    disabled={isImporting}
                  />
                </label>
                <div className='flex justify-start gap-2'>
                  <Button type='submit' disabled={isImporting || !exportFile}>
                    {isImporting ? 'Importing…' : 'Import export'}
                  </Button>
                </div>
              </form>
            </AdminCollapsibleSection>
            <div className='flex flex-wrap items-end gap-3'>
              <label className='flex min-w-48 flex-1 flex-col gap-1 text-sm text-slate-700'>
                Search
                <Input
                  type='search'
                  value={list.filters.q}
                  onChange={(event) => list.setFilter('q', event.target.value)}
                  placeholder='Name or WhatsApp id'
                />
              </label>
            </div>
          </div>
        }
      >
        <AdminDataTable>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>WhatsApp id</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Last message</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Inbound</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Outbound</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Lead</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {list.conversations.map((row) => (
              <tr
                key={row.id}
                className={
                  selectedId === row.id
                    ? 'cursor-pointer bg-emerald-50'
                    : 'cursor-pointer hover:bg-slate-50'
                }
                onClick={() => setSelectedId(row.id)}
              >
                <AdminDataTableCell>
                  <ConversationNameCell
                    contactId={row.contactId}
                    contactName={row.contactName}
                    profileName={row.profileName}
                  />
                </AdminDataTableCell>
                <AdminDataTableCell>{row.waId}</AdminDataTableCell>
                <AdminDataTableCell>{formatWhen(row.lastMessageAt)}</AdminDataTableCell>
                <AdminDataTableCell>{row.inboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.outboundCount}</AdminDataTableCell>
                <AdminDataTableCell>{row.leadId ? 'Linked' : '—'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    aria-label={`View conversation ${
                      formatInboxConversationName({
                        contactName: row.contactName,
                        profileName: row.profileName,
                      }) || row.waId
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(row.id);
                    }}
                  >
                    <ViewIcon className='h-4 w-4' />
                  </Button>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
    </div>
  );
}
