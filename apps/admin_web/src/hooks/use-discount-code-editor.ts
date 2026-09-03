'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { useServiceInstanceOptions } from '@/hooks/use-service-instance-options';
import { toErrorMessage } from '@/hooks/hook-errors';
import { isAdminApiConflictOnField } from '@/lib/admin-api-conflict-messages';
import {
  bumpDuplicateDiscountCode,
  DISCOUNT_CODE_ALLOCATION_FAILED_MESSAGE,
  MAX_DISCOUNT_CODE_DUPLICATE_CREATE_RETRIES,
} from '@/lib/discount-code-duplicate';
import {
  DISCOUNT_VALIDITY_RANGE_INVERTED_MESSAGE,
  isDiscountValidityRangeInverted,
} from '@/lib/discount-validity';
import { formatIsoForDatetimeLocalInput, parseAdminDateTimeInputToIsoUtc } from '@/lib/format';
import {
  normalizeDiscountTypeFromApi,
  REFERRAL_DEFAULT_CURRENCY,
  REFERRAL_DEFAULT_DISCOUNT_VALUE,
} from '@/types/services';
import type { DiscountCode, ServiceSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

/** Query parameter that mirrors the expanded discount code row (`?code=<id>` or `?code=new`). */
export const ADMIN_DISCOUNT_CODE_QUERY_PARAM = 'code';

export interface UseDiscountCodeEditorInput {
  codes: DiscountCode[];
  isLoading: boolean;
  isSaving: boolean;
  serviceOptions: ServiceSummary[];
  serviceById: Map<string, ServiceSummary>;
  instanceOptionsRefreshKey?: unknown;
  onCreate: (
    payload: ApiSchemas['CreateDiscountCodeRequest'],
    options?: { batchSaving?: boolean }
  ) => Promise<unknown> | void;
  onUpdate: (codeId: string, payload: ApiSchemas['UpdateDiscountCodeRequest']) => Promise<unknown> | void;
  onDelete: (codeId: string) => Promise<void> | void;
  onDiscountCodesRefresh?: () => void | Promise<void>;
}

/**
 * Editor state for the table-first Discount codes panel. The expanded row
 * drives create/edit mode; create retries with `COPY`, `COPY2`, ... when the
 * API reports a duplicate code, and scope changes on used codes ask first.
 */
export function useDiscountCodeEditor({
  codes,
  isLoading,
  isSaving,
  serviceOptions,
  serviceById,
  instanceOptionsRefreshKey,
  onCreate,
  onUpdate,
  onDelete,
  onDiscountCodesRefresh,
}: UseDiscountCodeEditorInput) {
  const shell = useEntityPanelEditorShell({ paramName: ADMIN_DISCOUNT_CODE_QUERY_PARAM });
  const { editorMode, selectedId, expanded, requestConfirm, setDeleteActionError, clearDirty, track } = shell;
  const [scopeConfirmProps, requestScopeConfirm] = useConfirmDialog();
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<ApiSchemas['DiscountType']>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [maxUses, setMaxUses] = useState('');
  const [active, setActive] = useState(true);
  const [validFromLocal, setValidFromLocal] = useState('');
  const [validUntilLocal, setValidUntilLocal] = useState('');
  const [validityRangeError, setValidityRangeError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [isBatchCreating, setIsBatchCreating] = useState(false);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);

  const instanceOptions = useServiceInstanceOptions(instanceOptionsRefreshKey);
  const { loadForService } = instanceOptions;

  const discountTypeSelectValue = normalizeDiscountTypeFromApi(discountType);
  const isReferral = discountTypeSelectValue === 'referral';

  /** “Applies to service” picker: published only, plus current selection if not published (edit legacy rows). */
  const serviceSelectOptions = useMemo(() => {
    const published = serviceOptions.filter((svc) => svc.status === 'published');
    if (!serviceId.trim()) {
      return published;
    }
    const selected = serviceById.get(serviceId.trim());
    if (!selected || selected.status === 'published') {
      return published;
    }
    const ids = new Set(published.map((s) => s.id));
    return ids.has(selected.id) ? published : [...published, selected];
  }, [serviceById, serviceId, serviceOptions]);

  const selectedCode = useMemo(() => codes.find((entry) => entry.id === selectedId) ?? null, [codes, selectedId]);

  useEffect(() => {
    void loadForService(serviceId.trim() || null);
  }, [loadForService, serviceId]);

  const resetForm = useCallback(() => {
    setCode('');
    setDescription('');
    setDiscountType('percentage');
    setDiscountValue('');
    setCurrency('HKD');
    setMaxUses('');
    setActive(true);
    setValidFromLocal('');
    setValidUntilLocal('');
    setValidityRangeError('');
    setSaveError('');
    setServiceId('');
    setInstanceId('');
    setIsBatchCreating(false);
    clearDirty();
  }, [clearDirty]);

  const applyRow = useCallback(
    (entry: DiscountCode) => {
      setCode(entry.code);
      setDescription(entry.description ?? '');
      setDiscountType(normalizeDiscountTypeFromApi(entry.discountType));
      setDiscountValue(entry.discountValue);
      setCurrency(entry.currency ?? 'HKD');
      setMaxUses(entry.maxUses?.toString() ?? '');
      setActive(entry.active);
      setValidFromLocal(formatIsoForDatetimeLocalInput(entry.validFrom));
      setValidUntilLocal(formatIsoForDatetimeLocalInput(entry.validUntil));
      setValidityRangeError('');
      setSaveError('');
      setServiceId(entry.serviceId ?? '');
      setInstanceId(entry.instanceId ?? '');
      clearDirty();
    },
    [clearDirty]
  );

  useExpandedRecordForm<DiscountCode>({
    expandedId: expanded.expandedId,
    rows: codes,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const validityInverted = isDiscountValidityRangeInverted(validFromLocal, validUntilLocal);
  const editorIsBusy = isSaving || isBatchCreating;
  const canSubmit = !editorIsBusy && Boolean(code.trim()) && (isReferral || Boolean(discountValue.trim())) && !validityInverted;

  async function handleSubmit(): Promise<void> {
    if (validityInverted) {
      setValidityRangeError(DISCOUNT_VALIDITY_RANGE_INVERTED_MESSAGE);
      return;
    }
    setValidityRangeError('');
    setSaveError('');
    const serviceUuid = serviceId.trim() || null;
    const instanceUuid = serviceUuid && instanceId.trim() ? instanceId.trim() : null;
    const shared = {
      description: description.trim() || null,
      discount_type: discountTypeSelectValue,
      discount_value: isReferral ? REFERRAL_DEFAULT_DISCOUNT_VALUE : discountValue.trim(),
      currency: isReferral ? REFERRAL_DEFAULT_CURRENCY : currency.trim() || null,
      valid_from: parseAdminDateTimeInputToIsoUtc(validFromLocal),
      valid_until: parseAdminDateTimeInputToIsoUtc(validUntilLocal),
      max_uses: maxUses ? Number(maxUses) : null,
      active,
      service_id: serviceUuid,
      instance_id: instanceUuid,
    };

    try {
      if (editorMode === 'create') {
        await createWithDuplicateRetry({ ...shared, code: code.trim().toUpperCase() });
        return;
      }
      if (!selectedCode) {
        return;
      }
      const scopeChanged =
        serviceUuid !== (selectedCode.serviceId ?? null) || instanceUuid !== (selectedCode.instanceId ?? null);
      if (selectedCode.currentUses > 0 && scopeChanged) {
        const ok = await requestScopeConfirm({
          title: 'Change discount scope?',
          description: `This code has been used ${selectedCode.currentUses} times. Changing scope won't retroactively affect past bookings, but future validations and redemptions will follow the new scope. Continue?`,
          confirmLabel: 'Continue',
          cancelLabel: 'Cancel',
          variant: 'default',
        });
        if (!ok) {
          return;
        }
      }
      await onUpdate(selectedCode.id, shared);
      clearDirty();
    } catch (err) {
      setSaveError(toErrorMessage(err, 'Save failed.'));
    }
  }

  async function createWithDuplicateRetry(createPayload: ApiSchemas['CreateDiscountCodeRequest']): Promise<void> {
    let attemptCode = createPayload.code;
    const maxDuplicateRetries = MAX_DISCOUNT_CODE_DUPLICATE_CREATE_RETRIES;
    setIsBatchCreating(true);
    try {
      for (let round = 0; round < maxDuplicateRetries; round += 1) {
        try {
          const isLastAttempt = round === maxDuplicateRetries - 1;
          await onCreate({ ...createPayload, code: attemptCode }, { batchSaving: !isLastAttempt });
          clearDirty();
          expanded.collapse();
          return;
        } catch (err) {
          if (!isAdminApiConflictOnField(err, 'code')) {
            throw err;
          }
          const nextCode = bumpDuplicateDiscountCode(attemptCode);
          if (nextCode === attemptCode) {
            throw err;
          }
          attemptCode = nextCode;
          setCode(nextCode);
        }
      }
      setSaveError(DISCOUNT_CODE_ALLOCATION_FAILED_MESSAGE);
      void onDiscountCodesRefresh?.();
    } finally {
      setIsBatchCreating(false);
    }
  }

  async function handleDeleteCode(entry: DiscountCode): Promise<void> {
    const confirmed = await requestConfirm({
      title: 'Delete discount code',
      description: `Delete "${entry.code}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    setDeletingCodeId(entry.id);
    try {
      await onDelete(entry.id);
      if (selectedId === entry.id) {
        clearDirty();
        expanded.collapse();
      }
    } catch (err) {
      setDeleteActionError(toErrorMessage(err, 'Failed to delete discount code'));
    } finally {
      setDeletingCodeId(null);
    }
  }

  const setDiscountTypeTracked = track((next: ApiSchemas['DiscountType']) => {
    const prev = discountTypeSelectValue;
    setDiscountType(next);
    if (next === 'referral') {
      setDiscountValue(REFERRAL_DEFAULT_DISCOUNT_VALUE);
      setCurrency(REFERRAL_DEFAULT_CURRENCY);
    } else if (prev === 'referral') {
      setDiscountValue('');
    }
  });

  return {
    shell,
    scopeConfirmProps,
    expanded,
    editorMode,
    selectedId,
    selectedCode,
    editorIsBusy,
    canSubmit,
    deletingCodeId,
    instanceOptions,
    serviceSelectOptions,
    discountTypeSelectValue,
    isReferral,
    validityRangeError,
    saveError,
    fields: {
      code,
      setCode: track((value: string) => {
        setSaveError('');
        setCode(value.toUpperCase());
      }),
      description,
      setDescription: track(setDescription),
      setDiscountType: setDiscountTypeTracked,
      discountValue,
      setDiscountValue: track(setDiscountValue),
      currency,
      setCurrency: track(setCurrency),
      maxUses,
      setMaxUses: track(setMaxUses),
      active,
      setActive: track(setActive),
      validFromLocal,
      setValidFromLocal: track((value: string) => {
        setValidFromLocal(value);
        setValidityRangeError('');
      }),
      validUntilLocal,
      setValidUntilLocal: track((value: string) => {
        setValidUntilLocal(value);
        setValidityRangeError('');
      }),
      serviceId,
      setServiceId: track((value: string) => {
        setServiceId(value);
        setInstanceId('');
      }),
      instanceId,
      setInstanceId: track(setInstanceId),
    },
    handleSubmit,
    handleDeleteCode,
  };
}
