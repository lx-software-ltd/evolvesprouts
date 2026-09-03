'use client';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { useTagsPage } from '@/hooks/use-tags-page';

const EDITOR_FORM_ID = 'tags-editor-form';

export interface TagEditorPanelProps {
  page: ReturnType<typeof useTagsPage>;
}

/** Editor rendered inside the expanded tag row (draft or existing tag). */
export function TagEditorPanel({ page }: TagEditorPanelProps) {
  return (
    <AdminEditorPanel
      status={page.saveError ? <AdminInlineError>{page.saveError}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode={page.editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={page.isSaving}
          submitDisabled={page.editorIsBusy || !page.name.trim()}
          submitLabel={page.editorMode === 'create' ? 'Create tag' : 'Update tag'}
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void page.handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField
            label='Name'
            htmlFor='tag-name'
            span={2}
            hint={page.isEditingSystemTag ? 'This system-managed tag name cannot be changed.' : undefined}
          >
            <Input
              id='tag-name'
              value={page.name}
              onChange={(event) => page.setName(event.target.value)}
              maxLength={100}
              autoComplete='off'
              disabled={page.isEditingSystemTag}
            />
          </AdminField>
          <AdminField label='Color (#RRGGBB)' htmlFor='tag-color'>
            <Input
              id='tag-color'
              value={page.color}
              onChange={(event) => page.setColor(event.target.value)}
              placeholder='#336699'
              maxLength={7}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Description' htmlFor='tag-description' span='full'>
            <Textarea
              id='tag-description'
              value={page.description}
              onChange={(event) => page.setDescription(event.target.value)}
              rows={2}
              maxLength={255}
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}
