'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface EntityRemoveMemberDialogProps {
  open: boolean;
  entityLabel: string;
  memberLabel: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function EntityRemoveMemberDialog({
  open,
  entityLabel,
  memberLabel,
  isSaving,
  onCancel,
  onConfirm,
}: EntityRemoveMemberDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title={`Remove ${entityLabel} member`}
      description={
        memberLabel ? `Remove ${memberLabel} from this ${entityLabel}?` : 'Remove this member?'
      }
      variant='danger'
      confirmLabel='Remove'
      confirmLoading={isSaving}
      confirmLoadingLabel='Removing…'
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
