'use client';

import { useEffect, useMemo, useState } from 'react';

import { PublicSiteQrExportPanel } from '@/components/admin/public-site-qr-export-panel';
import { AdminDialog } from '@/components/ui/admin-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import { trackAdminAnalyticsEvent } from '@/lib/admin-analytics';
import { buildMyBestAuntieInstanceBookingLink } from '@/lib/booking-links';
import { tryCopyTextToClipboard } from '@/lib/clipboard';
import { getPublicSiteBaseUrl } from '@/lib/config';
import {
  MY_BEST_AUNTIE_REFERRAL_LOCALES,
  REFERRAL_LOCALE_DISPLAY_LABELS,
  type MyBestAuntieReferralLocale,
} from '@/lib/referral-links';

export interface BookingLinkDialogProps {
  open: boolean;
  onClose: () => void;
  parentServiceKey: string | null;
  parentServiceType: string | null;
  parentServiceTier: string | null;
  slug: string;
}

export function BookingLinkDialog({
  open,
  onClose,
  parentServiceKey,
  parentServiceType,
  parentServiceTier,
  slug,
}: BookingLinkDialogProps) {
  const [locale, setLocale] = useState<MyBestAuntieReferralLocale>('en');
  const [copyError, setCopyError] = useState('');
  const { copiedKey, markCopied } = useCopyFeedback(1000);
  const baseUrl = useMemo(() => getPublicSiteBaseUrl(), []);
  const builtUrl = useMemo(() => {
    if (!baseUrl) {
      return '';
    }
    return buildMyBestAuntieInstanceBookingLink({
      baseUrl,
      locale,
      parentServiceKey,
      parentServiceType,
      parentServiceTier,
      slug,
    });
  }, [baseUrl, locale, parentServiceKey, parentServiceTier, parentServiceType, slug]);

  useEffect(() => {
    if (open && builtUrl) {
      trackAdminAnalyticsEvent('admin_booking_link_opened', {
        service_key: parentServiceKey ?? '',
        locale,
        service_tier: parentServiceTier ?? '',
      });
    }
  }, [builtUrl, locale, open, parentServiceKey, parentServiceTier]);

  const configError = !baseUrl.trim()
    ? 'Set NEXT_PUBLIC_PUBLIC_SITE_BASE_URL to generate booking links.'
    : '';
  const isCopied = copiedKey === 'booking-link';

  async function handleCopy() {
    if (!builtUrl) {
      return;
    }
    const ok = await tryCopyTextToClipboard(builtUrl);
    if (!ok) {
      setCopyError('Could not copy the link. Select the preview URL instead.');
      return;
    }
    setCopyError('');
    markCopied('booking-link');
    trackAdminAnalyticsEvent('admin_booking_link_copied', {
      service_key: parentServiceKey ?? '',
      locale,
      service_tier: parentServiceTier ?? '',
    });
  }

  return (
    <AdminDialog
      open={open}
      title='Booking link'
      description='Share this link to open the My Best Auntie confirm and pay form on this cohort. Locale is included in the URL.'
      onClose={onClose}
    >
      <div className='space-y-4' aria-label='Booking link configuration and preview'>
        <div>
          <Label htmlFor='booking-link-locale'>Locale</Label>
          <Select
            id='booking-link-locale'
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
        <Button
          type='button'
          size='sm'
          variant={isCopied ? 'success' : 'secondary'}
          disabled={!builtUrl}
          onClick={() => void handleCopy()}
        >
          {isCopied ? 'Link copied' : 'Copy link'}
        </Button>
        {copyError ? <p className='text-sm text-red-600'>{copyError}</p> : null}
        <PublicSiteQrExportPanel
          builtUrl={open ? builtUrl : ''}
          configError={configError}
          previewAriaLabel='QR code preview for booking link'
          downloadFilenameBase={`booking-${slug.trim().toLowerCase() || 'cohort'}`}
          downloadEvent='admin_booking_link_qr_downloaded'
          analyticsParams={{
            service_key: parentServiceKey ?? '',
            locale,
            service_tier: parentServiceTier ?? '',
          }}
          fieldIds={{
            includeLogo: 'booking-link-qr-include-logo',
            applyBranding: 'booking-link-qr-apply-branding',
            previewUrl: 'booking-link-preview-url',
          }}
          previewUrlPresentation='referral'
        />
      </div>
    </AdminDialog>
  );
}
