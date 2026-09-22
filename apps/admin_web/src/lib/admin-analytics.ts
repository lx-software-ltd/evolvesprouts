'use client';

type AnalyticsPrimitive = string | number | boolean;

export type AdminAnalyticsEventName =
  | 'admin_referral_qr_opened'
  | 'admin_referral_qr_downloaded'
  | 'admin_public_page_qr_opened'
  | 'admin_public_page_qr_downloaded'
  | 'admin_booking_link_opened'
  | 'admin_booking_link_copied'
  | 'admin_booking_link_qr_downloaded';

export type AdminAnalyticsEventParams = Record<
  string,
  string | number | boolean | null | undefined
>;

interface AdminDataLayerEventPayload {
  event: string;
  page_path: string;
  page_title: string;
  page_locale: string;
  section_id: string;
  cta_location: string;
  environment: string;
  app_surface: 'admin';
  [key: string]: unknown;
}

/** GTM may use a stub object with `push` before `dataLayer` becomes a real array. */
type AdminWindowDataLayer =
  | AdminDataLayerEventPayload[]
  | { push: (item: AdminDataLayerEventPayload) => void };

const DEFAULT_SECTION_ID = 'admin';
const DEFAULT_CTA_LOCATION = 'n/a';
const DEFAULT_LOCALE = 'en';

declare global {
  interface Window {
    dataLayer?: AdminWindowDataLayer;
  }
}

function isClientRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function resolveEnvironment(): string {
  if (!isClientRuntime()) {
    return 'prod';
  }
  const currentHost = window.location.hostname.toLowerCase();
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return 'staging';
  }
  if (currentHost.includes('staging') || currentHost.includes('preview')) {
    return 'staging';
  }
  return 'prod';
}

function resolvePageLocale(): string {
  if (!isClientRuntime()) {
    return DEFAULT_LOCALE;
  }
  const locale = document.documentElement.lang.trim();
  return locale || DEFAULT_LOCALE;
}

function removeUndefinedParams(
  params: Record<string, AnalyticsPrimitive | null | undefined> | undefined,
): Record<string, AnalyticsPrimitive> {
  if (!params) {
    return {};
  }
  return Object.entries(params).reduce<Record<string, AnalyticsPrimitive>>((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function pushAdminDataLayerPayload(
  eventName: AdminAnalyticsEventName,
  params?: Record<string, AnalyticsPrimitive | null | undefined>,
): void {
  if (!isClientRuntime()) {
    return;
  }
  if (!process.env.NEXT_PUBLIC_ADMIN_GTM_CONTAINER_ID?.trim()) {
    return;
  }
  const normalized = eventName.trim();
  if (!normalized) {
    return;
  }
  const payload: AdminDataLayerEventPayload = {
    event: normalized,
    page_path: window.location.pathname,
    page_title: document.title,
    page_locale: resolvePageLocale(),
    section_id: DEFAULT_SECTION_ID,
    cta_location: DEFAULT_CTA_LOCATION,
    environment: resolveEnvironment(),
    app_surface: 'admin',
    ...removeUndefinedParams(params),
  };
  const layer = window.dataLayer;
  if (Array.isArray(layer)) {
    layer.push(payload);
    return;
  }
  if (layer && typeof layer.push === 'function') {
    layer.push(payload);
    return;
  }
  try {
    window.dataLayer = [payload];
  } catch {
    Object.defineProperty(window, 'dataLayer', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: [payload],
    });
  }
}

/**
 * Pushes admin UI events to `window.dataLayer` for GTM/GA4 when
 * `NEXT_PUBLIC_ADMIN_GTM_CONTAINER_ID` is set (same pattern as public_www).
 */
export function trackAdminAnalyticsEvent(
  event: AdminAnalyticsEventName,
  params?: AdminAnalyticsEventParams,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  pushAdminDataLayerPayload(event, params);
}
