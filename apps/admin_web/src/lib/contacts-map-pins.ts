import type { AdminContactMapPin } from '@/lib/entity-api';

export interface GroupedContactMapPin {
  key: string;
  lat: number;
  lng: number;
  items: AdminContactMapPin[];
}

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Collapse pins that share the same stored coordinates into one marker. */
export function groupMapPinsByCoordinate(pins: readonly AdminContactMapPin[]): GroupedContactMapPin[] {
  const groups = new Map<string, AdminContactMapPin[]>();
  for (const pin of pins) {
    if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
      continue;
    }
    const key = coordinateKey(pin.lat, pin.lng);
    const existing = groups.get(key);
    if (existing) {
      existing.push(pin);
    } else {
      groups.set(key, [pin]);
    }
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    lat: items[0].lat,
    lng: items[0].lng,
    items,
  }));
}
