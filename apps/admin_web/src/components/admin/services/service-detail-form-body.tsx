'use client';

import { WarningTriangleIcon } from '@/components/icons/action-icons';
import { AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatEnumLabel, formatLocationLabel } from '@/lib/format';

import {
  SERVICE_DELIVERY_MODES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  isConsultationLikeServiceType,
} from '@/types/services';
import type { ServiceDeliveryMode, ServiceType, LocationSummary } from '@/types/services';

import {
  ConsultationCurrencyControl,
  ConsultationDurationControl,
  ConsultationHourlyRateControl,
  ConsultationMaxGroupSizeControl,
  ConsultationPackagePriceControl,
  ConsultationPackageSessionsControl,
  ConsultationPricingModelControl,
  ConsultationServiceFormatField,
  type ConsultationFormState,
} from './consultation-form-fields';
import {
  EventCategoryControl,
  EventDefaultCurrencyControl,
  EventDefaultPriceControl,
  type EventFormState,
} from './event-form-fields';
import { ServiceKeyField, type ServiceFormState } from './service-form-fields';
import {
  TrainingCurrencyControl,
  TrainingPriceControl,
  TrainingPricingUnitControl,
  type TrainingFormState,
} from './training-form-fields';
import { ServiceTierControl } from './service-tier-control';

export interface ServiceDetailFormBodyProps {
  isEditMode: boolean;
  serviceType: ServiceType;
  onServiceTypeChange: (next: ServiceType) => void;
  serviceForm: ServiceFormState;
  onServiceFormChange: (next: ServiceFormState) => void;
  trainingForm: TrainingFormState;
  onTrainingFormChange: (next: TrainingFormState) => void;
  eventForm: EventFormState;
  onEventFormChange: (next: EventFormState) => void;
  consultationForm: ConsultationFormState;
  onConsultationFormChange: (next: ConsultationFormState) => void;
  bookingSystem: string;
  onBookingSystemChange: (next: string) => void;
  coverFileName: string;
  onCoverFileNameChange: (next: string) => void;
  serviceTier: string;
  onServiceTierChange: (next: string) => void;
  locationId: string;
  onLocationIdChange: (next: string) => void;
  locationOptions: LocationSummary[];
  isLoadingLocations: boolean;
  locationError: string | null;
  hasLocationOptions: boolean;
  selectedLocationValue: string;
  locationExists: boolean;
  showDefaultLocationField: boolean;
  tierInvalid: boolean;
  tierConflictInline: string | undefined;
  serviceKeyConflictInline: string | undefined;
  discountUsageLoadState: 'idle' | 'loading' | 'ok' | 'error';
}

export function ServiceDetailFormBody({
  isEditMode,
  serviceType,
  onServiceTypeChange,
  serviceForm,
  onServiceFormChange,
  trainingForm,
  onTrainingFormChange,
  eventForm,
  onEventFormChange,
  consultationForm,
  onConsultationFormChange,
  bookingSystem,
  onBookingSystemChange,
  coverFileName,
  onCoverFileNameChange,
  serviceTier,
  onServiceTierChange,
  locationId,
  onLocationIdChange,
  locationOptions,
  isLoadingLocations,
  locationError,
  hasLocationOptions,
  selectedLocationValue,
  locationExists,
  showDefaultLocationField,
  tierInvalid,
  tierConflictInline,
  serviceKeyConflictInline,
  discountUsageLoadState,
}: ServiceDetailFormBodyProps) {
  const deliveryModeSelect = (
    <div>
      <Label htmlFor='service-delivery-mode'>Delivery mode</Label>
      <Select
        id='service-delivery-mode'
        value={serviceForm.deliveryMode}
        onChange={(event) => {
          const nextMode = event.target.value as ServiceDeliveryMode;
          onServiceFormChange({ ...serviceForm, deliveryMode: nextMode });
          if (nextMode === 'online') {
            onLocationIdChange('');
          }
        }}
      >
        {SERVICE_DELIVERY_MODES.map((entry) => (
          <option key={entry} value={entry}>
            {formatEnumLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );

  const bookingAndCover = (
    <>
      <div>
        <Label htmlFor='service-booking-system'>Booking system</Label>
        <Input
          id='service-booking-system'
          value={bookingSystem}
          onChange={(event) => onBookingSystemChange(event.target.value)}
          placeholder='e.g. training-booking'
          maxLength={80}
          autoComplete='off'
        />
      </div>
      <div>
        <Label htmlFor='service-detail-cover-file-name'>Cover file name</Label>
        <Input
          id='service-detail-cover-file-name'
          value={coverFileName}
          onChange={(event) => onCoverFileNameChange(event.target.value)}
          placeholder='e.g. media-cover.jpg'
        />
      </div>
    </>
  );

  const defaultLocationField = (
    <div>
      <Label htmlFor='service-default-location'>Default location</Label>
      {hasLocationOptions || isLoadingLocations ? (
        <Select
          id='service-default-location'
          value={selectedLocationValue}
          onChange={(event) => onLocationIdChange(event.target.value)}
        >
          <option value=''>{isLoadingLocations ? 'Loading locations...' : 'Select location'}</option>
          {locationId && !locationExists ? <option value={locationId}>{locationId}</option> : null}
          {locationOptions.map((location) => (
            <option key={location.id} value={location.id}>
              {formatLocationLabel(location)}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id='service-default-location'
          value={locationId}
          onChange={(event) => onLocationIdChange(event.target.value)}
          placeholder='Location UUID'
          autoComplete='off'
        />
      )}
      {locationError ? <p className='mt-1 text-xs text-red-600'>{locationError}</p> : null}
    </div>
  );

  return (
    <>
      <AdminFieldGrid columns={4}>
        <div>
          <Label htmlFor='service-type'>Type</Label>
          <Select
            id='service-type'
            value={serviceType}
            onChange={(event) => onServiceTypeChange(event.target.value as ServiceType)}
            disabled={isEditMode}
          >
            {SERVICE_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnumLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor='service-title'>Title</Label>
          <Input
            id='service-title'
            value={serviceForm.title}
            onChange={(event) => onServiceFormChange({ ...serviceForm, title: event.target.value })}
          />
        </div>
        <ServiceKeyField
          value={serviceForm.serviceKey}
          onChange={(next) => onServiceFormChange({ ...serviceForm, serviceKey: next })}
          serviceKeyUsageLoadError={
            discountUsageLoadState === 'error'
              ? 'Could not load discount code usage. Try again later.'
              : undefined
          }
          serviceKeyConflictError={serviceKeyConflictInline}
          publishedBookableKeyWarning={
            (serviceType === 'event' || serviceType === 'training_course' || serviceType === 'intro_call') &&
            serviceForm.status === 'published' &&
            !serviceForm.serviceKey.trim()
              ? 'A service key is required to take public bookings (discount validation and reservation submission). Set one before publishing.'
              : undefined
          }
        />
        <div>
          <div className='relative mb-1'>
            <Label htmlFor='service-status' className='mb-0 block pr-7'>
              Status
            </Label>
            {serviceForm.status === 'draft' ? (
              <span
                className='absolute right-0 top-1/2 inline-flex -translate-y-1/2 text-amber-600'
                role='img'
                aria-label='Draft — not published to the website'
                title='Draft — not published to the website'
              >
                <WarningTriangleIcon className='h-4 w-4' aria-hidden />
              </span>
            ) : null}
          </div>
          <Select
            id='service-status'
            value={serviceForm.status}
            onChange={(event) =>
              onServiceFormChange({ ...serviceForm, status: event.target.value as ServiceFormState['status'] })
            }
          >
            {SERVICE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnumLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
      </AdminFieldGrid>

      <AdminFieldGrid columns={1}>
        <div>
          <Label htmlFor='service-description'>Description</Label>
          <Textarea
            id='service-description'
            value={serviceForm.description}
            onChange={(event) => onServiceFormChange({ ...serviceForm, description: event.target.value })}
            rows={3}
          />
        </div>
      </AdminFieldGrid>

      {serviceType === 'training_course' ? (
        <AdminFieldGrid columns={4}>
          {deliveryModeSelect}
          <ServiceTierControl
            value={serviceTier}
            onChange={onServiceTierChange}
            id='service-tier-training'
            invalid={tierInvalid}
            tierConflictError={tierConflictInline}
          />
          {bookingAndCover}
        </AdminFieldGrid>
      ) : null}

      {serviceType === 'training_course' ? (
        <AdminFieldGrid columns={4}>
          <TrainingPricingUnitControl value={trainingForm} onChange={onTrainingFormChange} />
          <TrainingPriceControl
            value={trainingForm}
            onChange={onTrainingFormChange}
            priceLabel='Default price'
          />
          <TrainingCurrencyControl value={trainingForm} onChange={onTrainingFormChange} />
          {showDefaultLocationField ? defaultLocationField : null}
        </AdminFieldGrid>
      ) : null}

      {serviceType === 'event' ? (
        <AdminFieldGrid columns={4}>
          {deliveryModeSelect}
          <ServiceTierControl
            value={serviceTier}
            onChange={onServiceTierChange}
            id='service-tier-event'
            invalid={tierInvalid}
            tierConflictError={tierConflictInline}
          />
          {bookingAndCover}
        </AdminFieldGrid>
      ) : null}

      {serviceType === 'event' ? (
        <AdminFieldGrid columns={4}>
          <EventCategoryControl value={eventForm} onChange={onEventFormChange} categoryFieldId='service-event-category' />
          <EventDefaultPriceControl value={eventForm} onChange={onEventFormChange} />
          <EventDefaultCurrencyControl value={eventForm} onChange={onEventFormChange} />
          {showDefaultLocationField ? defaultLocationField : null}
        </AdminFieldGrid>
      ) : null}

      {isConsultationLikeServiceType(serviceType) ? (
        <AdminFieldGrid columns={4}>
          {deliveryModeSelect}
          <ServiceTierControl
            value={serviceTier}
            onChange={onServiceTierChange}
            id='service-tier-consultation'
            invalid={tierInvalid}
            tierConflictError={tierConflictInline}
          />
          {bookingAndCover}
        </AdminFieldGrid>
      ) : null}

      {isConsultationLikeServiceType(serviceType) ? (
        <>
          <AdminFieldGrid columns={4}>
            <ConsultationPricingModelControl value={consultationForm} onChange={onConsultationFormChange} />
            {consultationForm.pricingModel === 'hourly' ? (
              <ConsultationHourlyRateControl value={consultationForm} onChange={onConsultationFormChange} />
            ) : null}
            {consultationForm.pricingModel === 'package' ? (
              <ConsultationPackagePriceControl value={consultationForm} onChange={onConsultationFormChange} />
            ) : null}
            {consultationForm.pricingModel !== 'free' ? (
              <ConsultationCurrencyControl value={consultationForm} onChange={onConsultationFormChange} />
            ) : null}
            {showDefaultLocationField ? defaultLocationField : null}
          </AdminFieldGrid>
          <AdminFieldGrid columns={4}>
            <ConsultationServiceFormatField value={consultationForm} onChange={onConsultationFormChange} />
            <ConsultationDurationControl value={consultationForm} onChange={onConsultationFormChange} />
            {consultationForm.pricingModel === 'package' ? (
              <ConsultationPackageSessionsControl value={consultationForm} onChange={onConsultationFormChange} />
            ) : null}
            {consultationForm.consultationFormat !== 'one_on_one' ? (
              <ConsultationMaxGroupSizeControl value={consultationForm} onChange={onConsultationFormChange} />
            ) : null}
          </AdminFieldGrid>
        </>
      ) : null}
    </>
  );
}
