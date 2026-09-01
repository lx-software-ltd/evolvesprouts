import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

function defineEnumValues<T extends string>() {
  return <U extends readonly T[]>(values: U & ([T] extends [U[number]] ? unknown : never)) => values;
}

export type FunnelStage = ApiSchemas['FunnelStage'];
export const FUNNEL_STAGES = defineEnumValues<FunnelStage>()(
  ['new', 'contacted', 'engaged', 'qualified', 'unqualified', 'converted', 'lost'] as const satisfies readonly FunnelStage[]
);

export type LeadType = ApiSchemas['LeadType'];
export const LEAD_TYPES = defineEnumValues<LeadType>()(
  ['free_guide', 'event_inquiry', 'program_enrollment', 'consultation', 'partnership', 'other'] as const satisfies readonly LeadType[]
);

export type LostReason = ApiSchemas['LeadLostReason'];
export const LOST_REASONS = defineEnumValues<LostReason>()(
  [
    'price_too_high',
    'value_not_understood',
    'ghosted',
    'language_mismatch',
    'other',
  ] as const satisfies readonly LostReason[]
);

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price_too_high: 'Price too high',
  value_not_understood: 'Value not understood',
  ghosted: 'Ghosted',
  language_mismatch: 'Language mismatch',
  other: 'Other',
};

export type ContactSource = ApiSchemas['ContactSource'];
export const CONTACT_SOURCES = defineEnumValues<ContactSource>()(
  [
    'free_guide',
    'newsletter',
    'contact_form',
    'reservation',
    'referral',
    'instagram',
    'facebook',
    'manual',
    'whatsapp',
    'linkedin',
    'event',
    'phone_call',
    'public_website',
  ] as const satisfies readonly ContactSource[]
);

export interface AdminUser {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface LeadContact {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneRegion: string | null;
  phoneNationalNumber: string | null;
  phoneE164: string | null;
  instagramHandle: string | null;
  source: ContactSource | null;
  sourceDetail: string | null;
  contactType: string | null;
  relationshipType: string | null;
}

export interface LeadEvent {
  id: string;
  eventType: ApiSchemas['LeadEventType'];
  fromStage: FunnelStage | null;
  toStage: FunnelStage | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string | null;
}

/** Lead detail / lead-note API payloads use the shared ``Note`` schema (snake_case in JSON). */
export type LeadNote = ApiSchemas['Note'];

export interface LeadSummary {
  id: string;
  contact: LeadContact;
  leadType: LeadType;
  funnelStage: FunnelStage;
  assignedTo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  convertedAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  daysInStage: number;
  lastActivityAt: string | null;
  tags: string[];
}

export interface LeadDetail extends LeadSummary {
  family: Record<string, unknown> | null;
  organization: Record<string, unknown> | null;
  events: LeadEvent[];
  notes: LeadNote[];
}

export interface LeadAiFollowUp {
  channel: string;
  messageExcerpt: string;
  draftReply: string;
  rationale: string;
}

export interface LeadAiSuggestion {
  id: string;
  leadId: string;
  summary: string;
  actions: string[];
  followUps: LeadAiFollowUp[];
  risks: string[];
  generatedAt: string | null;
  generatedBy: string | null;
  model: string | null;
  conversationWatermarkAt: string | null;
  isStale: boolean;
  staleReasons: string[];
  staleAfter: string | null;
  latestMessageAt: string | null;
}

export interface LeadListFilters {
  stage: FunnelStage[];
  source: ContactSource[];
  leadType: LeadType[];
  assignedTo: string | null;
  unassigned: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  search: string;
  sort: 'created_at' | 'updated_at' | 'funnel_stage' | 'contact_name';
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_LEAD_LIST_FILTERS: LeadListFilters = {
  stage: [],
  source: [],
  leadType: [],
  assignedTo: null,
  unassigned: false,
  dateFrom: null,
  dateTo: null,
  search: '',
  sort: 'created_at',
  sortDir: 'desc',
};

export interface LeadAnalytics {
  funnel: Record<string, number>;
  conversionRate: number;
  avgDaysToConvert: number | null;
  leadsThisWeek: number;
  leadsThisMonth: number;
  sourceBreakdown: Record<string, number>;
  stageConversionRates: Record<string, number>;
  avgDaysInStage: Record<string, number>;
  leadsOverTime: Array<{ period: string; count: number }>;
  assigneeStats: Array<{
    assignedTo: string | null;
    total: number;
    converted: number;
    conversionRate: number;
  }>;
}
