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
  /** When true, the confirm action is non-interactive (for example during an in-flight mutation). */
  confirmDisabled?: boolean;
  /** When true, only the cancel/secondary control is shown (use for preview dialogs). */
  hideConfirm?: boolean;
  /** ARIA role for the modal surface; use `dialog` for informational previews. */
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
  hideConfirm = false,
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
          <Button
            type='button'
            variant={hideConfirm ? 'primary' : 'secondary'}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          {hideConfirm ? null : (
            <Button
              type='button'
              variant={variant === 'danger' ? 'danger' : 'primary'}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      }
    >
      {children}
    </AdminDialog>
  );
}
