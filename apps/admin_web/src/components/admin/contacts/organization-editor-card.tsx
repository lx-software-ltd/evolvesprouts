'use client';

import { EntityInlineLocationSection } from '@/components/admin/contacts/shared/entity-inline-location-section';
import { EntityMembersSection } from '@/components/admin/contacts/shared/entity-members-section';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export interface OrganizationEditorCardProps {
  editor: ReturnType<typeof useOrganizationPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
}

export function OrganizationEditorCard({
  editor,
  tags,
  geographicAreas,
  areasLoading,
}: OrganizationEditorCardProps) {
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
    resetCreateForm,
    handleSubmit,
    handleAddMember,
    handlePrimaryMemberChange,
  } = editor;

  return (
    <AdminEditorCard
      title='Organisation'
      description='CRM organisations only. Vendors are managed under Finance → Vendors; partners under Services → Partners.'
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
          <Button
            type='button'
            disabled={isSaving || !name.trim() || location.locationDraftInvalid}
            onClick={() => void handleSubmit()}
          >
            {editorMode === 'create' ? 'Create organisation' : 'Update organisation'}
          </Button>
        </>
      }
    >
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-4'>
        <div className='lg:col-span-2'>
          <Label htmlFor='crm-org-name'>Name</Label>
          <Input
            id='crm-org-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div className='lg:col-span-1'>
          <Label htmlFor='crm-org-rel'>Relationship</Label>
          <Select
            id='crm-org-rel'
            value={relationshipType}
            onChange={(e) => {
              const next = e.target.value as ApiSchemas['EntityOrganizationRelationshipType'];
              setRelationshipType(next);
            }}
          >
            {relationshipOptions.map((v) => (
              <option key={v} value={v}>
                {formatEnumLabel(v)}
              </option>
            ))}
          </Select>
        </div>
        <div className='lg:col-span-2'>
          <Label htmlFor='crm-org-web'>Website</Label>
          <Input
            id='crm-org-web'
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div className='lg:col-span-1'>
          <Label htmlFor='crm-org-type'>Organisation type</Label>
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
        </div>
        <div className='lg:col-span-1'>
          {editorMode === 'edit' ? (
            <>
              <Label htmlFor='crm-org-active'>Status</Label>
              <Select
                id='crm-org-active'
                value={active ? 'true' : 'false'}
                onChange={(e) => setActive(e.target.value === 'true')}
              >
                <option value='true'>Active</option>
                <option value='false'>Archived</option>
              </Select>
            </>
          ) : null}
        </div>
        <div className='lg:col-span-4'>
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
        </div>
        <div className='lg:col-span-4 space-y-4'>
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
        </div>
        {editorMode === 'edit' && selected ? (
          <div className='lg:col-span-4'>
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
          </div>
        ) : null}
      </div>
    </AdminEditorCard>
  );
}
