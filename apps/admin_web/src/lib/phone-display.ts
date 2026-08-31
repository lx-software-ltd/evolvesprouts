import parsePhoneNumberFromString, { type CountryCode } from 'libphonenumber-js';

const ISO_REGION = /^[A-Z]{2}$/;
const HK_REGION = 'HK';
const HK_CALLING_CODE = '852';
const HK_NATIONAL_LENGTH = 8;

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function asCountryCode(region: string | null | undefined): CountryCode | undefined {
  const normalized = region?.trim().toUpperCase() ?? '';
  if (!ISO_REGION.test(normalized)) {
    return undefined;
  }
  return normalized as CountryCode;
}

function formatHongKongNational(nationalDigits: string): string | null {
  if (!nationalDigits) {
    return null;
  }
  if (nationalDigits.length === HK_NATIONAL_LENGTH) {
    return `+${HK_CALLING_CODE} ${nationalDigits.slice(0, 4)} ${nationalDigits.slice(4)}`;
  }
  return `+${HK_CALLING_CODE} ${nationalDigits}`;
}

function isHongKong(
  region: CountryCode | undefined,
  e164: string | null,
  parsedCountry: string | undefined
): boolean {
  if (region === HK_REGION || parsedCountry === HK_REGION) {
    return true;
  }
  const e164Digits = digitsOnly(e164);
  return e164Digits.startsWith(HK_CALLING_CODE) && e164Digits.length === HK_CALLING_CODE.length + HK_NATIONAL_LENGTH;
}

/**
 * International display for stored contact phone fields.
 * Hong Kong 8-digit numbers always use +852 1234 5678 grouping.
 */
export function formatPhoneInternationalDisplay(input: {
  phoneRegion?: string | null;
  phoneNationalNumber?: string | null;
  phoneE164?: string | null;
}): string | null {
  const e164 = input.phoneE164?.trim() || null;
  const region = asCountryCode(input.phoneRegion);
  const national = digitsOnly(input.phoneNationalNumber);

  const parsedFromE164 = e164 ? parsePhoneNumberFromString(e164) : undefined;
  const parsedFromNational =
    !parsedFromE164 && region && national ? parsePhoneNumberFromString(national, region) : undefined;
  const parsed = parsedFromE164 ?? parsedFromNational;

  const nationalDigits = parsed?.nationalNumber ? String(parsed.nationalNumber) : national;
  if (isHongKong(region, e164, parsed?.country) && nationalDigits) {
    return formatHongKongNational(nationalDigits);
  }

  if (parsed) {
    return parsed.formatInternational();
  }

  return e164 || (national ? national : null);
}
