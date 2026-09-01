'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import { Select } from '@/components/ui/select';
import { CONTACT_TYPES } from '@/lib/contacts/contacts-panel-constants';
import { instagramHandleForStorage } from '@/lib/contacts/contacts-panel-helpers';
import { formatEnumLabel } from '@/lib/format';
import { CONTACT_RELATIONSHIP_TYPES } from '@/types/entity-relationship';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface ContactEditorIdentityFieldsProps {
  firstName: string;
  lastName: string;
  contactType: ApiSchemas['EntityContactType'];
  relationshipType: (typeof CONTACT_RELATIONSHIP_TYPES)[number];
  email: string;
  phoneRegion: string;
  phoneNational: string;
  instagramHandle: string;
  dateOfBirth: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onContactTypeChange: (value: ApiSchemas['EntityContactType']) => void;
  onRelationshipTypeChange: (value: (typeof CONTACT_RELATIONSHIP_TYPES)[number]) => void;
  onEmailChange: (value: string) => void;
  onPhoneRegionChange: (value: string) => void;
  onPhoneNationalChange: (value: string) => void;
  onInstagramHandleChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
}

export function ContactEditorIdentityFields({
  firstName,
  lastName,
  contactType,
  relationshipType,
  email,
  phoneRegion,
  phoneNational,
  instagramHandle,
  dateOfBirth,
  onFirstNameChange,
  onLastNameChange,
  onContactTypeChange,
  onRelationshipTypeChange,
  onEmailChange,
  onPhoneRegionChange,
  onPhoneNationalChange,
  onInstagramHandleChange,
  onDateOfBirthChange,
}: ContactEditorIdentityFieldsProps) {
  return (
    <>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <div>
          <Label htmlFor='crm-contact-first'>First name</Label>
          <Input
            id='crm-contact-first'
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div>
          <Label htmlFor='crm-contact-last'>Last name</Label>
          <Input
            id='crm-contact-last'
            value={lastName}
            onChange={(e) => onLastNameChange(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div>
          <Label htmlFor='crm-contact-type'>Contact type</Label>
          <Select
            id='crm-contact-type'
            value={contactType}
            onChange={(e) => onContactTypeChange(e.target.value as ApiSchemas['EntityContactType'])}
          >
            {CONTACT_TYPES.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor='crm-contact-rel'>Relationship</Label>
          <Select
            id='crm-contact-rel'
            value={relationshipType}
            onChange={(e) =>
              onRelationshipTypeChange(e.target.value as (typeof CONTACT_RELATIONSHIP_TYPES)[number])
            }
          >
            {CONTACT_RELATIONSHIP_TYPES.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <div>
          <Label htmlFor='crm-contact-email'>Email</Label>
          <Input
            id='crm-contact-email'
            type='email'
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div>
          <PhoneField
            variant='compact'
            combinedLabel='Phone number'
            regionLabel='Phone country / region'
            nationalLabel='Phone number (national digits)'
            region={phoneRegion}
            national={phoneNational}
            onRegionChange={onPhoneRegionChange}
            onNationalChange={onPhoneNationalChange}
            nationalInputId='crm-contact-phone-national'
          />
        </div>
        <div>
          <Label htmlFor='crm-contact-ig'>Instagram</Label>
          <div className='relative'>
            <span
              className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-500 sm:text-sm'
              aria-hidden
            >
              @
            </span>
            <Input
              id='crm-contact-ig'
              className='pl-7'
              value={instagramHandle}
              onChange={(e) =>
                onInstagramHandleChange(instagramHandleForStorage(e.target.value) ?? '')
              }
              autoComplete='off'
              placeholder='username'
            />
          </div>
        </div>
        <div>
          <Label htmlFor='crm-contact-dob'>Date of birth</Label>
          <Input
            id='crm-contact-dob'
            type='date'
            value={dateOfBirth}
            onChange={(e) => onDateOfBirthChange(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}
