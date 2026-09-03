'use client';

import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminReadOnlyValue } from '@/components/ui/admin-read-only-value';
import type { CompletionCertificate } from '@/lib/completion-certificates-api';
import { formatDate, formatEnumLabel } from '@/lib/format';

export interface CertificateDetailProps {
  certificate: CompletionCertificate;
}

/** Read-only record of an issued certificate, rendered inside its expanded row. */
export function CertificateDetail({ certificate }: CertificateDetailProps) {
  const voided = certificate.status === 'voided';
  return (
    <AdminEditorPanel>
      <AdminFieldGrid columns={4}>
        <AdminReadOnlyValue label='Recipient'>{certificate.recipient_display_name}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Contact'>{certificate.contact_label}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Service'>{certificate.service_label}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Instance'>{certificate.instance_label}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Program title'>{certificate.program_title}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Participation date'>{formatDate(certificate.participation_date)}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Partner'>{certificate.partner_display_name || '—'}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Partner signer'>{certificate.partner_signer_name || '—'}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Status'>{formatEnumLabel(certificate.status)}</AdminReadOnlyValue>
        <AdminReadOnlyValue label='Issued'>
          {formatDate(certificate.issued_at)}
          <span className='block text-xs text-slate-500'>by {certificate.issued_by}</span>
        </AdminReadOnlyValue>
        {voided ? (
          <AdminReadOnlyValue label='Voided'>
            {formatDate(certificate.voided_at ?? null)}
            {certificate.voided_by ? (
              <span className='block text-xs text-slate-500'>by {certificate.voided_by}</span>
            ) : null}
          </AdminReadOnlyValue>
        ) : null}
        <AdminReadOnlyValue label='Template version' mono>
          {certificate.pdf_template_version || '—'}
        </AdminReadOnlyValue>
      </AdminFieldGrid>
      <AdminReadOnlyValue label='Certificate text'>
        <p className='whitespace-pre-line'>{certificate.body_text}</p>
      </AdminReadOnlyValue>
    </AdminEditorPanel>
  );
}
