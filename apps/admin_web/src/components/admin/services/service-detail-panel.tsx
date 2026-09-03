'use client';

import { useCallback, useEffect, useRef } from 'react';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import type { components } from '@/types/generated/admin-api.generated';
import type { LocationSummary, ServiceDetail } from '@/types/services';

import { ServiceDetailFormBody } from './service-detail-form-body';
import { useServiceDetailPanel } from '@/hooks/use-service-detail-panel';

type ApiSchemas = components['schemas'];

const SERVICE_EDITOR_FORM_ID = 'service-editor-form';

export interface ServiceDetailPanelProps {
  mode: 'create' | 'edit';
  /** Full record for edit mode; `null` while creating. */
  service: ServiceDetail | null;
  /** When set in create mode, seed the draft from this template (UI-only duplicate). */
  createPrefillFromService?: ServiceDetail | null;
  locationOptions?: LocationSummary[];
  isLoadingLocations?: boolean;
  locationError?: string | null;
  isSaving: boolean;
  error: string;
  onCreate: (payload: ApiSchemas['CreateServiceRequest']) => Promise<void> | void;
  onUpdate: (payload: ApiSchemas['PartialUpdateServiceRequest']) => Promise<void> | void;
  onUploadCover: (fileName: string, contentType: string) => Promise<void> | void;
  /** Reports unsaved edits so the row hook can guard switching rows. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Editor rendered inside the expanded service row (or the draft row). No
 * title: the row above names the service. Type-specific field rows follow the
 * shared field grid, then one action row (Create / Update, plus the cover
 * upload helper while editing).
 */
export function ServiceDetailPanel({
  mode,
  service,
  createPrefillFromService = null,
  locationOptions = [],
  isLoadingLocations = false,
  locationError = null,
  isSaving,
  error,
  onCreate,
  onUpdate,
  onUploadCover,
  onDirtyChange,
}: ServiceDetailPanelProps) {
  const panel = useServiceDetailPanel({
    service: mode === 'edit' ? service : null,
    createPrefillFromService,
    locationOptions,
    isLoading: isSaving,
    onCreate,
    onUpdate,
  });

  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  // Collapsing the row unmounts the editor; its edits are gone with it.
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  const track = useCallback(
    <TValue,>(setter: (value: TValue) => void) =>
      (value: TValue) => {
        onDirtyChangeRef.current?.(true);
        setter(value);
      },
    []
  );

  async function handleSubmit() {
    try {
      const saved = mode === 'create' ? await panel.submitCreate() : await panel.submitUpdate();
      if (saved) {
        onDirtyChangeRef.current?.(false);
      }
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  }

  const submitDisabled = mode === 'create' ? panel.createDisabled : panel.updateDisabled;

  return (
    <>
      <AdminEditorPanel
        status={error ? <AdminInlineError>{error}</AdminInlineError> : null}
        actions={
          <AdminEditorActions
            mode={mode}
            formId={SERVICE_EDITOR_FORM_ID}
            isSaving={isSaving}
            submitDisabled={submitDisabled}
            submitLabel={mode === 'create' ? 'Create service' : 'Update service'}
          >
            {mode === 'edit' ? (
              <Button
                type='button'
                variant='outline'
                disabled={isSaving || !panel.coverFileName.trim() || !service}
                onClick={() => void onUploadCover(panel.coverFileName.trim(), 'image/jpeg')}
              >
                Generate cover upload URL
              </Button>
            ) : null}
          </AdminEditorActions>
        }
      >
        <form
          id={SERVICE_EDITOR_FORM_ID}
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <ServiceDetailFormBody
            isEditMode={mode === 'edit'}
            serviceType={panel.serviceType}
            onServiceTypeChange={track(panel.setServiceType)}
            serviceForm={panel.serviceForm}
            onServiceFormChange={track(panel.setServiceForm)}
            trainingForm={panel.trainingForm}
            onTrainingFormChange={track(panel.setTrainingForm)}
            eventForm={panel.eventForm}
            onEventFormChange={track(panel.setEventForm)}
            consultationForm={panel.consultationForm}
            onConsultationFormChange={track(panel.setConsultationForm)}
            bookingSystem={panel.bookingSystem}
            onBookingSystemChange={track(panel.setBookingSystem)}
            coverFileName={panel.coverFileName}
            onCoverFileNameChange={panel.setCoverFileName}
            serviceTier={panel.serviceTier}
            onServiceTierChange={track(panel.setServiceTier)}
            locationId={panel.locationId}
            onLocationIdChange={track(panel.setLocationId)}
            locationOptions={locationOptions}
            isLoadingLocations={isLoadingLocations}
            locationError={locationError}
            hasLocationOptions={panel.hasLocationOptions}
            selectedLocationValue={panel.selectedLocationValue}
            locationExists={panel.locationExists}
            showDefaultLocationField={panel.showDefaultLocationField}
            tierInvalid={panel.tierInvalid}
            tierConflictInline={panel.tierConflictInline}
            serviceKeyConflictInline={panel.serviceKeyConflictInline}
            discountUsageLoadState={panel.discountUsageLoadState}
          />
        </form>
      </AdminEditorPanel>
      <ConfirmDialog {...panel.confirmDialogProps} />
    </>
  );
}
