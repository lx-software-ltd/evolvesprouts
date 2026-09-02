'use client';

import { ContactEditorIdentityFields } from '@/components/admin/contacts/contact-editor-identity-fields';
import { ContactEditorSourceFields } from '@/components/admin/contacts/contact-editor-source-fields';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { InlineLocationEditor } from '@/components/admin/locations/inline-location-editor';
import { AdminCollapsibleSection } from '@/components/ui/admin-collapsible-section';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';
import type { EntityTagRef } from '@/lib/entity-api';
import type { GeographicAreaSummary } from '@/types/services';
import type { useContactsPanelEditor } from '@/hooks/use-contacts-panel-editor';

export interface ContactEditorCardProps {
  editor: ReturnType<typeof useContactsPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
}

export function ContactEditorCard({
  editor,
  tags,
  geographicAreas,
  areasLoading,
}: ContactEditorCardProps) {
  const {
    editorMode,
    selected,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    contactType,
    setContactType,
    relationshipType,
    setRelationshipType,
    email,
    setEmail,
    phoneRegion,
    setPhoneRegion,
    phoneNational,
    setPhoneNational,
    instagramHandle,
    setInstagramHandle,
    dateOfBirth,
    setDateOfBirth,
    source,
    sourceDetail,
    setSourceDetail,
    referralContactId,
    referralSearchInput,
    setReferralSearchInput,
    referralSelectOptions,
    handleSourceChange,
    setReferralContactId,
    setReferralPinnedLabel,
    familyPicker,
    organizationPicker,
    familySelectId,
    setFamilySelectId,
    organizationSelectId,
    setOrganizationSelectId,
    tagIds,
    setTagIds,
    active,
    setActive,
    isSaving,
    serviceLabels,
    linkedToFamilyOrOrg,
    location,
    readOnlyLockedLinesForEditor,
    setPendingLocationId,
    setOptimisticLocationSummary,
    saveDisabled,
    resetCreateForm,
    handleSubmit,
  } = editor;

  return (
    <AdminEditorCard
      title='Contact'
      description='Create a contact or select a row below to edit. When this contact is linked to a family or organisation, set location on that record instead. Mailchimp sync status is read-only from the API.'
      actions={
        <>
          {editorMode === 'edit' ? (
            <Button
              type='button'
              variant='secondary'
              onClick={() => void resetCreateForm()}
              disabled={isSaving}
            >
              Cancel
            </Button>
          ) : null}
          <Button type='button' disabled={saveDisabled} onClick={() => void handleSubmit()}>
            {editorMode === 'create' ? 'Create contact' : 'Update contact'}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <ContactEditorIdentityFields
          firstName={firstName}
          lastName={lastName}
          contactType={contactType}
          relationshipType={relationshipType}
          email={email}
          phoneRegion={phoneRegion}
          phoneNational={phoneNational}
          instagramHandle={instagramHandle}
          dateOfBirth={dateOfBirth}
          onFirstNameChange={setFirstName}
          onLastNameChange={setLastName}
          onContactTypeChange={setContactType}
          onRelationshipTypeChange={setRelationshipType}
          onEmailChange={setEmail}
          onPhoneRegionChange={setPhoneRegion}
          onPhoneNationalChange={setPhoneNational}
          onInstagramHandleChange={setInstagramHandle}
          onDateOfBirthChange={setDateOfBirth}
        />

        <ContactEditorSourceFields
          source={source}
          sourceDetail={sourceDetail}
          referralContactId={referralContactId}
          referralSearchInput={referralSearchInput}
          referralSelectOptions={referralSelectOptions}
          onSourceChange={handleSourceChange}
          onSourceDetailChange={setSourceDetail}
          onReferralSearchInputChange={setReferralSearchInput}
          onReferralContactIdChange={(contactId, pinnedLabel) => {
            setReferralContactId(contactId);
            if (pinnedLabel) {
              setReferralPinnedLabel(pinnedLabel);
            }
          }}
        />

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          <div>
            <Label htmlFor='crm-contact-family'>Family</Label>
            <Select
              id='crm-contact-family'
              value={familySelectId}
              onChange={(e) => {
                const v = e.target.value;
                setFamilySelectId(v);
                if (v) {
                  setPendingLocationId(null);
                  setOptimisticLocationSummary(null);
                }
              }}
            >
              <option value=''>None</option>
              {familyPicker.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='crm-contact-org'>Organisation</Label>
            <Select
              id='crm-contact-org'
              value={organizationSelectId}
              onChange={(e) => {
                const v = e.target.value;
                setOrganizationSelectId(v);
                if (v) {
                  setPendingLocationId(null);
                  setOptimisticLocationSummary(null);
                }
              }}
            >
              <option value=''>None</option>
              {organizationPicker.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          {editorMode === 'edit' ? (
            <div>
              <Label htmlFor='crm-contact-active'>Status</Label>
              <Select
                id='crm-contact-active'
                value={active ? 'true' : 'false'}
                onChange={(e) => setActive(e.target.value === 'true')}
              >
                <option value='true'>Active</option>
                <option value='false'>Archived</option>
              </Select>
            </div>
          ) : null}
        </div>

        <AdminCollapsibleSection id='crm-contact-location' title='Location' disabled={isSaving}>
          <InlineLocationEditor
            stateKey={location.inlineLocationStateKey}
            location={location.resolvedLocation}
            embeddedSummary={location.embeddedLocationSummary}
            areas={geographicAreas}
            areasLoading={areasLoading}
            canModify={!linkedToFamilyOrOrg}
            readOnlyLockedLines={readOnlyLockedLinesForEditor}
            readOnlyNote={
              linkedToFamilyOrOrg ? 'Location is managed on the linked family or organisation.' : null
            }
            isSaving={isSaving || location.locationSaveStatus.isSaving}
            isGeocoding={location.locationGeocoding}
            saveError={location.locationSaveStatus.error}
            onDraftChange={location.onLocationDraftChange}
            onClear={() => {
              setPendingLocationId(null);
              setOptimisticLocationSummary(null);
              location.clearLocationSaveError();
            }}
            onGeocode={location.geocodeLocation}
          />
        </AdminCollapsibleSection>

        <EntityTagPicker
          id='crm-contact-tags'
          label='Tags'
          tags={tags}
          selectedIds={tagIds}
          onChange={setTagIds}
          disabled={isSaving}
          variant='collapsible'
        />

        <EntityServicesSection id='crm-contact-services' labels={serviceLabels} />

        {editorMode === 'edit' && selected ? (
          <div className='text-sm text-slate-600'>
            <p>Mailchimp: {formatEnumLabel(selected.mailchimp_status)}</p>
          </div>
        ) : null}
      </div>
    </AdminEditorCard>
  );
}
