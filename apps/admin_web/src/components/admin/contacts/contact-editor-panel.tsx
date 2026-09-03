'use client';

import { ContactEditorIdentityFields } from '@/components/admin/contacts/contact-editor-identity-fields';
import { ContactEditorSourceFields } from '@/components/admin/contacts/contact-editor-source-fields';
import { ContactNotesPanel } from '@/components/admin/contacts/contact-notes-panel';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { InlineLocationEditor } from '@/components/admin/locations/inline-location-editor';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';
import type { EntityTagRef } from '@/lib/entity-api';
import type { AdminUser } from '@/types/leads';
import type { GeographicAreaSummary } from '@/types/services';
import type { useContactsPanelEditor } from '@/hooks/use-contacts-panel-editor';

export interface ContactEditorPanelProps {
  editor: ReturnType<typeof useContactsPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  adminUsers: AdminUser[];
  onPatchStandaloneNoteCount: (contactId: string, standaloneNoteCount: number) => void;
}

/**
 * Editor rendered inside the expanded contact row. No title: the row above
 * names the record. Fields first, disclosures for Location, Tags, Services,
 * and Notes, then one action row.
 */
export function ContactEditorPanel({
  editor,
  tags,
  geographicAreas,
  areasLoading,
  adminUsers,
  onPatchStandaloneNoteCount,
}: ContactEditorPanelProps) {
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
    jobTitle,
    setJobTitle,
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
    handleSubmit,
    notesOpen,
    setNotesOpen,
  } = editor;

  return (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={editorMode}
          onSubmit={() => void handleSubmit()}
          isSaving={isSaving}
          submitDisabled={saveDisabled}
          submitLabel={editorMode === 'create' ? 'Create contact' : 'Update contact'}
        />
      }
    >
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
        jobTitle={jobTitle}
        referralContactId={referralContactId}
        referralSearchInput={referralSearchInput}
        referralSelectOptions={referralSelectOptions}
        onSourceChange={handleSourceChange}
        onSourceDetailChange={setSourceDetail}
        onJobTitleChange={setJobTitle}
        onReferralSearchInputChange={setReferralSearchInput}
        onReferralContactIdChange={(contactId, pinnedLabel) => {
          setReferralContactId(contactId);
          if (pinnedLabel) {
            setReferralPinnedLabel(pinnedLabel);
          }
        }}
      />

      <AdminFieldGrid columns={4}>
        <AdminField
          label='Family'
          htmlFor='crm-contact-family'
          hint={linkedToFamilyOrOrg ? 'Location is set on the linked family or organisation.' : undefined}
        >
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
        </AdminField>
        <AdminField label='Organisation' htmlFor='crm-contact-org'>
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
        </AdminField>
        {editorMode === 'edit' ? (
          <AdminField label='Status' htmlFor='crm-contact-active'>
            <Select
              id='crm-contact-active'
              value={active ? 'true' : 'false'}
              onChange={(e) => setActive(e.target.value === 'true')}
            >
              <option value='true'>Active</option>
              <option value='false'>Archived</option>
            </Select>
          </AdminField>
        ) : null}
        {editorMode === 'edit' && selected ? (
          <AdminField label='Mailchimp' htmlFor='crm-contact-mailchimp'>
            <Input
              id='crm-contact-mailchimp'
              value={formatEnumLabel(selected.mailchimp_status)}
              readOnly
              aria-readonly='true'
              title='Sync status is read-only from the API.'
            />
          </AdminField>
        ) : null}
      </AdminFieldGrid>

      <AdminDisclosure id='crm-contact-location' title='Location' disabled={isSaving}>
        <InlineLocationEditor
          stateKey={location.inlineLocationStateKey}
          location={location.resolvedLocation}
          embeddedSummary={location.embeddedLocationSummary}
          areas={geographicAreas}
          areasLoading={areasLoading}
          canModify={!linkedToFamilyOrOrg}
          hideLabel
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
      </AdminDisclosure>

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
        <AdminDisclosure
          id='crm-contact-notes'
          title='Notes'
          summary={selected.standalone_note_count > 0 ? selected.standalone_note_count : undefined}
          open={notesOpen}
          onOpenChange={setNotesOpen}
        >
          {notesOpen ? (
            <ContactNotesPanel
              contact={selected}
              adminUsers={adminUsers}
              onStandaloneNoteCountChange={onPatchStandaloneNoteCount}
            />
          ) : null}
        </AdminDisclosure>
      ) : null}
    </AdminEditorPanel>
  );
}
