/**
 * Shared coordinate parsing and validation for venue/location inline editors.
 * Semantics match the legacy VenuesPanel implementation.
 */
export function parseOptionalCoordinate(raw: string): number | null | typeof NaN {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

export interface LatLngFieldErrors {
  latParseError: boolean;
  lngParseError: boolean;
  latRangeError: boolean;
  lngRangeError: boolean;
  coordinatesInvalid: boolean;
  onlyOneCoordinate: boolean;
}

export interface InlineLocationDraft {
  areaId: string;
  address: string;
  lat: string;
  lng: string;
  existingLocationId: string | null;
  isEditing: boolean;
  isEmpty: boolean;
  isPersistable: boolean;
  isInvalid: boolean;
}

export const EMPTY_INLINE_LOCATION_DRAFT: InlineLocationDraft = {
  areaId: '',
  address: '',
  lat: '',
  lng: '',
  existingLocationId: null,
  isEditing: true,
  isEmpty: true,
  isPersistable: false,
  isInvalid: false,
};

export function evaluateInlineLocationDraft(input: {
  areaId: string;
  address: string;
  lat: string;
  lng: string;
  existingLocationId: string | null;
  isEditing: boolean;
  readOnly: boolean;
}): InlineLocationDraft {
  const addressTrim = input.address.trim();
  const latTrim = input.lat.trim();
  const lngTrim = input.lng.trim();
  const isEmpty = !input.areaId && !addressTrim && !latTrim && !lngTrim;
  const coordErrors = computeLatLngErrors(input.lat, input.lng);
  const coordsBad = coordErrors.coordinatesInvalid || coordErrors.onlyOneCoordinate;
  const missingArea = !isEmpty && !input.areaId;

  if (input.readOnly || !input.isEditing) {
    return {
      areaId: input.areaId,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      existingLocationId: input.existingLocationId,
      isEditing: input.isEditing,
      isEmpty,
      isPersistable: false,
      isInvalid: false,
    };
  }

  const isInvalid = coordsBad || missingArea;
  return {
    areaId: input.areaId,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    existingLocationId: input.existingLocationId,
    isEditing: true,
    isEmpty,
    isPersistable: Boolean(input.areaId) && !isInvalid,
    isInvalid,
  };
}

export function buildLocationWritePayload(draft: InlineLocationDraft): {
  area_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
} {
  const latParsed = parseOptionalCoordinate(draft.lat);
  const lngParsed = parseOptionalCoordinate(draft.lng);
  return {
    area_id: draft.areaId,
    address: draft.address.trim() || null,
    lat: draft.lat.trim() === '' ? null : (latParsed as number),
    lng: draft.lng.trim() === '' ? null : (lngParsed as number),
  };
}

export function computeLatLngErrors(latRaw: string, lngRaw: string): LatLngFieldErrors {
  const latTrim = latRaw.trim();
  const lngTrim = lngRaw.trim();
  const latNum = parseOptionalCoordinate(latRaw);
  const lngNum = parseOptionalCoordinate(lngRaw);
  const latParseError = latTrim !== '' && Number.isNaN(latNum);
  const lngParseError = lngTrim !== '' && Number.isNaN(lngNum);
  const latRangeError =
    latTrim !== '' && !latParseError && latNum !== null && (latNum < -90 || latNum > 90);
  const lngRangeError =
    lngTrim !== '' && !lngParseError && lngNum !== null && (lngNum < -180 || lngNum > 180);
  const coordinatesInvalid = latParseError || lngParseError || latRangeError || lngRangeError;
  const onlyOneCoordinate =
    (latTrim !== '') !== (lngTrim !== '') && !latParseError && !lngParseError;
  return {
    latParseError,
    lngParseError,
    latRangeError,
    lngRangeError,
    coordinatesInvalid,
    onlyOneCoordinate,
  };
}
