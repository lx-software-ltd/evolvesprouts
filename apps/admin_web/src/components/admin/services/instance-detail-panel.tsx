'use client';

import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatEnumLabel } from '@/lib/format';
import type { EntityTagRef } from '@/lib/entity-api';

import type { components } from '@/types/generated/admin-api.generated';
import type { LocationSummary, ServiceInstance, ServiceSummary, ServiceType } from '@/types/services';

import { InstanceDetailTypeSections } from './instance-detail-type-sections';
import { InstanceFormFields } from './instance-form-fields';
import { SessionSlotEditor } from './session-slot-editor';
import { useInstanceDetailPanel } from '@/hooks/use-instance-detail-panel';

type ApiSchemas = components['schemas'];

export interface InstanceDetailPanelProps {
  instance: ServiceInstance | null;
  /** When set with `instance` null, seed the create form from this row (UI-only duplicate). */
  createPrefillInstance?: ServiceInstance | null;
  entityTags: EntityTagRef[];
  entityTagsLoading: boolean;
  entityTagsError: string;
  selectedServiceId: string | null;
  serviceOptions: ServiceSummary[];
  locationOptions: LocationSummary[];
  isLoadingLocations: boolean;
  serviceType: ServiceType | null;
  isLoading: boolean;
  error: string;
  locationError?: string;
  onSelectService: (serviceId: string | null) => void;
  onCancelSelection: () => void;
  onCreate: (serviceId: string, payload: ApiSchemas['CreateInstanceRequest']) => Promise<void> | void;
  onUpdate: (
    serviceId: string,
    instanceId: string,
    payload: ApiSchemas['UpdateInstanceRequest']
  ) => Promise<void> | void;
}

export function InstanceDetailPanel({
  instance,
  createPrefillInstance = null,
  entityTags,
  entityTagsLoading,
  entityTagsError,
  selectedServiceId,
  serviceOptions,
  locationOptions,
  isLoadingLocations,
  serviceType,
  isLoading,
  error,
  locationError = '',
  onSelectService,
  onCancelSelection,
  onCreate,
  onUpdate,
}: InstanceDetailPanelProps) {
  const panel = useInstanceDetailPanel({
    instance,
    createPrefillInstance,
    selectedServiceId,
    serviceOptions,
    locationOptions,
    serviceType,
    onSelectService,
    onCreate,
    onUpdate,
  });

  return (
    <AdminEditorCard
      title='Instance'
      description='Add or update an instance using the same fields below.'
      actions={
        panel.canSubmit ? (
          <>
            {panel.isEditMode ? (
              <>
                <Button type='button' variant='secondary' disabled={isLoading} onClick={onCancelSelection}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  disabled={
                    isLoading ||
                    !panel.instance ||
                    panel.externalUrlInvalid ||
                    panel.eventPriceMissing ||
                    panel.cohortInvalid
                  }
                  onClick={() => {
                    void panel.runUpdate();
                  }}
                >
                  {isLoading ? 'Updating...' : 'Update instance'}
                </Button>
              </>
            ) : (
              <Button
                type='button'
                disabled={
                  isLoading ||
                  !panel.selectedServiceId ||
                  panel.externalUrlInvalid ||
                  panel.eventPriceMissing ||
                  panel.cohortInvalid
                }
                onClick={() => {
                  void panel.runCreate();
                }}
              >
                {isLoading ? 'Adding...' : 'Add instance'}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {!panel.selectedService ? (
        <p className='text-sm text-slate-500'>Select a service to enable instance save actions.</p>
      ) : null}
      <InstanceFormFields
        value={panel.instanceForm}
        serviceId={panel.selectedServiceId}
        serviceLocationId={panel.selectedService?.locationId ?? null}
        serviceOptions={panel.serviceOptions}
        locationOptions={panel.filteredLocationOptions}
        isLoadingLocations={isLoadingLocations}
        instructorOptions={panel.instructorUsers}
        isLoadingInstructors={panel.isLoadingInstructors}
        onSelectService={panel.handleSelectService}
        onChange={panel.handleInstanceFormChange}
        slugFieldError={panel.slugFieldError}
      />

      <InstanceDetailTypeSections
        effectiveServiceType={panel.effectiveServiceType}
        consultationCatalogPricingReadOnly={panel.consultationCatalogPricingReadOnly}
        typeFieldsLocked={panel.typeFieldsLocked}
        instructorId={panel.instanceForm.instructorId}
        onInstructorIdChange={(instructorId) =>
          panel.handleInstanceFormChange({ ...panel.instanceForm, instructorId })
        }
        instructorUsers={panel.instructorUsers}
        isLoadingInstructors={panel.isLoadingInstructors}
        trainingForm={panel.trainingForm}
        onTrainingFormChange={panel.setTrainingForm}
        eventForm={panel.eventForm}
        onEventFormChange={panel.setEventForm}
        resolvedEventCategory={panel.resolvedEventCategory}
        consultationForm={panel.consultationForm}
        onConsultationFormChange={panel.setConsultationForm}
        partnerOrganizations={panel.instanceForm.partnerOrganizations}
        onPartnerOrganizationsChange={(next) =>
          panel.handleInstanceFormChange({ ...panel.instanceForm, partnerOrganizations: next })
        }
        externalUrl={panel.instanceForm.externalUrl}
        onExternalUrlChange={(next) =>
          panel.handleInstanceFormChange({ ...panel.instanceForm, externalUrl: next })
        }
        externalUrlInvalid={panel.externalUrlInvalid}
      />

      <div>
        <Label htmlFor='instance-notes'>Notes</Label>
        <Textarea
          id='instance-notes'
          value={panel.instanceForm.notes}
          disabled={panel.typeFieldsLocked}
          onChange={(event) =>
            panel.handleInstanceFormChange({ ...panel.instanceForm, notes: event.target.value })
          }
          rows={2}
        />
      </div>

      <EntityTagPicker
        id='service-instance-tags'
        label='Tags'
        tags={entityTags}
        selectedIds={panel.tagIds}
        onChange={panel.setTagIds}
        disabled={isLoading || entityTagsLoading || panel.typeFieldsLocked}
        variant='collapsible'
      />

      <SessionSlotEditor
        slots={panel.instanceForm.sessionSlots}
        disabled={panel.typeFieldsLocked}
        locationOptions={panel.filteredLocationOptions}
        isLoadingLocations={isLoadingLocations}
        defaultLocationId={panel.effectiveSessionSlotDefaultLocationId}
        onChange={panel.handleSessionSlotsChange}
      />
      {panel.sessionSlotsError ? <AdminInlineError>{panel.sessionSlotsError}</AdminInlineError> : null}

      {panel.effectiveServiceType === 'event' && panel.eventPriceMissing ? (
        <AdminInlineError>Enter a price for this event instance.</AdminInlineError>
      ) : null}
      {entityTagsError ? <AdminInlineError>{entityTagsError}</AdminInlineError> : null}
      {locationError ? <AdminInlineError>{locationError}</AdminInlineError> : null}
      {error ? <AdminInlineError>{error}</AdminInlineError> : null}

      {panel.isEditMode && panel.instance ? (
        <div className='text-sm text-slate-600'>
          <p>Eventbrite: {formatEnumLabel(panel.instance.eventbriteSyncStatus)}</p>
        </div>
      ) : null}
    </AdminEditorCard>
  );
}
