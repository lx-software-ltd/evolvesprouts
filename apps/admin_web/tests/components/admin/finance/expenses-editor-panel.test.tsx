import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ExpensesEditorPanel } from '@/components/admin/finance/expenses-editor-panel';
import type { Expense } from '@/types/expenses';
import type { Vendor } from '@/types/vendors';

const vendor: Vendor = {
  id: 'vendor-1',
  name: 'Acme Co',
  active: true,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  website: null,
};

const baseExpense: Expense = {
  id: 'exp-1',
  amendsExpenseId: null,
  status: 'submitted',
  parseStatus: 'succeeded',
  vendorId: vendor.id,
  vendorName: vendor.name,
  invoiceNumber: 'INV-1',
  invoiceDate: '2026-03-01',
  dueDate: null,
  currency: 'HKD',
  subtotal: '10.00',
  tax: '0',
  total: '10.00',
  lineItems: [],
  parseConfidence: null,
  notes: null,
  voidReason: null,
  createdBy: 'u',
  updatedBy: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  submittedAt: null,
  paidAt: null,
  voidedAt: null,
  attachments: [
    {
      id: 'att-1',
      assetId: 'asset-1',
      sortOrder: 0,
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      assetTitle: null,
    },
  ],
};

function renderEditor(
  overrides: Partial<ComponentProps<typeof ExpensesEditorPanel>> = {}
) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onAmend = vi.fn().mockResolvedValue(undefined);
  const onDirtyChange = vi.fn();

  render(
    <ExpensesEditorPanel
      selectedExpense={null}
      vendorOptions={[vendor]}
      isLoadingVendors={false}
      isSaving={false}
      isUploadingFiles={false}
      mutationError=''
      onCreate={onCreate}
      onUpdate={onUpdate}
      onAmend={onAmend}
      onDirtyChange={onDirtyChange}
      {...overrides}
    />
  );

  return { onCreate, onUpdate, onAmend, onDirtyChange };
}

describe('ExpensesEditorPanel', () => {
  it('renders without a title or Cancel button', () => {
    renderEditor({ selectedExpense: baseExpense });

    // Only sub-accordion triggers (Line items, Attachments) render as headings.
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /expense details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('requires a vendor before create submit and reports dirty edits', async () => {
    const user = userEvent.setup();
    const { onCreate, onDirtyChange } = renderEditor();

    expect(screen.getByRole('button', { name: 'Submit expense' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/^Vendor/), vendor.id);
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Submit expense' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            vendorId: vendor.id,
            parseRequested: true,
          }),
        })
      );
    });
  });

  it('calls onUpdate in edit mode', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor({ selectedExpense: baseExpense });

    await user.click(screen.getByRole('button', { name: 'Update expense' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: baseExpense.id,
          existingAttachmentAssetIds: ['asset-1'],
        })
      );
    });
  });

  it('shows mutation errors', () => {
    renderEditor({ mutationError: 'Save failed' });
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });
});
