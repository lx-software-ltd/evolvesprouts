/**
 * Public site config reads `process.env.NEXT_PUBLIC_*` with literal property
 * access only. Next.js inlines those at build time; dynamic keys like
 * `process.env[name]` are undefined in client bundles.
 */
export interface PublicSiteConfig {
  instagramUrl?: string;
  linkedinUrl?: string;
  whatsappUrl?: string;
  contactEmail: string;
  businessAddress?: string;
  businessPhoneNumber?: string;
  founderName?: string;
}

function normalizeOptionalEnvValue(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseConfiguredUrl(value: string): URL | null {
  const normalizedValue = value.trim();
  if (
    !normalizedValue
    || normalizedValue.startsWith('//')
    || normalizedValue.startsWith('/')
    || normalizedValue.startsWith('?')
    || normalizedValue.startsWith('#')
  ) {
    return null;
  }

  try {
    return new URL(normalizedValue);
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedValue)) {
      return null;
    }

    const hostCandidate = normalizedValue
      .split(/[/?#]/, 1)[0]
      ?.toLowerCase()
      .trim() ?? '';
    const isLocalhostCandidate =
      hostCandidate === 'localhost' || /^localhost:\d+$/.test(hostCandidate);
    const isDottedHostnameCandidate =
      hostCandidate.includes('.') && /^[a-z0-9.-]+(?::\d+)?$/.test(hostCandidate);
    if (!isLocalhostCandidate && !isDottedHostnameCandidate) {
      return null;
    }

    try {
      return new URL(`https://${normalizedValue}`);
    } catch {
      return null;
    }
  }
}

function isAllowedPublicUrl(url: URL): boolean {
  const protocol = url.protocol.toLowerCase();
  if (protocol === 'https:') {
    return true;
  }

  return protocol === 'http:' && url.hostname.toLowerCase() === 'localhost';
}

function normalizeConfiguredUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsedUrl = parseConfiguredUrl(value);
  if (!parsedUrl || !isAllowedPublicUrl(parsedUrl)) {
    return undefined;
  }

  return parsedUrl.toString();
}

function normalizeConfiguredEmail(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function resolveRequiredContactEmail(): string {
  const normalizedEmail = normalizeConfiguredEmail(
    normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_EMAIL),
  );
  if (!normalizedEmail) {
    throw new Error(
      'NEXT_PUBLIC_EMAIL must be configured with a valid email address.',
    );
  }

  return normalizedEmail;
}

function isWhatsappShortLink(url: URL): boolean {
  return url.hostname === 'wa.me' && url.pathname.startsWith('/message/');
}

function normalizePhoneForWhatsapp(phone: string | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

export function buildWhatsappPrefilledHref(
  baseWhatsappUrl: string | undefined,
  message: string | undefined,
  phoneNumber?: string,
): string {
  const normalizedBaseUrl = normalizeConfiguredUrl(baseWhatsappUrl);
  if (!normalizedBaseUrl) {
    return '';
  }

  const parsedUrl = parseConfiguredUrl(normalizedBaseUrl);
  if (!parsedUrl) {
    return '';
  }

  const normalizedMessage = message?.trim() ?? '';
  if (!normalizedMessage) {
    return parsedUrl.toString();
  }

  if (isWhatsappShortLink(parsedUrl)) {
    const digits = normalizePhoneForWhatsapp(phoneNumber);
    if (!digits) {
      return parsedUrl.toString();
    }
    const directUrl = new URL(`https://wa.me/${digits}`);
    directUrl.searchParams.set('text', normalizedMessage);
    return directUrl.toString();
  }

  parsedUrl.searchParams.set('text', normalizedMessage);
  return parsedUrl.toString();
}

export interface UtmParams {
  source: string;
  medium: string;
  campaign?: string;
  content?: string;
}

export function buildUtmHref(
  baseHref: string,
  params: UtmParams,
): string {
  const parsedUrl = parseConfiguredUrl(baseHref);
  if (!parsedUrl) {
    return baseHref;
  }

  parsedUrl.searchParams.set('utm_source', params.source);
  parsedUrl.searchParams.set('utm_medium', params.medium);
  if (params.campaign) {
    parsedUrl.searchParams.set('utm_campaign', params.campaign);
  }
  if (params.content) {
    parsedUrl.searchParams.set('utm_content', params.content);
  }

  return parsedUrl.toString();
}

export function resolvePublicSiteConfig(): PublicSiteConfig {
  return {
    instagramUrl: normalizeConfiguredUrl(
      normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_INSTAGRAM_URL),
    ),
    linkedinUrl: normalizeConfiguredUrl(
      normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_LINKEDIN_URL),
    ),
    whatsappUrl: normalizeConfiguredUrl(
      normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_WHATSAPP_URL),
    ),
    contactEmail: resolveRequiredContactEmail(),
    businessAddress: normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_BUSINESS_ADDRESS),
    businessPhoneNumber: normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_BUSINESS_PHONE_NUMBER),
    founderName: normalizeOptionalEnvValue(process.env.NEXT_PUBLIC_FOUNDER_NAME),
  };
}
