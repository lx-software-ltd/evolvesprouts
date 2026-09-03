'use client';

import { useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { SalesSettings, UpdateSalesSettingsRequest } from '@/lib/sales-settings-api';
import type { AdminUser } from '@/types/leads';

const SETTINGS_FORM_ID = 'sales-settings-form';

export interface SalesConfigurationViewProps {
  users: AdminUser[];
  settings: SalesSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  onSave: (body: UpdateSalesSettingsRequest) => Promise<void>;
}

/**
 * Sales settings as an untitled card on the standard editor layout: field
 * grid, then one action row with the Save button (no heading, no Cancel).
 */
export function SalesConfigurationView({
  users,
  settings,
  isLoading,
  isSaving,
  error,
  onSave,
}: SalesConfigurationViewProps) {
  const [defaultAssignedTo, setDefaultAssignedTo] = useState(
    settings?.default_assigned_to ?? ''
  );
  const [notifyAssignee, setNotifyAssignee] = useState(
    settings?.notify_assignee_on_assignment ?? false
  );
  const [helperDetectorEnabled, setHelperDetectorEnabled] = useState(
    settings?.helper_detector_enabled ?? false
  );
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  const settingsKey = settings
    ? `${settings.default_assigned_to ?? ''}:${settings.notify_assignee_on_assignment}:${settings.helper_detector_enabled}`
    : null;
  if (settingsKey && settingsKey !== hydratedKey) {
    setHydratedKey(settingsKey);
    setDefaultAssignedTo(settings?.default_assigned_to ?? '');
    setNotifyAssignee(settings?.notify_assignee_on_assignment ?? false);
    setHelperDetectorEnabled(settings?.helper_detector_enabled ?? false);
  }

  const staleUserLabel =
    defaultAssignedTo && !users.some((user) => user.sub === defaultAssignedTo)
      ? defaultAssignedTo
      : null;

  const handleSubmit = async () => {
    try {
      await onSave({
        default_assigned_to: defaultAssignedTo || null,
        notify_assignee_on_assignment: notifyAssignee,
        helper_detector_enabled: helperDetectorEnabled,
      });
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  };

  return (
    <Card aria-label='Sales configuration'>
      <AdminEditorPanel
        status={
          error ? (
            <StatusBanner variant='error' title='Sales configuration'>
              {error}
            </StatusBanner>
          ) : null
        }
        actions={
          <Button type='submit' form={SETTINGS_FORM_ID} disabled={isLoading} loading={isSaving}>
            Save
          </Button>
        }
      >
        {isLoading && !settings ? (
          <p className='text-sm text-slate-600'>Loading configuration…</p>
        ) : (
          <form
            id={SETTINGS_FORM_ID}
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <AdminFieldGrid columns={4}>
              <AdminField
                label='Default assignee'
                htmlFor='sales-settings-default-assignee'
                span={2}
                hint='Applied to new leads when no assignee is chosen. Pipeline create pre-fills this value; choosing Unassigned there leaves the lead unassigned.'
              >
                <Select
                  id='sales-settings-default-assignee'
                  value={defaultAssignedTo}
                  onChange={(event) => setDefaultAssignedTo(event.target.value)}
                >
                  <option value=''>Unassigned</option>
                  {staleUserLabel ? <option value={staleUserLabel}>{staleUserLabel}</option> : null}
                  {users.map((user) => (
                    <option key={user.sub} value={user.sub}>
                      {user.name || user.email || user.sub}
                    </option>
                  ))}
                </Select>
              </AdminField>
            </AdminFieldGrid>

            <AdminFieldGrid columns={1}>
              <AdminField>
                <div className='flex items-center gap-2'>
                  <input
                    id='sales-settings-notify-assignee'
                    type='checkbox'
                    className='h-4 w-4 rounded border-slate-300 text-slate-900'
                    checked={notifyAssignee}
                    onChange={(event) => setNotifyAssignee(event.target.checked)}
                  />
                  <Label htmlFor='sales-settings-notify-assignee' className='mb-0 cursor-pointer font-normal'>
                    Email the assignee when a lead is assigned to them
                  </Label>
                </div>
              </AdminField>
              <AdminField hint='When enabled, new automated leads whose name or username looks Filipino or Bahasa (Indonesian/Malay) are set to funnel stage Unqualified. Contact type becomes Helper only when it is currently Other.'>
                <div className='flex items-center gap-2'>
                  <input
                    id='sales-settings-helper-detector'
                    type='checkbox'
                    className='h-4 w-4 rounded border-slate-300 text-slate-900'
                    checked={helperDetectorEnabled}
                    onChange={(event) => setHelperDetectorEnabled(event.target.checked)}
                  />
                  <Label htmlFor='sales-settings-helper-detector' className='mb-0 cursor-pointer font-normal'>
                    Helper Detector
                  </Label>
                </div>
              </AdminField>
            </AdminFieldGrid>
          </form>
        )}
      </AdminEditorPanel>
    </Card>
  );
}
