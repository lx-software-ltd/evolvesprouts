'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { toErrorMessage } from '@/hooks/hook-errors';
import { useAutoSelectOnce } from '@/hooks/use-auto-select-once';
import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';
import { createInitialCustomerPaymentAfterEnrollmentCreate } from '@/lib/billing-api';
import { compareInstancesByFirstSlotStartsDesc } from '@/lib/format';

import { useSharedEntityTags } from './use-admin-catalog';
import { useDiscountCodes } from './use-discount-codes';
import { useVenues } from './use-venues';
import { useEnrollmentList } from './use-enrollment-list';
import { useEnrollmentMutations } from './use-enrollment-mutations';
import { useInstanceList } from './use-instance-list';
import { useInstanceMutations } from './use-instance-mutations';
import { useLocationList } from './use-location-list';
import { useQueryTabState } from './use-query-tab-state';
import { useServiceDetail } from './use-service-detail';
import { useServiceList } from './use-service-list';
import { useServiceMutations } from './use-service-mutations';

export type ServicesView =
  | 'catalog'
  | 'instances'
  | 'discount-codes'
  | 'venues'
  | 'partners'
  | 'certificates';

export const SERVICES_VIEW_KEYS: readonly ServicesView[] = [
  'catalog',
  'instances',
  'discount-codes',
  'venues',
  'partners',
  'certificates',
];
export const DEFAULT_SERVICES_VIEW: ServicesView = 'instances';

/** Instances list toolbar status filter; empty string means all statuses. */
export type InstancesListStatusFilter = '' | 'not_completed' | 'completed';

export const DEFAULT_INSTANCES_LIST_STATUS_FILTER: InstancesListStatusFilter = 'not_completed';

export function useServicesPage() {
  const {
    contactId: contactFilterId,
    familyId: familyFilterId,
    organizationId: organizationFilterId,
    partyFilterKey,
  } = useRelatedPartySearchParams();
  const [activeView, setActiveView] = useQueryTabState<ServicesView>(
    SERVICES_VIEW_KEYS,
    DEFAULT_SERVICES_VIEW
  );
  const [selectedServiceIdState, setSelectedServiceIdState] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instanceOptionsCacheVersion, setInstanceOptionsCacheVersion] = useState(0);
  const [instancesServiceFilter, setInstancesServiceFilter] = useState<string>('');
  const [instancesServiceTypeFilter, setInstancesServiceTypeFilter] = useState<string>('');
  const [instancesStatusFilter, setInstancesStatusFilter] = useState<InstancesListStatusFilter>(
    DEFAULT_INSTANCES_LIST_STATUS_FILTER
  );
  useEffect(() => {
    if (partyFilterKey) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset instance status when the related-party URL filter changes */
      setInstancesStatusFilter('');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [partyFilterKey]);
  const [instancesSearchQuery, setInstancesSearchQuery] = useState<string>('');
  const [enrollmentCustomerPaymentError, setEnrollmentCustomerPaymentError] = useState('');
  const entityTagsCatalog = useSharedEntityTags();
  const entityTags = entityTagsCatalog.items;
  const entityTagsLoading = entityTagsCatalog.isLoading;
  const entityTagsError = entityTagsCatalog.error;

  const serviceList = useServiceList();
  const selectedServiceId = selectedServiceIdState;

  const setSelectedServiceId = useCallback((serviceId: string | null) => {
    setSelectedServiceIdState(serviceId);
    setSelectedInstanceId(null);
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- clear enrollment payment error when leaving the enrollment context */
    setEnrollmentCustomerPaymentError('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeView, selectedInstanceId]);

  const serviceDetail = useServiceDetail(selectedServiceId);
  const instanceList = useInstanceList(
    activeView === 'instances' ? null : selectedServiceId,
    activeView === 'instances'
      ? {
          listAllInstances: true,
          filterServiceId: instancesServiceFilter || null,
          filterServiceType: instancesServiceTypeFilter || null,
          filterContactId: contactFilterId || null,
          filterFamilyId: familyFilterId || null,
          filterOrganizationId: organizationFilterId || null,
        }
      : undefined
  );

  const selectedService = useMemo(
    () => serviceList.services.find((entry) => entry.id === selectedServiceId) ?? null,
    [serviceList.services, selectedServiceId]
  );
  const selectedInstance = useMemo(
    () => instanceList.instances.find((entry) => entry.id === selectedInstanceId) ?? null,
    [instanceList.instances, selectedInstanceId]
  );
  const firstPartyInstanceId = useMemo(() => {
    if (activeView !== 'instances' || !partyFilterKey || instanceList.isLoading) {
      return null;
    }
    if (instanceList.instances.length === 0) {
      return null;
    }
    const [first] = [...instanceList.instances].sort(compareInstancesByFirstSlotStartsDesc);
    return first?.id ?? null;
  }, [activeView, partyFilterKey, instanceList.isLoading, instanceList.instances]);
  useAutoSelectOnce(
    partyFilterKey,
    Boolean(firstPartyInstanceId) && activeView === 'instances' && !instanceList.isLoading,
    () => {
      if (firstPartyInstanceId) {
        setSelectedInstanceId(firstPartyInstanceId);
      }
    }
  );

  const enrollmentServiceId =
    activeView === 'instances' ? (selectedInstance?.serviceId ?? null) : selectedServiceId;
  const enrollmentList = useEnrollmentList(enrollmentServiceId, selectedInstanceId);
  const locationList = useLocationList();
  const discountCodes = useDiscountCodes();
  const venues = useVenues();

  const serviceMutations = useServiceMutations({
    onSuccess: async (serviceId) => {
      await serviceList.refetch();
      if (serviceId) {
        setSelectedServiceIdState((current) => (current ? serviceId : current));
      }
      await serviceDetail.refetch();
      await instanceList.refetch();
      await enrollmentList.refetch();
    },
  });
  const instanceMutations = useInstanceMutations({
    onSuccess: async (instanceId) => {
      setInstanceOptionsCacheVersion((v) => v + 1);
      await instanceList.refetch();
      if (instanceId) {
        setSelectedInstanceId((current) => (current ? instanceId : current));
      }
      await enrollmentList.refetch();
    },
  });
  const enrollmentMutations = useEnrollmentMutations({
    onSuccess: async (detail) => {
      if (detail.operation === 'delete' && detail.enrollmentId) {
        enrollmentList.removeEnrollmentFromList(detail.enrollmentId);
      } else if (detail.enrollment) {
        enrollmentList.upsertEnrollmentInList(detail.enrollment);
      }
      await enrollmentList.refetch();
      await instanceList.refetch();
      if (detail.operation === 'create' && detail.enrollment) {
        try {
          setEnrollmentCustomerPaymentError('');
          await createInitialCustomerPaymentAfterEnrollmentCreate(detail.enrollment);
        } catch (error) {
          setEnrollmentCustomerPaymentError(
            toErrorMessage(
              error,
              'Enrollment was saved, but automatic customer payment failed. Record it from Finance.',
              { honorBackendMessage: true },
            ),
          );
        }
      }
    },
  });

  const setSelectedInstanceIdWithMode = useCallback((instanceId: string | null) => {
    setSelectedInstanceId(instanceId);
  }, []);

  return {
    activeView,
    setActiveView,
    instanceOptionsCacheVersion,
    setInstanceOptionsCacheVersion,
    selectedServiceId,
    setSelectedServiceId,
    selectedService,
    selectedInstanceId,
    setSelectedInstanceId: setSelectedInstanceIdWithMode,
    selectedInstance,
    instancesServiceFilter,
    setInstancesServiceFilter,
    instancesServiceTypeFilter,
    setInstancesServiceTypeFilter,
    instancesStatusFilter,
    setInstancesStatusFilter,
    instancesSearchQuery,
    setInstancesSearchQuery,
    entityTags,
    entityTagsLoading,
    entityTagsError,
    serviceList,
    serviceDetail,
    serviceMutations,
    instanceList,
    instanceMutations,
    enrollmentList,
    enrollmentMutations,
    locationList,
    isLoadingLocations: locationList.isLoading,
    locationError: locationList.error,
    discountCodes,
    venues,
    enrollmentCustomerPaymentError,
    contactFilterId,
    familyFilterId,
    organizationFilterId,
  };
}
