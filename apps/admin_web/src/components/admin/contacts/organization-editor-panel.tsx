'use client';

import { EntityInlineLocationSection } from '@/components/admin/contacts/shared/entity-inline-location-section';
import { EntityMembersSection } from '@/components/admin/contacts/shared/entity-members-section';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { EntityTagRef } from '@/lib/entity-api';
import { formatEnumLabel } from '@/lib/format';
import type { GeographicAreaSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';
import type { useOrganizationPanelEditor } from '@/hooks/use-organization-panel-editor';

type ApiSchemas = components['schemas'];

const ORG_TYPES: ApiSchemas['EntityOrganizationType'][] = [
  'school',
  'company',
  'community_group',
  'ngo',
  'other',
];

export interface OrganizationEditorPanelProps {
  editor: ReturnType<typeof useOrganizationPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
}

/** Editor rendered inside the expanded organisation row (CRM organisations only). */
export function OrganizationEditorPanel({
  editor,
  tags,
  geographicAreas,
  areasLoading,
}: OrganizationEditorPanelProps) {
  const {
    editorMode,
    selected,
    name,
    setName,
    organizationType,
    setOrganizationType,
    relationshipType,
    setRelationshipType,
    relationshipOptions,
    website,
    setWebsite,
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
    locationLockedReadOnly,
    expanded,
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
          onCancel={expanded.collapse}
          isSaving={isSaving}
          submitDisabled={!name.trim() || location.locationDraftInvalid}
          submitLabel={editorMode === 'create' ? 'Create organisation' : 'Update organisation'}
        />
      }
    >
      <AdminFieldGrid columns={4}>
        <AdminField label='Name' htmlFor='crm-org-name' span={2}>
          <Input
            id='crm-org-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete='off'
          />
        </AdminField>
        <AdminField
          label='Relationship'
          htmlFor='crm-org-rel'
          hint='CRM organisations only. Vendors are managed under Finance → Vendors; partners under Services → Partners.'
        >
          <Select
            id='crm-org-rel'
            value={relationshipType}
            onChange={(e) =>
              setRelationshipType(e.target.value as ApiSchemas['EntityOrganizationRelationshipType'])
            }
          >
            {relationshipOptions.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </AdminField>
        <AdminField label='Organisation type' htmlFor='crm-org-type'>
          <Select
            id='crm-org-type'
            value={organizationType}
            onChange={(e) =>
              setOrganizationType(e.target.value as ApiSchemas['EntityOrganizationType'])
            }
          >
            {ORG_TYPES.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </AdminField>
        <AdminField label='Website' htmlFor='crm-org-web' span={2}>
          <Input
            id='crm-org-web'
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            autoComplete='off'
          />
        </AdminField>
        {editorMode === 'edit' ? (
          <AdminField label='Status' htmlFor='crm-org-active'>
            <Select
              id='crm-org-active'
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
        sectionId='crm-org-location'
        stateKey={location.inlineLocationStateKey}
        location={location.resolvedLocation}
        embeddedSummary={location.embeddedLocationSummary}
        areas={geographicAreas}
        areasLoading={areasLoading}
        isSaving={isSaving || location.locationSaveStatus.isSaving}
        isGeocoding={location.locationGeocoding}
        saveError={location.locationSaveStatus.error}
        allowClearWhenLocked={locationLockedReadOnly}
        lockedSummaryExtra={
          locationLockedReadOnly
            ? 'To change the venue name or switch to a different address, use Services → Venues or update the partner organisation record.'
            : null
        }
        onDraftChange={location.onLocationDraftChange}
        onClear={location.clearPendingLocation}
        onGeocode={location.geocodeLocation}
      />

      <EntityTagPicker
        id='crm-org-tags'
        label='Tags'
        tags={tags}
        selectedIds={tagIds}
        onChange={setTagIds}
        disabled={isSaving}
        variant='collapsible'
      />

      <EntityServicesSection id='crm-org-services' labels={serviceLabels} />

      {editorMode === 'edit' && selected ? (
        <EntityMembersSection
          sectionId='crm-org-members'
          contactSelectId='crm-org-member-contact'
          entityLabel='organisation'
          helpText='Role for each member follows the contact type set on the contact record.'
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
