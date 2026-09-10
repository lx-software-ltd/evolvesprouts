'use client';

import { ContactsMapCanvas } from '@/components/admin/contacts/contacts-map-canvas';
import { StatusBanner } from '@/components/status-banner';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Card } from '@/components/ui/card';
import { useContactsMapPins } from '@/hooks/use-contacts-map-pins';
import { getGoogleMapsApiKey } from '@/lib/config';

export function ContactsMapPanel() {
  const apiKey = getGoogleMapsApiKey();
  const { pins, isLoading, error } = useContactsMapPins(Boolean(apiKey));

  return (
    <Card aria-label='Map' data-testid='contacts-map-panel'>
      <div className='space-y-3'>
        {apiKey ? null : (
          <StatusBanner variant='info' title='Google Maps is not configured'>
            Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Maps JavaScript API, HTTP-referrer restricted) and
            redeploy to show confirmed addresses on a Hong Kong map.
          </StatusBanner>
        )}
        {error ? <AdminInlineError>{error}</AdminInlineError> : null}
        {apiKey && isLoading ? <p className='text-sm text-slate-600'>Loading map pins…</p> : null}
        {apiKey && !isLoading && pins.length === 0 && !error ? (
          <p className='text-sm text-slate-600'>
            No families, contacts, or organisations have a confirmed address yet.
          </p>
        ) : null}
        {apiKey ? <ContactsMapCanvas apiKey={apiKey} pins={pins} /> : null}
      </div>
    </Card>
  );
}
