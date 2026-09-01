import { describe, expect, it } from 'vitest';

import {
  CLIENT_DOCUMENT_ASSET_TAG,
  CUSTOMER_INVOICE_ASSET_TAG,
  EXPENSE_ATTACHMENT_ASSET_TAG,
  isRestrictedSystemAssetTag,
} from '@/types/assets';

/**
 * Must stay aligned with `EXPENSE_ATTACHMENT_TAG_NAME` in
 * `backend/src/app/services/asset_expense_tagging.py` and admin OpenAPI
 * `tag_name` / expense filter examples.
 */
describe('asset tag constants', () => {
  it('expense attachment tag matches backend literal', () => {
    expect(EXPENSE_ATTACHMENT_ASSET_TAG).toBe('expense_attachment');
  });

  it('customer invoice tag matches backend literal', () => {
    expect(CUSTOMER_INVOICE_ASSET_TAG).toBe('customer_invoice');
  });

  it('marks expense and invoice tags as restricted system tags', () => {
    expect(isRestrictedSystemAssetTag(EXPENSE_ATTACHMENT_ASSET_TAG)).toBe(true);
    expect(isRestrictedSystemAssetTag(CUSTOMER_INVOICE_ASSET_TAG)).toBe(true);
    expect(isRestrictedSystemAssetTag(CLIENT_DOCUMENT_ASSET_TAG)).toBe(false);
  });
});
