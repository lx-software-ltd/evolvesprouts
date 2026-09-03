'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ConsultationFormState } from '@/components/admin/services/consultation-form-fields';
import type { EventFormState } from '@/components/admin/services/event-form-fields';
import {
  cloneEventTiersForCreate,
  mergeServiceIntoConsultationForm,
  mergeServiceIntoEventForm,
  mergeServiceIntoInstanceForm,
  mergeServiceIntoTrainingForm,
  resolveInheritedEventCategory,
} from '@/components/admin/services/instance-form-merge';
import { DEFAULT_EVENT_FORM } from '@/components/admin/services/form-defaults';
import {
  emptyInstanceDetailFormBundle,
  initialInstanceDetailFormBundle,
  instanceDetailFormBundleFromServiceInstance,
} from '@/components/admin/services/instance-detail-form-state';
import type { InstanceFormState } from '@/components/admin/services/instance-form-fields';
import {
  buildInstanceCreatePayload,
  buildInstanceUpdatePayload,
} from '@/components/admin/services/instance-detail-payload';
import type { TrainingFormState } from '@/components/admin/services/training-form-fields';

import type { components } from '@/types/generated/admin-api.generated';
import type { EventTicketTier, LocationSummary, ServiceInstance, ServiceSummary, ServiceType } from '@/types/services';

import { useInstructorUsers } from '@/hooks/use-instructor-users';
import { conflictFieldUserMessage } from '@/lib/admin-api-conflict-messages';
import { filterLocationsForInstance } from '@/lib/instance-location-options';
import { computeSuggestedInstanceSlug, INSTANCE_SLUG_PATTERN } from '@/lib/slug-utils';

type ApiSchemas = components['schemas'];

export interface UseInstanceDetailPanelParams {
  instance: ServiceInstance | null;
  createPrefillInstance?: ServiceInstance | null;
  selectedServiceId: string | null;
  serviceOptions: ServiceSummary[];
  locationOptions: LocationSummary[];
  serviceType: ServiceType | null;
  onSelectService: (serviceId: string | null) => void;
  onCreate: (serviceId: string, payload: ApiSchemas['CreateInstanceRequest']) => Promise<void> | void;
  onUpdate: (
    serviceId: string,
    instanceId: string,
    payload: ApiSchemas['UpdateInstanceRequest']
  ) => Promise<void> | void;
}

export function useInstanceDetailPanel({
  instance,
  createPrefillInstance = null,
  selectedServiceId,
  serviceOptions,
  locationOptions,
  serviceType,
  onSelectService,
  onCreate,
  onUpdate,
}: UseInstanceDetailPanelParams) {
  const isEditMode = Boolean(instance);
  const lastMergedServiceIdForCreateRef = useRef<string | null>(null);
  const duplicateCreateHydratedRef = useRef(false);
  const duplicateEventTiersTemplateRef = useRef<EventTicketTier[] | null>(null);
  const createSlugTouchedRef = useRef(false);
  const { users: instructorUsers, isLoading: isLoadingInstructors } = useInstructorUsers(
    Boolean(selectedServiceId)
  );

  const initialForms = initialInstanceDetailFormBundle(instance, serviceOptions);
  const [tagIds, setTagIds] = useState<string[]>(() => initialForms.tagIds);
  const [sessionSlotsError, setSessionSlotsError] = useState('');
  const [slugSubmitError, setSlugSubmitError] = useState('');
  const [slugConflictError, setSlugConflictError] = useState('');
  const [instanceForm, setInstanceForm] = useState<InstanceFormState>(() => initialForms.instanceForm);
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>(() => initialForms.trainingForm);
  const [eventForm, setEventForm] = useState<EventFormState>(() => initialForms.eventForm);
  const [consultationForm, setConsultationForm] = useState<ConsultationFormState>(
    () => initialForms.consultationForm,
  );

  useEffect(() => {
    createSlugTouchedRef.current = false;
  }, [selectedServiceId]);

  useEffect(() => {
    if (!createPrefillInstance) {
      duplicateCreateHydratedRef.current = false;
      duplicateEventTiersTemplateRef.current = null;
    }
  }, [createPrefillInstance]);

  useEffect(() => {
    if (instance || !createPrefillInstance || !selectedServiceId) {
      return;
    }
    if (selectedServiceId !== createPrefillInstance.serviceId) {
      return;
    }
    if (duplicateCreateHydratedRef.current) {
      return;
    }
    duplicateCreateHydratedRef.current = true;
    lastMergedServiceIdForCreateRef.current = selectedServiceId;
    duplicateEventTiersTemplateRef.current = cloneEventTiersForCreate(createPrefillInstance.eventTicketTiers);
    const hydrated = instanceDetailFormBundleFromServiceInstance(createPrefillInstance, serviceOptions, {
      duplicateCreate: true,
    });
    queueMicrotask(() => {
      setSlugSubmitError('');
      setSlugConflictError('');
      createSlugTouchedRef.current = false;
      setTagIds(hydrated.tagIds);
      setInstanceForm(hydrated.instanceForm);
      setTrainingForm(hydrated.trainingForm);
      setEventForm(hydrated.eventForm);
      setConsultationForm(hydrated.consultationForm);
    });
  }, [instance, createPrefillInstance, selectedServiceId, serviceOptions]);

  const handleSelectService = useCallback(
    (serviceId: string | null) => {
      setSlugSubmitError('');
      setSlugConflictError('');
      onSelectService(serviceId);
      if (!serviceId) {
        lastMergedServiceIdForCreateRef.current = null;
        setEventForm(DEFAULT_EVENT_FORM);
        return;
      }
      const svc = serviceOptions.find((entry) => entry.id === serviceId);
      if (!svc) {
        return;
      }
      lastMergedServiceIdForCreateRef.current = serviceId;
      setInstanceForm((prev) => mergeServiceIntoInstanceForm(prev, svc));
      setTrainingForm((prev) => mergeServiceIntoTrainingForm(prev, svc));
      setEventForm((prev) => mergeServiceIntoEventForm(prev, svc));
      setConsultationForm((prev) => mergeServiceIntoConsultationForm(prev, svc));
    },
    [onSelectService, serviceOptions]
  );

  useEffect(() => {
    if (
      instance ||
      !selectedServiceId ||
      (createPrefillInstance && createPrefillInstance.serviceId === selectedServiceId)
    ) {
      return;
    }
    const svc = serviceOptions.find((entry) => entry.id === selectedServiceId);
    if (!svc) {
      return;
    }
    if (lastMergedServiceIdForCreateRef.current === selectedServiceId) {
      return;
    }
    lastMergedServiceIdForCreateRef.current = selectedServiceId;
    queueMicrotask(() => {
      setInstanceForm((prev) => mergeServiceIntoInstanceForm(prev, svc));
      setTrainingForm((prev) => mergeServiceIntoTrainingForm(prev, svc));
      setEventForm((prev) => mergeServiceIntoEventForm(prev, svc));
      setConsultationForm((prev) => mergeServiceIntoConsultationForm(prev, svc));
    });
  }, [instance, selectedServiceId, serviceOptions, createPrefillInstance]);

  useEffect(() => {
    if (!instance) {
      const empty = emptyInstanceDetailFormBundle();
      queueMicrotask(() => {
        setTagIds(empty.tagIds);
      });
      return;
    }
    const hydrated = instanceDetailFormBundleFromServiceInstance(instance, serviceOptions);
    queueMicrotask(() => {
      setSlugSubmitError('');
      setSlugConflictError('');
      setTagIds(hydrated.tagIds);
      setInstanceForm(hydrated.instanceForm);
      setTrainingForm(hydrated.trainingForm);
      setEventForm(hydrated.eventForm);
      setConsultationForm(hydrated.consultationForm);
    });
  }, [instance, serviceOptions]);

  const selectedService =
    serviceOptions.find((entry) => entry.id === selectedServiceId) ?? null;
  const effectiveServiceType = serviceType ?? selectedService?.serviceType ?? 'training_course';
  const consultationCatalogPricingReadOnly =
    effectiveServiceType === 'consultation' || effectiveServiceType === 'intro_call';
  const canSubmit = Boolean(selectedServiceId);
  const typeFieldsLocked = !selectedServiceId;

  const suggestedCreateSlug = useMemo(
    () =>
      computeSuggestedInstanceSlug(
        effectiveServiceType,
        selectedService,
        instanceForm
      ),
    [effectiveServiceType, selectedService, instanceForm]
  );

  useEffect(() => {
    if (instance || !selectedServiceId) {
      return;
    }
    if (effectiveServiceType !== 'event' && effectiveServiceType !== 'training_course') {
      return;
    }
    if (createSlugTouchedRef.current) {
      return;
    }
    const next = suggestedCreateSlug.trim().toLowerCase();
    queueMicrotask(() => {
      setInstanceForm((prev) => ({ ...prev, slug: next }));
    });
  }, [instance, selectedServiceId, effectiveServiceType, suggestedCreateSlug]);

  const effectiveSessionSlotDefaultLocationId =
    instanceForm.locationId.trim() || selectedService?.locationId?.trim() || null;

  const extraSelectedLocationIds = useMemo(() => {
    const ids = new Set<string>();
    const add = (v: string | null | undefined) => {
      const t = v?.trim();
      if (t) {
        ids.add(t);
      }
    };
    add(instanceForm.locationId);
    add(selectedService?.locationId ?? null);
    for (const slot of instanceForm.sessionSlots) {
      add(slot.locationId);
    }
    for (const p of instanceForm.partnerOrganizations) {
      add(p.locationId);
    }
    return ids;
  }, [instanceForm.locationId, instanceForm.sessionSlots, instanceForm.partnerOrganizations, selectedService?.locationId]);

  const filteredLocationOptions = useMemo(
    () =>
      filterLocationsForInstance(
        locationOptions,
        instanceForm.partnerOrganizations,
        extraSelectedLocationIds
      ),
    [locationOptions, instanceForm.partnerOrganizations, extraSelectedLocationIds]
  );

  const resolvedEventCategory = useMemo(
    () => resolveInheritedEventCategory(selectedService, instance),
    [selectedService, instance]
  );

  const buildCreatePayload = (): ApiSchemas['CreateInstanceRequest'] | null => {
    setSlugSubmitError('');
    setSlugConflictError('');
    setSessionSlotsError('');
    const result = buildInstanceCreatePayload({
      instanceForm,
      tagIds,
      effectiveServiceType,
      trainingForm,
      eventForm,
      resolvedEventCategory,
      instance,
      duplicateEventTiersTemplate: duplicateEventTiersTemplateRef.current,
    });
    if (!result.ok) {
      if (result.slugSubmitError) {
        setSlugSubmitError(result.slugSubmitError);
      }
      if (result.sessionSlotsError) {
        setSessionSlotsError(result.sessionSlotsError);
      }
      return null;
    }
    return result.payload;
  };

  const buildUpdatePayload = (): ApiSchemas['UpdateInstanceRequest'] | null => {
    setSlugSubmitError('');
    setSlugConflictError('');
    setSessionSlotsError('');
    const result = buildInstanceUpdatePayload({
      instanceForm,
      tagIds,
      effectiveServiceType,
      trainingForm,
      eventForm,
      resolvedEventCategory,
      instance,
      duplicateEventTiersTemplate: duplicateEventTiersTemplateRef.current,
    });
    if (!result.ok) {
      if (result.slugSubmitError) {
        setSlugSubmitError(result.slugSubmitError);
      }
      if (result.sessionSlotsError) {
        setSessionSlotsError(result.sessionSlotsError);
      }
      return null;
    }
    return result.payload;
  };

  const externalUrlInvalid =
    effectiveServiceType === 'event' &&
    Boolean(instanceForm.externalUrl.trim()) &&
    !/^https?:\/\//i.test(instanceForm.externalUrl.trim());

  const eventPriceMissing =
    effectiveServiceType === 'event' && !eventForm.defaultPrice.trim();

  const cohortTrimmed = instanceForm.cohort.trim().toLowerCase();
  const cohortInvalid = Boolean(cohortTrimmed) && !INSTANCE_SLUG_PATTERN.test(cohortTrimmed);

  const slugFieldError = [slugSubmitError, slugConflictError].filter(Boolean).join(' ');

  /** Resolves true when the instance was created; false when validation or a slug conflict kept the form open. */
  const runCreate = async (): Promise<boolean> => {
    if (!selectedServiceId) {
      return false;
    }
    const payload = buildCreatePayload();
    if (!payload) {
      return false;
    }
    try {
      await onCreate(selectedServiceId, payload);
      setSlugConflictError('');
      return true;
    } catch (err) {
      const slugMsg = conflictFieldUserMessage(err, { slug: 'This slug is already in use.' });
      if (slugMsg) {
        setSlugConflictError(slugMsg);
        return false;
      }
      throw err;
    }
  };

  /** Resolves true when the instance was updated; false when validation or a slug conflict kept the form open. */
  const runUpdate = async (): Promise<boolean> => {
    if (!instance || !selectedServiceId) {
      return false;
    }
    const payload = buildUpdatePayload();
    if (!payload) {
      return false;
    }
    try {
      await onUpdate(selectedServiceId, instance.id, payload);
      setSlugConflictError('');
      return true;
    } catch (err) {
      const slugMsg = conflictFieldUserMessage(err, { slug: 'This slug is already in use.' });
      if (slugMsg) {
        setSlugConflictError(slugMsg);
        return false;
      }
      throw err;
    }
  };

  const handleInstanceFormChange = (next: InstanceFormState) => {
    if (next.slug !== instanceForm.slug) {
      setSlugConflictError('');
      if (!instance) {
        createSlugTouchedRef.current = true;
      }
    }
    setInstanceForm(next);
  };

  const handleSessionSlotsChange = (sessionSlots: InstanceFormState['sessionSlots']) => {
    setSessionSlotsError('');
    setInstanceForm((prev) => ({ ...prev, sessionSlots }));
  };

  return {
    isEditMode,
    instance,
    selectedService,
    selectedServiceId,
    serviceOptions,
    effectiveServiceType,
    consultationCatalogPricingReadOnly,
    canSubmit,
    typeFieldsLocked,
    instanceForm,
    handleInstanceFormChange,
    trainingForm,
    setTrainingForm,
    eventForm,
    setEventForm,
    consultationForm,
    setConsultationForm,
    tagIds,
    setTagIds,
    instructorUsers,
    isLoadingInstructors,
    filteredLocationOptions,
    resolvedEventCategory,
    effectiveSessionSlotDefaultLocationId,
    slugFieldError,
    sessionSlotsError,
    externalUrlInvalid,
    eventPriceMissing,
    handleSelectService,
    handleSessionSlotsChange,
    runCreate,
    runUpdate,
    cohortInvalid,
  };
}
