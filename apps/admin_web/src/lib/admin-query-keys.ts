/**
 * Query-key factories for the admin cache. Every cached list or catalog names
 * its key here so invalidation after a mutation targets one resource.
 *
 * Shape: `['admin', <resource>, <kind>, ...params]`. `list` keys are prefixes:
 * `usePaginatedList` appends the active filters as the last element, so
 * invalidating `adminQueryKeys.contacts.lists()` clears every filter variant.
 */
const ROOT = 'admin' as const;

function resource<TName extends string>(name: TName) {
  return {
    all: () => [ROOT, name] as const,
    lists: () => [ROOT, name, 'list'] as const,
    detail: (id: string) => [ROOT, name, 'detail', id] as const,
  };
}

export const adminQueryKeys = {
  contacts: resource('contacts'),
  families: resource('families'),
  organizations: resource('organizations'),
  leads: resource('leads'),
  services: resource('services'),
  serviceInstances: resource('service-instances'),
  enrollments: resource('enrollments'),
  discountCodes: resource('discount-codes'),
  certificates: resource('certificates'),
  partners: resource('partners'),
  venues: resource('venues'),
  expenses: resource('expenses'),
  vendors: resource('vendors'),
  customerInvoices: resource('customer-invoices'),
  customerPayments: resource('customer-payments'),
  assets: resource('assets'),
  auditLogs: resource('audit-logs'),
  apiKeys: resource('api-keys'),
  cognitoUsers: resource('cognito-users'),
  calendarBlocks: resource('calendar-blocks'),
  tags: resource('tags'),
  conversations: resource('conversations'),
  salesDailyPlan: {
    latest: () => [ROOT, 'sales-daily-plan', 'latest'] as const,
  },
  catalog: {
    entityTags: () => [ROOT, 'catalog', 'entity-tags'] as const,
    adminUsers: () => [ROOT, 'catalog', 'admin-users'] as const,
    instructorUsers: () => [ROOT, 'catalog', 'instructor-users'] as const,
    geographicAreas: () => [ROOT, 'catalog', 'geographic-areas'] as const,
    pickerLocations: () => [ROOT, 'catalog', 'picker-locations'] as const,
    venueLocations: () => [ROOT, 'catalog', 'venue-locations'] as const,
  },
} as const;

export type AdminQueryKey = readonly unknown[];
