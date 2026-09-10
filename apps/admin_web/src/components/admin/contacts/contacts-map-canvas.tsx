'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { AdminInlineError } from '@/components/ui/admin-inline-error';
import {
  adminContactsMapPinDeepLink,
  contactsMapPinKindLabel,
  type RelatedPartyKind,
} from '@/lib/contact-related-links';
import { groupMapPinsByCoordinate, type GroupedContactMapPin } from '@/lib/contacts-map-pins';
import type { AdminContactMapPin } from '@/lib/entity-api';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import {
  HONG_KONG_MAP_BOUNDS,
  HONG_KONG_MAP_CENTER,
  HONG_KONG_MAP_DEFAULT_ZOOM,
} from '@/lib/hong-kong-map-bounds';

export interface ContactsMapCanvasProps {
  apiKey: string;
  pins: AdminContactMapPin[];
}

function pinKind(entityType: AdminContactMapPin['entity_type']): RelatedPartyKind {
  return entityType;
}

export function ContactsMapCanvas({ apiKey, pins }: ContactsMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const groups = useMemo(() => groupMapPinsByCoordinate(pins), [pins]);
  const selected = groups.find((group) => group.key === selectedKey) ?? null;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || !apiKey) {
      return undefined;
    }

    void loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const map = new maps.Map(containerRef.current, {
          center: HONG_KONG_MAP_CENTER,
          zoom: HONG_KONG_MAP_DEFAULT_ZOOM,
          restriction: {
            latLngBounds: HONG_KONG_MAP_BOUNDS,
            strictBounds: false,
          },
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        map.addListener('click', () => {
          setSelectedKey(null);
        });
        mapRef.current = map;
        setMapReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load Google Maps.';
        setLoadError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = typeof window === 'undefined' ? undefined : window.google?.maps;
    if (!mapReady || !map || !maps) {
      return undefined;
    }

    for (const marker of markersRef.current) {
      marker.setMap(null);
    }

    markersRef.current = groups.map((group) => {
      const marker = new maps.Marker({
        map,
        position: { lat: group.lat, lng: group.lng },
        title: group.items.map((item) => item.label).join(', '),
      });
      marker.addListener('click', () => {
        setSelectedKey(group.key);
      });
      return marker;
    });

    return () => {
      for (const marker of markersRef.current) {
        marker.setMap(null);
      }
      markersRef.current = [];
    };
  }, [groups, mapReady]);

  return (
    <div className='space-y-3'>
      {loadError ? <AdminInlineError>{loadError}</AdminInlineError> : null}
      <div
        ref={containerRef}
        className='h-[min(70vh,40rem)] w-full overflow-hidden rounded-md border border-slate-200'
        role='application'
        aria-label='Hong Kong map of confirmed addresses'
      />
      <ContactsMapPinDetails group={selected} />
    </div>
  );
}

function ContactsMapPinDetails({ group }: { group: GroupedContactMapPin | null }) {
  if (!group) {
    return (
      <p className='text-sm text-slate-600'>
        Click a red pin to see the family, contact, or organisation at that address.
      </p>
    );
  }

  return (
    <div className='space-y-3' aria-live='polite' data-testid='contacts-map-pin-details'>
      {group.items.map((pin) => (
        <article
          key={`${pin.entity_type}:${pin.id}`}
          className='space-y-1 rounded-md border border-slate-200 p-3'
        >
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            {contactsMapPinKindLabel(pinKind(pin.entity_type))}
          </p>
          <p className='text-sm font-semibold text-slate-900'>{pin.label}</p>
          {pin.contact_type ? (
            <p className='text-sm text-slate-600'>Type: {pin.contact_type}</p>
          ) : null}
          {pin.organization_type ? (
            <p className='text-sm text-slate-600'>Type: {pin.organization_type}</p>
          ) : null}
          <p className='text-sm text-slate-700 wrap-anywhere'>
            {pin.address}
            {pin.area_name ? ` · ${pin.area_name}` : ''}
          </p>
          {pin.member_labels && pin.member_labels.length > 0 ? (
            <p className='text-sm text-slate-600 wrap-anywhere'>
              Members: {pin.member_labels.join(', ')}
            </p>
          ) : null}
          <a
            href={adminContactsMapPinDeepLink(pinKind(pin.entity_type), pin.id)}
            className='inline-flex text-sm font-semibold text-slate-900 underline'
          >
            Open
          </a>
        </article>
      ))}
    </div>
  );
}
