import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export const CONTACT_TYPES: ApiSchemas['EntityContactType'][] = [
  'parent',
  'child',
  'helper',
  'professional',
  'other',
];

export const CONTACT_SOURCES: ApiSchemas['EntityContactSource'][] = [
  'free_guide',
  'newsletter',
  'contact_form',
  'reservation',
  'referral',
  'instagram',
  'facebook',
  'whatsapp',
  'linkedin',
  'event',
  'phone_call',
  'public_website',
  'manual',
];
