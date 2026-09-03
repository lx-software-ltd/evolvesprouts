import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useCompletionCertificates } from '@/hooks/use-completion-certificates';
import type { CompletionCertificate } from '@/lib/completion-certificates-api';
import type { ServiceSummary } from '@/types/services';

const mockLoadForService = vi.fn();
vi.mock('@/hooks/use-service-instance-options', () => ({
  useServiceInstanceOptions: () => ({
    instances: [],
    isLoading: false,
    error: '',
    loadForService: mockLoadForService,
    invalidate: vi.fn(),
  }),
}));

vi.mock('@/lib/services-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services-api')>();
  return {
    ...actual,
    listEnrollments: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    isAbortRequestError: () => false,
  };
});

const { getCompletionCertificatePdfDownload } = vi.hoisted(() => ({
  getCompletionCertificatePdfDownload: vi.fn().mockResolvedValue({ downloadUrl: 'https://files.example.com/cert.pdf' }),
}));

vi.mock('@/lib/completion-certificates-api', () => ({
  previewCompletionCertificatePdf: vi.fn().mockResolvedValue({ downloadUrl: '' }),
  getCompletionCertificatePdfDownload,
}));

vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => [
    {
      open: false,
      title: '',
      description: '',
      onConfirm: () => {},
      onCancel: () => {},
    },
    () => Promise.resolve(true),
  ],
}));

import { CertificatesPanel } from '@/components/admin/services/certificates-panel';

function buildCertificatesHook(
  overrides: Partial<ReturnType<typeof useCompletionCertificates>> = {}
): ReturnType<typeof useCompletionCertificates> {
  return {
    certificates: [],
    filters: { contactId: '', serviceId: '', instanceId: '', status: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    isSaving: false,
    error: '',
    hasMore: false,
    loadMore: vi.fn(),
    issueCertificate: vi.fn(),
    voidCertificate: vi.fn().mockResolvedValue(undefined),
    deleteCertificate: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    totalCount: 0,
    ...overrides,
  };
}

const serviceOptions: ServiceSummary[] = [
  {
    id: 'svc-1',
    instancesCount: 0,
    title: 'My Best Auntie',
    serviceKey: 'mba',
    serviceType: 'training_course',
    status: 'published',
    deliveryMode: 'in_person',
    locationId: null,
    coverImageS3Key: null,
    bookingSystem: null,
    serviceTier: null,
    description: null,
    createdBy: 'admin',
    createdAt: null,
    updatedAt: null,
    trainingDetails: null,
    eventDetails: null,
    consultationDetails: null,
  },
];

function buildCertificate(overrides: Partial<CompletionCertificate> = {}): CompletionCertificate {
  return {
    id: 'cert-1',
    contact_id: 'contact-1',
    contact_label: 'Amy Chan',
    instance_id: 'inst-1',
    instance_label: 'MBA · Mar 2025',
    service_id: 'svc-1',
    service_label: 'My Best Auntie',
    enrollment_id: 'enr-1',
    partner_organization_id: null,
    participation_date: '2025-03-10',
    recipient_display_name: 'Amy Chan',
    program_title: 'My Best Auntie',
    partner_display_name: null,
    partner_signer_name: null,
    body_text: 'has completed the programme.',
    status: 'issued',
    issued_at: '2025-03-11T09:00:00Z',
    issued_by: 'admin@example.com',
    voided_at: null,
    voided_by: null,
    issued_pdf_sha256: null,
    pdf_template_version: 'v1',
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('CertificatesPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/services');
  });

  it('renders a table-first list without an editor card and opens the issue form from the draft row', async () => {
    const user = userEvent.setup();
    render(<CertificatesPanel certificates={buildCertificatesHook()} serviceOptions={serviceOptions} />);

    expect(screen.getByRole('region', { name: 'Certificates' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Service/)).not.toBeInTheDocument();
    const columnHeaders = screen.getAllByRole('columnheader').map((el) => el.textContent?.trim() ?? '');
    expect(columnHeaders).toEqual(['', 'Recipient', 'Program', 'Instance', 'Participation', 'Status', 'Operations']);

    await user.click(screen.getByRole('button', { name: 'Issue certificate' }));

    expect(await screen.findByLabelText(/^Service/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Contact enrolled/)).toBeDisabled();
    expect(screen.getByText('Complete the form to see a certificate preview.')).toBeInTheDocument();
    const issueButtons = screen.getAllByRole('button', { name: 'Issue certificate' });
    expect(issueButtons.some((button) => button.hasAttribute('form'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows list error from hook', () => {
    render(
      <CertificatesPanel
        certificates={buildCertificatesHook({ error: 'Failed to load certificates' })}
        serviceOptions={serviceOptions}
      />
    );
    expect(screen.getAllByText('Failed to load certificates').length).toBeGreaterThan(0);
  });

  it('expands an issued certificate into a read-only record with download, void, and delete operations', async () => {
    const user = userEvent.setup();
    const voidCertificate = vi.fn().mockResolvedValue(undefined);
    render(
      <CertificatesPanel
        certificates={buildCertificatesHook({ certificates: [buildCertificate()], voidCertificate })}
        serviceOptions={serviceOptions}
      />
    );

    expect(screen.getByRole('button', { name: 'Download certificate PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand certificate for Amy Chan' }));

    expect(await screen.findByText('has completed the programme.')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Void certificate' }));

    await waitFor(() => {
      expect(voidCertificate).toHaveBeenCalledWith('cert-1');
    });
  });

  it('hides download and void for voided certificates but keeps delete', async () => {
    const user = userEvent.setup();
    const deleteCertificate = vi.fn().mockResolvedValue(undefined);
    render(
      <CertificatesPanel
        certificates={buildCertificatesHook({
          certificates: [buildCertificate({ status: 'voided', voided_at: '2025-04-01T00:00:00Z' })],
          deleteCertificate,
        })}
        serviceOptions={serviceOptions}
      />
    );

    expect(screen.queryByRole('button', { name: 'Download certificate PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete certificate' }));

    await waitFor(() => {
      expect(deleteCertificate).toHaveBeenCalledWith('cert-1');
    });
  });
});
