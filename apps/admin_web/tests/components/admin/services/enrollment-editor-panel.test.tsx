import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EnrollmentEditorPanel } from '@/components/admin/services/enrollment-editor-panel';

import type { Enrollment } from '@/types/services';

const pickers = {
  contactOptions: [{ id: 'contact-1', label: 'Ada Example' }],
  families: [],
  organizations: [],
  loading: false,
  error: '',
};

function renderCreate(onCreate = vi.fn()) {
  render(
    <EnrollmentEditorPanel
      mode='create'
      enrollment={null}
      pickers={pickers}
      discountOptions={[]}
      discountOptionsLoading={false}
      discountOptionsError=''
      isSaving={false}
      onCreate={onCreate}
      onUpdate={vi.fn()}
    />
  );
  return onCreate;
}

describe('EnrollmentEditorPanel billing fields', () => {
  it('sends the billing choices with a new enrollment', async () => {
    const user = userEvent.setup();
    const onCreate = renderCreate();

    await user.selectOptions(screen.getByLabelText('Contact'), 'contact-1');
    await user.type(screen.getByLabelText('Amount paid'), '480');
    expect(screen.getByLabelText('Payment method')).toHaveValue('fps');
    await user.click(screen.getByLabelText('Money is already received'));
    await user.click(screen.getByRole('button', { name: 'Add enrollment' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'contact-1',
        amount_paid: '480',
        bill_later: false,
        payment_method: 'fps',
        payment_received: true,
        send_invoice_email: false,
      })
    );
  });

  it('hides the payment method when the enrollment will be billed later', async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByLabelText('Amount paid'), '480');
    expect(screen.getByLabelText('Payment method')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Merge this onto an invoice later'));
    expect(screen.queryByLabelText('Payment method')).not.toBeInTheDocument();
  });

  it('shows the invoice number while editing', () => {
    const enrollment = {
      id: 'enr-1',
      instanceId: 'inst-1',
      contactId: 'contact-1',
      familyId: null,
      organizationId: null,
      ticketTierId: null,
      discountCodeId: null,
      status: 'registered',
      amountPaid: '480',
      currency: 'HKD',
      enrolledAt: '2026-05-01T00:00:00.000Z',
      cancelledAt: null,
      notes: null,
      createdBy: 'staff',
      createdAt: null,
      updatedAt: null,
      invoiceNumber: 'INV-2026-000001',
      paymentStatus: 'pending',
    } as Enrollment;

    render(
      <EnrollmentEditorPanel
        mode='edit'
        enrollment={enrollment}
        pickers={pickers}
        discountOptions={[]}
        discountOptionsLoading={false}
        discountOptionsError=''
        isSaving={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Invoice')).toHaveValue('INV-2026-000001');
    expect(screen.getByLabelText('Payment')).toHaveValue('Pending');
    expect(screen.queryByLabelText('Payment method')).not.toBeInTheDocument();
  });

  it('shows a draft invoice and omits an unchanged amount', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const enrollment = {
      id: 'enr-1',
      instanceId: 'inst-1',
      contactId: 'contact-1',
      familyId: null,
      organizationId: null,
      ticketTierId: null,
      discountCodeId: null,
      status: 'registered',
      amountPaid: '480.00',
      currency: 'HKD',
      enrolledAt: '2026-05-01T02:30:00.000Z',
      cancelledAt: null,
      notes: 'Keep',
      createdBy: 'staff',
      createdAt: null,
      updatedAt: null,
      invoiceNumber: null,
      invoiceStatus: 'draft',
      paymentStatus: 'pending',
    } as Enrollment;

    render(
      <EnrollmentEditorPanel
        mode='edit'
        enrollment={enrollment}
        pickers={pickers}
        discountOptions={[]}
        discountOptionsLoading={false}
        discountOptionsError=''
        isSaving={false}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    expect(screen.getByLabelText('Invoice')).toHaveValue('Draft');
    await user.click(screen.getByRole('button', { name: 'Update enrollment' }));
    expect(onUpdate).toHaveBeenCalledWith(
      'enr-1',
      expect.not.objectContaining({ amount_paid: expect.anything(), currency: expect.anything() })
    );
  });

  it('omits the default currency when the enrollment has none stored', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const enrollment = {
      id: 'enr-1',
      instanceId: 'inst-1',
      contactId: 'contact-1',
      familyId: null,
      organizationId: null,
      ticketTierId: null,
      discountCodeId: null,
      status: 'registered',
      amountPaid: '480.00',
      currency: null,
      enrolledAt: '2026-05-01T02:30:00.000Z',
      cancelledAt: null,
      notes: null,
      createdBy: 'staff',
      createdAt: null,
      updatedAt: null,
      invoiceNumber: null,
      invoiceStatus: null,
      paymentStatus: null,
    } as Enrollment;

    render(
      <EnrollmentEditorPanel
        mode='edit'
        enrollment={enrollment}
        pickers={pickers}
        discountOptions={[]}
        discountOptionsLoading={false}
        discountOptionsError=''
        isSaving={false}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Update enrollment' }));
    expect(onUpdate).toHaveBeenCalledWith(
      'enr-1',
      expect.not.objectContaining({ currency: expect.anything() })
    );
  });
});
