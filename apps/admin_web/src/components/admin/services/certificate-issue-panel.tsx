'use client';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { useCertificateIssueDraft } from '@/hooks/use-certificate-issue-draft';
import { formatDiscountCodeInstanceOptionLabel, formatServiceTitleWithTier } from '@/lib/format';
import type { ServiceSummary } from '@/types/services';

const ISSUE_FORM_ID = 'certificate-issue-form';

export interface CertificateIssuePanelProps {
  draft: ReturnType<typeof useCertificateIssueDraft>;
  serviceOptions: ServiceSummary[];
  isSaving: boolean;
}

/**
 * Draft-row editor for issuing a certificate: service → instance → completed
 * enrollment cascade, then a live PDF preview once the draft is valid.
 */
export function CertificateIssuePanel({ draft, serviceOptions, isSaving }: CertificateIssuePanelProps) {
  const {
    instances,
    instancesLoading,
    enrolledContactOptions,
    enrollmentsLoading,
    enrollmentsError,
    activePartners,
    partnerRequired,
    draftPayload,
    editorError,
    previewUrl,
    previewLoading,
    previewError,
    refreshPreview,
    handleIssue,
    fields,
  } = draft;
  const hasScope = Boolean(fields.serviceId && fields.instanceId);
  const contactPlaceholder = enrollmentsLoading
    ? 'Loading enrollments…'
    : !hasScope
      ? 'Select service and instance first'
      : enrolledContactOptions.length === 0
        ? 'No completed contact enrollments'
        : 'Select enrolled contact';

  return (
    <AdminEditorPanel
      status={editorError ? <AdminInlineError>{editorError}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode='create'
          formId={ISSUE_FORM_ID}
          isSaving={isSaving}
          submitDisabled={!draftPayload || (partnerRequired && !fields.partnerOrganizationId)}
          submitLabel='Issue certificate'
          savingLabel='Issuing…'
        >
          <Button
            type='button'
            variant='secondary'
            onClick={() => void refreshPreview()}
            disabled={!draftPayload}
            loading={previewLoading}
            loadingLabel='Rendering…'
          >
            Refresh preview
          </Button>
        </AdminEditorActions>
      }
    >
      <form
        id={ISSUE_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleIssue();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Service' htmlFor='cert-service-id' required>
            <Select
              id='cert-service-id'
              value={fields.serviceId}
              onChange={(e) => fields.setServiceId(e.target.value)}
              disabled={isSaving}
            >
              <option value=''>Select service</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatServiceTitleWithTier(s.title, s.serviceTier)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Instance' htmlFor='cert-instance-id' required>
            <Select
              id='cert-instance-id'
              value={fields.instanceId}
              onChange={(e) => fields.setInstanceId(e.target.value)}
              disabled={!fields.serviceId || instancesLoading || isSaving}
            >
              <option value=''>{instancesLoading ? 'Loading instances…' : 'Select instance'}</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {formatDiscountCodeInstanceOptionLabel(inst)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField
            label='Contact enrolled'
            htmlFor='cert-contact-enrolled'
            required
            span={2}
            error={enrollmentsError || null}
          >
            <Select
              id='cert-contact-enrolled'
              value={fields.contactId}
              onChange={(e) => fields.setContactId(e.target.value)}
              disabled={!hasScope || enrollmentsLoading || isSaving}
            >
              <option value=''>{contactPlaceholder}</option>
              {enrolledContactOptions.map((o) => (
                <option key={o.contactId} value={o.contactId}>
                  {o.label}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={4}>
          <AdminField label='Program title' htmlFor='cert-program-title' span={2}>
            <Input
              id='cert-program-title'
              value={fields.programTitle}
              onChange={(e) => fields.setProgramTitle(e.target.value)}
              disabled={isSaving}
            />
          </AdminField>
          <AdminField label='Participation date' htmlFor='cert-participation-date' required>
            <Input
              id='cert-participation-date'
              type='date'
              value={fields.participationDate}
              onChange={(e) => fields.setParticipationDate(e.target.value)}
              disabled={isSaving}
            />
          </AdminField>
          {partnerRequired ? (
            <AdminField label='Partner' htmlFor='cert-partner-id' required>
              <Select
                id='cert-partner-id'
                value={fields.partnerOrganizationId}
                onChange={(e) => fields.setPartnerOrganizationId(e.target.value)}
                disabled={isSaving}
              >
                <option value=''>Select partner</option>
                {activePartners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </AdminField>
          ) : null}
        </AdminFieldGrid>
      </form>

      <div className='space-y-2' aria-live='polite'>
        <p className='text-xs font-medium text-slate-500'>Preview</p>
        {previewError ? <AdminInlineError>{previewError}</AdminInlineError> : null}
        {previewUrl ? (
          <iframe
            title='Certificate preview'
            src={previewUrl}
            className='certificates-preview-frame h-[32rem] w-full rounded-md border border-slate-200 bg-slate-50'
          />
        ) : (
          <p className='text-sm text-slate-500'>
            {previewLoading ? 'Rendering preview…' : 'Complete the form to see a certificate preview.'}
          </p>
        )}
      </div>
    </AdminEditorPanel>
  );
}
