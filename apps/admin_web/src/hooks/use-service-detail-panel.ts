'use client';

import { useEffect, useMemo, useState } from 'react';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { isAdminApiConflictOnField } from '@/lib/admin-api-conflict-messages';
import { getServiceDiscountCodeUsageSummary } from '@/lib/services-api';
import { INSTANCE_SLUG_PATTERN } from '@/lib/slug-utils';
import { SERVICE_KEY_PATTERN } from '@/lib/service-key-utils';

import type { components } from '@/types/generated/admin-api.generated';
import type { LocationSummary, ServiceDetail, ServiceType } from '@/types/services';

import type { ConsultationFormState } from '@/components/admin/services/consultation-form-fields';
import type { EventFormState } from '@/components/admin/services/event-form-fields';
import {
  DEFAULT_CONSULTATION_FORM,
  DEFAULT_EVENT_FORM,
  DEFAULT_SERVICE_FORM,
  DEFAULT_TRAINING_FORM,
} from '@/components/admin/services/form-defaults';
import type { ServiceFormState } from '@/components/admin/services/service-form-fields';
import type { TrainingFormState } from '@/components/admin/services/training-form-fields';
import {
  buildServiceCreatePayload,
  buildServiceUpdatePayload,
} from '@/components/admin/services/service-detail-payload';

type ApiSchemas = components['schemas'];

const SERVICE_KEY_TIER_PAIR_CONFLICT_MSG =
  'This service key and tier are already used by another service. Change the key or tier.';
const EMPTY_TIER_CONFLICT_MSG =
  'Another service uses this service key with an empty tier. Add a tier or use a different key.';

type DiscountUsageLoadState = 'idle' | 'loading' | 'ok' | 'error';

export interface UseServiceDetailPanelParams {
  service: ServiceDetail | null;
  createPrefillFromService?: ServiceDetail | null;
  locationOptions?: LocationSummary[];
  isLoading: boolean;
  onCreate: (payload: ApiSchemas['CreateServiceRequest']) => Promise<void> | void;
  onUpdate: (payload: ApiSchemas['PartialUpdateServiceRequest']) => Promise<void> | void;
}

export function useServiceDetailPanel({
  service,
  createPrefillFromService = null,
  locationOptions = [],
  isLoading,
  onCreate,
  onUpdate,
}: UseServiceDetailPanelParams) {
  const isEditMode = Boolean(service);
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [serviceType, setServiceType] = useState<ServiceType>(service?.serviceType ?? 'training_course');
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(
    service
      ? {
          title: service.title,
          description: service.description ?? '',
          serviceKey: service.serviceKey ?? '',
          deliveryMode: service.deliveryMode,
          status: service.status,
        }
      : DEFAULT_SERVICE_FORM
  );
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>(
    service
      ? {
          pricingUnit: service.trainingDetails?.pricingUnit ?? 'per_person',
          defaultPrice: service.trainingDetails?.defaultPrice ?? '',
          defaultCurrency: service.trainingDetails?.defaultCurrency ?? 'HKD',
        }
      : DEFAULT_TRAINING_FORM
  );
  const [eventForm, setEventForm] = useState<EventFormState>(
    service
      ? {
          eventCategory: service.eventDetails?.eventCategory ?? 'workshop',
          defaultPrice: service.eventDetails?.defaultPrice ?? '',
          defaultCurrency: service.eventDetails?.defaultCurrency ?? 'HKD',
        }
      : DEFAULT_EVENT_FORM
  );
  const [consultationForm, setConsultationForm] = useState<ConsultationFormState>(
    service
      ? {
          consultationFormat: service.consultationDetails?.consultationFormat ?? 'one_on_one',
          maxGroupSize: service.consultationDetails?.maxGroupSize?.toString() ?? '',
          durationMinutes: service.consultationDetails?.durationMinutes?.toString() ?? '',
          pricingModel: service.consultationDetails?.pricingModel ?? 'free',
          defaultHourlyRate: service.consultationDetails?.defaultHourlyRate ?? '',
          defaultPackagePrice: service.consultationDetails?.defaultPackagePrice ?? '',
          defaultPackageSessions: service.consultationDetails?.defaultPackageSessions?.toString() ?? '',
          defaultCurrency: service.consultationDetails?.defaultCurrency ?? 'HKD',
        }
      : DEFAULT_CONSULTATION_FORM
  );
  const [coverFileName, setCoverFileName] = useState('');
  const [bookingSystem, setBookingSystem] = useState(service?.bookingSystem ?? '');
  const [serviceTier, setServiceTier] = useState(service?.serviceTier ?? '');
  const [locationId, setLocationId] = useState(service?.locationId ?? '');
  const [discountUsageSummary, setDiscountUsageSummary] = useState<{
    totalCurrentUses: number;
    referencingCodeCount: number;
  } | null>(null);
  const [discountUsageLoadState, setDiscountUsageLoadState] = useState<DiscountUsageLoadState>('idle');
  const [serviceKeyTierConflict, setServiceKeyTierConflict] = useState<{
    serviceKey: string;
    tierNormalized: string;
    variant: 'tier_same' | 'tier_empty';
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!service?.id) {
        setDiscountUsageSummary(null);
        setDiscountUsageLoadState('idle');
        return;
      }
      setDiscountUsageLoadState('loading');
      setDiscountUsageSummary(null);
      void getServiceDiscountCodeUsageSummary(service.id).then(({ summary, error: loadError }) => {
        if (cancelled) {
          return;
        }
        if (loadError) {
          setDiscountUsageSummary(null);
          setDiscountUsageLoadState('error');
          return;
        }
        setDiscountUsageSummary(summary);
        setDiscountUsageLoadState('ok');
      });
    });
    return () => {
      cancelled = true;
    };
  }, [service?.id]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (!service && createPrefillFromService) {
        const p = createPrefillFromService;
        setServiceType(p.serviceType);
        setBookingSystem(p.bookingSystem ?? '');
        setServiceTier(p.serviceTier ?? '');
        setLocationId(p.locationId ?? '');
        setServiceForm({
          title: `${p.title} (copy)`,
          description: p.description ?? '',
          serviceKey: p.serviceKey ?? '',
          deliveryMode: p.deliveryMode,
          status: 'draft',
        });
        setTrainingForm(
          p.trainingDetails
            ? {
                pricingUnit: p.trainingDetails.pricingUnit,
                defaultPrice: p.trainingDetails.defaultPrice ?? '',
                defaultCurrency: p.trainingDetails.defaultCurrency ?? 'HKD',
              }
            : DEFAULT_TRAINING_FORM
        );
        setEventForm(
          p.eventDetails
            ? {
                eventCategory: p.eventDetails.eventCategory,
                defaultPrice: p.eventDetails.defaultPrice ?? '',
                defaultCurrency: p.eventDetails.defaultCurrency ?? 'HKD',
              }
            : DEFAULT_EVENT_FORM
        );
        setConsultationForm(
          p.consultationDetails
            ? {
                consultationFormat: p.consultationDetails.consultationFormat,
                maxGroupSize: p.consultationDetails.maxGroupSize?.toString() ?? '',
                durationMinutes: p.consultationDetails.durationMinutes?.toString() ?? '',
                pricingModel: p.consultationDetails.pricingModel,
                defaultHourlyRate: p.consultationDetails.defaultHourlyRate ?? '',
                defaultPackagePrice: p.consultationDetails.defaultPackagePrice ?? '',
                defaultPackageSessions: p.consultationDetails.defaultPackageSessions?.toString() ?? '',
                defaultCurrency: p.consultationDetails.defaultCurrency ?? 'HKD',
              }
            : DEFAULT_CONSULTATION_FORM
        );
        setServiceKeyTierConflict(null);
        return;
      }
      if (!service) {
        setServiceType('training_course');
        setServiceForm(DEFAULT_SERVICE_FORM);
        setTrainingForm(DEFAULT_TRAINING_FORM);
        setEventForm(DEFAULT_EVENT_FORM);
        setConsultationForm(DEFAULT_CONSULTATION_FORM);
        setBookingSystem('');
        setServiceTier('');
        setLocationId('');
        setServiceKeyTierConflict(null);
        return;
      }
      setServiceType(service.serviceType);
      setBookingSystem(service.bookingSystem ?? '');
      setServiceTier(service.serviceTier ?? '');
      setLocationId(service.locationId ?? '');
      setServiceForm({
        title: service.title,
        description: service.description ?? '',
        serviceKey: service.serviceKey ?? '',
        deliveryMode: service.deliveryMode,
        status: service.status,
      });
      setTrainingForm({
        pricingUnit: service.trainingDetails?.pricingUnit ?? 'per_person',
        defaultPrice: service.trainingDetails?.defaultPrice ?? '',
        defaultCurrency: service.trainingDetails?.defaultCurrency ?? 'HKD',
      });
      setEventForm({
        eventCategory: service.eventDetails?.eventCategory ?? 'workshop',
        defaultPrice: service.eventDetails?.defaultPrice ?? '',
        defaultCurrency: service.eventDetails?.defaultCurrency ?? 'HKD',
      });
      setConsultationForm({
        consultationFormat: service.consultationDetails?.consultationFormat ?? 'one_on_one',
        maxGroupSize: service.consultationDetails?.maxGroupSize?.toString() ?? '',
        durationMinutes: service.consultationDetails?.durationMinutes?.toString() ?? '',
        pricingModel: service.consultationDetails?.pricingModel ?? 'free',
        defaultHourlyRate: service.consultationDetails?.defaultHourlyRate ?? '',
        defaultPackagePrice: service.consultationDetails?.defaultPackagePrice ?? '',
        defaultPackageSessions: service.consultationDetails?.defaultPackageSessions?.toString() ?? '',
        defaultCurrency: service.consultationDetails?.defaultCurrency ?? 'HKD',
      });
      setServiceKeyTierConflict(null);
    });
    return () => {
      cancelled = true;
    };
  }, [service, createPrefillFromService]);

  const serviceKeyPayloadValue = useMemo(() => {
    const t = serviceForm.serviceKey.trim().toLowerCase();
    return t.length ? t : null;
  }, [serviceForm.serviceKey]);

  const normalizedServiceKeyInput = serviceForm.serviceKey.trim().toLowerCase();
  const tierTrimmedForValidation = serviceTier.trim().toLowerCase();

  const serviceKeyTierConflictActive = useMemo(() => {
    if (!serviceKeyTierConflict) {
      return false;
    }
    return (
      normalizedServiceKeyInput === serviceKeyTierConflict.serviceKey &&
      tierTrimmedForValidation === serviceKeyTierConflict.tierNormalized
    );
  }, [serviceKeyTierConflict, normalizedServiceKeyInput, tierTrimmedForValidation]);

  const serviceKeyConflictInline = useMemo(() => {
    if (!serviceKeyTierConflictActive || !serviceKeyTierConflict || serviceKeyTierConflict.variant !== 'tier_same') {
      return undefined;
    }
    return SERVICE_KEY_TIER_PAIR_CONFLICT_MSG;
  }, [serviceKeyTierConflictActive, serviceKeyTierConflict]);

  const tierConflictInline = useMemo(() => {
    if (!serviceKeyTierConflictActive || !serviceKeyTierConflict || serviceKeyTierConflict.variant !== 'tier_empty') {
      return undefined;
    }
    return EMPTY_TIER_CONFLICT_MSG;
  }, [serviceKeyTierConflictActive, serviceKeyTierConflict]);

  const hasLocationOptions = locationOptions.length > 0;
  const locationExists = locationOptions.some((entry) => entry.id === locationId);
  const selectedLocationValue = locationExists ? locationId : locationId || '';
  const showDefaultLocationField = serviceForm.deliveryMode !== 'online';

  const saveBlockedByPublishedBookableMissingKey = useMemo(() => {
    if (serviceForm.status !== 'published') {
      return false;
    }
    if (
      serviceType !== 'event' &&
      serviceType !== 'training_course' &&
      serviceType !== 'intro_call'
    ) {
      return false;
    }
    return serviceForm.serviceKey.trim() === '';
  }, [serviceForm.status, serviceForm.serviceKey, serviceType]);

  const saveBlockedByPairConflict = serviceKeyTierConflictActive;

  const tierInvalid =
    Boolean(tierTrimmedForValidation) && !INSTANCE_SLUG_PATTERN.test(tierTrimmedForValidation);

  const serviceKeyPatternInvalid = Boolean(
    serviceForm.serviceKey.trim() &&
      !SERVICE_KEY_PATTERN.test(serviceForm.serviceKey.trim().toLowerCase()),
  );

  function applyServiceKeyTierConflictFromApiError(
    caught: unknown,
    pair: { serviceKey: string | null; tierNormalized: string | null },
  ): boolean {
    if (!isAdminApiConflictOnField(caught, 'service_key_tier')) {
      return false;
    }
    const tierNorm = pair.tierNormalized ?? '';
    setServiceKeyTierConflict({
      serviceKey: pair.serviceKey ?? '',
      tierNormalized: tierNorm,
      variant: tierNorm.length > 0 ? 'tier_same' : 'tier_empty',
    });
    return true;
  }

  async function confirmServiceKeyChangeIfNeeded(newServiceKey: string | null, oldServiceKey: string | null): Promise<boolean> {
    if (newServiceKey === oldServiceKey) {
      return true;
    }
    const usageUnknown = discountUsageLoadState === 'error' || discountUsageSummary === null;
    if (usageUnknown) {
      const confirmed = await requestConfirm({
        title: 'Change service key?',
        description:
          "We couldn't verify current discount code usage — if this service key is referenced by active codes, changing it may break printed QR codes and links. Continue?",
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        variant: 'default',
      });
      return confirmed;
    }
    if (discountUsageSummary.totalCurrentUses > 0) {
      const confirmed = await requestConfirm({
        title: 'Change service key?',
        description: `This service has active discount code usage (${discountUsageSummary.totalCurrentUses} past redemptions). Changing the key will break any existing printed QR codes and links. Continue?`,
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        variant: 'default',
      });
      return confirmed;
    }
    return true;
  }

  async function submitUpdate() {
    if (!service) {
      return;
    }
    const serviceKeyTrimmed = serviceForm.serviceKey.trim();
    if (serviceKeyTrimmed && !SERVICE_KEY_PATTERN.test(serviceKeyTrimmed.toLowerCase())) {
      return;
    }
    const newServiceKey = serviceKeyTrimmed.toLowerCase() || null;
    const tierPayloadNormalized = serviceTier.trim().toLowerCase() || null;
    const oldServiceKey = (service.serviceKey ?? '').trim().toLowerCase() || null;
    const ok = await confirmServiceKeyChangeIfNeeded(newServiceKey, oldServiceKey);
    if (!ok) {
      return;
    }
    try {
      await onUpdate(
        buildServiceUpdatePayload({
          serviceType: service.serviceType,
          serviceForm,
          serviceKey: newServiceKey,
          bookingSystem,
          serviceTier,
          locationId,
          trainingForm,
          eventForm,
          consultationForm,
        }),
      );
      setServiceKeyTierConflict(null);
    } catch (caught) {
      if (
        applyServiceKeyTierConflictFromApiError(caught, {
          serviceKey: newServiceKey,
          tierNormalized: tierPayloadNormalized,
        })
      ) {
        return;
      }
      throw caught;
    }
  }

  async function submitCreate() {
    const tierPayloadNormalized = serviceTier.trim().toLowerCase() || null;
    try {
      await onCreate(
        buildServiceCreatePayload({
          serviceType,
          serviceForm,
          serviceKey: serviceKeyPayloadValue,
          bookingSystem,
          serviceTier,
          locationId,
          trainingForm,
          eventForm,
          consultationForm,
        }),
      );
      setServiceKeyTierConflict(null);
    } catch (caught) {
      if (
        applyServiceKeyTierConflictFromApiError(caught, {
          serviceKey: serviceKeyPayloadValue,
          tierNormalized: tierPayloadNormalized,
        })
      ) {
        return;
      }
      throw caught;
    }
  }

  const updateDisabled =
    isLoading ||
    !service ||
    saveBlockedByPairConflict ||
    saveBlockedByPublishedBookableMissingKey ||
    tierInvalid ||
    serviceKeyPatternInvalid;

  const createDisabled =
    isLoading ||
    saveBlockedByPairConflict ||
    saveBlockedByPublishedBookableMissingKey ||
    tierInvalid ||
    !serviceForm.title.trim() ||
    serviceKeyPatternInvalid;

  return {
    isEditMode,
    confirmDialogProps,
    serviceType,
    setServiceType,
    serviceForm,
    setServiceForm,
    trainingForm,
    setTrainingForm,
    eventForm,
    setEventForm,
    consultationForm,
    setConsultationForm,
    coverFileName,
    setCoverFileName,
    bookingSystem,
    setBookingSystem,
    serviceTier,
    setServiceTier,
    locationId,
    setLocationId,
    discountUsageLoadState,
    serviceKeyConflictInline,
    tierConflictInline,
    hasLocationOptions,
    selectedLocationValue,
    locationExists,
    showDefaultLocationField,
    tierInvalid,
    updateDisabled,
    createDisabled,
    submitUpdate,
    submitCreate,
  };
}
