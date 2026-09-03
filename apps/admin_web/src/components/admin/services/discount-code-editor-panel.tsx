'use client';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { useDiscountCodeEditor } from '@/hooks/use-discount-code-editor';
import {
  formatDiscountCodeInstanceOptionLabel,
  formatEnumLabel,
  formatServiceTitleWithTier,
  getCurrencyOptions,
} from '@/lib/format';
import { DISCOUNT_TYPES } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

const EDITOR_FORM_ID = 'discount-code-editor-form';

export interface DiscountCodeEditorPanelProps {
  editor: ReturnType<typeof useDiscountCodeEditor>;
}

/** Editor rendered inside the expanded discount code row (or the draft row). */
export function DiscountCodeEditorPanel({ editor }: DiscountCodeEditorPanelProps) {
  const {
    editorMode,
    editorIsBusy,
    canSubmit,
    instanceOptions,
    serviceSelectOptions,
    discountTypeSelectValue,
    isReferral,
    validityRangeError,
    saveError,
    fields,
    handleSubmit,
  } = editor;
  const currencyOptions = getCurrencyOptions();
  const statusMessage = validityRangeError || saveError;

  return (
    <AdminEditorPanel
      status={statusMessage ? <AdminInlineError>{statusMessage}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode={editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={editorIsBusy}
          submitDisabled={!canSubmit}
          submitLabel={editorMode === 'create' ? 'Create code' : 'Update code'}
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField
            label='Code'
            htmlFor='discount-code'
            required
            hint={editorMode === 'edit' ? 'Codes cannot be changed after creation.' : undefined}
          >
            <Input
              id='discount-code'
              value={fields.code}
              onChange={(event) => fields.setCode(event.target.value)}
              disabled={editorMode === 'edit' || editorIsBusy}
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Type' htmlFor='discount-type'>
            <Select
              id='discount-type'
              value={discountTypeSelectValue}
              onChange={(event) => fields.setDiscountType(event.target.value as ApiSchemas['DiscountType'])}
              disabled={editorIsBusy}
            >
              {DISCOUNT_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnumLabel(entry)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Valid from' htmlFor='discount-valid-from'>
            <Input
              id='discount-valid-from'
              type='datetime-local'
              value={fields.validFromLocal}
              onChange={(event) => fields.setValidFromLocal(event.target.value)}
              disabled={editorIsBusy}
            />
          </AdminField>
          <AdminField label='Valid until' htmlFor='discount-valid-until'>
            <Input
              id='discount-valid-until'
              type='datetime-local'
              value={fields.validUntilLocal}
              onChange={(event) => fields.setValidUntilLocal(event.target.value)}
              disabled={editorIsBusy}
            />
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={2}>
          <AdminField label='Applies to service' htmlFor='discount-service'>
            <Select
              id='discount-service'
              value={fields.serviceId}
              onChange={(event) => fields.setServiceId(event.target.value)}
              disabled={editorIsBusy}
            >
              <option value=''>All services</option>
              {serviceSelectOptions.map((svc) => (
                <option key={svc.id} value={svc.id}>
                  {formatServiceTitleWithTier(svc.title, svc.serviceTier)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField
            label='Applies to instance'
            htmlFor='discount-instance'
            hint={instanceOptions.isLoading ? 'Loading instances…' : undefined}
            error={instanceOptions.error || null}
          >
            <Select
              id='discount-instance'
              value={fields.instanceId}
              onChange={(event) => fields.setInstanceId(event.target.value)}
              disabled={!fields.serviceId.trim() || editorIsBusy}
            >
              <option value=''>All instances</option>
              {instanceOptions.instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {formatDiscountCodeInstanceOptionLabel(inst)}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={4}>
          <AdminField label='Value' htmlFor='discount-value' required={!isReferral}>
            <Input
              id='discount-value'
              value={fields.discountValue}
              onChange={(event) => fields.setDiscountValue(event.target.value)}
              disabled={isReferral || editorIsBusy}
              inputMode='decimal'
            />
          </AdminField>
          <AdminField label='Currency' htmlFor='discount-currency'>
            <Select
              id='discount-currency'
              value={fields.currency}
              onChange={(event) => fields.setCurrency(event.target.value)}
              disabled={discountTypeSelectValue === 'percentage' || isReferral || editorIsBusy}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Max uses' htmlFor='discount-max-uses'>
            <Input
              id='discount-max-uses'
              value={fields.maxUses}
              onChange={(event) => fields.setMaxUses(event.target.value)}
              disabled={editorIsBusy}
              inputMode='numeric'
            />
          </AdminField>
          <AdminField label='Status' htmlFor='discount-status'>
            <Select
              id='discount-status'
              value={fields.active ? 'true' : 'false'}
              onChange={(event) => fields.setActive(event.target.value === 'true')}
              disabled={editorIsBusy}
            >
              <option value='true'>Enabled</option>
              <option value='false'>Disabled</option>
            </Select>
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={1}>
          <AdminField label='Description' htmlFor='discount-description'>
            <Textarea
              id='discount-description'
              value={fields.description}
              onChange={(event) => fields.setDescription(event.target.value)}
              rows={2}
              disabled={editorIsBusy}
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}
