'use client';

import type { EntityTagRef } from '@/lib/entity-api';
import { EntityInlineLocationSection } from '@/components/admin/contacts/shared/entity-inline-location-section';
import { EntityMembersSection } from '@/components/admin/contacts/shared/entity-members-section';
import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEnumLabel } from '@/lib/format';
import { FAMILY_RELATIONSHIP_TYPES } from '@/types/entity-relationship';
import type { GeographicAreaSummary } from '@/types/services';
import type { useFamilyPanelEditor } from '@/hooks/use-family-panel-editor';

export interface FamilyEditorCardProps {
  editor: ReturnType<typeof useFamilyPanelEditor>;
  tags: EntityTagRef[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
}

export function FamilyEditorCard({ editor, tags, geographicAreas, areasLoading }: FamilyEditorCardProps) {
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
    resetCreateForm,
    handleSubmit,
    handleAddMember,
    handlePrimaryMemberChange,
  } = editor;

  return (
    <AdminEditorCard
      title='Family'
      description='Create a family or select one below. Add members by linking an existing contact.'
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
            disabled={isSaving || !familyName.trim() || location.locationDraftInvalid}
            onClick={() => void handleSubmit()}
          >
            {editorMode === 'create' ? 'Create family' : 'Update family'}
          </Button>
        </>
      }
    >
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-4'>
        <div className='lg:col-span-2'>
          <Label htmlFor='crm-family-name'>Family name</Label>
          <Input
            id='crm-family-name'
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            autoComplete='off'
          />
        </div>
        <div className='lg:col-span-1'>
          <Label htmlFor='crm-family-rel'>Relationship</Label>
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
        </div>
        {editorMode === 'edit' ? (
          <div className='lg:col-span-1'>
            <Label htmlFor='crm-family-active'>Status</Label>
            <Select
              id='crm-family-active'
              value={active ? 'true' : 'false'}
              onChange={(e) => setActive(e.target.value === 'true')}
            >
              <option value='true'>Active</option>
              <option value='false'>Archived</option>
            </Select>
          </div>
        ) : (
          <div className='hidden lg:col-span-1 lg:block' aria-hidden />
        )}
        <div className='lg:col-span-4'>
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
        </div>
        <div className='lg:col-span-4 space-y-4'>
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
        </div>
        {editorMode === 'edit' && selected ? (
          <div className='lg:col-span-4'>
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
          </div>
        ) : null}
      </div>
    </AdminEditorCard>
  );
}
