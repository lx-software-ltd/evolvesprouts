'use client';

import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CONTACT_SOURCES } from '@/lib/contacts/contacts-panel-constants';
import { formatEnumLabel } from '@/lib/format';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface ContactEditorSourceFieldsProps {
  source: ApiSchemas['EntityContactSource'];
  sourceDetail: string;
  referralContactId: string;
  referralSearchInput: string;
  referralSelectOptions: { id: string; label: string }[];
  onSourceChange: (value: ApiSchemas['EntityContactSource']) => void;
  onSourceDetailChange: (value: string) => void;
  onReferralSearchInputChange: (value: string) => void;
  onReferralContactIdChange: (contactId: string, pinnedLabel: string | null) => void;
}

export function ContactEditorSourceFields({
  source,
  sourceDetail,
  referralContactId,
  referralSearchInput,
  referralSelectOptions,
  onSourceChange,
  onSourceDetailChange,
  onReferralSearchInputChange,
  onReferralContactIdChange,
}: ContactEditorSourceFieldsProps) {
  const isReferral = source === 'referral';
  return (
    <AdminFieldGrid columns={4}>
      <AdminField label='Source' htmlFor='crm-contact-source'>
        <Select
          id='crm-contact-source'
          value={source}
          onChange={(e) => onSourceChange(e.target.value as ApiSchemas['EntityContactSource'])}
        >
          {CONTACT_SOURCES.map((v) => (
            <option key={v} value={v}>
              {formatEnumLabel(v)}
            </option>
          ))}
        </Select>
      </AdminField>
      <AdminField label='Source detail' htmlFor='crm-contact-source-detail' span={isReferral ? 1 : 2}>
        <Input
          id='crm-contact-source-detail'
          type='text'
          value={sourceDetail}
          onChange={(e) => onSourceDetailChange(e.target.value)}
          autoComplete='off'
        />
      </AdminField>
      {isReferral ? (
        <>
          <AdminField label='Find referring contact' htmlFor='crm-contact-referral-search'>
            <Input
              id='crm-contact-referral-search'
              value={referralSearchInput}
              onChange={(e) => onReferralSearchInputChange(e.target.value)}
              placeholder='Type at least 2 characters (name, email, phone, Instagram)'
              autoComplete='off'
            />
          </AdminField>
          <AdminField label='Referred by contact' htmlFor='crm-contact-referral'>
            <Select
              id='crm-contact-referral'
              value={referralContactId}
              onChange={(e) => {
                const v = e.target.value;
                const picked = referralSelectOptions.find((o) => o.id === v);
                onReferralContactIdChange(v, picked?.label ?? null);
              }}
            >
              <option value=''>Select contact</option>
              {referralSelectOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </AdminField>
        </>
      ) : null}
    </AdminFieldGrid>
  );
}
