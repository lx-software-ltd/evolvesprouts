'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { useAdminEntityContacts } from '@/hooks/use-admin-entity-contacts';
import { useFamilyOrgPickers } from '@/hooks/use-family-org-pickers';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { getAdminContact, type EntityPickerListItem } from '@/lib/entity-api';
import { ADMIN_CONTACT_QUERY_PARAM } from '@/lib/inbox-conversation-name';
import { contactPhoneRequestFields } from '@/lib/phone-request';
import {
  contactRowLabel,
  instagramHandleForStorage,
  linkedVenueReadOnlyLines,
} from '@/lib/contacts/contacts-panel-helpers';
import { useContactReferralSearch } from '@/hooks/use-contact-referral-search';
import { useContactServiceLabels } from '@/hooks/use-contact-service-labels';
import { CONTACT_RELATIONSHIP_TYPES, relationshipTypeForEditor } from '@/types/entity-relationship';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type AdminContact = ApiSchemas['AdminContact'];

export interface UseContactsPanelEditorInput {
  contacts: ReturnType<typeof useAdminEntityContacts>;
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  refreshLocations: () => Promise<void> | void;
  refreshFamilyOrgLists?: () => void | Promise<void>;
}

async function fetchMissingContact(id: string): Promise<AdminContact | null> {
  return getAdminContact(id);
}

export function useContactsPanelEditor({
  contacts,
  locations,
  geographicAreas,
  refreshLocations,
  refreshFamilyOrgLists,
}: UseContactsPanelEditorInput) {
  const { isSaving, isLoading, createContact, updateContact, deleteContact, contacts: rows } = contacts;

  const {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    externalDirtyRef,
    clearDirty,
    markDirty,
    track,
  } = useEntityPanelEditorShell({ paramName: ADMIN_CONTACT_QUERY_PARAM });
  const [notesOpen, setNotesOpen] = useState(false);
  const openNotesOnApplyRef = useRef(false);
  const { familyPicker, organizationPicker } = useFamilyOrgPickers();
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
  const [jobTitle, setJobTitle] = useState('');
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

  const linkedToFamilyOrOrg = Boolean(familySelectId.trim() || organizationSelectId.trim());
  const locationFieldLocked = linkedToFamilyOrOrg;

  const serviceLabels =
    editorMode === 'edit' && selectedId && serviceLabelsState?.entityId === selectedId
      ? serviceLabelsState.labels
      : [];

  function clearForm() {
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
    setJobTitle('');
    setReferralContactId('');
    setReferralSearchInput('');
    setReferralSearchResults([]);
    setReferralPinnedLabel('');
    setDateOfBirth('');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    setFamilySelectId('');
    setOrganizationSelectId('');
    setTagIds([]);
    setActive(true);
    setNotesOpen(false);
    clearDirty();
  }

  const applyRow = useCallback(
    (row: AdminContact) => {
      setFirstName(row.first_name);
      setLastName(row.last_name ?? '');
      setEmail(row.email ?? '');
      setInstagramHandle(instagramHandleForStorage(row.instagram_handle) ?? '');
      setPhoneRegion(row.phone_region ?? 'HK');
      setPhoneNational(row.phone_national_number ?? '');
      setContactType(row.contact_type);
      setRelationshipType(relationshipTypeForEditor(row.relationship_type));
      setSource(row.source);
      setSourceDetail(row.source_detail ?? '');
      setJobTitle(row.job_title ?? '');
      setReferralContactId(row.referral_contact_id ?? '');
      setReferralSearchInput('');
      setReferralSearchResults([]);
      setReferralPinnedLabel('');
      setDateOfBirth(row.date_of_birth ?? '');
      setPendingLocationId(row.location_id ?? null);
      setOptimisticLocationSummary(null);
      setFamilySelectId(row.family_ids[0] ?? '');
      setOrganizationSelectId(row.organization_ids[0] ?? '');
      setTagIds([...row.tag_ids]);
      setActive(row.active);
      setNotesOpen(openNotesOnApplyRef.current);
      openNotesOnApplyRef.current = false;
      clearDirty();
    },
    [clearDirty]
  );

  // `location` is declared below because it depends on the pinned row this
  // hook returns; the callbacks only run from effects, after both exist.
  const { pinnedRow } = useExpandedRecordForm<AdminContact>({
    expandedId: expanded.expandedId,
    rows,
    isLoading,
    applyRow: (row) => {
      applyRow(row);
      location.resetLocationDraft();
    },
    reset: () => {
      clearForm();
      location.resetLocationDraft();
    },
    collapse: expanded.collapse,
    fetchMissing: fetchMissingContact,
  });

  const selected = useMemo(
    () =>
      rows.find((c) => c.id === selectedId) ??
      (pinnedRow && pinnedRow.id === selectedId ? pinnedRow : null),
    [rows, pinnedRow, selectedId]
  );

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

  const locationDraftDirty = location.locationDraftDirty;
  useEffect(() => {
    externalDirtyRef.current = () => locationDraftDirty;
  }, [externalDirtyRef, locationDraftDirty]);

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
          instagram_handle: instagramHandleForStorage(instagramHandle),
          ...contactPhoneRequestFields(phoneRegion, phoneNational),
          contact_type: contactType,
          relationship_type: relationshipType,
          source,
          source_detail: sourceDetail.trim() || null,
          job_title: jobTitle.trim() || null,
          date_of_birth: dob,
          location_id: linkedToFamilyOrOrg ? null : loc,
          tag_ids: tagIds,
          family_ids,
          organization_ids,
          referral_contact_id: source === 'referral' ? referralContactId.trim() : null,
        });
        await refreshFamilyOrgLists?.();
        clearDirty();
        expanded.collapse();
        return;
      }
      if (!selected) {
        return;
      }
      const body: ApiSchemas['UpdateAdminContactRequest'] = {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        instagram_handle: instagramHandleForStorage(instagramHandle),
        ...contactPhoneRequestFields(phoneRegion, phoneNational),
        contact_type: contactType,
        relationship_type: relationshipType,
        source,
        source_detail: sourceDetail.trim() || null,
        job_title: jobTitle.trim() || null,
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
      // Location edits stay in the inline draft after persist; remount so the
      // close-row guard no longer treats the saved address as unsaved.
      externalDirtyRef.current = () => false;
      location.resetLocationDraft();
      clearDirty();
    } catch {
      // Retry with form state preserved.
    }
  }

  async function handleDeleteContact(row: AdminContact): Promise<void> {
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
        clearDirty();
        expanded.collapse();
      }
    } catch (err) {
      setDeleteActionError(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  }

  /** Expand the row (if needed) with its Notes disclosure open. */
  function openNotes(row: AdminContact) {
    if (selectedId === row.id) {
      setNotesOpen((current) => !current);
      return;
    }
    openNotesOnApplyRef.current = true;
    expanded.expand(row.id);
  }

  function handleSourceChange(v: ApiSchemas['EntityContactSource']) {
    markDirty();
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
    expanded,
    pinnedRow,
    notesOpen,
    setNotesOpen,
    openNotes,
    editorMode,
    selected,
    firstName,
    setFirstName: track(setFirstName),
    lastName,
    setLastName: track(setLastName),
    contactType,
    setContactType: track(setContactType),
    relationshipType,
    setRelationshipType: track(setRelationshipType),
    email,
    setEmail: track(setEmail),
    phoneRegion,
    setPhoneRegion: track(setPhoneRegion),
    phoneNational,
    setPhoneNational: track(setPhoneNational),
    instagramHandle,
    setInstagramHandle: track(setInstagramHandle),
    dateOfBirth,
    setDateOfBirth: track(setDateOfBirth),
    source,
    sourceDetail,
    setSourceDetail: track(setSourceDetail),
    jobTitle,
    setJobTitle: track(setJobTitle),
    referralContactId,
    referralSearchInput,
    setReferralSearchInput,
    referralSelectOptions,
    handleSourceChange,
    setReferralContactId: track(setReferralContactId),
    setReferralPinnedLabel,
    familyPicker,
    organizationPicker,
    familySelectId,
    setFamilySelectId: track(setFamilySelectId),
    organizationSelectId,
    setOrganizationSelectId: track(setOrganizationSelectId),
    tagIds,
    setTagIds: track(setTagIds),
    active,
    setActive: track(setActive),
    isSaving,
    serviceLabels,
    linkedToFamilyOrOrg,
    location,
    readOnlyLockedLinesForEditor,
    setPendingLocationId: track(setPendingLocationId),
    setOptimisticLocationSummary,
    saveDisabled,
    handleSubmit,
    handleDeleteContact,
    selectedId,
    updateContact,
    refreshFamilyOrgLists,
  };
}
