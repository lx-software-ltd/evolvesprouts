'use client';

import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import type { components } from '@/types/generated/admin-api.generated';
import type { LocationSummary, ServiceDetail } from '@/types/services';

import { ServiceDetailFormBody } from './service-detail-form-body';
import { useServiceDetailPanel } from '@/hooks/use-service-detail-panel';

type ApiSchemas = components['schemas'];

export interface ServiceDetailPanelProps {
  service: ServiceDetail | null;
  /** When set with `service` null, seed the create form from this template (UI-only duplicate). */
  createPrefillFromService?: ServiceDetail | null;
  locationOptions?: LocationSummary[];
  isLoadingLocations?: boolean;
  locationError?: string | null;
  isLoading: boolean;
  error: string;
  onCancelSelection: () => void;
  onCreate: (payload: ApiSchemas['CreateServiceRequest']) => Promise<void> | void;
  onUpdate: (payload: ApiSchemas['PartialUpdateServiceRequest']) => Promise<void> | void;
  onUploadCover: (fileName: string, contentType: string) => Promise<void> | void;
}

export function ServiceDetailPanel({
  service,
  createPrefillFromService = null,
  locationOptions = [],
  isLoadingLocations = false,
  locationError = null,
  isLoading,
  error,
  onCancelSelection,
  onCreate,
  onUpdate,
  onUploadCover,
}: ServiceDetailPanelProps) {
  const panel = useServiceDetailPanel({
    service,
    createPrefillFromService,
    locationOptions,
    isLoading,
    onCreate,
    onUpdate,
  });

  return (
    <>
      <AdminEditorCard
        title='Service'
        description='Add or update a service using the same fields below.'
        actions={
          <>
            {panel.isEditMode ? (
              <>
                <Button type='button' variant='secondary' onClick={onCancelSelection} disabled={isLoading}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  disabled={panel.updateDisabled}
                  onClick={() => void panel.submitUpdate()}
                >
                  {isLoading ? 'Updating...' : 'Update service'}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  disabled={isLoading || !panel.coverFileName.trim() || !service}
                  onClick={() => void onUploadCover(panel.coverFileName.trim(), 'image/jpeg')}
                >
                  Generate cover upload URL
                </Button>
              </>
            ) : (
              <Button
                type='button'
                disabled={panel.createDisabled}
                onClick={() => void panel.submitCreate()}
              >
                {isLoading ? 'Adding...' : 'Add service'}
              </Button>
            )}
          </>
        }
      >
        <ServiceDetailFormBody
          isEditMode={panel.isEditMode}
          serviceType={panel.serviceType}
          onServiceTypeChange={panel.setServiceType}
          serviceForm={panel.serviceForm}
          onServiceFormChange={panel.setServiceForm}
          trainingForm={panel.trainingForm}
          onTrainingFormChange={panel.setTrainingForm}
          eventForm={panel.eventForm}
          onEventFormChange={panel.setEventForm}
          consultationForm={panel.consultationForm}
          onConsultationFormChange={panel.setConsultationForm}
          bookingSystem={panel.bookingSystem}
          onBookingSystemChange={panel.setBookingSystem}
          coverFileName={panel.coverFileName}
          onCoverFileNameChange={panel.setCoverFileName}
          serviceTier={panel.serviceTier}
          onServiceTierChange={panel.setServiceTier}
          locationId={panel.locationId}
          onLocationIdChange={panel.setLocationId}
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

        {error ? <AdminInlineError>{error}</AdminInlineError> : null}
      </AdminEditorCard>
      <ConfirmDialog {...panel.confirmDialogProps} />
    </>
  );
}
