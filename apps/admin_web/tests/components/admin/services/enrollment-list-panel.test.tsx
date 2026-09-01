import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnrollmentListPanel } from '@/components/admin/services/enrollment-list-panel';
import { parseDatetimeLocalToIsoUtc } from '@/lib/format';
import type { Enrollment } from '@/types/services';

vi.mock('@/lib/services-api', () => ({
  isAbortRequestError: () => false,
  listEnrollmentDiscountOptions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/hooks/use-enrollment-parent-pickers', () => ({
  useEnrollmentParentPickers: () => ({
    contactOptions: [{ id: 'contact-1', label: 'Jane Doe' }],
    families: [{ id: 'family-1', label: 'Smith family' }],
    organizations: [{ id: 'org-1', label: 'Acme Org' }],
    partnerOrganizations: [],
    loading: false,
    error: '',
    labelByContactId: new Map([['contact-1', 'Jane Doe']]),
    labelByFamilyId: new Map([['family-1', 'Smith family']]),
    labelByOrganizationId: new Map([['org-1', 'Acme Org']]),
    labelByPartnerOrganizationId: new Map(),
  }),
}));

const ENROLLMENT_FIXTURE: Enrollment = {
  id: 'enrollment-1',
  instanceId: 'instance-1',
  contactId: 'contact-1',
  familyId: null,
  organizationId: null,
  ticketTierId: null,
  discountCodeId: null,
  status: 'registered',
  amountPaid: null,
  currency: 'HKD',
  enrolledAt: '2026-03-01T10:00:00Z',
  cancelledAt: null,
  notes: null,
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
};

describe('EnrollmentListPanel', () => {
  it('locks contact in edit mode; allows family and org for contact-only conversion', () => {
    render(
      <EnrollmentListPanel
        enrollments={[ENROLLMENT_FIXTURE]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Add or update an enrollment using the same fields below.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact')).toBeEnabled();
    expect(screen.getByLabelText('Family')).toBeEnabled();
    expect(screen.getByLabelText('Organization')).toBeEnabled();

    const table = screen.getByRole('table');
    const selectedRow = within(table).getByText('Jane Doe').closest('tr');
    expect(selectedRow).not.toBeNull();
    fireEvent.click(selectedRow as HTMLTableRowElement);

    expect(screen.getByText('Add or update an enrollment using the same fields below.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact')).toBeDisabled();
    expect(screen.getByLabelText('Family')).toBeEnabled();
    expect(screen.getByLabelText('Organization')).toBeEnabled();
    expect(screen.getByLabelText('Enrolled at')).toBeEnabled();
  });

  it('locks family and organization pickers when enrollment is not contact-only', () => {
    const familyEnrollment: Enrollment = {
      ...ENROLLMENT_FIXTURE,
      id: 'enrollment-2',
      contactId: null,
      familyId: 'family-1',
      organizationId: null,
    };
    render(
      <EnrollmentListPanel
        enrollments={[familyEnrollment]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Smith family').closest('tr') as HTMLTableRowElement);

    expect(screen.getByLabelText('Contact')).toBeDisabled();
    expect(screen.getByLabelText('Family')).toBeDisabled();
    expect(screen.getByLabelText('Organization')).toBeDisabled();
  });

  it('disables enrolled at while adding a new enrollment', () => {
    render(
      <EnrollmentListPanel
        enrollments={[ENROLLMENT_FIXTURE]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Enrolled at')).toBeDisabled();
  });

  it('includes enrolled_at in the update payload after changing datetime-local', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <EnrollmentListPanel
        enrollments={[ENROLLMENT_FIXTURE]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />
    );

    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Jane Doe').closest('tr') as HTMLTableRowElement);

    const enrolledInput = screen.getByLabelText('Enrolled at');
    fireEvent.change(enrolledInput, { target: { value: '2026-06-15T14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update enrollment' }));

    expect(onUpdate).toHaveBeenCalledWith(
      'enrollment-1',
      expect.objectContaining({
        enrolled_at: parseDatetimeLocalToIsoUtc('2026-06-15T14:30'),
      }),
    );
  });

  it('uses selectable currency options in the enrollment editor', () => {
    render(
      <EnrollmentListPanel
        enrollments={[]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const currencyField = screen.getByLabelText('Currency');
    expect(currencyField.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'HKD Hong Kong Dollar' })).toBeInTheDocument();
  });

  it('auto-selects the contact enrollment from a party deep link', () => {
    const other: Enrollment = {
      ...ENROLLMENT_FIXTURE,
      id: 'enrollment-other',
      contactId: 'contact-other',
    };
    render(
      <EnrollmentListPanel
        enrollments={[other, ENROLLMENT_FIXTURE]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        autoSelectParty={{ contactId: 'contact-1' }}
      />
    );

    expect(screen.getByLabelText('Contact')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update enrollment' })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe').closest('tr')).toHaveClass('bg-slate-100');
  });

  it('auto-selects the family enrollment from a party deep link', () => {
    const familyEnrollment: Enrollment = {
      ...ENROLLMENT_FIXTURE,
      id: 'enrollment-family',
      contactId: null,
      familyId: 'family-1',
    };
    render(
      <EnrollmentListPanel
        enrollments={[ENROLLMENT_FIXTURE, familyEnrollment]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        autoSelectParty={{ familyId: 'family-1' }}
      />
    );

    expect(screen.getByLabelText('Family')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update enrollment' })).toBeInTheDocument();
    expect(screen.getByText('Smith family').closest('tr')).toHaveClass('bg-slate-100');
  });

  it('auto-selects the organisation enrollment from a party deep link', () => {
    const orgEnrollment: Enrollment = {
      ...ENROLLMENT_FIXTURE,
      id: 'enrollment-org',
      contactId: null,
      familyId: null,
      organizationId: 'org-1',
    };
    render(
      <EnrollmentListPanel
        enrollments={[ENROLLMENT_FIXTURE, orgEnrollment]}
        serviceId='service-1'
        instanceId='instance-1'
        canCreate={true}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        autoSelectParty={{ organizationId: 'org-1' }}
      />
    );

    expect(screen.getByLabelText('Organization')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update enrollment' })).toBeInTheDocument();
    expect(screen.getByText('Acme Org').closest('tr')).toHaveClass('bg-slate-100');
  });
});
