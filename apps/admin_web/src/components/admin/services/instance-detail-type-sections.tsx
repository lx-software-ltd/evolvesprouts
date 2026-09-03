'use client';

import {
  ConsultationInstanceRowDFields,
  ConsultationInstanceRowEFields,
  type ConsultationFormState,
} from './consultation-form-fields';
import {
  EventCategoryControl,
  EventDefaultCurrencyControl,
  EventDefaultPriceControl,
  type EventFormState,
} from './event-form-fields';
import { EventInstancePartnersField } from './event-instance-partners-field';
import { InstanceInstructorField, type InstanceInstructorOption } from './instance-form-fields';
import {
  TrainingCurrencyControl,
  TrainingPriceControl,
  TrainingPricingUnitControl,
  type TrainingFormState,
} from './training-form-fields';

import { isConsultationLikeServiceType, type ServiceType } from '@/types/services';

import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import type { PartnerOrgRef } from '@/types/services';

export interface InstanceDetailTypeSectionsProps {
  effectiveServiceType: ServiceType;
  consultationCatalogPricingReadOnly: boolean;
  typeFieldsLocked: boolean;
  instructorId: string;
  onInstructorIdChange: (instructorId: string) => void;
  instructorUsers: InstanceInstructorOption[];
  isLoadingInstructors: boolean;
  trainingForm: TrainingFormState;
  onTrainingFormChange: (next: TrainingFormState) => void;
  eventForm: EventFormState;
  onEventFormChange: (next: EventFormState) => void;
  resolvedEventCategory: EventFormState['eventCategory'];
  consultationForm: ConsultationFormState;
  onConsultationFormChange: (next: ConsultationFormState) => void;
  partnerOrganizations: PartnerOrgRef[];
  onPartnerOrganizationsChange: (next: PartnerOrgRef[]) => void;
  externalUrl: string;
  onExternalUrlChange: (next: string) => void;
  externalUrlInvalid: boolean;
}

/** Type-specific field rows of the instance editor, laid out on the shared 4-column grid. */
export function InstanceDetailTypeSections({
  effectiveServiceType,
  consultationCatalogPricingReadOnly,
  typeFieldsLocked,
  instructorId,
  onInstructorIdChange,
  instructorUsers,
  isLoadingInstructors,
  trainingForm,
  onTrainingFormChange,
  eventForm,
  onEventFormChange,
  resolvedEventCategory,
  consultationForm,
  onConsultationFormChange,
  partnerOrganizations,
  onPartnerOrganizationsChange,
  externalUrl,
  onExternalUrlChange,
  externalUrlInvalid,
}: InstanceDetailTypeSectionsProps) {
  return (
    <>
      {effectiveServiceType === 'training_course' ? (
        <AdminFieldGrid columns={4}>
          <InstanceInstructorField
            value={instructorId}
            disabled={typeFieldsLocked}
            instructorOptions={instructorUsers}
            isLoadingInstructors={isLoadingInstructors}
            onChange={onInstructorIdChange}
          />
          <TrainingPricingUnitControl value={trainingForm} disabled={typeFieldsLocked} onChange={onTrainingFormChange} />
          <TrainingPriceControl value={trainingForm} disabled={typeFieldsLocked} onChange={onTrainingFormChange} />
          <TrainingCurrencyControl value={trainingForm} disabled={typeFieldsLocked} onChange={onTrainingFormChange} />
        </AdminFieldGrid>
      ) : null}

      {effectiveServiceType === 'event' ? (
        <>
          <AdminFieldGrid columns={4}>
            <InstanceInstructorField
              value={instructorId}
              disabled={typeFieldsLocked}
              instructorOptions={instructorUsers}
              isLoadingInstructors={isLoadingInstructors}
              onChange={onInstructorIdChange}
            />
            <EventCategoryControl
              value={{
                ...eventForm,
                eventCategory: resolvedEventCategory,
              }}
              disabled={typeFieldsLocked}
              onChange={(next) =>
                onEventFormChange({ ...next, eventCategory: resolvedEventCategory })
              }
              categoryReadOnly
              categoryFieldId='instance-event-category'
            />
            <EventDefaultPriceControl
              value={eventForm}
              disabled={typeFieldsLocked}
              onChange={onEventFormChange}
              priceLabel='Price'
            />
            <EventDefaultCurrencyControl value={eventForm} disabled={typeFieldsLocked} onChange={onEventFormChange} />
          </AdminFieldGrid>
          <AdminFieldGrid columns={4}>
            <div className='min-w-0 sm:col-span-2'>
              <EventInstancePartnersField
                value={partnerOrganizations}
                disabled={typeFieldsLocked}
                onChange={onPartnerOrganizationsChange}
              />
            </div>
            <AdminField
              label='External URL'
              htmlFor='instance-external-url'
              span={2}
              error={externalUrlInvalid ? 'URL must start with http:// or https://' : undefined}
            >
              <Input
                id='instance-external-url'
                value={externalUrl}
                disabled={typeFieldsLocked}
                onChange={(event) => onExternalUrlChange(event.target.value)}
                placeholder='https://…'
                autoComplete='off'
              />
            </AdminField>
          </AdminFieldGrid>
        </>
      ) : null}

      {isConsultationLikeServiceType(effectiveServiceType) ? (
        <>
          {consultationCatalogPricingReadOnly ? (
            <p className='text-sm text-slate-500'>
              Pricing is managed on the service catalog. Open the service row to edit it.
              {effectiveServiceType === 'intro_call'
                ? ' Intro-call session slots here drive the public booking grid.'
                : ''}
            </p>
          ) : null}
          <AdminFieldGrid columns={4}>
            <InstanceInstructorField
              value={instructorId}
              disabled={typeFieldsLocked}
              instructorOptions={instructorUsers}
              isLoadingInstructors={isLoadingInstructors}
              onChange={onInstructorIdChange}
            />
            <ConsultationInstanceRowDFields
              value={consultationForm}
              disabled={typeFieldsLocked || consultationCatalogPricingReadOnly}
              onChange={onConsultationFormChange}
            />
          </AdminFieldGrid>
          <AdminFieldGrid columns={4}>
            <ConsultationInstanceRowEFields
              value={consultationForm}
              disabled={typeFieldsLocked || consultationCatalogPricingReadOnly}
              onChange={onConsultationFormChange}
            />
          </AdminFieldGrid>
        </>
      ) : null}
    </>
  );
}
