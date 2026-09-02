'use client';

import type { EntityTagRef } from '@/lib/entity-api';
import { EntityInlineLocationSection } from '@/components/admin/contacts/shared/entity-inline-location-section';
import { EntityMembersSection } from '@/components/admin/contacts/shared/entity-members-section';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';
import { FAMILY_RELATIONSHIP_TYPES } from '@/types/entity-relationship';
import type { GeographicAreaSummary } from '@/types/services';
import type { useFamilyPanelEditor } from '@/hooks/use-family-panel-editor';

export interface FamilyEditorPanelProps {
  editor: ReturnType<typeof useFamilyPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
}

/** Editor rendered inside the expanded family row. */
export function FamilyEditorPanel({ editor, tags, geographicAreas, areasLoading }: FamilyEditorPanelProps) {
  const {
    editorMode,
    selected,
    familyName,
    setFamilyName,
    relationshipType,
    setRelationshipType,
    tagIds,
    setTagIds,
    active,
    setActive,
    isSaving,
    serviceLabels,
    memberContactId,
    setMemberContactId,
    memberContactOptions,
    setRemoveTarget,
    location,
    handleSubmit,
    handleAddMember,
    handlePrimaryMemberChange,
  } = editor;

  return (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={editorMode}
          onSubmit={() => void handleSubmit()}
          isSaving={isSaving}
          submitDisabled={!familyName.trim() || location.locationDraftInvalid}
          submitLabel={editorMode === 'create' ? 'Create family' : 'Update family'}
        />
      }
    >
      <AdminFieldGrid columns={4}>
        <AdminField label='Family name' htmlFor='crm-family-name' span={2}>
          <Input
            id='crm-family-name'
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            autoComplete='off'
          />
        </AdminField>
        <AdminField label='Relationship' htmlFor='crm-family-rel'>
          <Select
            id='crm-family-rel'
            value={relationshipType}
            onChange={(e) =>
              setRelationshipType(e.target.value as (typeof FAMILY_RELATIONSHIP_TYPES)[number])
            }
          >
            {FAMILY_RELATIONSHIP_TYPES.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </AdminField>
        {editorMode === 'edit' ? (
          <AdminField label='Status' htmlFor='crm-family-active'>
            <Select
              id='crm-family-active'
              value={active ? 'true' : 'false'}
              onChange={(e) => setActive(e.target.value === 'true')}
            >
              <option value='true'>Active</option>
              <option value='false'>Archived</option>
            </Select>
          </AdminField>
        ) : null}
      </AdminFieldGrid>

      <EntityInlineLocationSection
        sectionId='crm-family-location'
        stateKey={location.inlineLocationStateKey}
        location={location.resolvedLocation}
        embeddedSummary={location.embeddedLocationSummary}
        areas={geographicAreas}
        areasLoading={areasLoading}
        isSaving={isSaving || location.locationSaveStatus.isSaving}
        isGeocoding={location.locationGeocoding}
        saveError={location.locationSaveStatus.error}
        onDraftChange={location.onLocationDraftChange}
        onClear={location.clearPendingLocation}
        onGeocode={location.geocodeLocation}
      />

      <EntityTagPicker
        id='crm-family-tags'
        label='Tags'
        tags={tags}
        selectedIds={tagIds}
        onChange={setTagIds}
        disabled={isSaving}
        variant='collapsible'
      />

      <EntityServicesSection id='crm-family-services' labels={serviceLabels} />

      {editorMode === 'edit' && selected ? (
        <EntityMembersSection
          sectionId='crm-family-members'
          contactSelectId='crm-family-member-contact'
          entityLabel='family'
          helpText='Role is stored on each membership and matches the contact type when the member is added or when the contact type is changed on the contact record.'
          members={selected.members}
          memberContactId={memberContactId}
          memberContactOptions={memberContactOptions}
          isSaving={isSaving}
          onMemberContactIdChange={setMemberContactId}
          onAddMember={() => void handleAddMember()}
          onPrimaryChange={(memberId, checked) => {
            void handlePrimaryMemberChange(memberId, checked);
          }}
          onRemoveRequest={(memberId, label) => setRemoveTarget({ memberId, label })}
        />
      ) : null}
    </AdminEditorPanel>
  );
}
