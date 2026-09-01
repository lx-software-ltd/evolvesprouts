'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import type { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { useFamilyOrgPickers } from '@/hooks/use-family-org-pickers';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { getAdminContact, type EntityPickerListItem } from '@/lib/entity-api';
import { readAdminContactQueryId } from '@/lib/inbox-conversation-name';
import { contactPhoneRequestFields } from '@/lib/phone-request';
import { contactRowLabel, linkedVenueReadOnlyLines } from '@/lib/contacts/contacts-panel-helpers';
import { useContactReferralSearch } from '@/hooks/use-contact-referral-search';
import { useContactServiceLabels } from '@/hooks/use-contact-service-labels';
import { CONTACT_RELATIONSHIP_TYPES, relationshipTypeForEditor } from '@/types/entity-relationship';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export interface UseContactsPanelEditorInput {
  contacts: ReturnType<typeof useAdminEntityContacts>;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
  refreshFamilyOrgLists?: () => void | Promise<void>;
}

export function useContactsPanelEditor({
  contacts,
  locations,
  geographicAreas,
  refreshLocations,
  refreshFamilyOrgLists,
}: UseContactsPanelEditorInput) {
  const { isSaving, createContact, updateContact, deleteContact, contacts: rows } = contacts;

  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');
  const [notesTarget, setNotesTarget] = useState<ApiSchemas['AdminContact'] | null>(null);
  const { familyPicker, organizationPicker } = useFamilyOrgPickers();

  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const appliedContactQueryIdRef = useRef<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [phoneRegion, setPhoneRegion] = useState('HK');
  const [phoneNational, setPhoneNational] = useState('');
  const [contactType, setContactType] = useState<ApiSchemas['EntityContactType']>('parent');
  const [relationshipType, setRelationshipType] =
    useState<(typeof CONTACT_RELATIONSHIP_TYPES)[number]>('prospect');
  const [source, setSource] = useState<ApiSchemas['EntityContactSource']>('manual');
  const [sourceDetail, setSourceDetail] = useState('');
  const [referralContactId, setReferralContactId] = useState('');
  const [referralSearchInput, setReferralSearchInput] = useState('');
  const [referralSearchResults, setReferralSearchResults] = useState<EntityPickerListItem[]>([]);
  const [referralPinnedLabel, setReferralPinnedLabel] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);
  const [optimisticLocationSummary, setOptimisticLocationSummary] =
    useState<InlineLocationEmbeddedSummary | null>(null);
  const [familySelectId, setFamilySelectId] = useState('');
  const [organizationSelectId, setOrganizationSelectId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [serviceLabelsState, setServiceLabelsState] = useState<{
    entityId: string;
    labels: string[];
  } | null>(null);
  const [active, setActive] = useState(true);

  const selected = useMemo(
    () => rows.find((c) => c.id === selectedId) ?? null,
    [rows, selectedId]
  );

  const linkedToFamilyOrOrg = Boolean(familySelectId.trim() || organizationSelectId.trim());
  const locationFieldLocked = linkedToFamilyOrOrg;

  const serviceLabels =
    editorMode === 'edit' && selectedId && serviceLabelsState?.entityId === selectedId
      ? serviceLabelsState.labels
      : [];

  const readOnlyLockedLinesForEditor = useMemo(() => {
    if (!linkedToFamilyOrOrg || !selected) {
      return null;
    }
    const { lines, footerNote } = linkedVenueReadOnlyLines(selected);
    if (lines.length === 0) {
      return null;
    }
    return { lines, footerNote };
  }, [linkedToFamilyOrOrg, selected]);

  const location = useEntityInlineLocation({
    editorMode,
    selectedId,
    stateKeyPrefix: 'contact',
    pendingLocationId,
    setPendingLocationId,
    optimisticLocationSummary,
    setOptimisticLocationSummary,
    selectedLocationSummary: selected?.location_summary,
    locations,
    geographicAreas,
    refreshLocations,
  });

  const referralSelectOptions = useContactReferralSearch({
    source,
    editorMode,
    selectedId,
    referralSearchInput,
    referralContactId,
    referralSearchResults,
    referralPinnedLabel,
    setReferralSearchResults,
    setReferralPinnedLabel,
  });

  useContactServiceLabels(editorMode, selectedId, setServiceLabelsState);

  async function resetCreateForm() {
    setEditorMode('create');
    setSelectedId(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setInstagramHandle('');
    setPhoneRegion('HK');
    setPhoneNational('');
    setContactType('parent');
    setRelationshipType('prospect');
    setSource('manual');
    setSourceDetail('');
    setReferralContactId('');
    setReferralSearchInput('');
    setReferralSearchResults([]);
    setReferralPinnedLabel('');
    setDateOfBirth('');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    location.resetLocationDraft();
    setFamilySelectId('');
    setOrganizationSelectId('');
    setTagIds([]);
    setActive(true);
  }

  async function handleSubmit(): Promise<void> {
    try {
      const dob = dateOfBirth.trim() ? dateOfBirth.trim() : null;
      let loc = pendingLocationId;
      if (!locationFieldLocked) {
        const resolved = await location.commitLocationForSubmit();
        if (resolved.status === 'abort') {
          return;
        }
        loc = resolved.locationId;
      }
      const fam = familySelectId.trim();
      const org = organizationSelectId.trim();
      const family_ids = fam ? [fam] : [];
      const organization_ids = org ? [org] : [];

      if (source === 'referral' && !referralContactId.trim()) {
        return;
      }

      if (editorMode === 'create') {
        await createContact({
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          instagram_handle: instagramHandle.trim() || null,
          ...contactPhoneRequestFields(phoneRegion, phoneNational),
          contact_type: contactType,
          relationship_type: relationshipType,
          source,
          source_detail: sourceDetail.trim() || null,
          date_of_birth: dob,
          location_id: linkedToFamilyOrOrg ? null : loc,
          tag_ids: tagIds,
          family_ids,
          organization_ids,
          referral_contact_id: source === 'referral' ? referralContactId.trim() : null,
        });
        await refreshFamilyOrgLists?.();
        await resetCreateForm();
        return;
      }
      if (!selected) {
        return;
      }
      const body: ApiSchemas['UpdateAdminContactRequest'] = {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        instagram_handle: instagramHandle.trim() || null,
        ...contactPhoneRequestFields(phoneRegion, phoneNational),
        contact_type: contactType,
        relationship_type: relationshipType,
        source,
        source_detail: sourceDetail.trim() || null,
        date_of_birth: dob,
        active,
        tag_ids: tagIds,
        family_ids,
        organization_ids,
      };
      if (source === 'referral') {
        body.referral_contact_id = referralContactId.trim();
      }
      if (!locationFieldLocked) {
        body.location_id = loc;
      }
      await updateContact(selected.id, body);
      await refreshFamilyOrgLists?.();
    } catch {
      // Retry with form state preserved.
    }
  }

  async function handleDeleteContact(
    row: ApiSchemas['AdminContact'],
    clickEvent: MouseEvent<HTMLButtonElement>
  ): Promise<void> {
    clickEvent.stopPropagation();
    const confirmed = await requestConfirm({
      title: 'Delete contact',
      description: `Permanently delete "${contactRowLabel(row)}"? This removes the contact from the database and cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    try {
      await deleteContact(row.id);
      await refreshFamilyOrgLists?.();
      if (selectedId === row.id) {
        await resetCreateForm();
      }
    } catch (err) {
      setDeleteActionError(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  }

  const resetLocationDraft = location.resetLocationDraft;
  const selectRow = useCallback((row: ApiSchemas['AdminContact']) => {
    setSelectedId(row.id);
    setEditorMode('edit');
    setFirstName(row.first_name);
    setLastName(row.last_name ?? '');
    setEmail(row.email ?? '');
    setInstagramHandle(row.instagram_handle ?? '');
    setPhoneRegion(row.phone_region ?? 'HK');
    setPhoneNational(row.phone_national_number ?? '');
    setContactType(row.contact_type);
    setRelationshipType(relationshipTypeForEditor(row.relationship_type));
    setSource(row.source);
    setSourceDetail(row.source_detail ?? '');
    setReferralContactId(row.referral_contact_id ?? '');
    setReferralSearchInput('');
    setReferralSearchResults([]);
    setReferralPinnedLabel('');
    setDateOfBirth(row.date_of_birth ?? '');
    setPendingLocationId(row.location_id ?? null);
    setOptimisticLocationSummary(null);
    resetLocationDraft();
    setFamilySelectId(row.family_ids[0] ?? '');
    setOrganizationSelectId(row.organization_ids[0] ?? '');
    setTagIds([...row.tag_ids]);
    setActive(row.active);
  }, [resetLocationDraft]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const requestedId = readAdminContactQueryId(window.location.search);
    if (!requestedId || appliedContactQueryIdRef.current === requestedId) {
      return;
    }
    const row = rows.find((contact) => contact.id === requestedId) ?? null;
    let cancelled = false;
    const source = row
      ? Promise.resolve(row)
      : getAdminContact(requestedId);
    void source
      .then((contact) => {
        if (cancelled) {
          return;
        }
        appliedContactQueryIdRef.current = requestedId;
        if (contact) {
          selectRow(contact);
        }
      })
      .catch(() => {
        if (!cancelled) {
          appliedContactQueryIdRef.current = requestedId;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rows, selectRow]);

  function handleSourceChange(v: ApiSchemas['EntityContactSource']) {
    setSource(v);
    if (v !== 'referral') {
      setReferralContactId('');
      setReferralSearchInput('');
      setReferralSearchResults([]);
      setReferralPinnedLabel('');
    } else {
      setReferralSearchResults([]);
    }
  }

  const saveDisabled =
    isSaving ||
    !firstName.trim() ||
    (source === 'referral' && !referralContactId.trim()) ||
    (!locationFieldLocked && location.locationDraftInvalid);

  return {
    confirmDialogProps,
    deleteActionError,
    setDeleteActionError,
    notesTarget,
    setNotesTarget,
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
    handleDeleteContact,
    selectRow,
    selectedId,
    updateContact,
    refreshFamilyOrgLists,
  };
}
