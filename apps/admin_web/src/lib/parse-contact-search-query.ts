import parsePhoneNumberFromString from 'libphonenumber-js';

export const BILL_TO_PARTY_SEARCH_MIN_CHARS = 2;

const EMAIL_RE = /\S+@\S+\.\S+/;
const DEFAULT_PHONE_REGION = 'HK';

export interface ParsedContactSearchQuery {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phoneRegion: string | null;
  phoneNational: string | null;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function splitName(raw: string): { firstName: string; lastName: string | null } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0].slice(0, 100), lastName: null };
  }
  return {
    firstName: parts[0].slice(0, 100),
    lastName: parts.slice(1).join(' ').slice(0, 100),
  };
}

function parsePhoneToken(raw: string): { region: string; national: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed =
    parsePhoneNumberFromString(trimmed) ??
    parsePhoneNumberFromString(trimmed, DEFAULT_PHONE_REGION);
  if (parsed && (parsed.isValid() || parsed.isPossible())) {
    return {
      region: parsed.country ?? DEFAULT_PHONE_REGION,
      national: String(parsed.nationalNumber),
    };
  }
  const digits = digitsOnly(trimmed);
  if (digits.length >= 6 && digits.length <= 20) {
    const letterCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
    if (letterCount === 0) {
      return { region: DEFAULT_PHONE_REGION, national: digits };
    }
  }
  return null;
}

function emailLocalPart(email: string): string {
  const local = email.split('@')[0]?.trim() ?? '';
  return local.slice(0, 100);
}

/**
 * Map a single search box value to create-contact fields.
 * Email and phone win when the whole string looks like those; otherwise name tokens.
 */
export function parseContactSearchQuery(raw: string): ParsedContactSearchQuery {
  const trimmed = raw.trim();
  const emailMatch = trimmed.match(EMAIL_RE);
  if (emailMatch) {
    const email = emailMatch[0];
    const rest = trimmed.replace(email, ' ').trim();
    const name = splitName(rest);
    const firstName = name.firstName || emailLocalPart(email) || trimmed.slice(0, 100);
    return {
      firstName,
      lastName: name.lastName,
      email,
      phoneRegion: null,
      phoneNational: null,
    };
  }

  const phone = parsePhoneToken(trimmed);
  if (phone) {
    return {
      firstName: trimmed.slice(0, 100),
      lastName: null,
      email: null,
      phoneRegion: phone.region,
      phoneNational: phone.national,
    };
  }

  const name = splitName(trimmed);
  return {
    firstName: name.firstName || trimmed.slice(0, 100),
    lastName: name.lastName,
    email: null,
    phoneRegion: null,
    phoneNational: null,
  };
}
