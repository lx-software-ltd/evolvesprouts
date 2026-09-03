'use client';

import { useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
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
    <AdminEditorCard
      title='Sales configuration'
      description='Choose who receives new leads, assignment email notifications, and Helper Detector.'
      actions={
        <Button type='submit' form={SETTINGS_FORM_ID} disabled={isLoading} loading={isSaving}>
          Save
        </Button>
      }
    >
      {error ? (
        <StatusBanner variant='error' title='Sales configuration'>
          {error}
        </StatusBanner>
      ) : null}

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
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div>
              <Label htmlFor='sales-settings-default-assignee'>Default assignee</Label>
              <Select
                id='sales-settings-default-assignee'
                value={defaultAssignedTo}
                onChange={(event) => setDefaultAssignedTo(event.target.value)}
              >
                <option value=''>Unassigned</option>
                {staleUserLabel ? (
                  <option value={staleUserLabel}>{staleUserLabel}</option>
                ) : null}
                {users.map((user) => (
                  <option key={user.sub} value={user.sub}>
                    {user.name || user.email || user.sub}
                  </option>
                ))}
              </Select>
              <p className='mt-1 text-xs text-slate-500'>
                Applied to new leads when no assignee is chosen. Pipeline create
                pre-fills this value; choosing Unassigned there leaves the lead
                unassigned.
              </p>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <input
              id='sales-settings-notify-assignee'
              type='checkbox'
              className='h-4 w-4 rounded border-slate-300 text-slate-900'
              checked={notifyAssignee}
              onChange={(event) => setNotifyAssignee(event.target.checked)}
            />
            <Label
              htmlFor='sales-settings-notify-assignee'
              className='mb-0 cursor-pointer font-normal'
            >
              Email the assignee when a lead is assigned to them
            </Label>
          </div>

          <div className='flex items-start gap-2'>
            <input
              id='sales-settings-helper-detector'
              type='checkbox'
              className='mt-1 h-4 w-4 rounded border-slate-300 text-slate-900'
              checked={helperDetectorEnabled}
              onChange={(event) => setHelperDetectorEnabled(event.target.checked)}
            />
            <div>
              <Label
                htmlFor='sales-settings-helper-detector'
                className='mb-0 cursor-pointer font-normal'
              >
                Helper Detector
              </Label>
              <p className='mt-1 text-xs text-slate-500'>
                When enabled, new automated leads whose name or username looks Filipino
                or Bahasa (Indonesian/Malay) are set to funnel stage Unqualified. Contact
                type becomes Helper only when it is currently Other.
              </p>
            </div>
          </div>
        </form>
      )}
    </AdminEditorCard>
  );
}
