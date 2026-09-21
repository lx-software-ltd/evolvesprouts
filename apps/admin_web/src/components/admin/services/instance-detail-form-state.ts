import type { ConsultationFormState } from './consultation-form-fields';
import type { EventFormState } from './event-form-fields';
import {
  cloneSessionSlotsForCreate,
  consultationFormFromInstanceResolved,
  mapPartnerRefsFromInstance,
  resolveInheritedEventCategory,
} from './instance-form-merge';
import {
  DEFAULT_CONSULTATION_INSTANCE_FORM,
  DEFAULT_EVENT_FORM,
  DEFAULT_INSTANCE_FORM,
  DEFAULT_TRAINING_FORM,
} from './form-defaults';
import type { InstanceFormState } from './instance-form-fields';
import type { TrainingFormState } from './training-form-fields';

import type { ServiceInstance, ServiceSummary } from '@/types/services';

import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { mapSessionSlotsFromApiToForm } from '@/lib/format';

const defaultCurrencyCode = getAdminDefaultCurrencyCode();

export interface InstanceDetailFormBundle {
  instanceForm: InstanceFormState;
  trainingForm: TrainingFormState;
  eventForm: EventFormState;
  consultationForm: ConsultationFormState;
  tagIds: string[];
}

export function instanceFormFromServiceInstance(
  source: ServiceInstance,
  options?: { duplicateCreate?: boolean },
): InstanceFormState {
  return {
    title: source.title ?? '',
    slug: options?.duplicateCreate ? '' : (source.slug ?? ''),
    description: source.description ?? '',
    status: source.status,
    deliveryMode: source.deliveryMode ?? '',
    locationId: source.locationId ?? '',
    maxCapacity: source.maxCapacity?.toString() ?? '',
    capacityLeftOverride:
      source.capacityLeftOverride != null ? String(source.capacityLeftOverride) : '',
    waitlistEnabled: source.waitlistEnabled,
    instructorId: source.instructorId ?? '',
    notes: source.notes ?? '',
    cohort: source.cohort ?? '',
    externalUrl: source.externalUrl ?? '',
    partnerOrganizations: mapPartnerRefsFromInstance(source),
    sessionSlots: options?.duplicateCreate
      ? cloneSessionSlotsForCreate(source.sessionSlots)
      : mapSessionSlotsFromApiToForm(source.sessionSlots),
  };
}

export function trainingFormFromServiceInstance(source: ServiceInstance): TrainingFormState {
  return {
    pricingUnit: source.resolvedTrainingDetails?.pricingUnit ?? 'per_person',
    defaultPrice: source.resolvedTrainingDetails?.price ?? '',
    defaultCurrency: source.resolvedTrainingDetails?.currency ?? defaultCurrencyCode,
  };
}

export function eventFormFromServiceInstance(
  source: ServiceInstance,
  serviceOptions: ServiceSummary[],
): EventFormState {
  return {
    eventCategory: resolveInheritedEventCategory(
      serviceOptions.find((entry) => entry.id === source.serviceId) ?? null,
      source,
    ),
    defaultPrice: source.resolvedEventTicketTiers?.[0]?.price ?? '',
    defaultCurrency: source.resolvedEventTicketTiers?.[0]?.currency ?? defaultCurrencyCode,
  };
}

export function instanceDetailFormBundleFromServiceInstance(
  source: ServiceInstance,
  serviceOptions: ServiceSummary[],
  options?: { duplicateCreate?: boolean },
): InstanceDetailFormBundle {
  return {
    tagIds: [...source.tagIds],
    instanceForm: instanceFormFromServiceInstance(source, options),
    trainingForm: trainingFormFromServiceInstance(source),
    eventForm: eventFormFromServiceInstance(source, serviceOptions),
    consultationForm: consultationFormFromInstanceResolved(source),
  };
}

export function emptyInstanceDetailFormBundle(): InstanceDetailFormBundle {
  return {
    tagIds: [],
    instanceForm: DEFAULT_INSTANCE_FORM,
    trainingForm: DEFAULT_TRAINING_FORM,
    eventForm: DEFAULT_EVENT_FORM,
    consultationForm: DEFAULT_CONSULTATION_INSTANCE_FORM,
  };
}

export function initialInstanceDetailFormBundle(
  instance: ServiceInstance | null,
  serviceOptions: ServiceSummary[],
): InstanceDetailFormBundle {
  if (!instance) {
    return emptyInstanceDetailFormBundle();
  }
  return instanceDetailFormBundleFromServiceInstance(instance, serviceOptions);
}
