'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end'>
      <div>
        <Label htmlFor='crm-contact-source'>Source</Label>
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
      </div>
      <div className={source === 'referral' ? undefined : 'lg:col-span-3'}>
        <Label htmlFor='crm-contact-source-detail'>Source detail</Label>
        <Input
          id='crm-contact-source-detail'
          type='text'
          value={sourceDetail}
          onChange={(e) => onSourceDetailChange(e.target.value)}
          autoComplete='off'
        />
      </div>
      {source === 'referral' ? (
        <>
          <div>
            <Label htmlFor='crm-contact-referral-search'>Find referring contact</Label>
            <Input
              id='crm-contact-referral-search'
              value={referralSearchInput}
              onChange={(e) => onReferralSearchInputChange(e.target.value)}
              placeholder='Type at least 2 characters (name, email, phone, Instagram)'
              autoComplete='off'
            />
          </div>
          <div>
            <Label htmlFor='crm-contact-referral'>Referred by contact</Label>
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
          </div>
        </>
      ) : null}
    </div>
  );
}
