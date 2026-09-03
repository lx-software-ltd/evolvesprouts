'use client';

import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import { BUTTON_DEFAULT_LOADING_LABEL, Button } from './button';

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
  isSaving?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  savingLabel?: string;
  /** Extra secondary controls rendered after the primary action. */
  children?: ReactNode;
}

/**
 * Standard action row: one primary button (Create / Update). There is no
 * Cancel: collapsing the row (chevron, row click, or another row) is how the
 * operator leaves an editor, and unsaved edits are guarded by the row hook.
 */
export function AdminEditorActions({
  mode,
  formId,
  onSubmit,
  isSaving = false,
  submitDisabled = false,
  submitLabel,
  savingLabel = BUTTON_DEFAULT_LOADING_LABEL,
  children,
}: AdminEditorActionsProps) {
  const label = submitLabel ?? (mode === 'create' ? 'Create' : 'Update');
  return (
    <>
      <Button
        type={formId ? 'submit' : 'button'}
        form={formId}
        onClick={formId ? undefined : onSubmit}
        disabled={submitDisabled}
        loading={isSaving}
        loadingLabel={savingLabel}
      >
        {label}
      </Button>
      {children}
    </>
  );
}
