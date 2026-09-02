'use client';

import { useEffect, useMemo, useState } from 'react';

import { PublicSiteQrExportPanel } from '@/components/admin/public-site-qr-export-panel';
import { AdminDialog } from '@/components/ui/admin-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { trackAdminAnalyticsEvent } from '@/lib/admin-analytics';
import { getPublicSiteBaseUrl } from '@/lib/config';
import {
  buildPublicReferralUrlWithSlug,
  MY_BEST_AUNTIE_REFERRAL_LOCALES,
  REFERRAL_LOCALE_DISPLAY_LABELS,
  type MyBestAuntieReferralLocale,
  type ReferralParamName,
} from '@/lib/referral-links';
import type { DiscountType } from '@/types/services';

export interface ReferralLinkQrDialogProps {
  open: boolean;
  onClose: () => void;
  discountCode: string;
  /** Public `services.service_key` for deep link, or null for locale home. */
  serviceKey: string | null;
  discountType: DiscountType;
}

export function ReferralLinkQrDialog({
  open,
  onClose,
  discountCode,
  serviceKey,
  discountType,
}: ReferralLinkQrDialogProps) {
  const [locale, setLocale] = useState<MyBestAuntieReferralLocale>('en');
  const paramName: ReferralParamName = discountType === 'referral' ? 'ref' : 'discount';

  const baseUrl = useMemo(() => getPublicSiteBaseUrl(), []);
  const builtUrl = useMemo(() => {
    if (!baseUrl) {
      return '';
    }
    return buildPublicReferralUrlWithSlug({
      baseUrl,
      locale,
      serviceKey,
      code: discountCode,
      paramName,
    });
  }, [baseUrl, discountCode, locale, paramName, serviceKey]);

  const analyticsSlugTag = serviceKey?.trim().toLowerCase() || 'home';

  useEffect(() => {
    if (open) {
      trackAdminAnalyticsEvent('admin_referral_qr_opened', { service_key: analyticsSlugTag });
    }
  }, [analyticsSlugTag, open]);

  const configError = !baseUrl.trim()
    ? 'Set NEXT_PUBLIC_PUBLIC_SITE_BASE_URL to generate referral links.'
    : '';

  const previewAriaLabel = `QR code preview for referral link (${analyticsSlugTag})`;

  const destinationHint = serviceKey?.trim()
    ? `Opens the public service page for “${serviceKey.trim()}”.`
    : 'Opens the public site home for the selected locale.';

  return (
    <AdminDialog
      open={open}
      title='Link and QR'
      description={`Share this link or QR. ${destinationHint} Locale is included in the URL for consistent scanning.`}
      onClose={onClose}
    >
      <div className='space-y-4' aria-label='Referral link configuration and preview'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div>
            <Label htmlFor='referral-locale'>Locale</Label>
            <Select
              id='referral-locale'
              value={locale}
              onChange={(event) => setLocale(event.target.value as MyBestAuntieReferralLocale)}
              disabled={Boolean(configError)}
            >
              {MY_BEST_AUNTIE_REFERRAL_LOCALES.map((entry) => (
                <option key={entry} value={entry}>
                  {REFERRAL_LOCALE_DISPLAY_LABELS[entry]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <PublicSiteQrExportPanel
          builtUrl={open ? builtUrl : ''}
          configError={configError}
          previewAriaLabel={previewAriaLabel}
          downloadFilenameBase={`referral-${discountCode.trim().toUpperCase()}`}
          downloadEvent='admin_referral_qr_downloaded'
          analyticsParams={{
            service_key: analyticsSlugTag,
          }}
          fieldIds={{
            includeLogo: 'referral-qr-include-logo',
            applyBranding: 'referral-qr-apply-branding',
            previewUrl: 'referral-preview-url',
          }}
          previewUrlPresentation='referral'
        />
      </div>
    </AdminDialog>
  );
}
