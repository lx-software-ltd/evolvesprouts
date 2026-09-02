import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminDialog } from '@/components/ui/admin-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

describe('AdminDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <AdminDialog open={false} title='Hidden' onClose={() => undefined}>
        body
      </AdminDialog>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('labels the dialog and renders a default close button', () => {
    const onClose = vi.fn();
    render(
      <AdminDialog open title='Detail' description='More info' onClose={onClose}>
        <p>body</p>
      </AdminDialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Detail');
    expect(dialog).toHaveAccessibleDescription('More info');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and uses a custom footer when provided', () => {
    const onClose = vi.fn();
    render(
      <AdminDialog open title='Detail' onClose={onClose} footer={<button type='button'>Custom</button>}>
        body
      </AdminDialog>
    );
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog', () => {
  it('renders cancel before confirm and wires both callbacks', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title='Delete?'
        description='Irreversible.'
        confirmLabel='Delete'
        variant='danger'
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete?');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete']);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm action while busy and renders extra fields', () => {
    render(
      <ConfirmDialog
        open
        title='Void invoice?'
        description='Provide a reason.'
        confirmDisabled
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <input aria-label='Reason' />
      </ConfirmDialog>
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
  });
});
