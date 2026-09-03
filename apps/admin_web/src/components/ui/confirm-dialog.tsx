'use client';

import type { ReactNode } from 'react';

import { AdminDialog } from '@/components/ui/admin-dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional fields (for example a void reason) rendered between the description and actions. */
  children?: ReactNode;
  /** When true, the confirm action is non-interactive (for example while a prerequisite is missing). */
  confirmDisabled?: boolean;
  /** In-flight confirm mutation: shows the standard spinner + `confirmLoadingLabel`. */
  confirmLoading?: boolean;
  confirmLoadingLabel?: string;
  /** ARIA role for the modal surface; `alertdialog` for destructive confirmations. */
  dialogRole?: 'dialog' | 'alertdialog';
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
  confirmLoading = false,
  confirmLoadingLabel,
  dialogRole = 'alertdialog',
}: ConfirmDialogProps) {
  return (
    <AdminDialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      dialogRole={dialogRole}
      footer={
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='secondary' onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type='button'
            variant={variant === 'danger' ? 'danger' : 'primary'}
            disabled={confirmDisabled}
            loading={confirmLoading}
            loadingLabel={confirmLoadingLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {children}
    </AdminDialog>
  );
}
