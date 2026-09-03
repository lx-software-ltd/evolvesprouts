'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { formatEnumLabel } from '@/lib/format';
import type { EntityTagRef } from '@/lib/entity-api';

import type { components } from '@/types/generated/admin-api.generated';
import type { LocationSummary, ServiceInstance, ServiceSummary, ServiceType } from '@/types/services';

import { InstanceDetailTypeSections } from './instance-detail-type-sections';
import { InstanceFormFields } from './instance-form-fields';
import { SessionSlotEditor } from './session-slot-editor';
import { useInstanceDetailPanel } from '@/hooks/use-instance-detail-panel';

type ApiSchemas = components['schemas'];

const INSTANCE_EDITOR_FORM_ID = 'instance-editor-form';

export interface InstanceDetailPanelProps {
  /** Full record for edit mode; `null` while creating. */
  instance: ServiceInstance | null;
  /** When set in create mode, seed the draft from this row (UI-only duplicate). */
  createPrefillInstance?: ServiceInstance | null;
  entityTags: EntityTagRef[];
  entityTagsLoading: boolean;
  entityTagsError: string;
  /** Service the draft belongs to (create mode); edit mode always uses `instance.serviceId`. */
  selectedServiceId: string | null;
  serviceOptions: ServiceSummary[];
  locationOptions: LocationSummary[];
  isLoadingLocations: boolean;
  serviceType: ServiceType | null;
  isSaving: boolean;
  error: string;
  locationError?: string;
  onSelectService: (serviceId: string | null) => void;
  onCreate: (serviceId: string, payload: ApiSchemas['CreateInstanceRequest']) => Promise<void> | void;
  onUpdate: (
    serviceId: string,
    instanceId: string,
    payload: ApiSchemas['UpdateInstanceRequest']
  ) => Promise<void> | void;
  /** Reports unsaved edits so the row hook can guard switching rows. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Nested enrollments list for a saved instance. Mounted only once its
   * disclosure opens so expanding a row costs no enrollment request.
   */
  enrollments?: ReactNode;
  /** Number shown next to the Enrollments title. */
  enrollmentsCount?: number | null;
  /** Open the Enrollments disclosure immediately (related-party deep links). */
  enrollmentsDefaultOpen?: boolean;
}

/**
 * Editor rendered inside the expanded instance row (or the draft row). No
 * title: the row above names the instance. Shared fields, type-specific
 * rows, Notes, then Tags / Session slots / Enrollments disclosures and one
 * action row.
 */
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
  isSaving,
  error,
  locationError = '',
  onSelectService,
  onCreate,
  onUpdate,
  onDirtyChange,
  enrollments,
  enrollmentsCount = null,
  enrollmentsDefaultOpen = false,
}: InstanceDetailPanelProps) {
  const mode: 'create' | 'edit' = instance ? 'edit' : 'create';
  const [enrollmentsOpen, setEnrollmentsOpen] = useState(enrollmentsDefaultOpen);

  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  // Collapsing the row unmounts the editor; its edits are gone with it.
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);
  const markDirty = useCallback(() => onDirtyChangeRef.current?.(true), []);
  const track = useCallback(
    <TValue,>(setter: (value: TValue) => void) =>
      (value: TValue) => {
        onDirtyChangeRef.current?.(true);
        setter(value);
      },
    []
  );

  const panel = useInstanceDetailPanel({
    instance,
    createPrefillInstance,
    selectedServiceId: instance ? instance.serviceId : selectedServiceId,
    serviceOptions,
    locationOptions,
    serviceType,
    onSelectService,
    onCreate,
    onUpdate,
  });

  async function handleSubmit() {
    try {
      const saved = mode === 'create' ? await panel.runCreate() : await panel.runUpdate();
      if (saved) {
        onDirtyChangeRef.current?.(false);
      }
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  }

  const validationBlocked = panel.externalUrlInvalid || panel.eventPriceMissing || panel.cohortInvalid;
  const submitDisabled = mode === 'create' ? !panel.selectedServiceId || validationBlocked : validationBlocked;

  return (
    <AdminEditorPanel
      status={
        <>
          {panel.sessionSlotsError ? <AdminInlineError>{panel.sessionSlotsError}</AdminInlineError> : null}
          {panel.effectiveServiceType === 'event' && panel.eventPriceMissing ? (
            <AdminInlineError>Enter a price for this event instance.</AdminInlineError>
          ) : null}
          {entityTagsError ? <AdminInlineError>{entityTagsError}</AdminInlineError> : null}
          {locationError ? <AdminInlineError>{locationError}</AdminInlineError> : null}
          {error ? <AdminInlineError>{error}</AdminInlineError> : null}
        </>
      }
      actions={
        <AdminEditorActions
          mode={mode}
          formId={INSTANCE_EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={submitDisabled}
          submitLabel={mode === 'create' ? 'Create instance' : 'Update instance'}
        />
      }
    >
      <form
        id={INSTANCE_EDITOR_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {mode === 'create' && !panel.selectedService ? (
          <p className='text-sm text-slate-500'>Select a service to enable the instance fields.</p>
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
          onSelectService={mode === 'create' ? track(panel.handleSelectService) : undefined}
          serviceReadOnly={mode === 'edit'}
          onChange={track(panel.handleInstanceFormChange)}
          slugFieldError={panel.slugFieldError}
        />

        <InstanceDetailTypeSections
          effectiveServiceType={panel.effectiveServiceType}
          consultationCatalogPricingReadOnly={panel.consultationCatalogPricingReadOnly}
          typeFieldsLocked={panel.typeFieldsLocked}
          instructorId={panel.instanceForm.instructorId}
          onInstructorIdChange={(instructorId) => {
            markDirty();
            panel.handleInstanceFormChange({ ...panel.instanceForm, instructorId });
          }}
          instructorUsers={panel.instructorUsers}
          isLoadingInstructors={panel.isLoadingInstructors}
          trainingForm={panel.trainingForm}
          onTrainingFormChange={track(panel.setTrainingForm)}
          eventForm={panel.eventForm}
          onEventFormChange={track(panel.setEventForm)}
          resolvedEventCategory={panel.resolvedEventCategory}
          consultationForm={panel.consultationForm}
          onConsultationFormChange={track(panel.setConsultationForm)}
          partnerOrganizations={panel.instanceForm.partnerOrganizations}
          onPartnerOrganizationsChange={(next) => {
            markDirty();
            panel.handleInstanceFormChange({ ...panel.instanceForm, partnerOrganizations: next });
          }}
          externalUrl={panel.instanceForm.externalUrl}
          onExternalUrlChange={(next) => {
            markDirty();
            panel.handleInstanceFormChange({ ...panel.instanceForm, externalUrl: next });
          }}
          externalUrlInvalid={panel.externalUrlInvalid}
        />

        <AdminFieldGrid columns={mode === 'edit' ? 4 : 1}>
          <AdminField label='Notes' htmlFor='instance-notes' span={mode === 'edit' ? 2 : 1}>
            <Input
              id='instance-notes'
              value={panel.instanceForm.notes}
              disabled={panel.typeFieldsLocked}
              onChange={(event) => {
                markDirty();
                panel.handleInstanceFormChange({ ...panel.instanceForm, notes: event.target.value });
              }}
              autoComplete='off'
            />
          </AdminField>
          {mode === 'edit' && instance ? (
            <AdminField label='Eventbrite' htmlFor='instance-eventbrite-sync'>
              <Input
                id='instance-eventbrite-sync'
                value={formatEnumLabel(instance.eventbriteSyncStatus)}
                readOnly
                aria-readonly
              />
            </AdminField>
          ) : null}
        </AdminFieldGrid>

        <EntityTagPicker
          id='service-instance-tags'
          label='Tags'
          tags={entityTags}
          selectedIds={panel.tagIds}
          onChange={track(panel.setTagIds)}
          disabled={isSaving || entityTagsLoading || panel.typeFieldsLocked}
          variant='collapsible'
        />

        <SessionSlotEditor
          slots={panel.instanceForm.sessionSlots}
          disabled={panel.typeFieldsLocked}
          locationOptions={panel.filteredLocationOptions}
          isLoadingLocations={isLoadingLocations}
          defaultLocationId={panel.effectiveSessionSlotDefaultLocationId}
          onChange={track(panel.handleSessionSlotsChange)}
        />
      </form>

      {mode === 'edit' && instance && enrollments !== undefined ? (
        <AdminDisclosure
          id='instance-enrollments'
          title='Enrollments'
          summary={enrollmentsCount != null && enrollmentsCount > 0 ? enrollmentsCount : undefined}
          open={enrollmentsOpen}
          onOpenChange={setEnrollmentsOpen}
        >
          {enrollmentsOpen ? enrollments : null}
        </AdminDisclosure>
      ) : null}
    </AdminEditorPanel>
  );
}
