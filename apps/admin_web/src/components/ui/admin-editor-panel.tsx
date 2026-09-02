'use client';

import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import { Button } from './button';

export interface AdminEditorPanelProps {
  /** Field area, usually `AdminFieldGrid` rows and `AdminDisclosure` sections. */
  children: ReactNode;
  /** Single action row rendered under the fields (see `AdminEditorActions`). */
  actions?: ReactNode;
  /** Error or status banner shown above the actions. */
  status?: ReactNode;
  className?: string;
}

/**
 * Body of an expanded record row. No title or description: the row itself
 * identifies the record, so the panel starts directly with fields.
 */
export function AdminEditorPanel({ children, actions, status, className }: AdminEditorPanelProps) {
  return (
    <div className={clsx('space-y-4', className)} data-testid='admin-editor-panel'>
      {children}
      {status}
      {actions ? (
        <div className='flex flex-wrap items-center justify-start gap-2 border-t border-slate-200 pt-4'>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export interface AdminEditorActionsProps {
  mode: 'create' | 'edit';
  /** Id of the `<form>` the primary button submits; omit when using `onSubmit`. */
  formId?: string;
  onSubmit?: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  savingLabel?: string;
  cancelLabel?: string;
  /** Extra secondary controls rendered after the primary action. */
  children?: ReactNode;
}

/**
 * Standard action row: Create shows only the primary button; Edit shows
 * Cancel to the left of the primary action.
 */
export function AdminEditorActions({
  mode,
  formId,
  onSubmit,
  onCancel,
  isSaving = false,
  submitDisabled = false,
  submitLabel,
  savingLabel = 'Saving...',
  cancelLabel = 'Cancel',
  children,
}: AdminEditorActionsProps) {
  const label = submitLabel ?? (mode === 'create' ? 'Create' : 'Update');
  return (
    <>
      {mode === 'edit' && onCancel ? (
        <Button type='button' variant='secondary' onClick={onCancel} disabled={isSaving}>
          {cancelLabel}
        </Button>
      ) : null}
      <Button
        type={formId ? 'submit' : 'button'}
        form={formId}
        onClick={formId ? undefined : onSubmit}
        disabled={isSaving || submitDisabled}
      >
        {isSaving ? savingLabel : label}
      </Button>
      {children}
    </>
  );
}
